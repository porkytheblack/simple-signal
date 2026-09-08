import { topologicalSort, type BroadcastDefinition, type FailurePolicy } from "station-broadcast/browser";
import type { AnySignal } from "station-signal/browser";
import { type BrowserRun, IndexedDBStore } from "./store.js";

export interface BrowserBroadcastNode {
  name: string;
  signalName: string;
  dependsOn: string[];
  status: "pending" | "running" | "completed" | "failed" | "skipped";
  skipReason?: "guard" | "upstream-failed" | "cancelled";
  signalRunId?: string;
  output?: string;
  error?: string;
}
export interface BrowserBroadcastRun {
  id: string;
  broadcastName: string;
  input: string;
  status: "pending" | "running" | "completed" | "failed" | "cancelled";
  definitionVersion: string;
  failurePolicy: FailurePolicy;
  timeout?: number;
  createdAt: Date;
  completedAt?: Date;
  error?: string;
  nodes: BrowserBroadcastNode[];
}

export function makeRun(signal: AnySignal, input: unknown, version: string, id: string = crypto.randomUUID()): BrowserRun {
  const serialized = JSON.stringify(signal.inputSchema.parse(input));
  if (serialized === undefined) throw new Error("Signal input must be JSON serializable");
  return {
    id, signalName: signal.name, input: serialized, kind: "trigger", status: "pending",
    attempts: 0, maxAttempts: signal.maxAttempts, timeout: signal.timeout,
    createdAt: new Date(), checkpoints: [], definitionVersion: version,
  };
}

const terminal = (node: BrowserBroadcastNode) => ["completed", "failed", "skipped"].includes(node.status);

/** Reconciliation and child enqueue happen in the same transaction, across all tabs. */
export class BrowserBroadcasts {
  private definitions = new Map<string, BroadcastDefinition>();
  constructor(private store: IndexedDBStore, definitions: BroadcastDefinition[], private version: string) {
    for (const def of definitions) {
      if (this.definitions.has(def.name)) throw new Error(`Duplicate broadcast: ${def.name}`);
      if (def.interval) throw new Error(`${def.name}: browser recurring broadcasts are not supported`);
      if (def.timeout !== undefined && (!Number.isFinite(def.timeout) || def.timeout <= 0)) throw new Error("Invalid broadcast timeout");
      if (!def.nodes.length || new Set(def.nodes.map((node) => node.name)).size !== def.nodes.length
        || def.nodes.some((node) => node.dependsOn.some((dep) => !def.nodes.some((candidate) => candidate.name === dep)))) {
        throw new Error(`${def.name}: invalid DAG`);
      }
      topologicalSort(def.name, def.nodes);
      this.definitions.set(def.name, def);
    }
  }

  async trigger(name: string, input: unknown): Promise<string> {
    const definition = this.definitions.get(name);
    if (!definition) throw new Error(`Unknown browser broadcast: ${name}`);
    const serialized = JSON.stringify(input);
    if (serialized === undefined) throw new Error("Broadcast input must be JSON serializable");
    const id = crypto.randomUUID();
    const run: BrowserBroadcastRun = {
      id, broadcastName: name, input: serialized, status: "pending", definitionVersion: this.version,
      failurePolicy: definition.failurePolicy, timeout: definition.timeout, createdAt: new Date(),
      nodes: topologicalSort(name, definition.nodes).map((node) => ({
        name: node.name, signalName: node.signalName, dependsOn: [...node.dependsOn], status: "pending",
      })),
    };
    await this.store.atomic<void>(["broadcasts"], "readwrite", (tx) => { tx.objectStore("broadcasts").add(run); });
    return id;
  }

  list(): Promise<BrowserBroadcastRun[]> {
    return this.store.atomic(["broadcasts"], "readonly", (tx, result) => {
      const request = tx.objectStore("broadcasts").getAll();
      request.onsuccess = () => result((request.result as BrowserBroadcastRun[]).sort((a, b) => +b.createdAt - +a.createdAt));
    });
  }

  cancel(id: string): Promise<void> {
    return this.reconcile(id, true);
  }

  async advance(): Promise<void> {
    for (const run of await this.list()) {
      if (["pending", "running"].includes(run.status) && this.definitions.has(run.broadcastName)) await this.reconcile(run.id);
    }
  }

  private reconcile(id: string, cancel = false): Promise<void> {
    return this.store.atomic(["broadcasts", "runs"], "readwrite", (tx) => {
      const parents = tx.objectStore("broadcasts");
      const jobs = tx.objectStore("runs");
      const parentRequest = parents.get(id);
      parentRequest.onsuccess = () => {
        const run: BrowserBroadcastRun | undefined = parentRequest.result;
        if (!run || !["pending", "running"].includes(run.status)) return;
        const definition = this.definitions.get(run.broadcastName);
        if (!definition && !cancel) return;
        const request = jobs.getAll();
        request.onsuccess = () => {
          const children = new Map<string, BrowserRun>((request.result as BrowserRun[]).map((job) => [job.id, job]));
          const stop = (status: "failed" | "cancelled", error: string) => {
            run.status = status; run.error = error; run.completedAt = new Date();
            for (const node of run.nodes) {
              if (terminal(node)) continue;
              const child = node.signalRunId ? children.get(node.signalRunId) : undefined;
              if (child && ["pending", "running"].includes(child.status)) {
                child.status = "cancelled"; child.completedAt = new Date(); child.leaseToken = undefined;
                child.leaseExpiresAt = undefined; jobs.put(child);
              }
              node.status = "skipped"; node.skipReason = "cancelled";
            }
          };
          if (cancel) stop("cancelled", "Cancelled by user");
          else if (run.definitionVersion !== this.version) stop("failed", "Broadcast definition changed; enqueue a new run");
          else if (run.timeout && Date.now() >= +run.createdAt + run.timeout) stop("failed", "Broadcast timed out");
          else {
            run.status = "running";
            for (const node of run.nodes) {
              if (!node.signalRunId || terminal(node)) continue;
              const job = children.get(node.signalRunId);
              if (job?.status === "completed") { node.status = "completed"; node.output = job.output; }
              else if (job?.status === "failed" || job?.status === "cancelled") { node.status = "failed"; node.error = job.error ?? "Signal cancelled"; }
            }
            const byName = new Map(run.nodes.map((node) => [node.name, node]));
            for (const node of run.nodes) {
              if (run.failurePolicy === "fail-fast" && run.nodes.some((n) => n.status === "failed")) {
                stop("failed", "A broadcast node failed (fail-fast)"); break;
              }
              if (node.status !== "pending") continue;
              const deps = node.dependsOn.map((name) => byName.get(name)!);
              if (deps.some((dep) => dep.status === "failed" || dep.skipReason === "upstream-failed")) {
                node.status = "skipped"; node.skipReason = "upstream-failed"; continue;
              }
              if (!deps.every(terminal)) continue;
              const def = definition!.nodes.find((candidate) => candidate.name === node.name)!;
              try {
                const upstream = Object.fromEntries(deps.map((dep) => [dep.name, dep.output === undefined ? undefined : JSON.parse(dep.output)]));
                const input = JSON.parse(run.input);
                const context = { input, upstream };
                const allowed = def.evalGuard ? def.evalGuard(context) : def.when ? def.when(deps.length ? upstream : input) : true;
                if (typeof allowed !== "boolean") throw new Error("Broadcast guards must return a synchronous boolean");
                if (!allowed) { node.status = "skipped"; node.skipReason = "guard"; continue; }
                const mapped = def.evalInput ? def.evalInput(context) : !deps.length ? input : def.map ? def.map(upstream)
                  : deps.length === 1 ? upstream[deps[0].name] : upstream;
                // Stable child IDs and atomic parent+child writes prevent duplicate dispatch on recovery.
                const child = makeRun(def.signal, mapped, this.version, `${run.id}/${node.name}`);
                jobs.add(child); children.set(child.id, child);
                node.signalRunId = child.id; node.status = "running";
              } catch (error) { node.status = "failed"; node.error = String(error); }
            }
            // Catch a guard/map failure on the final node too.
            if (run.status === "running" && run.failurePolicy === "fail-fast" && run.nodes.some((node) => node.status === "failed")) {
              stop("failed", "A broadcast node failed (fail-fast)");
            }
            if (run.status === "running" && run.nodes.every(terminal)) {
              const failed = run.nodes.filter((node) => node.status === "failed");
              run.status = failed.length && run.failurePolicy !== "continue" ? "failed" : "completed";
              run.error = failed.length ? `Nodes failed: ${failed.map((node) => node.name).join(", ")}` : undefined;
              run.completedAt = new Date();
            }
          }
          parents.put(run);
        };
      };
    });
  }
}
