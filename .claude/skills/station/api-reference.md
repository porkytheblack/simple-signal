# Station API Reference

Complete reference for all Station packages. Every export, type, interface, and method signature.

> **Choose the runtime first.** Browser-local execution uses the experimental
> `station-browser` package; read [browser.md](browser.md) for its host setup and
> supported subset. Node runners, directory discovery, server adapters, and fleet
> APIs below are not browser APIs.
>
> **For Node applications: `station-kit` is Station's entry point by design.**
> An ordinary app is a `station.config.ts` calling `defineConfig` (§7), run with
> `npx station`. That single call wires the signal / broadcast / beacon runners
> and their shutdown ordering, the HTTP server, the dashboard, the authenticated
> v1 API, API keys, the env store, run-log storage, and schedule reconciliation.
>
> The `SignalRunner` / `BroadcastRunner` / `BeaconRunner` constructors documented
> below are the escape hatch — reach for them only when a requirement genuinely
> cannot be met through `StationConfig` (§7): embedding Station inside a process
> you already own, a headless worker that must not bind a port, tests, or a
> desktop app (which should use `station-tauri`, §12). Check the `StationConfig`
> fields and the pluggable adapters first; most "I need custom X" cases are a
> config field.

## Contents

1. [station-signal](#1-station-signal)
2. [station-broadcast](#2-station-broadcast)
3. [station-adapter-sqlite](#3-station-adapter-sqlite)
4. [station-adapter-postgres](#4-station-adapter-postgres)
5. [station-adapter-mysql](#5-station-adapter-mysql)
6. [station-adapter-redis](#6-station-adapter-redis)
7. [station-kit](#7-station-kit)
8. [Station v1 API Endpoints](#8-station-v1-api-endpoints)
9. [Dynamic Broadcasts](#9-dynamic-broadcasts)
10. [station-schedules](#10-station-schedules)
11. [station-expressions](#11-station-expressions)
12. [station-tauri](#12-station-tauri)
13. [station-beacon](#13-station-beacon)
14. [station-env](#14-station-env)
15. [station-network](#15-station-network)
16. [station-browser](#16-station-browser-experimental)
17. [Quick Reference: Import Patterns](#quick-reference-import-patterns)

---

## 1. station-signal

### Exports

```ts
import {
  // Builder
  signal, SignalBuilder, StepBuilder,
  // Runner
  SignalRunner,
  // Configuration
  configure, getAdapter, getTriggerAdapter, isConfigured,
  // Interval parser
  parseInterval,
  // Adapters
  MemoryAdapter, registerAdapter, createAdapter, hasAdapter,
  isSerializableAdapter,
  // Subscribers
  ConsoleSubscriber,
  // Remote trigger
  HttpTriggerAdapter,
  // Type guards
  isSignal, SIGNAL_BRAND,
  // Zod re-export
  z,
  // Constants
  DEFAULT_TIMEOUT_MS, DEFAULT_MAX_ATTEMPTS,
  // Types
  type Signal, type BuiltSignal, type AnySignal, type SignalConcurrency, type SignalPlacement,
  type SignalRunnerOptions,
  type ConfigureOptions,
  type Run, type RunKind, type RunStatus, type RunPatch, type RunClaim,
  type Step, type StepStatus, type StepPatch, type StepDefinition,
  type SignalQueueAdapter, type SerializableAdapter, type AdapterManifest,
  type SignalSubscriber, type IPCMessage,
  type TriggerAdapter,
  type HttpTriggerOptions,
  // Errors
  SignalValidationError, SignalTimeoutError, SignalNotFoundError, StationRemoteError,
} from "station-signal";
```

### Constants

```ts
const DEFAULT_TIMEOUT_MS = 300_000;  // 5 minutes
const DEFAULT_MAX_ATTEMPTS = 1;      // no retry by default
```

### signal() Builder

```ts
function signal(name: string): SignalBuilder;
```

Name must match `/^[a-zA-Z][a-zA-Z0-9_-]*$/`.

#### SignalBuilder

```ts
class SignalBuilder<TInput = unknown, TOutput = void> {
  constructor(name: string);

  /** Set input schema. Infers TInput from Zod type. */
  input<T>(schema: z.ZodType<T>): SignalBuilder<T, TOutput>;

  /** Set output schema. Infers TOutput from Zod type. */
  output<T>(schema: z.ZodType<T>): SignalBuilder<TInput, T>;

  /** Set recurring interval. Format: "<number><ms|s|m|h|d|w>" (e.g. "5m", "100ms", "1w"). */
  every(interval: string): SignalBuilder<TInput, TOutput>;

  /** Set timeout in milliseconds. Default: 300000 (5 min). */
  timeout(ms: number): SignalBuilder<TInput, TOutput>;

  /** Set retries. maxAttempts = n + 1. Default: 0 retries (1 attempt). */
  retries(n: number): SignalBuilder<TInput, TOutput>;

  /** Set per-station concurrency, or separate station + fleet-wide limits. */
  concurrency(value: number | { station?: number; network?: number }): SignalBuilder<TInput, TOutput>;

  /** Require exact station-label matches before a worker may claim this signal. */
  placement(policy: { labels?: Record<string, string> }): SignalBuilder<TInput, TOutput>;

  /** Set default input for recurring signals. */
  withInput(input: TInput): SignalBuilder<TInput, TOutput>;

  /** Single-handler signal. Returns BuiltSignal with optional .onComplete(). */
  run(fn: (input: TInput) => Promise<TOutput>): BuiltSignal<TInput, TOutput>;

  /** Start a step chain. First step receives TInput. */
  step<TNext>(name: string, fn: (prev: TInput) => Promise<TNext>): StepBuilder<TInput, TNext>;
}
```

#### BuiltSignal (returned by `.run()`)

```ts
interface BuiltSignal<TInput, TOutput> extends Signal<TInput, TOutput> {
  onComplete(fn: (output: TOutput, input: TInput) => Promise<void>): Signal<TInput, TOutput>;
}
```

#### StepBuilder

```ts
class StepBuilder<TInput, TLast> {
  /** Add another step. Input is previous step's output. */
  step<TNext>(name: string, fn: (prev: TLast) => Promise<TNext>): StepBuilder<TInput, TNext>;

  /** Add an onComplete handler and finalize. */
  onComplete(fn: (output: TLast, input: TInput) => Promise<void>): Signal<TInput, TLast>;

  /** Finalize without onComplete handler. */
  build(): Signal<TInput, TLast>;
}
```

#### Usage patterns

```ts
// Single-handler signal
const mySignal = signal("my-signal")
  .input(z.object({ url: z.string() }))
  .output(z.object({ status: z.number() }))
  .timeout(60_000)
  .retries(2)
  .run(async (input) => {
    return { status: 200 };
  });

// Single-handler with onComplete
const withComplete = signal("with-complete")
  .input(z.object({ id: z.string() }))
  .run(async (input) => {
    return { processed: true };
  })
  .onComplete(async (output, input) => {
    console.log("Done:", output);
  });

// Step-based signal
const pipeline = signal("pipeline")
  .input(z.object({ data: z.string() }))
  .step("parse", async (input) => {
    return { parsed: JSON.parse(input.data) };
  })
  .step("transform", async (prev) => {
    return { transformed: prev.parsed };
  })
  .onComplete(async (output, input) => {
    console.log("Pipeline done:", output);
  });

// Recurring signal
const recurring = signal("health-check")
  .input(z.object({ endpoint: z.string() }))
  .every("5m")
  .withInput({ endpoint: "https://api.example.com" })
  .run(async (input) => {
    const res = await fetch(input.endpoint);
    return { ok: res.ok };
  });
```

### Signal Interface

```ts
interface Signal<TInput = unknown, TOutput = void> {
  readonly [SIGNAL_BRAND]: true;
  readonly name: string;
  readonly inputSchema: z.ZodType<TInput>;
  readonly outputSchema?: z.ZodType<TOutput>;
  readonly handler?: (input: TInput) => Promise<TOutput>;
  readonly steps?: StepDefinition[];
  readonly onCompleteHandler?: (output: TOutput, input: TInput) => Promise<void>;
  readonly interval?: string;
  readonly timeout: number;
  readonly maxAttempts: number;
  readonly maxConcurrency?: number;
  readonly networkConcurrency?: number;
  readonly placement?: { labels?: Record<string, string> };
  readonly recurringInput?: TInput;
  readonly requiredEnv?: string[];        // keys declared via .env(); enforced before dispatch

  /**
   * Trigger the signal. Validates input against inputSchema.
   * Returns the run ID.
   *
   * If a TriggerAdapter is configured (remote mode), sends to remote server.
   * Otherwise writes directly to the local adapter.
   */
  trigger(input: TInput): Promise<string>;
}

type AnySignal = Signal<any, any>;
```

### SignalRunner

```ts
interface SignalRunnerOptions {
  signalsDir?: string;
  adapter?: SignalQueueAdapter;
  pollIntervalMs?: number;          // default: 1000
  idlePollIntervalMs?: number;      // default: max(pollIntervalMs, 5000) — ceiling for idle poll backoff
  maxAttempts?: number;              // default: 1
  subscribers?: SignalSubscriber[];
  maxConcurrent?: number;            // default: 5
  retryBackoffMs?: number;           // default: 1000
  scheduleReconciler?: SignalScheduleReconciler;  // runtime schedules (see §10)
  envProvider?: EnvProvider;                       // runtime env-var injection (see §14)
}

class SignalRunner {
  constructor(options?: SignalRunnerOptions);

  /**
   * Convenience factory. Auto-discovers signals from signalsDir.
   * Defaults to [ConsoleSubscriber()] if no subscribers provided.
   */
  static create(signalsDir: string, options?: Omit<SignalRunnerOptions, "signalsDir">): SignalRunner;

  /** The underlying queue adapter. */
  getAdapter(): SignalQueueAdapter;

  /** Register a signal by name and file path. */
  register(name: string, filePath: string, options?: { maxConcurrency?: number }): this;

  /** Add a subscriber. */
  subscribe(subscriber: SignalSubscriber): this;

  /** List all registered signals with metadata. */
  listRegistered(): Array<{ name: string; filePath: string; maxConcurrency?: number }>;

  /** Check whether a signal is registered by name. */
  hasSignal(name: string): boolean;

  /** Get a run by ID. */
  getRun(id: string): Promise<Run | null>;

  /** List all runs for a signal. */
  listRuns(signalName: string): Promise<Run[]>;

  /** Get steps for a run. */
  getSteps(runId: string): Promise<Step[]>;

  /**
   * Wait for a run to reach a terminal status (completed, failed, cancelled).
   * Returns the run, or null if not found (and waitForExistence is false).
   */
  waitForRun(runId: string, opts?: {
    pollMs?: number;           // default: 200
    timeoutMs?: number;        // default: 60000
    waitForExistence?: boolean; // default: false
  }): Promise<Run | null>;

  /** Purge completed/failed/cancelled runs older than the given age. Returns count deleted. */
  purgeCompleted(olderThanMs: number): Promise<number>;

  /** Cancel a run. Marks as cancelled and kills child process. Returns false if already terminal. */
  cancel(runId: string): Promise<boolean>;

  /** Start the runner loop. Blocks until stop() is called. */
  start(): Promise<void>;

  /** Stop the runner. Optionally wait for active children. */
  stop(options?: { graceful?: boolean; timeoutMs?: number }): Promise<void>;
}
```

### configure()

```ts
interface ConfigureOptions {
  /** Local adapter for in-process signal storage. */
  adapter?: SignalQueueAdapter;
  /** Remote Station server endpoint (e.g. "https://station.example.com"). */
  endpoint?: string;
  /** API key for authenticating with the remote Station server. */
  apiKey?: string;
  /** Custom trigger adapter (advanced -- overrides endpoint/apiKey). */
  triggerAdapter?: TriggerAdapter;
}

function configure(options: ConfigureOptions): void;
function getAdapter(): SignalQueueAdapter;
function getTriggerAdapter(): TriggerAdapter | null;
function isConfigured(): boolean;
```

Auto-configuration from environment variables on first access:
- `STATION_ENDPOINT` -- sets endpoint
- `STATION_API_KEY` -- sets apiKey

### Run Type

```ts
type RunKind = "trigger" | "recurring";
type RunStatus = "pending" | "running" | "completed" | "failed" | "cancelled";

interface Run {
  id: string;
  signalName: string;
  kind: RunKind;
  input: string;           // JSON-serialized
  output?: string;         // JSON-serialized TOutput
  error?: string;
  status: RunStatus;
  attempts: number;
  maxAttempts: number;
  timeout: number;         // ms
  interval?: string;       // e.g. "5m" (recurring only)
  nextRunAt?: Date;
  lastRunAt?: Date;
  startedAt?: Date;
  completedAt?: Date;
  createdAt: Date;
}

type RunPatch = Partial<Omit<Run, "id" | "signalName" | "kind" | "createdAt">>;
```

### Step Type

```ts
type StepStatus = "pending" | "running" | "completed" | "failed";

interface Step {
  id: string;
  runId: string;
  name: string;
  status: StepStatus;
  input?: string;      // JSON
  output?: string;     // JSON
  error?: string;
  startedAt?: Date;
  completedAt?: Date;
}

type StepPatch = Partial<Omit<Step, "id" | "runId" | "name">>;

interface StepDefinition {
  name: string;
  fn: (prev: unknown) => Promise<unknown>;
}
```

### SignalQueueAdapter Interface

```ts
interface SignalQueueAdapter {
  // Run methods
  addRun(run: Run): Promise<void>;
  removeRun(id: string): Promise<void>;
  getRunsDue(limit?: number): Promise<Run[]>;
  getRunsRunning(): Promise<Run[]>;
  getRun(id: string): Promise<Run | null>;
  updateRun(id: string, patch: RunPatch): Promise<void>;
  /** Atomic ownership and fencing methods required for safe Station Networks. */
  claimRun?(id: string, claim: RunClaim): Promise<Run | null>;
  cancelRun?(id: string, completedAt: Date): Promise<boolean>;
  renewRunLease?(id: string, leaseToken: string, leaseExpiresAt: Date, now?: Date): Promise<boolean>;
  updateClaimedRun?(id: string, leaseToken: string, patch: RunPatch): Promise<boolean>;
  requeueExpiredRuns?(now: Date): Promise<number>;
  listRuns(signalName: string, options?: ListRunsOptions): Promise<Run[]>;
  listAllRuns(options?: ListAllRunsOptions): Promise<Run[]>;
  countRunsByStatus(options?: { signalName?: string }): Promise<Partial<Record<RunStatus, number>>>;
  hasRunWithStatus(signalName: string, statuses: RunStatus[]): Promise<boolean>;
  purgeRuns(olderThan: Date, statuses: RunStatus[]): Promise<number>;

  // Step methods
  addStep(step: Step): Promise<void>;
  updateStep(id: string, patch: StepPatch): Promise<void>;
  getSteps(runId: string): Promise<Step[]>;
  removeSteps(runId: string): Promise<void>;

  // Utility
  generateId(): string;
  ping(): Promise<boolean>;
  close?(): Promise<void>;
}
```

### SerializableAdapter Interface

```ts
interface AdapterManifest {
  name: string;
  options: Record<string, unknown>;
  moduleUrl?: string;
}

interface SerializableAdapter extends SignalQueueAdapter {
  toManifest(): AdapterManifest;
}

function isSerializableAdapter(adapter: SignalQueueAdapter): adapter is SerializableAdapter;
```

### MemoryAdapter

```ts
class MemoryAdapter implements SignalQueueAdapter {
  constructor(options?: { maxRuns?: number }); // default: 10000
}
```

Does NOT implement `SerializableAdapter`. Cannot share state across processes.

### Adapter Registry

```ts
function registerAdapter(name: string, factory: (options: Record<string, unknown>) => SignalQueueAdapter): void;
function createAdapter(name: string, options?: Record<string, unknown>): SignalQueueAdapter;
function hasAdapter(name: string): boolean;
```

### SignalSubscriber Interface

All methods are optional. Implement only what you need.

```ts
interface SignalSubscriber {
  onSignalDiscovered?(event: { signalName: string; filePath: string }): void;
  onRunDispatched?(event: { run: Run }): void;
  onRunStarted?(event: { run: Run }): void;
  onRunCompleted?(event: { run: Run; output?: string }): void;
  onRunTimeout?(event: { run: Run }): void;
  onRunRetry?(event: { run: Run; attempt: number; maxAttempts: number }): void;
  onRunFailed?(event: { run: Run; error?: string }): void;
  onRunCancelled?(event: { run: Run }): void;
  onRunSkipped?(event: { run: Run; reason: string }): void;
  onRunRescheduled?(event: { run: Run; nextRunAt: Date }): void;
  onStepStarted?(event: { run: Run; step: Pick<Step, "id" | "runId" | "name"> }): void;
  onStepCompleted?(event: { run: Run; step: Step }): void;
  onStepFailed?(event: { run: Run; step: Step }): void;
  onCompleteError?(event: { run: Run; error: string }): void;
  onLogOutput?(event: { run: Run; level: "stdout" | "stderr"; message: string }): void;
}
```

### ConsoleSubscriber

```ts
class ConsoleSubscriber implements SignalSubscriber {
  // Logs all events to console with "[station-signal]" prefix.
  // Implements every method on SignalSubscriber.
}
```

### TriggerAdapter Interface

```ts
interface TriggerAdapter {
  trigger(signalName: string, input: unknown): Promise<string>;
  triggerBroadcast?(broadcastName: string, input: unknown): Promise<string>;
  ping?(): Promise<boolean>;
}
```

### HttpTriggerAdapter

```ts
interface HttpTriggerOptions {
  endpoint: string;
  apiKey?: string;
  timeout?: number;       // default: 10000
  fetch?: typeof globalThis.fetch;
}

class HttpTriggerAdapter implements TriggerAdapter {
  constructor(options: HttpTriggerOptions);
  trigger(signalName: string, input: unknown): Promise<string>;
  triggerBroadcast(broadcastName: string, input: unknown): Promise<string>;
  ping(): Promise<boolean>;
}
```

### IPCMessage

```ts
interface IPCMessage {
  type: "run:started" | "run:completed" | "run:failed" | "step:completed" | "onComplete:error";
  runId: string;
  signalName: string;
  timestamp: string;
  data?: Record<string, unknown>;
}
```

### Error Classes

```ts
class SignalValidationError extends Error {
  readonly code = "SIGNAL_VALIDATION_ERROR";
  readonly signalName: string;
  constructor(signalName: string, zodMessage: string);
}

class SignalTimeoutError extends Error {
  readonly code = "SIGNAL_TIMEOUT";
  readonly signalName: string;
  readonly timeoutMs: number;
  constructor(signalName: string, timeoutMs: number);
}

class SignalNotFoundError extends Error {
  readonly code = "SIGNAL_NOT_FOUND";
  readonly signalName: string;
  readonly filePath: string;
  constructor(signalName: string, filePath: string);
}

class StationRemoteError extends Error {
  readonly code = "STATION_REMOTE_ERROR";
  readonly statusCode: number;
  readonly remoteError?: string;
  constructor(statusCode: number, remoteError?: string, remoteMessage?: string);
}
```

### Utility

```ts
function parseInterval(interval: string): number;
// Parses "100ms", "30s", "5m", "1h", "2d", "1w", or "every 5m" format. Returns milliseconds.
// Valid units: ms (1), s (1000), m (60000), h (3600000), d (86400000), w (604800000)

function isSignal(value: unknown): value is AnySignal;
const SIGNAL_BRAND: unique symbol; // Symbol.for("station-signal")
```

---

## 2. station-broadcast

### Exports

```ts
import {
  // Builder
  broadcast, BroadcastBuilder, BroadcastChain,
  // Runner
  BroadcastRunner,
  // Configuration
  configureBroadcast, getBroadcastAdapter, isBroadcastConfigured,
  // Adapters
  BroadcastMemoryAdapter,
  // Subscribers
  ConsoleBroadcastSubscriber,
  // Type guards
  isBroadcast, BROADCAST_BRAND,
  // Types
  type BroadcastDefinition, type BroadcastNode, type ThenOptions,
  type BroadcastRunnerOptions,
  type BroadcastRun, type BroadcastRunStatus, type BroadcastRunPatch,
  type BroadcastNodeRun, type BroadcastNodeStatus, type BroadcastNodeRunPatch,
  type BroadcastNodeSkipReason,
  type BroadcastQueueAdapter,
  type BroadcastSubscriber, type FailurePolicy,
  // Errors
  BroadcastValidationError, BroadcastCycleError,
} from "station-broadcast";
```

### broadcast() Builder

```ts
function broadcast(name: string): BroadcastBuilder;
```

Name must match `/^[a-zA-Z][a-zA-Z0-9_-]*$/`.

#### BroadcastBuilder

```ts
class BroadcastBuilder {
  constructor(name: string);

  /** Set the root signal (entry point of the DAG). Infers input type. */
  input<T>(rootSignal: Signal<T, any>): BroadcastChain<T>;
}
```

#### BroadcastChain

```ts
class BroadcastChain<TInput> {
  /**
   * Add signal(s) to the DAG.
   *
   * Single signal:
   *   .then(signal)
   *   .then(signal, { as, after, map, when })
   *
   * Fan-out (parallel):
   *   .then(signalA, signalB, signalC)
   *   (No options allowed with fan-out)
   */
  then(...args: (AnySignal | ThenOptions)[]): BroadcastChain<TInput>;

  /** Set broadcast-level timeout in ms. Auto-fails if exceeded. */
  timeout(ms: number): BroadcastChain<TInput>;

  /** Set recurring interval. Format: "<number><ms|s|m|h|d|w>". */
  every(interval: string): BroadcastChain<TInput>;

  /** Set default input for recurring broadcasts. */
  withInput(input: TInput): BroadcastChain<TInput>;

  /** Set failure policy. Default: "fail-fast". */
  onFailure(policy: FailurePolicy): BroadcastChain<TInput>;

  /** Finalize and return the BroadcastDefinition. Validates DAG (duplicates, missing deps, cycles). */
  build(): BroadcastDefinition;
}
```

#### ThenOptions

```ts
interface ThenOptions {
  /** Node label (defaults to signal name). */
  as?: string;
  /** Explicit upstream dependencies (defaults to all nodes in the previous tier). */
  after?: string[];
  /** Transform upstream outputs into this node's input. */
  map?: (upstream: Record<string, unknown>) => unknown;
  /** Conditional guard -- skip this node if returns false. */
  when?: (upstream: Record<string, unknown>) => boolean;
}
```

#### Usage patterns

```ts
// Linear pipeline
const pipeline = broadcast("my-pipeline")
  .input(fetchSignal)
  .then(parseSignal)
  .then(saveSignal)
  .build();

// Fan-out (parallel)
const fanOut = broadcast("fan-out")
  .input(fetchSignal)
  .then(emailSignal, slackSignal, smsSignal) // all run in parallel
  .then(summarySignal)                        // runs after all three complete
  .build();

// With options
const withOpts = broadcast("with-options")
  .input(fetchSignal)
  .then(processSignal, {
    as: "custom-name",
    map: (upstream) => ({ data: upstream["fetch-data"]?.result }),
    when: (upstream) => upstream["fetch-data"]?.status === "ok",
  })
  .onFailure("skip-downstream")
  .timeout(60_000)
  .build();

// Custom dependency wiring
const diamond = broadcast("diamond")
  .input(startSignal)
  .then(leftSignal, rightSignal)           // parallel after start
  .then(mergeSignal, {
    after: ["leftSignal", "rightSignal"],  // explicit deps
    map: (upstream) => ({
      left: upstream["leftSignal"],
      right: upstream["rightSignal"],
    }),
  })
  .build();
```

### BroadcastDefinition

```ts
interface BroadcastDefinition {
  readonly [BROADCAST_BRAND]: true;
  readonly name: string;
  readonly nodes: readonly BroadcastNode[];
  readonly failurePolicy: FailurePolicy;
  readonly timeout?: number;
  readonly interval?: string;
  readonly recurringInput?: unknown;
  trigger(input: unknown): Promise<string>;
}
```

### BroadcastNode

```ts
interface BroadcastNode {
  readonly name: string;
  readonly signalName: string;
  readonly signal: AnySignal;
  readonly dependsOn: readonly string[];
  readonly timeout: number;
  readonly maxAttempts: number;
  readonly map?: (upstream: Record<string, unknown>) => unknown;
  readonly when?: (upstream: Record<string, unknown>) => boolean;
}
```

### FailurePolicy

```ts
type FailurePolicy = "fail-fast" | "skip-downstream" | "continue";
```

- `"fail-fast"` -- Cancel all running nodes and fail the broadcast immediately when any node fails.
- `"skip-downstream"` -- Skip nodes whose upstream dependencies failed, but let other branches continue.
- `"continue"` -- Run all possible nodes regardless of failures. Broadcast completes even if some nodes failed.

### BroadcastRunner

```ts
interface BroadcastRunnerOptions {
  signalRunner: SignalRunner;           // required
  broadcastsDir?: string;
  adapter?: BroadcastQueueAdapter;
  pollIntervalMs?: number;              // default: 1000
  subscribers?: BroadcastSubscriber[];
  /** Schedule reconciler. station-kit wires one in automatically when `config.scheduleAdapter` is set. */
  scheduleReconciler?: ScheduleReconciler;
}

class BroadcastRunner {
  constructor(options: BroadcastRunnerOptions);

  /** List all registered broadcast definitions with metadata. */
  listRegistered(): Array<{
    name: string;
    nodeCount: number;
    failurePolicy: FailurePolicy;
    timeout?: number;
    interval?: string;
  }>;

  /** Check whether a broadcast is registered by name. */
  hasBroadcast(name: string): boolean;

  /** Register a broadcast definition explicitly. */
  register(definition: BroadcastDefinition): this;

  /** Add a subscriber. */
  subscribe(subscriber: BroadcastSubscriber): this;

  /** Get a broadcast run by ID. */
  getBroadcastRun(id: string): Promise<BroadcastRun | null>;

  /** Get node runs for a broadcast run. */
  getNodeRuns(broadcastRunId: string): Promise<BroadcastNodeRun[]>;

  /**
   * Wait for a broadcast run to reach a terminal status.
   * Returns the run, or null if not found.
   */
  waitForBroadcastRun(id: string, opts?: {
    pollMs?: number;     // default: 200
    timeoutMs?: number;  // default: 60000
  }): Promise<BroadcastRun | null>;

  /** Cancel a broadcast run. Cancels all running/pending nodes. */
  cancel(broadcastRunId: string): Promise<boolean>;

  /**
   * Trigger a broadcast by name. Writes directly to this runner's adapter.
   * Prefer this over definition.trigger() for local usage.
   * If the name resolves to a dynamic broadcast, falls through to triggerDynamic.
   */
  trigger(broadcastName: string, input: unknown): Promise<string>;

  /**
   * Trigger a dynamic broadcast and snapshot its current spec into
   * BroadcastRun.definitionSnapshot. Edits to the spec after this call do
   * not affect the resulting run.
   */
  triggerDynamic(name: string, input: unknown): Promise<string>;

  /** True if a dynamic broadcast with this name is currently registered. */
  hasDynamicBroadcast(name: string): boolean;

  /**
   * Refresh the dynamic broadcast registry from the adapter. Called
   * automatically each tick; expose for tests or eager updates after a
   * `saveDefinition`.
   */
  reconcileDynamicDefinitions(): Promise<void>;

  /** Start the runner loop. Blocks until stop() is called. */
  start(): Promise<void>;

  /** Stop the runner. */
  stop(options?: { graceful?: boolean; timeoutMs?: number }): Promise<void>;
}
```

### BroadcastRun Type

```ts
type BroadcastRunStatus = "pending" | "running" | "completed" | "failed" | "cancelled";

interface BroadcastRun {
  id: string;
  broadcastName: string;
  input: string;                    // JSON-serialized
  status: BroadcastRunStatus;
  failurePolicy: FailurePolicy;
  timeout?: number;                 // ms
  interval?: string;
  nextRunAt?: Date;
  createdAt: Date;
  startedAt?: Date;
  completedAt?: Date;
  error?: string;
  /**
   * For runs of dynamic broadcasts: a JSON-serialized DynamicBroadcastSpec
   * captured at trigger time. The advance loop reads from this rather than
   * the live registry so spec edits don't mutate in-flight runs.
   */
  definitionSnapshot?: string;
}

type BroadcastRunPatch = Partial<Omit<BroadcastRun, "id" | "broadcastName" | "createdAt">>;
```

### BroadcastNodeRun Type

```ts
type BroadcastNodeStatus = "pending" | "running" | "completed" | "failed" | "skipped";
type BroadcastNodeSkipReason = "guard" | "upstream-failed" | "cancelled";

interface BroadcastNodeRun {
  id: string;
  broadcastRunId: string;
  nodeName: string;
  signalName: string;
  signalRunId?: string;             // links to signal Run record
  status: BroadcastNodeStatus;
  skipReason?: BroadcastNodeSkipReason;
  input?: string;                   // JSON-serialized
  output?: string;                  // JSON-serialized
  error?: string;
  startedAt?: Date;
  completedAt?: Date;
}

type BroadcastNodeRunPatch = Partial<Omit<BroadcastNodeRun, "id" | "broadcastRunId" | "nodeName" | "signalName">>;
```

### BroadcastQueueAdapter Interface

```ts
interface BroadcastQueueAdapter {
  // Broadcast runs
  addBroadcastRun(run: BroadcastRun): Promise<void>;
  getBroadcastRun(id: string): Promise<BroadcastRun | null>;
  updateBroadcastRun(id: string, patch: BroadcastRunPatch): Promise<void>;
  getBroadcastRunsDue(): Promise<BroadcastRun[]>;
  getBroadcastRunsRunning(): Promise<BroadcastRun[]>;
  listBroadcastRuns(broadcastName: string): Promise<BroadcastRun[]>;
  hasBroadcastRunWithStatus(broadcastName: string, statuses: BroadcastRunStatus[]): Promise<boolean>;
  purgeBroadcastRuns(olderThan: Date, statuses: BroadcastRunStatus[]): Promise<number>;

  // Node runs
  addNodeRun(nodeRun: BroadcastNodeRun): Promise<void>;
  getNodeRun(id: string): Promise<BroadcastNodeRun | null>;
  updateNodeRun(id: string, patch: BroadcastNodeRunPatch): Promise<void>;
  getNodeRuns(broadcastRunId: string): Promise<BroadcastNodeRun[]>;

  // Dynamic broadcast definitions (optional — adapters that don't implement
  // these cannot host runtime-editable broadcasts; static broadcasts still work).
  saveDefinition?(spec: DynamicBroadcastSpec): Promise<DynamicBroadcastSpec>;
  getDefinition?(name: string, version?: number): Promise<DynamicBroadcastSpec | null>;
  listDefinitions?(): Promise<DynamicBroadcastSpec[]>;
  listDefinitionVersions?(name: string): Promise<DynamicBroadcastSpec[]>;
  deleteDefinition?(name: string): Promise<boolean>;

  // Utility
  generateId(): string;
  ping(): Promise<boolean>;
  close?(): Promise<void>;
}
```

See §9 for `DynamicBroadcastSpec` and the contract for these methods (version monotonicity, soft-delete semantics).

### BroadcastMemoryAdapter

```ts
class BroadcastMemoryAdapter implements BroadcastQueueAdapter {
  constructor(); // no options
}
```

### BroadcastSubscriber Interface

All methods are optional.

```ts
interface BroadcastSubscriber {
  onBroadcastDiscovered?(event: { broadcastName: string; filePath: string }): void;
  onBroadcastQueued?(event: { broadcastRun: BroadcastRun }): void;
  onBroadcastStarted?(event: { broadcastRun: BroadcastRun }): void;
  onBroadcastCompleted?(event: { broadcastRun: BroadcastRun }): void;
  onBroadcastFailed?(event: { broadcastRun: BroadcastRun; error: string }): void;
  onBroadcastCancelled?(event: { broadcastRun: BroadcastRun }): void;
  onNodeTriggered?(event: { broadcastRun: BroadcastRun; nodeRun: BroadcastNodeRun }): void;
  onNodeCompleted?(event: { broadcastRun: BroadcastRun; nodeRun: BroadcastNodeRun }): void;
  onNodeFailed?(event: { broadcastRun: BroadcastRun; nodeRun: BroadcastNodeRun; error: string }): void;
  onNodeSkipped?(event: { broadcastRun: BroadcastRun; nodeRun: BroadcastNodeRun; reason: string }): void;
}
```

### ConsoleBroadcastSubscriber

```ts
class ConsoleBroadcastSubscriber implements BroadcastSubscriber {
  // Logs all events to console with "[station-broadcast]" prefix.
  // Implements every method on BroadcastSubscriber.
}
```

### Broadcast Configuration

```ts
function configureBroadcast(options: { adapter: BroadcastQueueAdapter }): void;
function getBroadcastAdapter(): BroadcastQueueAdapter;
function isBroadcastConfigured(): boolean;
```

### Error Classes

```ts
class BroadcastValidationError extends Error {
  readonly code: string; // "BROADCAST_VALIDATION_ERROR"
  constructor(message: string);
}

class BroadcastCycleError extends BroadcastValidationError {
  readonly code: string; // "BROADCAST_CYCLE_ERROR"
  readonly cycle: string[];
  constructor(broadcastName: string, cycle: string[]);
}
```

### Utility

```ts
function isBroadcast(value: unknown): value is BroadcastDefinition;
const BROADCAST_BRAND: unique symbol; // Symbol.for("station-broadcast")
```

---

## 3. station-adapter-sqlite

npm: `station-adapter-sqlite`
Dependency: `better-sqlite3` (synchronous)

### Signal Adapter

```ts
import { SqliteAdapter, type SqliteAdapterOptions } from "station-adapter-sqlite";
```

```ts
interface SqliteAdapterOptions {
  /** Path to the SQLite database file. Defaults to "station.db". */
  dbPath?: string;
  /** Table name (alphanumeric and underscores only). Defaults to "runs". */
  tableName?: string;
}

class SqliteAdapter implements SerializableAdapter {
  constructor(options?: SqliteAdapterOptions);
  toManifest(): AdapterManifest;
  // ... all SignalQueueAdapter methods
}
```

Registers as `"sqlite"` in the adapter factory. WAL mode and foreign keys enabled. Schema auto-created on construction.

### Broadcast Adapter

```ts
import { BroadcastSqliteAdapter, type BroadcastSqliteAdapterOptions } from "station-adapter-sqlite/broadcast";
```

```ts
interface BroadcastSqliteAdapterOptions {
  dbPath?: string;       // default: "station.db"
  tableName?: string;    // default: "broadcast_runs"
}

class BroadcastSqliteAdapter implements BroadcastQueueAdapter {
  constructor(options?: BroadcastSqliteAdapterOptions);
  // ... all BroadcastQueueAdapter methods
}
```

Node runs table: `${tableName}_nodes` with foreign key cascade.

### Shared database pattern

```ts
// Share the same station.db file
const signalAdapter = new SqliteAdapter({ dbPath: "station.db" });
const broadcastAdapter = new BroadcastSqliteAdapter({ dbPath: "station.db" });
```

---

## 4. station-adapter-postgres

npm: `station-adapter-postgres`
Dependency: `pg` (async)

### Signal Adapter

```ts
import { PostgresAdapter, type PostgresAdapterOptions } from "station-adapter-postgres";
```

```ts
interface PostgresAdapterOptions {
  /** PostgreSQL connection string. Ignored if pool is provided. */
  connectionString?: string;
  /** Existing pg.Pool instance to reuse. */
  pool?: pg.Pool;
  /** Table name. Defaults to "runs". */
  tableName?: string;
}

class PostgresAdapter implements SerializableAdapter {
  constructor(options?: PostgresAdapterOptions);
  toManifest(): AdapterManifest;
  // ... all SignalQueueAdapter methods
}
```

Constructor is synchronous. Schema initialization is deferred -- first adapter method call awaits the internal `ready()` promise. Registers as `"postgres"`.

### Broadcast Adapter

```ts
import { BroadcastPostgresAdapter, type BroadcastPostgresAdapterOptions } from "station-adapter-postgres/broadcast";
```

```ts
interface BroadcastPostgresAdapterOptions {
  connectionString?: string;
  pool?: pg.Pool;
  tableName?: string;    // default: "broadcast_runs"
}

class BroadcastPostgresAdapter implements BroadcastQueueAdapter {
  constructor(options?: BroadcastPostgresAdapterOptions);
  // ... all BroadcastQueueAdapter methods
}
```

### Pool sharing

```ts
import pg from "pg";

const pool = new pg.Pool({ connectionString: "postgres://..." });
const signalAdapter = new PostgresAdapter({ pool });
const broadcastAdapter = new BroadcastPostgresAdapter({ pool });
// Both share the same connection pool. Only close the pool once.
```

---

## 5. station-adapter-mysql

npm: `station-adapter-mysql`
Dependency: `mysql2/promise` (async)

### Signal Adapter

```ts
import { MysqlAdapter, type MysqlAdapterOptions } from "station-adapter-mysql";
```

```ts
interface MysqlAdapterOptions {
  /** MySQL connection string (e.g. "mysql://user:pass@host:3306/db"). */
  connectionString?: string;
  /** Existing mysql2 connection pool. Takes precedence over connectionString. */
  pool?: Pool;
  /** Table name. Defaults to "runs". */
  tableName?: string;
}

class MysqlAdapter implements SerializableAdapter {
  // Private constructor -- NEVER use `new MysqlAdapter()`
  private constructor(pool: Pool, tableName: string, ownsPool: boolean, options: MysqlAdapterOptions);

  /** The ONLY way to create a MysqlAdapter. Async because table creation requires await. */
  static async create(options?: MysqlAdapterOptions): Promise<MysqlAdapter>;

  toManifest(): AdapterManifest;
  // ... all SignalQueueAdapter methods
}
```

Registers as `"mysql"`. Requires either `connectionString` or `pool`.

### Broadcast Adapter

```ts
import { BroadcastMysqlAdapter, type BroadcastMysqlAdapterOptions } from "station-adapter-mysql/broadcast";
```

```ts
interface BroadcastMysqlAdapterOptions {
  connectionString?: string;
  pool?: Pool;
  tableName?: string;    // default: "broadcast_runs"
}

class BroadcastMysqlAdapter implements BroadcastQueueAdapter {
  // Private constructor -- NEVER use `new BroadcastMysqlAdapter()`
  private constructor(pool: Pool, runsTable: string, nodesTable: string, ownsPool: boolean);

  /** The ONLY way to create a BroadcastMysqlAdapter. */
  static async create(options?: BroadcastMysqlAdapterOptions): Promise<BroadcastMysqlAdapter>;

  // ... all BroadcastQueueAdapter methods
}
```

### Pool sharing

```ts
import mysql from "mysql2/promise";

const pool = mysql.createPool("mysql://user:pass@host:3306/db");
const signalAdapter = await MysqlAdapter.create({ pool });
const broadcastAdapter = await BroadcastMysqlAdapter.create({ pool });
```

---

## 6. station-adapter-redis

npm: `station-adapter-redis`
Dependency: `ioredis`

### Signal Adapter

```ts
import { RedisAdapter, type RedisAdapterOptions } from "station-adapter-redis";
```

```ts
interface RedisAdapterOptions {
  /** Redis connection URL. Defaults to "redis://localhost:6379". */
  url?: string;
  /** Existing ioredis instance. Takes precedence over url. */
  redis?: Redis;
  /** Key prefix for all Redis keys. Defaults to "station". */
  prefix?: string;
}

class RedisAdapter implements SerializableAdapter {
  constructor(options?: RedisAdapterOptions);
  toManifest(): AdapterManifest;
  // ... all SignalQueueAdapter methods
}
```

Registers as `"redis"`. Uses Redis hashes for data, sorted sets for indexes, `MULTI/EXEC` for atomicity.

Key schema (prefix default `"station"`):
- `station:run:{id}` -- hash per run
- `station:runs:pending` -- sorted set (score = nextRunAt or 0)
- `station:runs:running` -- sorted set (score = startedAt)
- `station:runs:signal:{signalName}` -- sorted set (score = createdAt)
- `station:runs:status:{signalName}:{status}` -- set of run IDs
- `station:runs:completed-at` -- sorted set (score = completedAt)
- `station:step:{id}` -- hash per step
- `station:run-steps:{runId}` -- set of step IDs

### Broadcast Adapter

```ts
import { BroadcastRedisAdapter, type BroadcastRedisAdapterOptions } from "station-adapter-redis/broadcast";
```

```ts
interface BroadcastRedisAdapterOptions {
  url?: string;
  redis?: Redis;
  prefix?: string;       // default: "station"
}

class BroadcastRedisAdapter implements BroadcastQueueAdapter {
  constructor(options?: BroadcastRedisAdapterOptions);
  // ... all BroadcastQueueAdapter methods
}
```

Key schema:
- `station:broadcast-run:{id}` -- hash per broadcast run
- `station:broadcast-runs:pending` -- sorted set
- `station:broadcast-runs:running` -- sorted set
- `station:broadcast-runs:name:{broadcastName}` -- sorted set
- `station:broadcast-runs:status:{broadcastName}:{status}` -- set
- `station:broadcast-runs:completed-at` -- sorted set
- `station:node-run:{id}` -- hash per node run
- `station:broadcast-run-nodes:{broadcastRunId}` -- set of node IDs

### Redis instance sharing

```ts
import Redis from "ioredis";

const redis = new Redis("redis://localhost:6379");
const signalAdapter = new RedisAdapter({ redis, prefix: "myapp" });
const broadcastAdapter = new BroadcastRedisAdapter({ redis, prefix: "myapp" });
```

---

## 7. station-kit

**The entry point for a Station app.** Everything below is what `defineConfig` +
`npx station` gives you without hand-wiring runners.

npm: `station-kit`

Dashboard with Hono API server + Next.js frontend.

### Exports

```ts
import { defineConfig, type StationUserConfig, type StationConfig, type AuthConfig, type DeployConfig } from "station-kit";
```

### defineConfig()

```ts
function defineConfig(config: StationUserConfig): StationUserConfig;
```

Used in `station.config.ts` at the project root.

### StationUserConfig

```ts
interface AuthConfig {
  username: string;
  password: string;
  sessionTtlMs?: number;   // default: 86400000 (24h)
  /**
   * Pluggable storage backend for API keys. Defaults to a `FileKeyStorage`
   * (JSON file at `<dataDir>/station-keys.json`, no native deps, fsync'd
   * tmp+rename, 0o600 perms). Provide a custom `ApiKeyStorageAdapter` to
   * host keys in Postgres, MySQL, Redis, etc. (See §7.5 below.)
   */
  keyStorage?: ApiKeyStorageAdapter;
}

interface RunnerConfig {
  pollIntervalMs: number;   // default: 1000
  maxConcurrent: number;    // default: 5
  maxAttempts: number;      // default: 1
  retryBackoffMs: number;   // default: 1000
}

interface BroadcastRunnerConfig {
  pollIntervalMs: number;   // default: 1000
}

interface DeployConfig {
  include?: string[];        // extra files/dirs to copy into deploy bundle
}

interface StationNetworkConfig {
  id?: string;                       // logical fleet id; default "default"
  stationId?: string;                // stable unique node id; defaults from STATION_ID/process
  name?: string;                     // display name; defaults to stationId
  adapter?: StationNetworkAdapter;   // durable shared adapter for multiple processes
  labels?: Record<string, string>;   // exact-match placement labels
  endpoint?: string;                 // HTTP(S) endpoint reachable by Headquarters
  heartbeatIntervalMs?: number;      // default 5000
  leaseDurationMs?: number;          // default 15000
}

interface StationConfig {
  role: "standalone" | "headquarters" | "station"; // default: "standalone"
  network: StationNetworkConfig;
  port: number;                          // default: 4400
  host: string;                          // default: "localhost"
  adapter?: SignalQueueAdapter;
  broadcastAdapter?: BroadcastQueueAdapter;
  beaconAdapter?: BeaconStateAdapter;    // durable beacon instance state + lifecycle log
  beaconMaxInstances?: number;           // default cap per beacon definition: 100
  /**
   * Optional schedule storage. When provided, runtime-editable schedules are
   * persisted here and reconciled by both runners. (See §10.)
   */
  scheduleAdapter?: ScheduleAdapter;
  /**
   * Optional storage for runtime-managed environment variables. Defaults to a
   * `FileEnvStorage` (JSON at `<dataDir>/station-env.json`, single-process).
   * Provide a durable `EnvStorageAdapter` for multi-process deployments. (See §14.)
   */
  envStorage?: EnvStorageAdapter;
  /**
   * Pluggable storage backend for run logs. Defaults to a `FileLogStorage`
   * (append-only JSONL at `<dataDir>/station-logs.jsonl`, no native deps,
   * single-process only). Provide a custom `LogStorageAdapter` for
   * Postgres / MySQL / Redis / S3 in multi-process or high-durability
   * deployments. (See §7.6 below.)
   */
  logStorage?: LogStorageAdapter;
  /**
   * Your own lifecycle subscribers, registered *in addition to* the ones
   * Station wires for the dashboard and event stream. Use for metrics,
   * alerting, audit logs. Only applied when `runRunners` is true (Station warns
   * if you configure them on a dashboard-only instance). (See §7.7 below.)
   */
  subscribers?: SubscribersConfig;
  signalsDir?: string;                   // auto-detects "./signals" if exists
  broadcastsDir?: string;                // auto-detects "./broadcasts" if exists
  beaconsDir?: string;                   // auto-detects "./beacons" if exists; supervises beacons + surfaces them on the dashboard
  runner: RunnerConfig;
  broadcastRunner: BroadcastRunnerConfig;
  runRunners: boolean;                   // default: true; Headquarters still never executes work
  open: boolean;                         // default: true (opens browser)
  logLevel: "debug" | "info" | "warn" | "error"; // default: "info"
  auth?: AuthConfig;
  deploy?: DeployConfig;               // deployment bundle configuration
  stationDir: string;                  // default: ".station"
}

type StationUserConfig = Partial<Omit<StationConfig, "runner" | "broadcastRunner" | "network">> & {
  runner?: Partial<RunnerConfig>;
  broadcastRunner?: Partial<BroadcastRunnerConfig>;
  network?: StationNetworkConfig;
};
```

### 7.7 Custom subscribers (`subscribers`)

```ts
interface SubscribersConfig {
  signal?: SignalSubscriber[];       // run lifecycle — see §1
  broadcast?: BroadcastSubscriber[]; // DAG lifecycle — see §2
  beacon?: BeaconSubscriber[];       // supervision lifecycle — see §13
}
```

```ts
export default defineConfig({
  signalsDir: "./signals",
  subscribers: {
    signal: [{
      onRunCompleted: ({ run }) => metrics.increment("signal.completed", { name: run.signalName }),
      onRunFailed: ({ run, error }) => alerting.send(`${run.signalName} failed: ${error}`),
    }],
  },
});
```

Semantics:

- **Additive, never replacing.** Station's internal subscribers (which power the dashboard, WebSocket/SSE streams, and log capture) are always registered and always run **first**; yours are appended.
- **Isolated.** Runners catch and log per-subscriber errors, so one of yours throwing cannot fail a run or stop later subscribers from firing.
- **Requires runners.** With `runRunners: false` there is nothing to subscribe to; Station logs a warning rather than silently dropping them.

This is why hand-rolling a runner is *not* needed for observability hooks.

### Config file example

```ts
// station.config.ts
import { defineConfig } from "station-kit";
import { SqliteAdapter } from "station-adapter-sqlite";
import { BroadcastSqliteAdapter } from "station-adapter-sqlite/broadcast";

export default defineConfig({
  port: 4400,
  signalsDir: "./signals",
  broadcastsDir: "./broadcasts",
  adapter: new SqliteAdapter({ dbPath: "station.db" }),
  broadcastAdapter: new BroadcastSqliteAdapter({ dbPath: "station.db" }),
  runner: {
    maxConcurrent: 10,
    maxAttempts: 3,
  },
  auth: {
    username: "admin",
    password: "secret",
  },
});
```

### CLI

```
npx station
```

Launches:
- Hono API and dashboard on the configured public `port` (default 4400)
- Internal Next.js process managed automatically by StationKit
- `standalone`: control-plane reconciliation plus local execution when `runRunners` is true
- `headquarters`: API/dashboard and control-plane reconciliation, never signal/beacon execution
- `station`: signal/beacon execution when `runRunners` is true, never schedule/broadcast reconciliation

The CLI uses a launcher pattern: re-execs with `node --import tsx` to enable TypeScript resolution for user signal/broadcast files.

### CLI Commands

```
npx station                    # Start dashboard + runners
npx station deploy             # Build production bundle to .station/out/
npx station --no-open          # Start without opening browser
npx station --no-runners       # Dashboard only, no job processing
npx station --port 5000        # Custom port
npx station --host 0.0.0.0    # Bind to all interfaces
npx station --config path.ts   # Custom config file
```

### station deploy

Bundles signals, broadcasts, and config into a self-contained deploy directory using esbuild.

**What it does:**
1. Discovers all `.ts`/`.js` files in `signalsDir` and `broadcastsDir`
2. Bundles each as an esbuild entry point with code splitting (shared imports → chunk files)
3. Externalizes npm packages (installed via `npm install` at deploy time)
4. Resolves `workspace:*` → `^{version}` for monorepo dependencies
5. Generates production `package.json`, `Dockerfile`, `nixpacks.toml`, `.dockerignore`, `.gitignore`
6. Copies `deploy.include` entries (non-JS assets)

**Output structure:**
```
.station/out/
  package.json          # production deps, resolved versions
  station.config.js     # compiled config
  signals/
    *.js                # bundled signal files
  broadcasts/
    *.js                # bundled broadcast files
  chunk-*.js            # shared code extracted by esbuild
  Dockerfile
  nixpacks.toml
  .dockerignore
  .gitignore
```

### Environment Variable Overrides

These env vars override config values at runtime:

| Variable | Overrides | Description |
|----------|-----------|-------------|
| `PORT` | `port` | Server port |
| `HOST` | `host` | Server bind address |
| `STATION_AUTH_USERNAME` | `auth.username` | Dashboard login username |
| `STATION_AUTH_PASSWORD` | `auth.password` | Dashboard login password |

If `auth` is not set in config but both `STATION_AUTH_USERNAME` and `STATION_AUTH_PASSWORD` are set, auth is enabled automatically.

### 7.5 KeyStore (API key storage)

API keys live behind a pluggable `ApiKeyStorageAdapter`. The `KeyStore` class owns crypto (UUIDs, SHA-256 hashing, key generation) and delegates persistence to the adapter.

```ts
import {
  KeyStore,
  FileKeyStorage,
  MemoryKeyStorage,
  SqliteKeyStorage, // optional — requires the `better-sqlite3` package
  type ApiKeyStorageAdapter,
  type ApiKey,
  type ApiKeyPublic,
} from "station-kit/server";
```

#### ApiKeyStorageAdapter

```ts
interface ApiKey {
  id: string;
  name: string;
  keyHash: string;       // sha256 hex
  keyPrefix: string;     // first 12 chars of the raw key, e.g. "sk_live_abc"
  scopes: string[];
  createdAt: string;     // ISO
  lastUsed: string | null;
  expiresAt: string | null;
  revoked: boolean;
}

type ApiKeyPublic = Omit<ApiKey, "keyHash">;

interface ApiKeyStorageAdapter {
  insert(record: ApiKey): Promise<void> | void;
  findByHash(keyHash: string): Promise<ApiKey | null> | ApiKey | null;
  list(): Promise<ApiKeyPublic[]> | ApiKeyPublic[];
  touch(id: string, lastUsedIso: string): Promise<void> | void;
  revoke(id: string): Promise<boolean> | boolean;
  close?(): Promise<void> | void;
}
```

Methods may return synchronously or as promises — `KeyStore` awaits results either way.

#### KeyStore (async)

```ts
class KeyStore {
  /**
   * Pass an ApiKeyStorageAdapter for any backend, or a string path to
   * construct a FileKeyStorage at that path. A `.db` extension is silently
   * rewritten to `.json` for backwards compatibility — old SQLite-backed
   * `station-keys.db` files are NOT auto-migrated; createStation logs a
   * warning if it detects one.
   */
  constructor(storageOrPath: ApiKeyStorageAdapter | string);

  create(name: string, scopes?: string[]): Promise<{ key: string; record: ApiKey }>;
  verify(rawKey: string): Promise<ApiKey | null>;
  list(): Promise<ApiKeyPublic[]>;
  revoke(id: string): Promise<boolean>;
  close(): Promise<void>;
}
```

All `KeyStore` methods are async. Direct callers must `await` (the dashboard / Tauri sidecar already do).

#### Built-in implementations

```ts
class FileKeyStorage implements ApiKeyStorageAdapter {
  constructor(options: { filePath: string });
}

class MemoryKeyStorage implements ApiKeyStorageAdapter {
  constructor();
}

// Optional — requires the `better-sqlite3` package to be installed.
// Lazy-loaded via createRequire; throws a helpful "npm install better-sqlite3"
// error if used without the package.
class SqliteKeyStorage implements ApiKeyStorageAdapter {
  constructor(options: { dbPath: string; tableName?: string });
}
```

`FileKeyStorage` is the default when station-kit boots without a `keyStorage` configured (JSON file, fsync'd tmp+rename, `0o600`/`0o700` perms, no native deps). Single-process only — for multi-process or high-throughput deployments, implement your own `ApiKeyStorageAdapter`. `MemoryKeyStorage` is intended for tests and ephemeral deployments — keys do not survive process restart. `SqliteKeyStorage` remains as an opt-in adapter for users who want SQLite specifically.

### 7.6 LogStore (run log storage)

Run logs live behind a pluggable `LogStorageAdapter`. The `LogStore` class is a thin wrapper that:
- Treats `add()` as fire-and-forget — adapter throws and rejections are caught at the boundary so a slow or failing log backend can never crash a signal runner.
- Exposes `get(runId): Promise<LogEntry[]>` — callers must `await`.
- Awaits `adapter.close?()` once on graceful shutdown (NOT on `SIGKILL`).

```ts
import {
  LogStore,
  FileLogStorage,
  MemoryLogStorage,
  type LogStorageAdapter,
  type LogEntry,
} from "station-kit/server";

interface LogStorageAdapter {
  add(entry: LogEntry): Promise<void> | void;
  get(runId: string): Promise<LogEntry[]> | LogEntry[];
  close?(): Promise<void> | void;
}
```

**Contract:** `get(runId)` must return entries for that run in append order. Routes that aggregate across runs may re-sort by timestamp. Adapters needing durability guarantees (queues, retries, batching) implement that internally.

#### Built-in implementations

```ts
class FileLogStorage implements LogStorageAdapter {
  constructor(options: {
    filePath: string;
    onError?: (err: unknown) => void;  // surfaces background write failures
  });
}

class MemoryLogStorage implements LogStorageAdapter {
  constructor();
}
```

`FileLogStorage` is the default — append-only JSONL at `<dataDir>/station-logs.jsonl`, single-process only. The default `onError` (when wired through `createStation`) routes failures to `console.error`. `MemoryLogStorage` is for tests; logs do not survive restart. The legacy SQLite-backed log store has been removed; an old `station-logs.db` triggers a startup warning from `createStation`.

#### Configuring custom storage

```ts
import { defineConfig, type LogStorageAdapter, type LogEntry } from "station-kit";

class PostgresLogStorage implements LogStorageAdapter {
  constructor(private pool: Pool) {}
  async add(entry: LogEntry) {
    await this.pool.query(
      "INSERT INTO run_logs (run_id, signal_name, level, message, ts) VALUES ($1,$2,$3,$4,$5)",
      [entry.runId, entry.signalName, entry.level, entry.message, entry.timestamp],
    );
  }
  async get(runId: string) {
    const { rows } = await this.pool.query(
      "SELECT run_id AS \"runId\", signal_name AS \"signalName\", level, message, ts AS timestamp FROM run_logs WHERE run_id = $1 ORDER BY id",
      [runId],
    );
    return rows;
  }
}

export default defineConfig({
  logStorage: new PostgresLogStorage(pool),
  // ...
});
```

#### Configuring custom storage

```ts
import { defineConfig } from "station-kit";

export default defineConfig({
  auth: {
    username: "admin",
    password: process.env.PW!,
    keyStorage: new MyPostgresKeyStorage(pool),
  },
});
```

`auth.keyStorage` is a plain `ApiKeyStorageAdapter` — anyone can implement it against Postgres / MySQL / Redis / etc. without forking station-kit.

---

## 8. Station v1 API Endpoints

Base path: `/api/v1`

Authentication: `Authorization: Bearer sk_live_...` header or session cookie.

API key scopes: `trigger`, `read`, `cancel`, `admin`.

### Health (no auth required)

```
GET /api/v1/health
```

Response:
```json
{ "data": { "ok": true, "signal": true, "broadcast": true } }
```

### Auth (rate-limited, no auth required)

```
POST /api/v1/auth/login
```

Body: `{ "username": "...", "password": "..." }`
Response: `{ "data": { "ok": true } }` + `Set-Cookie` header.

```
POST /api/v1/auth/logout
```

Response: `{ "data": { "ok": true } }` + clears cookie.

### Trigger (scope: `trigger`)

```
POST /api/v1/trigger
```

Body: `{ "signalName": "my-signal", "input": { ... } }`
Response (201):
```json
{ "data": { "id": "uuid", "signalName": "my-signal", "status": "pending", "createdAt": "..." } }
```

```
POST /api/v1/trigger-broadcast
```

Body: `{ "broadcastName": "my-broadcast", "input": { ... } }`
Response (201):
```json
{ "data": { "id": "uuid", "broadcastName": "my-broadcast", "status": "pending", "createdAt": "..." } }
```

```
POST /api/v1/trigger-dynamic-broadcast
```

Body: `{ "broadcastName": "my-dynamic", "input": { ... } }`
Response (201): `{ "data": { "id": "uuid", "broadcastName": "my-dynamic", "status": "pending", "createdAt": "..." } }`

Errors: `404 not_found` if no dynamic broadcast with that name is registered; `400 trigger_failed` if the spec couldn't be materialized (e.g. its referenced signal isn't loaded).

### Read (scope: `read`)

```
GET /api/v1/stations?role=station&status=online
GET /api/v1/stations/:id
```

Returns network membership, status, labels, capacity, advertised definitions,
endpoint, and heartbeat/lease timestamps.

```
GET /api/v1/signals
```

Response: `{ "data": [{ "name": "...", "filePath": "...", ... }] }`

```
GET /api/v1/signals/:name
```

Response: `{ "data": { "name": "...", "filePath": "...", ... } }`

```
GET /api/v1/runs
```

Query params: `?signalName=...&status=...&limit=50` (max 200)
Response: `{ "data": [...], "meta": { "total": N } }`

```
GET /api/v1/runs/:id
```

Response: `{ "data": { "id": "...", "signalName": "...", "status": "...", ... } }`

```
GET /api/v1/runs/:id/steps
```

Response: `{ "data": [{ "id": "...", "runId": "...", "name": "...", "status": "...", ... }] }`

```
GET /api/v1/runs/:id/logs
```

Response: `{ "data": [...] }` (array of log entries)

```
GET /api/v1/broadcasts
```

Response: `{ "data": [{ "name": "...", "nodeCount": N, "failurePolicy": "...", ... }] }`

```
GET /api/v1/broadcasts/:name
```

Response: `{ "data": { "name": "...", "nodeCount": N, "failurePolicy": "...", ... } }`

```
GET /api/v1/broadcast-runs/:id
```

Response: `{ "data": { "id": "...", "broadcastName": "...", "status": "...", ... } }`

```
GET /api/v1/broadcast-runs/:id/nodes
```

Response: `{ "data": [{ "id": "...", "nodeName": "...", "signalName": "...", "status": "...", ... }] }`

### SSE Events (scope: `read`)

```
GET /api/v1/events
```

Query params (all optional, comma-separated):
- `?signals=signal1,signal2` -- filter events by signal name
- `?broadcasts=broadcast1` -- filter events by broadcast name
- `?events=run:completed,run:failed` -- filter by event type

Returns Server-Sent Events stream. Event format:
```
event: <event-type>
data: <JSON payload>
id: evt_<counter>
```

Heartbeat every 30 seconds:
```
event: heartbeat
data:
```

### Cancel (scope: `cancel`)

```
POST /api/v1/runs/:id/cancel
```

Response: `{ "data": { "cancelled": true } }`
Error: `{ "error": "cannot_cancel", "message": "Run cannot be cancelled." }` (400)

```
POST /api/v1/broadcast-runs/:id/cancel
```

Response: `{ "data": { "cancelled": true } }`
Error: `{ "error": "cannot_cancel", "message": "Broadcast run cannot be cancelled." }` (400)

### API Keys (scope: `admin`)

```
PATCH /api/v1/stations/:id
```

Body: `{ "status": "draining" }` or `{ "status": "online" }`. Draining
prevents a station from claiming new work while active work finishes.

```
POST /api/v1/keys
```

Body: `{ "name": "My Key", "scopes": ["trigger", "read"] }`
Response (201):
```json
{
  "data": {
    "id": "uuid",
    "name": "My Key",
    "key": "sk_live_...",
    "keyPrefix": "sk_live_abc...",
    "scopes": ["trigger", "read"],
    "createdAt": "..."
  }
}
```

The `key` field is only returned at creation time.

```
GET /api/v1/keys
```

Response: `{ "data": [{ "id": "...", "name": "...", "keyPrefix": "...", "scopes": [...], ... }] }`

```
DELETE /api/v1/keys/:id
```

Response: `{ "data": { "revoked": true } }`

### Error Responses

All errors follow this format:

```json
{ "error": "error_code", "message": "Human-readable description." }
```

Common error codes:
- `bad_request` (400) -- missing or invalid body
- `unauthorized` (401) -- no auth or invalid credentials/key
- `forbidden` (403) -- missing required scope
- `not_found` (404) -- resource not found
- `cannot_cancel` (400) -- run already in terminal state
- `unavailable` (503) -- runner not configured or read-only mode
- `trigger_failed` (400) -- broadcast trigger threw an error

---

## 9. Dynamic Broadcasts

Runtime-editable broadcasts persisted as JSON specs and reconciled into the runner's live registry on each tick. Distinct from file-defined broadcasts — names live in a separate registry and may collide harmlessly.

### DynamicBroadcastSpec / DynamicNodeSpec

```ts
import type { DynamicBroadcastSpec, DynamicNodeSpec } from "station-broadcast";

interface DynamicNodeSpec {
  /** Unique within the spec. */
  name: string;
  /** Must resolve to a registered signal at materialization time. */
  signalName: string;
  dependsOn: string[];
  /** ExprNode JSON; absent ⇒ pass-through (single-dep) or upstream object (multi-dep). */
  input?: ExprNode;
  /** ExprNode JSON returning boolean; absent ⇒ always run. */
  when?: ExprNode;
}

interface DynamicBroadcastSpec {
  name: string;
  /** Monotonically incremented on each save. */
  version: number;
  failurePolicy: FailurePolicy;
  timeout?: number;
  nodes: DynamicNodeSpec[];
  createdAt: Date;
  updatedAt: Date;
  /** API key id or session user that authored this version. */
  createdBy?: string;
  /** Soft-delete marker — definitions are retained for run-history inspection. */
  deletedAt?: Date;
}
```

### Adapter contract (optional methods)

The optional `BroadcastQueueAdapter` definition methods (see §2) follow these rules:

- `saveDefinition(spec)` — assigns the next version (`max(existing) + 1`) and returns the persisted record. Caller-supplied `version` is ignored. Clears any `deletedAt`.
- `getDefinition(name)` — returns the latest non-deleted version, or `null`.
- `getDefinition(name, version)` — returns that exact version (including soft-deleted ones — for history inspection).
- `listDefinitions()` — latest of each name, excluding soft-deleted definitions.
- `listDefinitionVersions(name)` — full version history, newest first, includes deleted versions.
- `deleteDefinition(name)` — soft-deletes the latest version, returns `true` on success. Recreating later via `saveDefinition` continues at the next version (NOT v1).

### BroadcastRunner methods

```ts
class BroadcastRunner {
  // ... base methods ...
  triggerDynamic(name: string, input: unknown): Promise<string>;
  hasDynamicBroadcast(name: string): boolean;
  reconcileDynamicDefinitions(): Promise<void>;
}
```

`triggerDynamic` snapshots the current spec into `BroadcastRun.definitionSnapshot`. The advance loop materializes from the snapshot, so spec edits after trigger time never mutate in-flight runs.

`reconcileDynamicDefinitions()` is called automatically on `start()` and on each tick. It also retries previously-failed materializations whenever the signal registry size changes (so a broadcast that referenced a not-yet-loaded signal recovers automatically).

### Validation

```ts
import { validateDynamicSpec, type DynamicValidationContext, type DynamicValidationResult } from "station-broadcast";

interface DynamicValidationContext {
  signalSchemas: Map<string, { inputSchema: SchemaField; outputSchema: SchemaField }>;
  /** When omitted, refs to `input.*` aren't type-checked. */
  broadcastInputSchema?: SchemaField;
}

interface DynamicValidationError {
  /** node name, or "$" for spec-level errors */
  node: string;
  field?: string;     // "input" | "when" | "signalName" | "dependsOn"
  message: string;
}

interface DynamicValidationResult {
  ok: boolean;
  errors: DynamicValidationError[];
}

function validateDynamicSpec(
  spec: DynamicBroadcastSpec,
  ctx: DynamicValidationContext,
): DynamicValidationResult;
```

Checks: unique node names, signals exist, dependencies exist, no cycles, expression well-formedness against schemas.

### v1 endpoints

| Endpoint | Scope | Description |
|---|---|---|
| `POST /api/v1/broadcast-definitions` | `admin` | Create a new definition or new version. Body: `DynamicBroadcastSpec` (server assigns `version`, `createdBy`). Validates first; returns `422 validation_failed` on errors. |
| `POST /api/v1/broadcast-definitions/validate` | `read` | Validate a spec without persisting. Response: `{ data: DynamicValidationResult }`. |
| `GET /api/v1/broadcast-definitions` | `read` | List the latest non-deleted version of each definition. |
| `GET /api/v1/broadcast-definitions/:name` | `read` | Get the latest version of `:name`. |
| `GET /api/v1/broadcast-definitions/:name/versions` | `read` | Full version history, newest first. |
| `GET /api/v1/broadcast-definitions/:name/versions/:n` | `read` | Get specific version `n`. |
| `DELETE /api/v1/broadcast-definitions/:name` | `admin` | Soft-delete the latest version. |
| `POST /api/v1/trigger-dynamic-broadcast` | `trigger` | Trigger by name. Snapshots current spec into the run. |

All endpoints return 503 `unavailable` when the broadcast adapter doesn't implement the relevant optional method.

---

## 10. station-schedules

Runtime-editable schedule store + reconciler shared by `SignalRunner` and `BroadcastRunner`. Distinct from file-defined `.every()` schedules in code.

npm: `station-schedules`

### Exports

```ts
import {
  ScheduleReconciler,
  ScheduleMemoryAdapter,
  type Schedule,
  type SchedulePatch,
  type ScheduleKind,
  type ScheduleAdapter,
  type ScheduleListFilter,
  type ScheduleReconcilerOptions,
} from "station-schedules";
```

### Schedule type

```ts
type ScheduleKind = "signal" | "broadcast-static" | "broadcast-dynamic";

interface Schedule {
  id: string;
  kind: ScheduleKind;
  /** Signal name OR broadcast name OR dynamic broadcast name. */
  target: string;
  /** Parsed by station-signal's parseInterval — "100ms", "5m", "1h", "1d", "1w". */
  interval: string;
  input?: unknown;       // JSON-serializable; passed to target on each fire
  enabled: boolean;
  nextRunAt: Date;
  lastRunAt?: Date;
  lastRunStatus?: string;   // "triggered" | "errored" | "skipped:overlap" | …
  lastRunId?: string;       // run ID for click-through
  createdAt: Date;
  updatedAt: Date;
  createdBy?: string;       // API key id of the author
}

type SchedulePatch = Partial<Omit<Schedule, "id" | "kind" | "target" | "createdAt">>;
```

### ScheduleAdapter interface

```ts
interface ScheduleListFilter {
  kind?: ScheduleKind;
  enabled?: boolean;
  /** When true, returns enabled schedules with nextRunAt <= now. */
  due?: boolean;
}

interface ScheduleAdapter {
  add(schedule: Schedule): Promise<void>;
  get(id: string): Promise<Schedule | null>;
  list(filter?: ScheduleListFilter): Promise<Schedule[]>;
  update(id: string, patch: SchedulePatch): Promise<void>;
  delete(id: string): Promise<boolean>;
  /**
   * Atomically advance nextRunAt only if it still matches expectedNextRunAt.
   * Returns true if the caller successfully claimed the schedule. Required
   * for multi-instance correctness — adapters without this fall back to a
   * non-atomic advance (single-process only).
   */
  claimDue?(id: string, expectedNextRunAt: Date, newNextRunAt: Date): Promise<boolean>;
  generateId(): string;
  ping(): Promise<boolean>;
  close?(): Promise<void>;
}
```

### Persistent adapter packages

Imported via subpath, mirroring the broadcast adapter pattern:

| Adapter | Import path |
|---|---|
| SQLite | `station-adapter-sqlite/schedules` (`ScheduleSqliteAdapter`) |
| Postgres | `station-adapter-postgres/schedules` (`SchedulePostgresAdapter`) |
| MySQL | `station-adapter-mysql/schedules` (`ScheduleMysqlAdapter` — async `create`) |
| Redis | `station-adapter-redis/schedules` (`ScheduleRedisAdapter`) |

All implement `claimDue` atomically:

- **SQLite** — `UPDATE ... WHERE next_run_at = ?` (single-writer DB).
- **Postgres** — `UPDATE ... WHERE next_run_at = $1 RETURNING id`.
- **MySQL** — `UPDATE ...`, decided by `affectedRows > 0`.
- **Redis** — Lua `EVAL` script comparing `ZSCORE` and updating atomically.

### ScheduleReconciler

```ts
interface ScheduleReconcilerOptions {
  adapter: ScheduleAdapter;
  /** Which kinds this reconciler handles — others are skipped. */
  kinds: ScheduleKind[];
  triggerFn: (schedule: Schedule) => Promise<string>;
  /** Returns true if a pending or running run already exists for this target. */
  hasPendingOrRunning?: (schedule: Schedule) => Promise<boolean>;
  parseInterval: (interval: string) => number;
  onError?: (err: Error, schedule?: Schedule) => void;
}

class ScheduleReconciler {
  constructor(opts: ScheduleReconcilerOptions);
  /** Run one reconciliation pass. Safe to call from a runner's tick loop. */
  tick(): Promise<void>;
}
```

`tick()` flow per due schedule:

1. `claimDue(id, currentNextRunAt, newNextRunAt)` — bails if another runner already claimed.
2. Optional `hasPendingOrRunning` — sets `lastRunStatus = "skipped:overlap"` and skips firing if true.
3. `triggerFn(schedule)` — records `lastRunAt`, `lastRunId`, and `lastRunStatus` (`"triggered"` or `"errored"`).

If `triggerFn` throws, the schedule still has its `nextRunAt` advanced (via the claim) and records an error status — schedules can never busy-loop on a recurring failure.

### Runner wiring

Both `SignalRunnerOptions` and `BroadcastRunnerOptions` accept `scheduleReconciler?: ScheduleReconciler`. station-kit constructs and wires reconcilers automatically when `config.scheduleAdapter` is set:

- one reconciler per runner, with `kinds` set to `["signal"]` for the SignalRunner and `["broadcast-static", "broadcast-dynamic"]` for the BroadcastRunner.

### v1 endpoints

| Endpoint | Scope | Description |
|---|---|---|
| `POST /api/v1/schedules` | `admin` | Create. Body: `{ kind, target, interval, input?, enabled? }`. `nextRunAt` defaults to `now + intervalMs`. Returns 201 with the persisted Schedule. |
| `GET /api/v1/schedules` | `read` | List. Query: `?kind=signal&enabled=true`. |
| `GET /api/v1/schedules/:id` | `read` | Get one. |
| `PATCH /api/v1/schedules/:id` | `admin` | Update. Accepts `interval`, `input`, `enabled`, `nextRunAt`. |
| `DELETE /api/v1/schedules/:id` | `admin` | Delete. |
| `POST /api/v1/schedules/:id/preview` | `read` | Preview next N fire times (1-20, default 5). Body: `{ count?: number }`. Response: `{ data: { fires: ISO8601[] } }`. |

All return 503 `unavailable` when no `scheduleAdapter` is configured.

---

## 11. station-expressions

Pure, deterministic expression language. Used by `DynamicNodeSpec.input` (mappings) and `DynamicNodeSpec.when` (guards). JSON-serializable AST plus a string syntax compiled to AST.

npm: `station-expressions`

Properties:

- **No I/O, no time, no randomness** — pure functions of `{ input, upstream }`.
- **No loops, no recursion, no user-defined functions** — bounded complexity (`MAX_NODES = 10_000`).
- Total over well-typed inputs that pass `validate` against the real schemas.

### Exports

```ts
import {
  evaluate,
  validate,
  parse,
  stringify,
  ExpressionEvalError,
  ExpressionParseError,
  type ExprNode,
  type BinaryOp,
  type UnaryOp,
  type SchemaField,
  type EvalContext,
  type ValidationContext,
  type ValidationError,
  type ValidationResult,
} from "station-expressions";
```

### ExprNode

```ts
type BinaryOp = "==" | "!=" | ">" | "<" | ">=" | "<=" | "&&" | "||" | "+" | "-" | "*" | "/";
type UnaryOp = "!";

type ExprNode =
  | { kind: "ref"; path: string[] }
  | { kind: "lit"; value: unknown }
  | { kind: "tmpl"; parts: (string | ExprNode)[] }
  | { kind: "op"; op: BinaryOp | UnaryOp; args: ExprNode[] }
  | { kind: "obj"; entries: Record<string, ExprNode> }
  | { kind: "arr"; items: ExprNode[] };
```

#### Reference paths

| Path                         | Resolves to                                  |
|------------------------------|----------------------------------------------|
| `["input", "foo"]`           | The broadcast's trigger input, field `foo`   |
| `["upstream", "node", "f"]`  | An upstream node's output, field `f`         |
| `["node", "f"]`              | Shorthand for `["upstream", "node", "f"]`    |

Missing paths return `undefined` rather than throwing — use `validate` to catch missing-property errors at save time.

#### Operators

`==`, `!=`, `>`, `<`, `>=`, `<=`, `&&`, `||`, `!`, `+`, `-`, `*`, `/`.

`+` is overloaded: if either operand is a string, the result is string concatenation; otherwise numeric addition. Equality is strict (`===`).

### SchemaField (validator)

```ts
type SchemaField =
  | { type: "string" | "number" | "boolean" | "null" | "any" | "unknown" }
  | { type: "array"; items?: SchemaField }
  | { type: "object"; properties?: Record<string, SchemaField>; additionalProperties?: boolean }
  | { type: "union"; options: SchemaField[] };
```

Mirrors the shape produced by Station's existing `inputSchema` / `outputSchema` reflection.

### Public API

```ts
interface EvalContext {
  input: unknown;
  upstream: Record<string, unknown>;
}

interface ValidationContext {
  inputSchema: SchemaField;
  upstreamSchemas: Record<string, SchemaField>;
  /** When validating an `input` mapping, the target signal's input schema. */
  expectedSchema?: SchemaField;
}

function evaluate(node: ExprNode, ctx: EvalContext): unknown;
function validate(node: ExprNode, ctx: ValidationContext): ValidationResult;
function parse(source: string): ExprNode;     // throws ExpressionParseError
function stringify(node: ExprNode): string;
```

### v1 endpoints (all `read` scope)

| Endpoint | Description |
|---|---|
| `POST /api/v1/expressions/parse` | Body: `{ source: string }`. Response: `{ data: { node: ExprNode } }`. Errors: `400 parse_error` with `position`. |
| `POST /api/v1/expressions/evaluate` | Body: `{ node: ExprNode, context?: { input?, upstream? } }`. Response: `{ data: { value: unknown } }`. |
| `POST /api/v1/expressions/validate` | Body: `{ node: ExprNode, schemaContext?: { inputSchema?, upstreamSchemas?, expectedSchema? } }`. Response: `{ data: ValidationResult }`. |

### Escape hatch

When the language can't express something — async lookups, complex string manipulation, business logic — write a code-defined signal in TypeScript and reference it from your dynamic broadcast graph. The signal is the unit of arbitrary code; expressions just connect them.

---

## 12. station-tauri

npm: `station-tauri`

Tauri v2 sidecar integration. Runs Station as a localhost-only background process for desktop apps. No dashboard UI.

### Exports

```ts
import { createTauriStation, type TauriStationConfig, type TauriStation } from "station-tauri";
```

### createTauriStation()

```ts
async function createTauriStation(config: TauriStationConfig): Promise<TauriStation>;
```

Creates a Station instance configured for desktop apps. Auto-provisions an API key on first run (saved to `{dataDir}/.station-key`).

### TauriStationConfig

```ts
interface TauriStationConfig {
  dataDir: string;                // required -- data directory for DB and key file
  port?: number;                  // default: 4400
  signalsDir?: string;            // signals directory
  broadcastsDir?: string;         // broadcasts directory
}
```

### TauriStation

```ts
interface TauriStation {
  port: number;                   // bound port
  apiKey: string;                 // auto-provisioned API key (sk_live_...)
  keyStore: KeyStore;             // key store instance
  dataDir: string;                // resolved data directory
  stop(): Promise<void>;          // graceful shutdown
}
```

### StationInstance additions

`StationInstance` (from station-kit internals) now exposes two additional properties:

```ts
interface StationInstance {
  // ... existing properties ...
  keyStore: KeyStore;             // API key store
  dataDir: string;                // resolved data directory
}
```

### Sidecar binary

The `station-sidecar` bin is the standalone entry point for Tauri's sidecar spawn. It reads configuration from environment variables and outputs a JSON ready event to stdout.

**Stdout on startup:**

```json
{"event":"ready","port":4400,"apiKey":"sk_live_..."}
```

### Sidecar environment variables

| Variable | Required | Description |
|----------|----------|-------------|
| `STATION_DATA_DIR` | Yes | Data directory for DB and key file |
| `STATION_PORT` | No | Server port (default: 4400) |
| `STATION_SIGNALS_DIR` | No | Signals directory |
| `STATION_BROADCASTS_DIR` | No | Broadcasts directory |

---

## 13. station-beacon

The long-running, supervised process primitive. Where a signal runs to completion and exits, a **beacon** stays up — a server, a poller, or a client. The `BeaconRunner` supervises each beacon in its own child process: restart policy, exponential backoff, startup-timeout and heartbeat stall detection, graceful shutdown, and per-beacon desired-state reconciliation. `station-beacon` has `station-signal` as a **peer dependency** (used for `z`, `parseInterval`, and passing the signal adapter manifest to children). Import `beacon` and `z` from `station-beacon`.

### `beacon(name)` builder

```ts
import { beacon, z } from "station-beacon";

export const webhookServer = beacon("webhook-server")
  .config(z.object({ port: z.number().default(8080) })) // Zod config schema
  .withConfig({ port: 8080 })                            // default config
  .restart("always")                                     // restart policy
  .backoff("1s", { factor: 2, max: "30s", resetAfter: "60s" })
  .startupTimeout("30s")                                 // ready() deadline (opt-in)
  .heartbeat("10s", { timeout: "45s" })                  // stall detection (opt-in)
  .stopTimeout("10s")                                    // grace before SIGKILL
  .run(async (ctx) => { /* long-running handler */ });
```

Two terminals finalize a beacon:

- `.run(handler)` — a general long-running handler; runs until it returns, throws, or `ctx.signal` aborts.
- `.poll(interval, fn)` — the framework calls `fn` every `interval` until stopped, marking ready on the first tick.

| Method | Description |
|--------|-------------|
| `.config(schema)` | Zod schema for config; validated (with defaults) in the child before each start. Invalid config is **fatal** (→ `errored`, no restart). |
| `.withConfig(data)` | Default config when started without an override. |
| `.restart(policy)` | `"always"` \| `"on-failure"` (default) \| `"never"`. |
| `.backoff(base, opts?)` | Exponential backoff. `base`: interval string or ms. `opts`: `{ factor=2, max="30s", resetAfter="60s" }`. |
| `.heartbeat(interval, opts?)` | Opt into stall detection. `opts.timeout` defaults to 3× interval. Handler must call `ctx.heartbeat()`. |
| `.startupTimeout(value)` | Deadline from spawn to reach ready (`ctx.ready()`). Missing it kills+restarts with reason `startup-timeout` (per policy). Off by default; handler must call `ctx.ready()`. |
| `.stopTimeout(value)` | Grace period after a stop request before force-kill. Default `"10s"`. |
| `.startMode(mode)` | `"auto"` (default) \| `"manual"` \| `"on-demand"` — how instances come into existence. |
| `.manualStart()` | Shorthand for `.startMode("manual")`: seed one instance, leave it stopped. |
| `.onDemand()` | Shorthand for `.startMode("on-demand")`: seed nothing; instances are created at runtime. |
| `.maxInstances(n)` | Cap concurrent instances of this beacon. Defaults to the runner's `maxInstancesPerBeacon` (100). |
| `.env(...keys)` | Require env var keys; a missing one marks the instance `errored` instead of spawning. |
| `.run(handler)` / `.poll(interval, fn)` | Finalize. |

Intervals accept `"100ms"`, `"30s"`, `"5m"`, `"1h"`, `"1d"`, `"1w"`, or a raw millisecond number.

### Start modes and instances

A beacon **definition** can back many running **instances**, each supervised independently with its own config, status, restart counter, and logs. The start mode decides how they come to exist:

| Start mode | Behaviour |
|------------|-----------|
| `auto` (default) | One instance is seeded on discovery and started. Its id is the beacon name. |
| `manual` (`.manualStart()`) | One instance is seeded but left stopped until started from the dashboard or API. |
| `on-demand` (`.onDemand()`) | Nothing is seeded. Instances exist only once created at runtime, and are removed when deleted. |

The instance seeded from the file has `origin: "definition"` and uses the beacon name as its id — so single-instance state written before instances existed keeps working unchanged, and definition-level calls (`startBeacon` / `stopBeacon` / `restartBeacon`) act on it. Any beacon, whatever its start mode, can *additionally* have instances created at runtime (`origin: "api"`); those are fully removable.

```ts
// One definition, many tenants.
export const queueWorker = beacon("queue-worker")
  .config(z.object({ queue: z.string(), batchSize: z.number().default(10) }))
  .onDemand()
  .maxInstances(8)
  .run(async (ctx) => {
    ctx.log(`instance ${ctx.instanceId} draining ${ctx.config.queue}`);
    ctx.ready();
    await ctx.untilStopped();
  });

await runner.createInstance("queue-worker", {
  id: "worker-acme",                       // optional; generated when omitted
  label: "acme",                           // optional
  config: { queue: "acme", batchSize: 25 }, // validated against the config schema
});                                        // starts immediately (start: false to stage it)
```

Instance ids are unique **across all beacons** (they are adapter primary keys and URL segments), must match `/^[a-zA-Z0-9][a-zA-Z0-9._:-]*$/`, and are at most 128 characters. The bare beacon name is reserved for the definition-owned instance. Runtime-created instances are persisted, so a supervisor restart resumes them; an instance whose definition is no longer registered is marked `errored` with an explanatory message rather than silently dropped (restoring the file brings it back).

### `BeaconContext`

Passed to every handler:

```ts
interface BeaconContext<TConfig> {
  readonly name: string;
  readonly instanceId: string;      // which instance this process is; === name for the definition-owned one
  readonly config: TConfig;         // validated, defaults applied
  readonly incarnation: number;     // 1 on first start, +1 per restart
  readonly signal: AbortSignal;     // aborts on stop — pass to fetch / stream iterators
  ready(): void;                    // mark healthy (records readyAt)
  heartbeat(): void;                // report liveness (required if .heartbeat() declared)
  log(message: string): void;       // structured log line to subscribers
  onStop(fn: () => void | Promise<void>): void; // cleanup on stop
  untilStopped(): Promise<void>;    // resolves when signal aborts
}
```

Idiomatic server tail: start the thing, `ctx.ready()`, `ctx.onStop(cleanup)`, then `await ctx.untilStopped()`.

### `BeaconRunner`

```ts
import { BeaconRunner, ConsoleBeaconSubscriber } from "station-beacon";

const runner = new BeaconRunner({
  beaconsDir: "./beacons",          // auto-discovery (or use register())
  adapter,                          // BeaconStateAdapter (default: BeaconMemoryAdapter)
  subscribers: [new ConsoleBeaconSubscriber()],
  signalRunner,                     // optional — lets beacons trigger signals
  pollIntervalMs: 1000,             // reconcile cadence
});
await runner.start();               // blocks until stop()
```

| Constructor option | Type | Default | Notes |
|---|---|---|---|
| `beaconsDir` | `string` | — | Recursive auto-discovery of exported beacons. |
| `adapter` | `BeaconStateAdapter` | `BeaconMemoryAdapter` | Supervision state + optional event log. |
| `signalRunner` | `SignalRunner` | — | Beacons can `signal.trigger()` into its queue (adapter manifest passed to children). |
| `signalAdapter` | `SignalQueueAdapter` | — | Alternative to `signalRunner`. |
| `subscribers` | `BeaconSubscriber[]` | `[]` | Lifecycle event listeners. |
| `pollIntervalMs` | `number` | `1000` | Milliseconds between reconcile ticks. |
| `envProvider` | `EnvProvider` | — | Source of runtime env vars (station-env's `EnvStore`); satisfies `.env()` requirements. |
| `maxInstancesPerBeacon` | `number` | `100` | Default instance cap for beacons without their own `.maxInstances()`. |

**Lifecycle:** `start()`, `whenReady()`, `stop({ graceful?, timeoutMs? })`, `register(beacon, filePath)`, `subscribe(sub)`, `static create(beaconsDir, opts?)`.

`start()` only settles when the supervisor stops, so anything that needs the registry populated — an API served on top of the runner, or a `createInstance()` call at boot — should `await runner.whenReady()`, which resolves once discovery, hydration of persisted instances, and seeding are done.

**Definitions:** `listRegistered()`, `getBeacon(name)`, `hasBeacon(name)`.

**Instances:** `createInstance(beaconName, { id?, label?, config?, start? })`, `updateInstance(id, { config?, label?, restart? })`, `deleteInstance(id, { timeoutMs? })`, `startInstance(id, { config? })`, `stopInstance(id)`, `restartInstance(id)`, `getInstance(id)`, `listInstances({ beaconName? })`, `listInstanceEvents(id, limit?)`, `listBeaconEvents(name, limit?)`, `stopAllInstances(beaconName)`.

**Definition-level shorthands** (act on the definition-owned instance, whose id is the beacon name): `startBeacon(name, { config? })`, `stopBeacon(name)`, `restartBeacon(name)`.

Runtime control is desired-state based — the supervisor reconciles toward it every tick, including stopping a live child whose desired state became `stopped`:

```ts
await runner.stopBeacon("consumer");                       // desired = stopped
await runner.startBeacon("consumer", { config: { ... } }); // desired = running (+ config override)
await runner.restartBeacon("consumer");                    // graceful stop, then relaunch

// Per-instance, for beacons running more than one:
const inst = await runner.createInstance("queue-worker", { config: { queue: "acme" } });
await runner.stopInstance(inst.id);
await runner.updateInstance(inst.id, { config: { queue: "acme2" }, restart: true });
await runner.deleteInstance(inst.id);                      // stops, then removes the record
```

`createInstance` throws `BeaconValidationError` on config that fails the schema, `BeaconInstanceExistsError` on a taken id, and `BeaconInstanceLimitError` at the cap. `deleteInstance` refuses a definition-owned instance — stop it instead. `startBeacon` on an `on-demand` beacon throws, since there is no definition instance to start.

### `BeaconInstance` and status model

One record per **instance** (not per beacon), mirrored in-memory and written through to the adapter.

```ts
type BeaconStatus = "stopped" | "starting" | "running" | "stopping" | "backoff" | "errored";
type DesiredState = "running" | "stopped";
type ExitReason = "clean" | "failure" | "stopped" | "stalled" | "startup-timeout";
type RestartPolicy = "always" | "on-failure" | "never";

interface BeaconInstance {
  id: string;                  // unique instance id; === beaconName for the definition-owned instance
  beaconName: string;
  label?: string;
  origin: "definition" | "api"; // seeded from the beacon file, or created at runtime
  status: BeaconStatus;        // backoff = scheduled to (re)start at nextRestartAt; errored = terminal
  desiredState: DesiredState;
  incarnation: number;         // total starts
  restartCount: number;        // consecutive restarts since last healthy
  pid?: number;
  config?: string;             // JSON of the resolved config for this incarnation
  startedAt?: Date; readyAt?: Date; lastHeartbeatAt?: Date;
  lastExitAt?: Date; lastExitReason?: ExitReason; lastError?: string;
  nextRestartAt?: Date;        // when, in backoff, the next restart fires
  createdAt: Date; updatedAt: Date;
}
```

Restart decision (`shouldRestart`, exported from `station-beacon`): never restart when `desiredState==="stopped"` or the stop was operator-initiated; `never` never restarts; `on-failure` restarts on `failure`/`stalled`/`startup-timeout`; `always` restarts on any non-operator exit. Backoff: `computeBackoffMs(attempt, cfg) = min(max, base × factor^attempt)`; `shouldResetBackoff(uptimeMs, cfg)` resets the attempt counter after the process stays up past `resetAfterMs`.

### `BeaconStateAdapter`

Parent-only (the supervisor is the sole authority — no cross-process reconstruction).

Records are keyed by **instance id**, not beacon name.

```ts
interface BeaconStateAdapter {
  upsertInstance(instance: BeaconInstance): Promise<void>;
  getInstance(instanceId: string): Promise<BeaconInstance | null>;
  updateInstance(instanceId: string, patch: BeaconInstancePatch): Promise<void>;
  listInstances(filter?: { beaconName?: string }): Promise<BeaconInstance[]>;
  removeInstance(instanceId: string): Promise<void>;            // also drops the instance's events
  addEvent?(event: BeaconEvent): Promise<void>;                 // optional lifecycle log
  listEvents?(instanceId: string, limit?: number): Promise<BeaconEvent[]>;
  listBeaconEvents?(beaconName: string, limit?: number): Promise<BeaconEvent[]>;
  generateId(): string;
  ping(): Promise<boolean>;
  close?(): Promise<void>;
}
```

`BeaconEvent` carries both `instanceId` and `beaconName`, so a timeline can be read per instance or across every instance of a beacon.

Built-in: `BeaconMemoryAdapter` (single-process; state lost on restart — the supervisor re-derives desired state from each beacon's start mode, and runtime-created instances do not survive). Durable implementations ship as `/beacon` subpath exports of the adapter packages: `BeaconSqliteAdapter` (`station-adapter-sqlite/beacon`), `BeaconPostgresAdapter` (`station-adapter-postgres/beacon`), `BeaconMysqlAdapter` (`station-adapter-mysql/beacon`, async `.create()`), `BeaconRedisAdapter` (`station-adapter-redis/beacon`). Each persists the instance record and the lifecycle event log, and each migrates a pre-multi-instance database in place on first open (the old `beacon_name` primary key becomes the instance `id`, with `beacon_name` backfilled) — existing records keep their desired state and counters.

### `BeaconSubscriber`

All optional; errors are caught and logged. `onBeaconDiscovered`, `onBeaconInstanceCreated`, `onBeaconInstanceRemoved`, `onBeaconStarting`, `onBeaconStarted`, `onBeaconReady`, `onBeaconHeartbeat`, `onBeaconExited` (`{ instance, reason, code }`), `onBeaconRestartScheduled` (`{ instance, delayMs, nextRestartAt }`), `onBeaconStopped`, `onBeaconErrored` (`{ instance, error }`), `onBeaconStalled`, `onBeaconLog` (`{ instance, level, message }`). Built-in `ConsoleBeaconSubscriber`.

### Notes

- **Fatal errors** (invalid config, beacon not found) exit with `FATAL_EXIT_CODE` (78, exported) and go to `errored` without restarting — the sentinel exit code is authoritative so a bad config never restart-loops, even under `restart("always")`.
- Child processes are `unref`'d and self-exit on IPC `disconnect`, so a dying supervisor never leaves orphans.
- Triggering signals from a beacon requires a **persistent** signal adapter (SQLite/Postgres/…) wired via `signalRunner`; the default in-memory adapter does not cross the child-process boundary.
- **Dashboard**: set `beaconsDir` (and optionally `beaconAdapter`) in `station-kit`'s `defineConfig` to supervise beacons and surface them on the dashboard `/beacons` page — live status, logs, lifecycle events, per-instance controls, and a **New instance** form built from the beacon's config schema. `beaconMaxInstances` sets the default instance cap.

**Beacon REST surface** (dashboard API under `/api`, authenticated v1 under `/api/v1`):

| Method + path | v1 scope | Purpose |
|---|---|---|
| `GET /beacons` | `read` | Definitions with their instances, `instanceCount`, `runningCount`. |
| `GET /beacons/:name` | `read` | One definition + `configSchema` + every instance. |
| `GET /beacons/:name/instances` | `read` | Instances of one beacon. |
| `GET /beacons/:name/instances/:id` | `read` | One instance. |
| `GET /beacons/:name/events` | `read` | Lifecycle events across all instances. |
| `GET /beacons/:name/instances/:id/{events,logs}` | `read` | Per-instance history and captured output. |
| `POST /beacons/:name/instances` | `trigger` | Create an instance — `{ id?, label?, config?, start? }`; 201 with the record. |
| `POST /beacons/:name/instances/:id/{start,restart}` | `trigger` | Bring an instance up. |
| `POST /beacons/:name/instances/:id/stop` | `cancel` | Take an instance down. |
| `PATCH /beacons/:name/instances/:id` | `admin` | Change `config` / `label`; `restart: true` applies it now. |
| `DELETE /beacons/:name/instances/:id` | `admin` | Stop and remove a runtime-created instance. |
| `POST /beacons/:name/{start,stop,restart}` | `trigger` / `cancel` | Act on the definition-owned instance; `stop?all=true` stops every instance. |

Creation failures are distinguishable: `400 invalid_config`, `404 not_found` (unknown beacon), `409 instance_exists`, `409 instance_limit`. An instance id only resolves under the beacon that owns it, so `/beacons/other/instances/:id` is a 404.

---

## 14. station-env

Runtime-managed environment variables injected into signal/beacon runs. Values live behind a pluggable `EnvStorageAdapter`; `EnvStore` adds validation, secret masking, conflict detection, and Vercel-style resolution.

### Exports (`station-env`)

```ts
import {
  EnvStore, EnvValidationError,
  MemoryEnvStorage, FileEnvStorage,
  type EnvStorageAdapter, type EnvVar, type EnvVarPublic, type EnvTarget,
  validateEnvKey, missingEnvKeys,
} from "station-env";
```

### `EnvStorageAdapter`

```ts
interface EnvStorageAdapter {
  add(envVar: EnvVar): Promise<void>;
  get(id: string): Promise<EnvVar | null>;
  list(): Promise<EnvVar[]>;
  update(id: string, patch: EnvVarPatch): Promise<void>;
  delete(id: string): Promise<boolean>;
  generateId(): string;
  ping(): Promise<boolean>;
  close?(): Promise<void>;
}
```

Built-ins: `MemoryEnvStorage` (tests), `FileEnvStorage` (default — JSON at `<dataDir>/station-env.json`, fsync'd tmp+rename, `0o600`, single-process). Durable adapters: `station-adapter-{sqlite,postgres,mysql,redis}/env` (`EnvSqliteAdapter`, `EnvPostgresAdapter`, `EnvMysqlAdapter.create()`, `EnvRedisAdapter`). The MySQL adapter uses the async `create()` factory (private constructor); the rest are plain `new`.

### `EnvVar` / `EnvTarget`

```ts
interface EnvTarget { kind: "signal" | "beacon"; name: string; }

interface EnvVar {
  id: string;
  key: string;               // POSIX-style; store rejects loader/exec keys (PATH, NODE_OPTIONS, NODE_PATH, LD_PRELOAD, LD_LIBRARY_PATH, DYLD_INSERT_LIBRARIES, DYLD_LIBRARY_PATH) + prefixes STATION_SIGNAL_/STATION_BEACON_/__STATION
  value: string;
  secret: boolean;           // secret ⇒ value redacted (null) on read, still injected at run time
  targets: EnvTarget[];      // empty ⇒ global; else scoped (overrides a global of the same key)
  createdAt: Date;
  updatedAt: Date;
  createdBy?: string;
}
```

### `EnvStore`

```ts
const store = new EnvStore(adapter, { cacheTtlMs: 1000 });

await store.create({ key: "STRIPE_API_KEY", value: "sk_live_…", secret: true });     // global
await store.create({ key: "DB_URL", value: "…", targets: [{ kind: "signal", name: "charge" }] });
await store.update(id, { value: "…" });               // secret can't be downgraded to non-secret
await store.delete(id);
await store.listPublic();                             // redacted (secrets → value: null)
await store.resolveFor({ kind: "signal", name: "charge" });  // Record<string,string> to inject
```

- **Resolution**: global vars first, then vars scoped to the target (scoped wins on key collisions).
- **Conflicts**: `create`/`update` throw `EnvValidationError` if two vars would both apply to one target with the same key.
- `EnvStore` structurally satisfies the runner `EnvProvider` interface — pass it as `envProvider` to `SignalRunner`/`BeaconRunner`, or set `envStorage` in `station-kit`'s `defineConfig` (station-kit wires the `EnvStore` and injects it into both runners automatically).

### Requiring env vars

`.env(...keys)` on a signal or beacon marks keys required. Before dispatch the runner checks each key against the resolved store map **and** the host `process.env`. A signal run **fails** with a missing-keys error; a beacon is marked **errored** (terminal until `startBeacon` retries). Provided vars are applied to the child's `process.env` (over IPC, not the spawn env) before the file is imported.

### v1 API Endpoints

| Method | Path | Scope | Notes |
|--------|------|-------|-------|
| `GET` | `/api/v1/env` | read | Secret values redacted (`value: null`). |
| `GET` | `/api/v1/env/:id` | read | Redacted. |
| `POST` | `/api/v1/env` | admin | Body `{ key, value, secret?, targets? }`. 400 on invalid/reserved/conflicting key. |
| `PATCH` | `/api/v1/env/:id` | admin | Body `{ value?, secret?, targets? }`. |
| `DELETE` | `/api/v1/env/:id` | admin | |

Dashboard: the **Environment** page manages vars and flags required-but-undefined keys per signal/beacon.

---

## 15. station-network

Shared fleet membership and fenced controller leases for multi-process Station
deployments. `station-kit` creates a memory adapter automatically, but separate
processes must receive the same durable backend through `network.adapter`.

### Exports

```ts
import {
  StationNetworkMemoryAdapter,
  type StationRole,
  type StationStatus,
  type StationCapacity,
  type StationDefinitions,
  type StationNode,
  type StationHeartbeat,
  type ControllerLease,
  type StationListFilter,
  type StationNetworkAdapter,
} from "station-network";
```

```ts
type StationRole = "headquarters" | "station" | "standalone";
type StationStatus = "online" | "draining" | "offline";

interface StationNode {
  id: string;
  networkId: string;
  name: string;
  role: StationRole;
  status: StationStatus;
  labels: Record<string, string>;
  capacity: { maxConcurrent: number; activeRuns: number };
  definitions: { signals: string[]; broadcasts: string[]; beacons: string[] };
  version?: string;
  endpoint?: string;
  startedAt: Date;
  lastHeartbeatAt: Date;
  leaseExpiresAt: Date;
}

interface ControllerLease {
  name: string;
  holderId: string;
  token: string;
  expiresAt: Date;
}
```

### Adapter contract

```ts
interface StationNetworkAdapter {
  upsertStation(station: StationNode): Promise<void>;
  getStation(id: string): Promise<StationNode | null>;
  listStations(filter?: StationListFilter): Promise<StationNode[]>;
  heartbeat(id: string, heartbeat: StationHeartbeat): Promise<boolean>;
  removeStation(id: string): Promise<void>;
  markOfflineBefore(cutoff: Date, networkId?: string): Promise<number>;

  acquireControllerLease(lease: ControllerLease, now: Date): Promise<boolean>;
  renewControllerLease(name: string, holderId: string, token: string,
    expiresAt: Date, now?: Date): Promise<boolean>;
  releaseControllerLease(name: string, holderId: string, token: string): Promise<boolean>;
  getControllerLease(name: string): Promise<ControllerLease | null>;

  ping(): Promise<boolean>;
  close?(): Promise<void>;
}
```

Controller leases guard fleet-wide signal concurrency and single-owner beacon
instances. A lease token fences stale owners: renewal fails after expiry, and a
previous holder cannot release or renew a replacement holder's lease.

### Persistent adapters

```ts
import { StationNetworkSqliteAdapter } from "station-adapter-sqlite/network";
import { StationNetworkPostgresAdapter } from "station-adapter-postgres/network";
import { StationNetworkMysqlAdapter } from "station-adapter-mysql/network";
import { StationNetworkRedisAdapter } from "station-adapter-redis/network";

const sqlite = new StationNetworkSqliteAdapter({ dbPath: "./station.db" });
const postgres = new StationNetworkPostgresAdapter({ connectionString });
const mysql = await StationNetworkMysqlAdapter.create({ connectionString });
const redis = new StationNetworkRedisAdapter({ url: "redis://localhost:6379" });
```

SQLite coordinates processes that share one filesystem. Use PostgreSQL,
MySQL, or Redis across machines. Reuse existing pools/clients when appropriate.

### Signal controls

```ts
export const render = signal("render")
  .concurrency({ station: 4, network: 20 })
  .placement({ labels: { gpu: "true", region: "ke" } })
  .run(async () => { /* ... */ });
```

Passing a number to `.concurrency(4)` remains the per-station form. A station
must match every requested placement label and be `online` before it can claim.
Run ownership uses `RunClaim` fields on the shared signal queue:
`stationId`, `leaseToken`, `leaseExpiresAt`, and `claimedAt`. Official adapters
implement atomic claim, renewal, cancellation, recovery, and fenced updates.

### Beacon controls and service proxy

Beacon definitions accept `.placement({ labels })`. Each networked instance has
one lease-owning station. `ctx.expose({ protocol: "http", port, path? })`
publishes a service address after the handler starts. Headquarters proxies HTTP
requests through:

```text
/api/v1/beacons/:name/instances/:id/proxy/*
```

The route requires `trigger` or `admin`, refuses stale/offline owners, and only
uses advertised HTTP(S) station endpoints. WebSocket upgrades return 426; use
the owning station endpoint directly for WebSockets.

### Operational semantics

- Give each process a stable, unique `stationId` and the same `network.id`.
- Keep the queue and network backend shared by every node. Share beacon state
  for beacons and schedule storage across Headquarters replicas.
- Headquarters reconciles schedules and broadcasts but has zero signal
  execution slots. Stations execute signals/beacons but do not reconcile them.
- `draining` blocks new signal and beacon claims. `offline` is derived when the
  heartbeat lease expires.
- A scheduled timestamp is eligibility time, not a hard real-time start SLA.
  Atomic occurrence claims prevent duplicate fires; queue and run leases
  prevent duplicate ownership.

---

## 16. station-browser (experimental)

Use `BrowserStation`, not the Node runners above, for execution inside a web app.
Read [browser.md](browser.md) for complete registry/page/worker examples, package
availability, beacon configuration behavior, and recovery constraints.

```ts
import {
  BrowserStation, IndexedDBStore, BrowserBroadcasts, BrowserBeacons,
  signal, broadcast, beacon, z, configure, sleepOrAbort,
  type BrowserRun, type Checkpoint, type BrowserBroadcastRun,
  type BrowserBroadcastNode, type BrowserBeaconInstance,
  type BeaconContext, type AnyBeacon, type Signal, type BroadcastDefinition,
} from "station-browser";
import type { BrowserStationOptions } from "station-browser";
```

`BrowserStationOptions` accepts optional `signals`, `broadcasts`, `beacons`,
`database`, `stationId`, `definitionVersion`, and positive integer `concurrency`.
Defaults: empty definition arrays, database `station-browser`, generated station
ID, definition version `"1"`, and four concurrent async signal attempts.

| API | Result and semantics |
|---|---|
| `station.trigger(definitionOrName, input)` | `Promise<string>` signal run ID; validates input and enqueues |
| `station.triggerBroadcast(name, input)` | `Promise<string>` broadcast ID; root signal validation occurs during coordination |
| `station.drain({ maxJobs?, budgetMs? })` | `Promise<number>` claimed attempts; defaults 10 / 20,000 ms, budget limits new claims |
| `station.wake({ maxJobs?, budgetMs?, beaconSliceMs? })` | `Promise<void>` jobs plus beacon supervision; default slice 1,500 ms |
| `station.store.get(id)` | `Promise<BrowserRun \| undefined>` |
| `station.store.list()` | `Promise<BrowserRun[]>` |
| `station.store.cancel(id)` | `Promise<boolean>`; fences active writes |
| `station.store.close()` | `Promise<void>`; settle host work before closing |
| `station.broadcasts.trigger(name, input)` | `Promise<string>`; same as station.triggerBroadcast |
| `station.broadcasts.list()` | `Promise<BrowserBroadcastRun[]>`; find a workflow by ID in this list |
| `station.broadcasts.cancel(id)` | `Promise<void>`; cancels parent and fences child jobs |
| `station.broadcasts.advance()` | `Promise<void>`; coordinator called automatically by drain |
| `station.beacons.start(name, { instanceId?, config? })` | `Promise<string>` instance ID; persists desired running |
| `station.beacons.list()` | `Promise<BrowserBeaconInstance[]>` |
| `station.beacons.stop(instanceId)` | `Promise<void>`; persists desired stopped |
| `station.beacons.tick()` | `Promise<void>`; host supervision and lease renewal |
| `station.beacons.runSlice(ms?)` | `Promise<void>`; default 1,500 ms then suspension/cleanup |
| `station.beacons.suspend()` | `Promise<void>`; preserve desired running, clean up this host's handlers |

Inputs, outputs, checkpoint outputs, and beacon configs are JSON strings in stored
records. Parse defined values. Signal/broadcast timestamps use Dates; beacon
lifecycle/log timestamps use epoch milliseconds. These records are origin-local
IndexedDB data, not server queue adapters or network membership.

Signals reject recurring schedules, env, placement, per-signal concurrency, and
onComplete. Broadcasts reject recurring definitions and do not expose dynamic
workflow storage/editing. Beacons cannot expose listening ports or inject env /
placement. Browser supervision is cooperative; service-worker beacons suspend
between wakes. No method guarantees continuous execution after app/browser exit.

---

## Quick Reference: Import Patterns

### Adapter subpath imports

All adapter packages use subpath exports for their broadcast adapters:

```ts
// Signal adapters (main entry)
import { SqliteAdapter } from "station-adapter-sqlite";
import { PostgresAdapter } from "station-adapter-postgres";
import { MysqlAdapter } from "station-adapter-mysql";
import { RedisAdapter } from "station-adapter-redis";

// Broadcast adapters (subpath)
import { BroadcastSqliteAdapter } from "station-adapter-sqlite/broadcast";
import { BroadcastPostgresAdapter } from "station-adapter-postgres/broadcast";
import { BroadcastMysqlAdapter } from "station-adapter-mysql/broadcast";
import { BroadcastRedisAdapter } from "station-adapter-redis/broadcast";

// Beacon adapters (subpath)
import { BeaconSqliteAdapter } from "station-adapter-sqlite/beacon";
import { BeaconPostgresAdapter } from "station-adapter-postgres/beacon";
import { BeaconMysqlAdapter } from "station-adapter-mysql/beacon";
import { BeaconRedisAdapter } from "station-adapter-redis/beacon";

// Env adapters (subpath)
import { EnvSqliteAdapter } from "station-adapter-sqlite/env";
import { EnvPostgresAdapter } from "station-adapter-postgres/env";
import { EnvMysqlAdapter } from "station-adapter-mysql/env";   // async: await EnvMysqlAdapter.create(...)
import { EnvRedisAdapter } from "station-adapter-redis/env";

// Station Network adapters (subpath)
import { StationNetworkSqliteAdapter } from "station-adapter-sqlite/network";
import { StationNetworkPostgresAdapter } from "station-adapter-postgres/network";
import { StationNetworkMysqlAdapter } from "station-adapter-mysql/network"; // async .create(...)
import { StationNetworkRedisAdapter } from "station-adapter-redis/network";

// Tauri sidecar
import { createTauriStation } from "station-tauri";
```

Exception: MySQL broadcast adapter is also re-exported from the main entry:

```ts
import { MysqlAdapter, BroadcastMysqlAdapter } from "station-adapter-mysql";
```

Same for Redis:

```ts
import { RedisAdapter, BroadcastRedisAdapter } from "station-adapter-redis";
```

### Zod re-export

```ts
import { z } from "station-signal";
// Equivalent to: import { z } from "zod";
```

### Full setup pattern

```ts
import { signal, SignalRunner, z } from "station-signal";
import { broadcast, BroadcastRunner } from "station-broadcast";
import { SqliteAdapter } from "station-adapter-sqlite";
import { BroadcastSqliteAdapter } from "station-adapter-sqlite/broadcast";

// Define signals
const mySignal = signal("my-signal")
  .input(z.object({ name: z.string() }))
  .run(async (input) => {
    return { greeting: `Hello, ${input.name}` };
  });

// Define broadcasts
const myBroadcast = broadcast("my-broadcast")
  .input(mySignal)
  .build();

// Create runners
const signalAdapter = new SqliteAdapter({ dbPath: "station.db" });
const broadcastAdapter = new BroadcastSqliteAdapter({ dbPath: "station.db" });

const signalRunner = new SignalRunner({
  adapter: signalAdapter,
  subscribers: [],
  maxConcurrent: 10,
});
signalRunner.register("my-signal", "./signals/my-signal.ts");

const broadcastRunner = new BroadcastRunner({
  signalRunner,
  adapter: broadcastAdapter,
});
broadcastRunner.register(myBroadcast);

// Start (non-blocking)
signalRunner.start();
broadcastRunner.start();

// Trigger
const runId = await mySignal.trigger({ name: "World" });
const broadcastRunId = await broadcastRunner.trigger("my-broadcast", { name: "World" });
```

### Remote trigger pattern

```ts
import { signal, configure, z } from "station-signal";

// Configure remote endpoint
configure({
  endpoint: "https://station.example.com",
  apiKey: "sk_live_...",
});

// Or via environment variables:
// STATION_ENDPOINT=https://station.example.com
// STATION_API_KEY=sk_live_...

const mySignal = signal("my-signal")
  .input(z.object({ name: z.string() }))
  .run(async () => {}); // Handler not used remotely

// trigger() sends HTTP POST to remote Station server
const runId = await mySignal.trigger({ name: "World" });
```
