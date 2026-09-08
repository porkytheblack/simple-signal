import type { AnyBeacon, BeaconContext } from "station-beacon/browser";
import { IndexedDBStore } from "./store.js";

export interface BrowserBeaconInstance {
  id: string;
  beaconName: string;
  config: string;
  definitionVersion: string;
  desired: "running" | "stopped";
  status: "starting" | "running" | "stopping" | "suspended" | "backoff" | "stopped" | "errored";
  incarnation: number;
  restarts: number;
  owner?: string;
  token?: string;
  leaseExpiresAt?: number;
  startedAt?: number;
  readyAt?: number;
  heartbeatAt?: number;
  nextRestartAt?: number;
  error?: string;
  logs: { at: number; message: string }[];
}
interface ActiveBeacon {
  record: BrowserBeaconInstance;
  definition: AnyBeacon;
  controller: AbortController;
  ready: boolean;
  heartbeatAt: number;
  cleanups: (() => void | Promise<void>)[];
  work: Promise<void>;
  writes: Promise<unknown>;
  settled: boolean;
  stopping?: Promise<void>;
}

/** Cooperative browser supervision. A lost execution opportunity is a suspension. */
export class BrowserBeacons {
  private definitions = new Map<string, AnyBeacon>();
  private active = new Map<string, ActiveBeacon>();
  private ticking?: Promise<void>;
  private slicing?: Promise<void>;
  private seeded = false;
  private suspending = false;
  readonly leaseMs = 2_500;

  constructor(private store: IndexedDBStore, definitions: AnyBeacon[], private owner: string, private version: string) {
    for (const def of definitions) {
      if (this.definitions.has(def.name)) throw new Error(`Duplicate beacon: ${def.name}`);
      if (def.requiredEnv?.length || def.placement) throw new Error(`${def.name}: env and placement require a server runtime`);
      const values = [def.stopTimeoutMs, def.backoff.baseMs, def.backoff.maxMs, def.backoff.resetAfterMs,
        def.pollIntervalMs, def.startupTimeoutMs, def.heartbeatIntervalMs, def.heartbeatTimeoutMs].filter((n) => n !== undefined);
      if (values.some((n) => !Number.isFinite(n) || n! <= 0) || !Number.isFinite(def.backoff.factor) || def.backoff.factor < 1) {
        throw new Error(`${def.name}: invalid beacon timing configuration`);
      }
      this.definitions.set(def.name, def);
    }
  }

  list(): Promise<BrowserBeaconInstance[]> {
    return this.store.atomic(["beacons"], "readonly", (tx, result) => {
      const request = tx.objectStore("beacons").getAll();
      request.onsuccess = () => result(request.result);
    });
  }

  private change<T>(id: string, fn: (record: BrowserBeaconInstance | undefined) => { record?: BrowserBeaconInstance; result: T }): Promise<T> {
    return this.store.atomic(["beacons"], "readwrite", (tx, result) => {
      const records = tx.objectStore("beacons");
      const request = records.get(id);
      request.onsuccess = () => {
        const next = fn(request.result);
        if (next.record) records.put(next.record);
        result(next.result);
      };
    });
  }

  async start(name: string, options: { instanceId?: string; config?: unknown } = {}): Promise<string> {
    return this.create(name, options, false);
  }

  private async create(name: string, options: { instanceId?: string; config?: unknown }, seed: boolean): Promise<string> {
    const def = this.definitions.get(name);
    if (!def) throw new Error(`Unknown browser beacon: ${name}`);
    const id = options.instanceId ?? name;
    const config = JSON.stringify(def.configSchema.parse(options.config ?? def.defaultConfig ?? {}));
    if (config === undefined) throw new Error("Beacon config must be JSON serializable");
    return this.store.atomic(["beacons"], "readwrite", (tx, result) => {
      const records = tx.objectStore("beacons");
      const request = records.getAll();
      request.onsuccess = () => {
        const all: BrowserBeaconInstance[] = request.result;
        const existing = all.find((record) => record.id === id);
        // Errors must abort the transaction, not leave callers waiting on a thrown event callback.
        if (existing?.beaconName !== undefined && existing.beaconName !== name) { tx.abort(); return; }
        if (seed && existing) { result(id); return; }
        if (!existing && all.filter((record) => record.beaconName === name).length >= (def.maxInstances ?? 8)) { tx.abort(); return; }
        // An active incarnation must be stopped before its configuration can be changed.
        if (existing?.token && (existing.leaseExpiresAt ?? 0) > Date.now()) { result(id); return; }
        const record: BrowserBeaconInstance = existing ?? {
          id, beaconName: name, config, definitionVersion: this.version, desired: "stopped",
          status: "stopped", incarnation: 0, restarts: 0, logs: [],
        };
        record.config = config; record.definitionVersion = this.version;
        record.desired = seed && !def.autoStart ? "stopped" : "running";
        record.status = record.desired === "running" ? "suspended" : "stopped";
        record.error = undefined; record.nextRestartAt = undefined;
        record.token = undefined; record.leaseExpiresAt = undefined;
        records.put(record); result(id);
      };
    });
  }

  async stop(id: string): Promise<void> {
    await this.change(id, (record) => {
      if (!record) return { result: undefined };
      record.desired = "stopped";
      record.status = record.token && (record.leaseExpiresAt ?? 0) > Date.now() ? "stopping" : "stopped";
      return { record, result: undefined };
    });
    const active = this.active.get(id);
    if (active) await this.end(active, "stop");
  }

  tick(): Promise<void> {
    if (this.ticking) return this.ticking;
    this.ticking = this.reconcile().finally(() => { this.ticking = undefined; });
    return this.ticking;
  }

  private async reconcile(): Promise<void> {
    if (this.suspending) return;
    if (!this.seeded) {
      for (const def of this.definitions.values()) if (def.startMode !== "on-demand") await this.create(def.name, {}, true);
      this.seeded = true;
    }
    for (const snapshot of await this.list()) {
      const def = this.definitions.get(snapshot.beaconName);
      if (!def) continue;
      const active = this.active.get(snapshot.id);
      if (active) {
        if (active.stopping) continue;
        if (snapshot.desired === "stopped") { await this.end(active, "stop"); continue; }
        const now = Date.now();
        if (snapshot.token !== active.record.token || (snapshot.leaseExpiresAt ?? 0) <= now) { await this.end(active, "suspend"); continue; }
        if (!active.ready && def.startupTimeoutMs && now - active.record.startedAt! >= def.startupTimeoutMs) {
          await this.end(active, "failure", "Beacon startup timed out"); continue;
        }
        if (def.heartbeatTimeoutMs && now - active.heartbeatAt >= def.heartbeatTimeoutMs) {
          await this.end(active, "failure", "Beacon heartbeat stalled"); continue;
        }
        await this.owned(active, (record) => { record.leaseExpiresAt = now + this.leaseMs; });
        continue;
      }
      if (this.active.size >= 8 || this.suspending) continue;
      const claimed = await this.change<BrowserBeaconInstance | undefined>(snapshot.id, (record) => {
        if (!record || record.desired !== "running" || (record.token && (record.leaseExpiresAt ?? 0) > Date.now())) return { result: undefined };
        if (record.definitionVersion !== this.version) {
          record.status = "errored"; record.desired = "stopped"; record.error = "Beacon definition changed; start again";
          return { record, result: undefined };
        }
        // A process disappearing is suspension; it is resumed regardless of failure restart policy.
        if (record.nextRestartAt && record.nextRestartAt > Date.now()) return { result: undefined };
        record.incarnation++; record.token = crypto.randomUUID(); record.owner = this.owner;
        record.leaseExpiresAt = Date.now() + this.leaseMs; record.startedAt = Date.now();
        record.readyAt = undefined; record.heartbeatAt = record.startedAt;
        record.status = def.startupTimeoutMs ? "starting" : "running";
        return { record, result: record };
      });
      if (claimed) this.launch(claimed, def);
    }
  }

  private owned(active: ActiveBeacon, update: (record: BrowserBeaconInstance) => void): Promise<boolean> {
    return this.change(active.record.id, (record) => {
      if (!record || record.token !== active.record.token || (record.leaseExpiresAt ?? 0) <= Date.now()) return { result: false };
      update(record); return { record, result: true };
    });
  }

  private launch(record: BrowserBeaconInstance, definition: AnyBeacon): void {
    const active: ActiveBeacon = {
      record, definition, controller: new AbortController(), ready: false, heartbeatAt: Date.now(),
      cleanups: [], work: Promise.resolve(), writes: Promise.resolve(), settled: false,
    };
    this.active.set(record.id, active);
    const emit = (update: (record: BrowserBeaconInstance) => void) => {
      if (active.controller.signal.aborted) return;
      active.writes = active.writes.then(() => this.owned(active, update)).catch(() => { active.controller.abort(); });
    };
    const context: BeaconContext = {
      name: definition.name, instanceId: record.id, config: JSON.parse(record.config), incarnation: record.incarnation,
      signal: active.controller.signal,
      ready: () => { active.ready = true; emit((r) => { r.readyAt ??= Date.now(); r.status = "running"; }); },
      heartbeat: () => { active.heartbeatAt = Date.now(); emit((r) => { r.heartbeatAt = active.heartbeatAt; }); },
      log: (message) => emit((r) => { r.logs.push({ at: Date.now(), message: String(message).slice(0, 2_000) }); r.logs = r.logs.slice(-30); }),
      expose: () => { throw new Error("Browser beacons cannot expose a listening server port"); },
      onStop: (fn) => { if (!active.controller.signal.aborted) active.cleanups.push(fn); },
      untilStopped: () => active.controller.signal.aborted ? Promise.resolve()
        : new Promise((resolve) => active.controller.signal.addEventListener("abort", () => resolve(), { once: true })),
    };
    active.work = Promise.resolve().then(() => definition.handler(context)).then(
      () => { active.settled = true; if (!active.stopping) void this.end(active, "clean"); },
      (error) => { active.settled = true; if (!active.stopping) void this.end(active, "failure", String(error)); },
    );
  }

  private end(active: ActiveBeacon, reason: "stop" | "suspend" | "clean" | "failure", error?: string): Promise<void> {
    if (active.stopping) return active.stopping;
    // Defer execution until the guard is assigned: an abort can immediately resolve a handler.
    active.stopping = Promise.resolve().then(async () => {
      await this.owned(active, (record) => { record.leaseExpiresAt = Date.now() + active.definition.stopTimeoutMs + 1_000; });
      active.controller.abort();
      let timer: ReturnType<typeof setTimeout> | undefined;
      let cleaned = false;
      let cleanupError: string | undefined;
      const cleanup = Promise.all([
        active.work,
        (async () => { for (const fn of active.cleanups) await fn(); })(),
      ]).then(() => { cleaned = true; }, (err) => { cleanupError = String(err); });
      await Promise.race([cleanup, new Promise<void>((resolve) => { timer = setTimeout(resolve, active.definition.stopTimeoutMs); })]);
      clearTimeout(timer);
      await active.writes;
      await this.owned(active, (record) => {
        record.token = undefined; record.leaseExpiresAt = undefined;
        if (!cleaned) {
          record.status = "errored"; record.desired = "stopped";
          record.error = cleanupError ?? "Beacon ignored stop; terminate its Web Worker before restarting";
        } else if (record.desired === "stopped" || reason === "stop") { record.status = "stopped"; record.desired = "stopped"; }
        else if (reason === "suspend") { record.status = "suspended"; }
        else {
          const restart = active.definition.restartPolicy === "always" || (reason === "failure" && active.definition.restartPolicy === "on-failure");
          record.error = error;
          if (restart) {
            if (Date.now() - active.record.startedAt! >= active.definition.backoff.resetAfterMs) record.restarts = 0;
            record.restarts++;
            record.nextRestartAt = Date.now() + Math.min(active.definition.backoff.maxMs,
              active.definition.backoff.baseMs * active.definition.backoff.factor ** Math.min(100, record.restarts - 1));
            record.status = "backoff";
          } else { record.status = reason === "failure" ? "errored" : "stopped"; record.desired = "stopped"; }
        }
      });
      // Uncooperative handlers remain blocked in this supervisor until its worker is destroyed.
      if (cleaned) this.active.delete(active.record.id);
    }).catch((err) => { console.error("Browser beacon shutdown failed", err); });
    return active.stopping;
  }

  async suspend(): Promise<void> {
    this.suspending = true;
    try {
      await this.ticking;
      await Promise.all([...this.active.values()].map((active) => this.end(active, "suspend")));
    } finally { this.suspending = false; }
  }

  /** Run beacons during a bounded service-worker wake, then cooperatively suspend. */
  runSlice(durationMs = 1_500): Promise<void> {
    if (this.slicing) return this.slicing;
    if (!Number.isFinite(durationMs) || durationMs <= 0) return Promise.reject(new Error("Invalid beacon slice duration"));
    this.slicing = (async () => {
      const until = Date.now() + durationMs;
      try {
        while (Date.now() < until) {
          await this.tick();
          await new Promise((resolve) => setTimeout(resolve, Math.min(100, Math.max(0, until - Date.now()))));
        }
      } finally { await this.suspend(); }
    })().finally(() => { this.slicing = undefined; });
    return this.slicing;
  }
}
