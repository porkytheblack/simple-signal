import type { AnySignal, Signal, TriggerAdapter } from "station-signal/browser";
import { IndexedDBStore, type BrowserRun } from "./store.js";
import type { BroadcastDefinition } from "station-broadcast/browser";
import type { AnyBeacon } from "station-beacon/browser";
import { BrowserBroadcasts, makeRun } from "./broadcasts.js";
import { BrowserBeacons } from "./beacons.js";

export { signal, z, configure, type Signal } from "station-signal/browser";
export { IndexedDBStore, type BrowserRun, type Checkpoint } from "./store.js";
export { broadcast, type BroadcastDefinition } from "station-broadcast/browser";
export { beacon, sleepOrAbort, type BeaconContext, type AnyBeacon } from "station-beacon/browser";
export { BrowserBroadcasts, type BrowserBroadcastRun, type BrowserBroadcastNode } from "./broadcasts.js";
export { BrowserBeacons, type BrowserBeaconInstance } from "./beacons.js";

export interface BrowserStationOptions {
  signals?: AnySignal[];
  broadcasts?: BroadcastDefinition[];
  beacons?: AnyBeacon[];
  /** Number of async signals this executor may run at once. Not CPU thread parallelism. */
  concurrency?: number;
  database?: string;
  stationId?: string;
  /** Bump when handler/step semantics change. Old runs fail instead of mixing versions. */
  definitionVersion?: string;
}

/** Experimental execution runtime. Construct inside a Web Worker or service worker. */
export class BrowserStation implements TriggerAdapter {
  readonly store: IndexedDBStore;
  readonly stationId: string;
  readonly broadcasts: BrowserBroadcasts;
  readonly beacons: BrowserBeacons;
  private readonly concurrency: number;
  private readonly signals = new Map<string, AnySignal>();
  private readonly version: string;
  private draining?: Promise<number>;

  constructor(options: BrowserStationOptions) {
    this.store = new IndexedDBStore(options.database);
    this.stationId = options.stationId ?? `browser-${crypto.randomUUID()}`;
    this.version = options.definitionVersion ?? "1";
    this.concurrency = options.concurrency ?? 4;
    if (!Number.isSafeInteger(this.concurrency) || this.concurrency < 1) throw new Error("Concurrency must be a positive integer");
    const definitions = [...(options.signals ?? []), ...(options.broadcasts ?? []).flatMap((def) => def.nodes.map((node) => node.signal))];
    for (const signal of definitions) {
      if (this.signals.has(signal.name)) {
        if (this.signals.get(signal.name) !== signal) throw new Error(`Conflicting signal definitions: ${signal.name}`);
        continue;
      }
      if (signal.interval || signal.requiredEnv?.length || signal.placement || signal.networkConcurrency
        || signal.maxConcurrency || signal.onCompleteHandler) {
        throw new Error(`${signal.name}: schedules, env, placement, concurrency policies and onComplete are not supported by the browser prototype`);
      }
      if (!Number.isFinite(signal.timeout) || signal.timeout <= 0
        || !Number.isSafeInteger(signal.maxAttempts) || signal.maxAttempts < 1) {
        throw new Error(`${signal.name}: timeout and attempt count must be positive`);
      }
      if (!signal.handler && !signal.steps?.length) throw new Error(`${signal.name}: no handler or steps`);
      this.signals.set(signal.name, signal);
    }
    this.broadcasts = new BrowserBroadcasts(this.store, options.broadcasts ?? [], this.version);
    this.beacons = new BrowserBeacons(this.store, options.beacons ?? [], this.stationId, this.version);
  }

  trigger<TInput, TOutput>(signal: Signal<TInput, TOutput>, input: TInput): Promise<string>;
  trigger(name: string, input: unknown): Promise<string>;
  async trigger(signalOrName: string | AnySignal, input: unknown): Promise<string> {
    const name = typeof signalOrName === "string" ? signalOrName : signalOrName.name;
    const signal = this.signals.get(name);
    if (!signal) throw new Error(`Unknown browser signal: ${name}`);
    const run = makeRun(signal, input, this.version);
    await this.store.add(run);
    return run.id;
  }

  triggerBroadcast(name: string, input: unknown): Promise<string> { return this.broadcasts.trigger(name, input); }

  /** Suitable for event.waitUntil(): process jobs and supervise a bounded beacon slice. */
  async wake(options: { maxJobs?: number; budgetMs?: number; beaconSliceMs?: number } = {}): Promise<void> {
    await Promise.all([this.drain(options), this.beacons.runSlice(options.beaconSliceMs)]);
  }

  /** Process bounded work during a wake event. No persistent background loop is assumed.
   * The time budget stops NEW claims; a claimed job may use its full timeout.
   */
  drain(options: { maxJobs?: number; budgetMs?: number } = {}): Promise<number> {
    if (this.draining) return this.draining;
    const maxJobs = options.maxJobs ?? 10;
    const budgetMs = options.budgetMs ?? 20_000;
    if (!Number.isSafeInteger(maxJobs) || maxJobs < 1 || !Number.isFinite(budgetMs) || budgetMs <= 0) {
      return Promise.reject(new Error("maxJobs and budgetMs must be positive"));
    }
    this.draining = this.runBatch(maxJobs, budgetMs).finally(() => { this.draining = undefined; });
    return this.draining;
  }

  private async runBatch(maxJobs: number, budgetMs: number): Promise<number> {
    const until = Date.now() + budgetMs;
    let count = 0;
    while (count < maxJobs && Date.now() < until) {
      await this.broadcasts.advance();
      const batch: BrowserRun[] = [];
      while (batch.length < this.concurrency && count + batch.length < maxJobs && Date.now() < until) {
        const run = await this.store.claim([...this.signals.keys()], this.stationId);
        if (!run) break;
        batch.push(run);
      }
      if (!batch.length) break;
      await Promise.all(batch.map(async (run) => { await this.execute(run); await this.broadcasts.advance(); }));
      count += batch.length;
    }
    await this.broadcasts.advance();
    return count;
  }

  private async execute(run: BrowserRun): Promise<void> {
    const token = run.leaseToken!;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let active = true;
    const assertActive = () => {
      if (!active || Date.now() >= run.startedAt!.getTime() + run.timeout) throw new Error("Signal timed out");
    };
    const work = async () => {
      const signal = this.signals.get(run.signalName)!;
      if (run.definitionVersion !== this.version) throw new Error("Signal definition changed; enqueue a new run");
      const input = signal.inputSchema.parse(JSON.parse(run.input));
      let output: unknown = input;
      if (signal.steps) {
        for (let index = 0; index < signal.steps.length; index++) {
          assertActive();
          const step = signal.steps[index];
          const saved = run.checkpoints[index];
          if (saved) {
            if (saved.name !== step.name) throw new Error("Step definitions changed; enqueue a new run");
            output = saved.output === undefined ? undefined : JSON.parse(saved.output);
            continue;
          }
          output = await step.fn(output);
          assertActive();
          const written = await this.store.checkpoint(run.id, token, {
            name: step.name, output: JSON.stringify(output), completedAt: new Date(),
          });
          if (!written) throw new Error("Run ownership lost or run cancelled");
        }
      } else output = await signal.handler!(input);
      assertActive();
      if (signal.outputSchema) output = signal.outputSchema.parse(output);
      return JSON.stringify(output);
    };
    try {
      const output = await Promise.race([
        work(),
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => { active = false; reject(new Error("Signal timed out")); },
            Math.max(0, run.startedAt!.getTime() + run.timeout - Date.now()));
        }),
      ]);
      await this.store.finish(run.id, token, { output });
    } catch (error) {
      active = false;
      await this.store.finish(run.id, token, { error: error instanceof Error ? error.message : String(error) });
    } finally {
      active = false;
      clearTimeout(timer);
    }
  }
}
