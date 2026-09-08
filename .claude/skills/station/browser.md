# Browser-local Station (experimental)

Use this reference for web apps, PWAs, Web Workers, and service workers executing
Station workloads on the device. Use the Node guidance for remote server work.
The browser runtime is not a Station Network member and needs no companion app.

## Start from the workspace

`station-browser` is not yet included in npm release automation. Work from a
checkout containing the package; do not assume an npm install of the existing
Station version includes it. Run `pnpm install` and `pnpm dev:browser` at the repo
root, then open http://127.0.0.1:4317. For another app in this monorepo, declare
`station-browser: workspace:*` in dependencies.

Bundle page and worker entries for the browser (for example with esbuild and
`platform: "browser"`, `format: "esm"`). Serve worker bundles at the URLs used
below. Browser-aware package conditions select Web Crypto. Explicit builder
entrypoints also exist at `station-signal/browser`, `station-broadcast/browser`,
and `station-beacon/browser`. Do not bundle Node runners or database adapters.
Use HTTPS or localhost, IndexedDB, Web Crypto, and module worker support. Page
TypeScript uses DOM types; worker entries use WebWorker types.

## Shared definitions

Use a stable database name and identical registries/definitionVersion in the
page and executor. Register every definition explicitly; broadcast node signals
are included automatically. Do not create definitions dynamically on every render.

```ts
// src/registry.ts
import { beacon, broadcast, signal, z } from "station-browser";

export const report = signal("report")
  .input(z.object({ text: z.string() }))
  .timeout(5_000).retries(2)
  .step("normalize", async ({ text }) => text.trim())
  .step("count", async (text) => ({ characters: text.length }))
  .build();

const summarize = signal("summarize")
  .input(z.object({ characters: z.number() }))
  .output(z.object({ message: z.string() }))
  .run(async ({ characters }) => ({ message: String(characters) + " characters" }));

export const analysis = broadcast("analysis")
  .input(report).then(summarize)
  .onFailure("skip-downstream").build();

// onDemand avoids seeding an instance before its required URL is supplied.
export const status = beacon("status")
  .config(z.object({ url: z.string() }))
  .onDemand().restart("on-failure")
  .backoff("1s", { max: "10s" }).stopTimeout(1_000)
  .poll("1s", async (ctx) => {
    const response = await fetch(ctx.config.url, { signal: ctx.signal });
    if (!response.ok) throw new Error("Status request failed");
    ctx.heartbeat();
    ctx.log("HTTP " + response.status);
  });

export const options = {
  database: "my-app-station-v1",
  definitionVersion: "1",
  signals: [report], broadcasts: [analysis], beacons: [status],
  concurrency: 4,
};
```

The app must provide `/api/status` or supply another URL. Cross-origin fetches
need the target server's CORS permission. A poll awaits its callback and then
sleeps for the configured interval: `poll("1s")` is a delay after completion,
not an exact one-second schedule. Browser suspension and restarts add gaps.

## Dedicated worker host

Keep beacon ticks independent of job drains so slow signals do not block lease
renewal. The current beacon lease lasts 2.5 seconds; tick around every 100 ms
while the worker can execute. Catch and report host failures.

```ts
// src/worker.ts — compile with the WebWorker library
import { BrowserStation, configure } from "station-browser";
import { options } from "./registry.js";

const station = new BrowserStation({ ...options, stationId: "web-worker" });
configure({ triggerAdapter: station });
const reportError = (error: unknown) => postMessage({ error: String(error) });

async function drain() {
  try { await station.drain({ maxJobs: 10, budgetMs: 10_000 }); }
  catch (error) { reportError(error); }
  setTimeout(drain, 300);
}
void drain();
setInterval(() => {
  void station.beacons.tick().catch(reportError);
}, 100);
```

Page setup (bundles served at the origin root):

```ts
// src/app.ts — compile with the DOM library; bundles served at origin root
import { BrowserStation, configure } from "station-browser";
import { options, report, analysis } from "./registry.js";

const station = new BrowserStation(options);
configure({ triggerAdapter: station });
const worker = new Worker("/worker.js", { type: "module" });
worker.onmessage = ({ data }) => { if (data.error) console.error(data.error); };

const runId = await report.trigger({ text: "Hello from this device" });
const workflowId = await analysis.trigger({ text: "A browser workflow" });
await station.beacons.start("status", {
  instanceId: "api-status", config: { url: "/api/status" },
});

// Read these again from your UI to observe progress; trigger() only enqueues.
console.log(await station.store.get(runId));
console.log((await station.broadcasts.list()).find((run) => run.id === workflowId));
console.log(await station.beacons.list());

// User actions can call:
// await station.store.cancel(runId);
// await station.broadcasts.cancel(workflowId);
// await station.beacons.stop("api-status");
```

`configure()` is per JavaScript context. Configure every context calling a
builder's `.trigger()`, including handlers that trigger other work, or call
`station.trigger(definitionOrName, input)` / `station.triggerBroadcast(name, input)`.
Triggering only enqueues: it does not wait for completion or start an executor.
Observe stored statuses; there is no BrowserStation `waitForRun()` method.

## Service-worker host alternative

Use this instead of the dedicated worker. Register event handlers at module
load and pass the bounded work promise to `event.waitUntil()`.

```ts
// src/sw.ts — compile with the WebWorker library
import { BrowserStation, configure } from "station-browser";
import { options } from "./registry.js";

const sw = self as unknown as ServiceWorkerGlobalScope;
const station = new BrowserStation({ ...options, stationId: "service-worker" });
configure({ triggerAdapter: station });
sw.addEventListener("message", (event) => {
  if (event.data?.type !== "station:wake") return;
  event.waitUntil(station.wake({
    maxJobs: 10, budgetMs: 10_000, beaconSliceMs: 1_500,
  }));
});
```

In the page, replace `new Worker(...)` and its message handler with:

```ts
// In the page: replace new Worker(...) with this registration.
// After enqueueing work or changing beacon desired state, call wake().
await navigator.serviceWorker.register("/sw.js", { type: "module" });
const registration = await navigator.serviceWorker.ready;
function wake() {
  registration.active?.postMessage({ type: "station:wake" });
}
wake();
// Supply later wake opportunities while the page is open, including for retries.
setInterval(wake, 1_000);
```

Run the enqueue/start calls from the page example, then wake the service worker.
`wake()` drains jobs and supervises a beacon slice concurrently. `drain()` alone
does not supervise beacons. A retry or unfinished DAG needs a later drain/wake.
Background Sync is an optional, feature-detected host enhancement, not a timer.
BrowserStation does not register the service worker, push notifications, or an
offline shell cache; those belong to the application host. Reuse the demo's
cache code only with the application's own asset paths and cache namespace.

## Supported API and definition subset

- `new BrowserStation({ signals?, broadcasts?, beacons?, database?, stationId?,
  definitionVersion?, concurrency? })`: arrays default empty, database defaults
  `station-browser`, version `"1"`, concurrency 4, stationId a generated ID.
  Concurrency overlaps async signal attempts in one executor, not CPU threads.
- `trigger(definitionOrName, input)` and `triggerBroadcast(name, input)` return
  persisted run IDs. `drain({ maxJobs?, budgetMs? })` returns a claimed-attempt
  count (defaults 10 jobs / 20,000 ms). Its budget limits new claims only.
- `wake({ maxJobs?, budgetMs?, beaconSliceMs? })` returns `Promise<void>`;
  the default beacon slice is 1,500 ms, plus up to stopTimeout for cleanup.
- `store.get(id)`, `store.list()`, `store.cancel(id)` inspect/cancel signals;
  `broadcasts.list()`, `.cancel(id)` inspect/cancel workflows.
  Inputs/outputs/checkpoint outputs are serialized JSON strings; parse defined
  values. No remote v1 REST API or dashboard is created by this runtime.
- `beacons.start(name, { instanceId?, config? })` persists desired-running state
  and returns the instance ID. `beacons.stop(instanceId)` persists stopped;
  `beacons.list()` returns instances including heartbeat, owner, logs, and status.
- Hosts call `beacons.tick()`, `runSlice(ms)`, or `suspend()`. To shut down
  gracefully, stop host timers, suspend in the executor owning the handlers,
  settle in-flight work, then `store.close()`. Page unload is not a reliable
  asynchronous cleanup opportunity. Terminating a worker uses lease recovery.
- Signals support schemas, `.run()` or `.step().build()`, timeout, and retries.
  They reject recurring schedules, env injection, placement, per-signal/fleet
  concurrency policies, and onComplete. Set concurrency on BrowserStation.
- Broadcasts support fan-out/fan-in, named dependencies, synchronous maps/guards,
  and fail-fast / skip-downstream / continue. Continue completes the parent with
  an error summary and skips descendants of failures. Dynamic definitions and
  recurring broadcasts are unsupported; parent timeout includes suspension.
- Beacons support `.run()` / `.poll()`, config, ready, heartbeat, onStop,
  untilStopped, restart/backoff, startup timeout, and start modes. Honor
  `ctx.signal` and release resources. `ctx.expose()`, env, and placement are
  unavailable. Use run handlers for clients and poll handlers for repeated work.

## Known config workaround

Initial reconciliation seeds every non-on-demand definition using default
config before checking whether an instance already exists. A required field
without a default can reject the entire supervisor tick, even if `start()` was
already called with valid config. Until fixed, use `.onDemand()` plus explicit
config on `start()` for such definitions, as above. Manual/auto definitions need
valid defaults (schema defaults or `.withConfig(...)`). Stop an active instance
before changing its config. Do not present this issue as fixed.

## Recovery and lifetime rules

- Signal claims increment attempts and lease for timeout + 1 second. Configure
  retries to recover interruption. Expired work is reclaimed on a later drain;
  exhausted attempts fail. Retries become eligible after 250 ms.
- Completed step outputs persist; incomplete steps/plain handlers can repeat.
  External effects are at least once and must be idempotent. Ownership tokens
  fence state writes, not an HTTP request already sent by a stale handler.
- Browser timeouts and beacon cleanup are cooperative. A CPU loop blocks
  watchdogs; a handler ignoring abort may keep running. Workers do not provide
  an untrusted-code sandbox or the Node runner's process isolation.
- Service-worker slice completion suspends rather than fails a beacon. Desired
  running state survives; a later wake starts another incarnation, even with
  restart("never"). Explicit stop stays stopped across reloads.
- Neither Web Workers nor PWA service workers promise continuous execution after
  app closure. A service-worker registration may persist, but a live polling
  loop does not. `waitUntil()` is not an indefinite keepalive. Show suspended /
  last-updated state instead of claiming monitoring is active while closed.
- Increment definitionVersion when changing handler/step semantics. Coordinate
  old/new worker assets or use separate database names for incompatible queues.
  Incompatible runs fail instead of reusing checkpoints with new semantics.
- IndexedDB belongs to the origin/browser and can be cleared or evicted. It is
  not a server backup. Store scans, retention, blocked upgrades, and cross-browser
  rollout need hardening. Keep server secrets out of all browser bundles.

## Verify and find sources

Run `pnpm --filter example-17-browser... build` and `pnpm typecheck`. Stop manual
lab beacons and close other demo executors before navigating to `/tests.html`;
its real-browser checks are separate from `pnpm test` and CI. Verify worker
termination/recovery, a failed DAG branch, explicit beacon stop across reload,
and bounded service-worker slices. Do not infer cross-browser or closed-app
support from an in-app browser test.

Implementation: `packages/station-browser/src/{index,store,broadcasts,beacons}.ts`.
Runnable host and workloads: `examples/17-browser`. The package README documents
additional execution details. Published docs are generated from the site pages:
[browser guide](https://station.dterminal.net/docs/browser.md),
[browser lab](https://station.dterminal.net/docs/examples/browser.md), and
[LLM index](https://station.dterminal.net/llms.txt).
