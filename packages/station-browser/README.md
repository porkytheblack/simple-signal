# station-browser (experimental)

Run Station signals, broadcasts, and beacons inside Web Workers and service
workers. The browser runtime reuses Station's existing definition builders and
adds IndexedDB persistence, atomic ownership, DAG coordination, and cooperative
beacon supervision. This is a local browser prototype, not yet a Station Network
member or a replacement for the Node runners.

| Primitive | Web Worker | Service worker |
|---|---|---|
| Signals | Async execution, retries, saved steps | Bounded batches on wake events |
| Broadcasts | Concurrent branches, joins, guards, failure policies | Same DAG coordinator; unfinished work resumes on later wakes |
| Beacons | Supervision while worker can execute | Run a short slice, request cleanup, save `suspended`; resume on a later wake |

## Try it

From the repository root:

```sh
pnpm install
pnpm dev:browser
```

Open http://127.0.0.1:4317. Queue a report, interrupt the Web Worker after a step
has completed, then resume. The interrupted attempt is reclaimed after its
fixed lease expires (seven seconds for the demo report), and saved steps are
reused. Reloading the page also preserves the queue. Select **Service worker**
to run the same signals via message wake events. Once the offline shell is
cached, the demo can reload without its static file server.

The demo also includes **Run text analysis**, a broadcast with two concurrent
branches, a join, and a conditional highlight. Check **Simulate one branch
failing** to see independent work finish while dependent nodes are skipped.
**Start pulse** starts a poll beacon; **Start recovering client** starts a raw
handler that fails once and reconnects under supervision. Both display their
incarnation, heartbeat, desired state, executor, and recent logs.

## Define a signal

This package reuses the actual Station signal builder and Zod schemas.
Bundle browser entries with a browser-aware bundler such as esbuild or Vite;
the `browser` condition selects Web Crypto instead of Node's crypto module.
There are no Node runtime polyfills in the demo bundle.

```ts
// signals.ts — import this registry in your page and worker bundles.
import { signal, z } from "station-browser";

export const wordCount = signal("word-count")
  .input(z.object({ text: z.string() }))
  .timeout(5_000)
  .retries(2)
  .step("split", async ({ text }) => text.trim().split(/\s+/))
  .step("count", async (words) => ({ words: words.length }))
  .build();
```

```ts
// page.ts — persists jobs; execution happens in your worker.
import { BrowserStation, configure } from "station-browser";
import { wordCount } from "./signals";

const station = new BrowserStation({ signals: [wordCount], database: "my-app-jobs" });
configure({ triggerAdapter: station });
await wordCount.trigger({ text: "Hello from the browser" });
// Alternatively: await station.trigger(wordCount, { text: "Hello" });
const runs = await station.store.list();
```

```ts
// sw.ts — bundle as a service-worker entry and register it from the page.
import { BrowserStation } from "station-browser";
import { wordCount } from "./signals";

const station = new BrowserStation({ signals: [wordCount], database: "my-app-jobs" });
self.addEventListener("message", (event) => {
  if (event.data?.type === "station:drain") {
    event.waitUntil(station.drain({ maxJobs: 5, budgetMs: 10_000 }));
  }
});
```

Wake it with `registration.active.postMessage({ type: "station:drain" })`.
The runnable example also shows a dedicated Web Worker loop, feature-detected
Background Sync registration, offline shell caching, and a queue viewer.
Calls to `drain()` on one instance share one batch promise. Multiple instances
can process different runs; IndexedDB serializes their claims.

## Broadcasts

Import `broadcast` from `station-browser` or `station-broadcast/browser` and use
the existing `.input(signal).then(...).build()` API. Register the definitions:

```ts
const station = new BrowserStation({
  database: "my-app-jobs",
  broadcasts: [myWorkflow],
  concurrency: 4,
});
configure({ triggerAdapter: station });
await myWorkflow.trigger(input);
await station.drain();
const workflows = await station.broadcasts.list();
await station.broadcasts.cancel(workflows[0].id);
```

Node signals are registered automatically. Conflicting definitions with the same
signal name are rejected. Concurrency here means overlapping async work in one
executor, not multiple CPU threads. It defaults to four signals per station.

Node records and their child signal runs are created in one IndexedDB
transaction. Deterministic child IDs and serialized reconciliation prevent two
coordinators from dispatching the same node twice. Completed outputs survive
reload, while interrupted child jobs use normal signal lease recovery.

The coordinator supports fan-out/fan-in, named nodes, explicit `after`
dependencies, synchronous input mappers and guards, and all three failure
policies. `fail-fast` cancels remaining child jobs; `skip-downstream` skips
descendants of failures while independent branches finish; `continue` follows
the same skip behavior but completes the parent with an error summary. Guard
skips do not propagate failure; mapped successors can still run. Failed/skipped
upstream outputs are not available as successful values.

Cancellation and parent timeouts fence active child writes. The optional parent
timeout runs from enqueue time, including time spent suspended. Change
`definitionVersion` when modifying workflow logic. Recurring broadcasts and the
dynamic-definition editing/storage APIs are not implemented.

## Beacons

Use the existing `beacon()` builder, including `.run()` or `.poll()`, config
schemas, `ready()`, heartbeats, `onStop()`, `untilStopped()`, restart policies,
backoff, startup timeout, manual/auto/on-demand start modes, and instance caps.

```ts
const station = new BrowserStation({ database: "my-app-jobs", beacons: [myClient] });
await station.beacons.start("my-client", { instanceId: "tenant-a", config: { tenant: "a" } });
await station.beacons.tick(); // dedicated-worker host should keep calling this (e.g. every 100ms)
const instances = await station.beacons.list();
await station.beacons.stop("tenant-a");
await station.beacons.suspend(); // host is shutting down; preserve desired-running state
```

For a service worker, use `event.waitUntil(station.wake({ beaconSliceMs: 1500 }))`.
`wake()` processes signals/broadcasts and runs a bounded beacon supervision slice
concurrently. The slice ends by aborting handlers and running cleanup callbacks.
Cleanup can add up to the beacon's `stopTimeout` beyond the slice duration. A
standalone `station.beacons.runSlice(ms)` is also available. `drain()` by itself
only processes signals and broadcasts.

Instance desired state and logs are persisted. Each launch gets an incarnation
number and an exclusive renewable lease. The host should tick much more often
than the 2.5-second lease duration. An expired lease can be recovered by a later
executor, and an old owner cannot overwrite the new owner's metadata. Backoff
and next-restart time survive reloads. At most eight beacons are active per
supervisor; the default per-definition stored-instance cap is also eight.

**Suspension differs from failure.** A requested suspension preserves
`desired: running` and does not consume a failure restart. Even a `restart("never")`
beacon resumes after suspension; that policy governs handler exits, not loss of
the browser execution opportunity. A clean exit honors `always` versus
`on-failure`/`never`; an exception or watchdog failure follows the restart policy.
Explicit stop persists `desired: stopped`, so it stays stopped after reload.
Stop an active instance before changing its config. A version mismatch stops
the instance with an error until explicitly started with the new definition.

Handlers must honor `ctx.signal` and clean up resources. When a handler ignores
stop or its cleanup fails, the supervisor marks it errored and blocks another
incarnation in that same worker. Destroy the worker to terminate it. Browser
leases fence stored state, not arbitrary external side effects: a frozen or
uncooperative handler can still have sent requests before it loses ownership.
Browser workers are not an untrusted-code sandbox, and a blocked JavaScript
thread prevents watchdog timers from running. This is cooperative supervision,
not the Node runner's OS process isolation.

The browser cannot host a listening server port: `ctx.expose()` fails explicitly.
Environment injection and placement are also rejected. Keep server credentials
out of browser bundles. Beacons in service workers cannot promise continuous
polling, live sockets, exact timers, or execution after the app/browser closes.

## Execution contract

- Each claim increments the attempt count and receives an opaque ownership
  token. Its lease expires at the job timeout plus one second. A subsequent
  drain recovers expired attempts, or fails them if their attempt budget is
  exhausted. Configure retries for recovery after interruption.
- Each successful step saves its JSON output before the next step begins.
  Retrying reuses these checkpoints. Incomplete steps and plain handlers may
  execute again. This is at-least-once execution: make external effects
  idempotent. A checkpoint does not make an external API call transactional.
- Token and lease checks guard both checkpoint and completion writes. Cancelled
  or superseded attempts cannot overwrite the current state.
- `budgetMs` limits when a batch may claim another job; an already claimed job
  can use its full timeout. Browsers may terminate service workers earlier.
  Timeouts are cooperative: the runtime rejects late writes, but cannot stop
  arbitrary JavaScript, a CPU loop, or an already sent request. A dedicated
  worker can be terminated by its owner, as the demo does.
- Queued retries become eligible after 250 ms and need another drain event.
  The demo supplies wake events while open. Background Sync is optional and
  does not promise prompt retries, recurring execution, or a continuously
  running worker after the page closes.
- Use a stable database name. Increment `definitionVersion` when changing
  handlers or step semantics. Runs from a different version fail through the
  normal attempt policy rather than execute with incompatible checkpoints.
  Keep old and new runtime versions from intentionally sharing a queue during
  a rollout, or use separate versioned database names.
- Inputs, outputs, and checkpoints should be JSON values. IndexedDB storage
  belongs to this browser and origin, can be cleared or evicted, and is not a
  server backup. Storage errors are surfaced to the caller.

Signals accept `.input()`, `.output()`, `.timeout()`, `.retries()`,
`.run()`, and `.step().build()`. The runtime explicitly rejects recurring schedules,
environment injection, placement, concurrency policies, and `onComplete`
callbacks. Per-station async concurrency is configured on `BrowserStation`;
per-signal and fleet concurrency policies are outside this slice. Fleet
membership, arbitrary Node modules, hard process isolation, and untrusted-code
sandboxing are outside this slice.
Handlers must use browser-compatible APIs. No server credentials should be
bundled into a browser handler.

`IndexedDBStore` is a small browser-specific store, not an implementation of
the full server `SignalQueueAdapter`. Database version 2 adds broadcast and
beacon stores while preserving version 1 signal runs. It currently scans the
local stores; large queues and retention policies need further work. Beacon
logs are bounded to 30 entries of 2,000 characters per instance.

## Validation

Run the demo, then open `/tests.html` with the demo page closed so another
executor does not take the integration-test jobs. Tests use real browser
IndexedDB and exercise input/output validation, competing claims, retries,
saved steps, expired leases, fencing, cancellation, timeout, version mismatch,
worker termination, DAG recovery, failure policies, beacon health and lifecycle,
and service-worker execution of all three primitives. Integration-test runs remain
visible in the demo queue. The checks do not certify background behavior across
all browsers or operation after the browser itself exits.
