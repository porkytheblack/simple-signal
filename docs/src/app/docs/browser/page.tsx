import { Metadata } from "next";
import Link from "next/link";
import { Code } from "../../components/Code";

export const metadata: Metadata = {
  title: "Browser runtime — Station",
  description: "Build local signals, broadcast workflows, and supervised beacons in browser workers with IndexedDB persistence.",
};

export default function BrowserPage() {
  return (
    <>
      <div className="eyebrow">Experimental guide</div>
      <h2 style={{ marginTop: 0 }}>Station in the browser</h2>
      <p>
        <code>station-browser</code> executes signals, broadcast DAGs, and beacons
        in Web Workers and service workers. IndexedDB stores the queue, completed
        steps, workflow progress, and beacon desired state on the device. The
        browser runtime needs no Node runner, companion app, or Station server.
        It is experimental and is not a Station Network member.
      </p>
      <p>
        Persistence survives a page reload; continuous execution does not.
        Service workers run bounded work when the browser wakes them. Neither an
        installed PWA nor <code>event.waitUntil()</code> guarantees polling after
        closing the app or browser.
      </p>

      <h3>Try the implementation</h3>
      <p>
        The experimental package is included in the Station 2.3.0 release.
        After that release is published, install it in your application with
        <code> pnpm add station-browser@^2.3.0</code>. To try the release checkout,
        start with the repository workspace:
      </p>
      <Code>{`# From the Station repository checkout containing station-browser
pnpm install
pnpm dev:browser`}</Code>
      <p>
        Open <code>http://127.0.0.1:4317</code>. The Node process serves static
        files only. Follow the <Link href="/docs/examples/browser">browser lab walkthrough</Link>
        {" "}to exercise interruption, retries, DAGs, and beacon restarts.
      </p>
      <p>
        For another application in this monorepo, add <code>station-browser</code>
        {" "}as a <code>workspace:*</code> dependency. Bundle page and worker entries
        for the browser with esbuild or another browser-aware bundler. The browser
        condition selects Web Crypto; do not polyfill Node runners into the app.
        Use HTTPS or localhost, IndexedDB, Web Crypto, and module worker support.
        TypeScript worker entries need the WebWorker library.
      </p>

      <h3>Choose an execution host</h3>
      <table className="api-table">
        <thead><tr><th>Host</th><th>Use it for</th><th>Execution contract</th></tr></thead>
        <tbody>
          <tr><td>Web Worker</td><td>Interactive local jobs and live beacon sessions</td><td>Drain jobs and tick beacons while the worker runs. Page closure or suspension can interrupt it.</td></tr>
          <tr><td>Service worker</td><td>Bounded work on message or supported background events</td><td>Call wake() through event.waitUntil(). Beacons suspend at the end of each slice.</td></tr>
        </tbody>
      </table>

      <h3>1. Share a workload registry</h3>
      <p>
        Import the same definitions and database name in the page and executor.
        Definitions are bundled code; there is no directory auto-discovery.
        Broadcast node signals are registered automatically.
      </p>
      <Code>{`// src/registry.ts
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

// onDemand creates an instance only when explicitly requested.
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
};`}</Code>
      <p>
        The poll callback completes before the one-second delay begins, so a slow
        request lengthens the interval. Suspension, restart backoff, and browser
        scheduling add further gaps. This is not an exact one-second clock.
        The example URL must point to an endpoint your app provides; cross-origin
        requests also need permission from the target server through CORS.
      </p>

      <h3>2. Host it in a Web Worker</h3>
      <p>
        Drain jobs independently of beacon ticks: waiting for a slow signal must
        not prevent lease renewal. The current beacon lease is 2.5 seconds; the
        demo ticks every 100 ms. Catch failures so the host can report them.
      </p>
      <Code>{`// src/worker.ts — compile with the WebWorker library
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
}, 100);`}</Code>
      <Code>{`// src/app.ts — compile with the DOM library; bundles served at origin root
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
// await station.beacons.stop("api-status");`}</Code>
      <p>
        <code>configure()</code> applies to its JavaScript context. Configure every
        context that calls a definition&apos;s <code>.trigger()</code>, or use
        {" "}<code>station.trigger(report, input)</code> and
        {" "}<code>station.triggerBroadcast("analysis", input)</code> directly.
        {" "}<code>BrowserStation</code> has no <code>waitForRun()</code>; observe
        the persisted status instead.
      </p>

      <h3>3. Alternatively, host it in a service worker</h3>
      <p>
        Use this host in place of the dedicated worker above. A message grants
        an execution opportunity; it does not create a permanent background loop.
      </p>
      <Code>{`// src/sw.ts — compile with the WebWorker library
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
});`}</Code>
      <Code>{`// In the page: replace new Worker(...) with this registration.
// After enqueueing work or changing beacon desired state, call wake().
await navigator.serviceWorker.register("/sw.js", { type: "module" });
const registration = await navigator.serviceWorker.ready;
function wake() {
  registration.active?.postMessage({ type: "station:wake" });
}
wake();
// Supply later wake opportunities while the page is open, including for retries.
setInterval(wake, 1_000);`}</Code>
      <p>
        <code>wake()</code> drains signals and broadcasts while supervising a
        bounded beacon slice. <code>drain()</code> alone never supervises beacons.
        At slice end, handlers are aborted and cleanup is requested; cleanup may
        add the configured stop timeout. Beacon desired state remains running,
        with status suspended, until a later wake resumes it. Explicit stop
        persists across reloads. Background Sync is optional and feature-detected
        in the lab; no recurring schedule, push wakeup, or app-shell cache is
        installed by <code>BrowserStation</code> itself.
      </p>

      <h3>Browser API reference</h3>
      <table className="api-table">
        <thead><tr><th>API</th><th>Behavior</th></tr></thead>
        <tbody>
          <tr><td><code>new BrowserStation(options)</code></td><td>Optional signals, broadcasts, beacons arrays; database defaults to station-browser, definitionVersion to 1, concurrency to 4, stationId to a generated ID. Concurrency overlaps async signals in one executor.</td></tr>
          <tr><td><code>trigger(definitionOrName, input)</code></td><td>Validate and enqueue a signal; returns its ID.</td></tr>
          <tr><td><code>triggerBroadcast(name, input)</code></td><td>Enqueue a registered broadcast; returns its ID.</td></tr>
          <tr><td><code>drain({"{ maxJobs, budgetMs }"})</code></td><td>Returns the number of claimed signal attempts. Defaults: 10 jobs, 20,000 ms. Budget limits new claims; already claimed work may use its full timeout.</td></tr>
          <tr><td><code>wake({"{ maxJobs, budgetMs, beaconSliceMs }"})</code></td><td>Drain jobs and run a beacon slice concurrently. Default slice: 1,500 ms.</td></tr>
          <tr><td><code>store.get(id) / list() / cancel(id)</code></td><td>Read or cancel signal runs. Input, output, and checkpoint outputs are serialized JSON strings; decode defined values with JSON.parse().</td></tr>
          <tr><td><code>broadcasts.list() / cancel(id)</code></td><td>Read workflow and node states or cancel the workflow and fence child writes.</td></tr>
          <tr><td><code>beacons.start(name, {"{ instanceId, config }"})</code></td><td>Persist desired-running state and return the instance ID. An executor must tick or wake to launch it.</td></tr>
          <tr><td><code>beacons.list() / stop(instanceId)</code></td><td>Inspect instances or persist desired-stopped state. Stop before changing active configuration.</td></tr>
          <tr><td><code>beacons.tick() / runSlice(ms) / suspend()</code></td><td>Host-level supervision. Suspend preserves desired-running state; invoke it in the executor that owns the handlers. Stop host timers before graceful shutdown and close storage after in-flight work settles.</td></tr>
        </tbody>
      </table>

      <h3>Supported definitions and limits</h3>
      <ul>
        <li>Signals support input/output schemas, run handlers, saved steps, retries, and cooperative timeouts. Schedules, env injection, placement, per-signal concurrency policies, and onComplete hooks are rejected.</li>
        <li>Broadcasts support fan-out, joins, named dependencies, synchronous maps/guards, and fail-fast, skip-downstream, or continue policies. Recurring and dynamic-definition workflows are unsupported. Parent timeouts include time spent suspended.</li>
        <li>Beacons support run/poll, config, readiness, heartbeat/startup watchdogs, restart/backoff, and manual/auto/on-demand modes. Handlers must honor ctx.signal and release resources through onStop. Listening ports through ctx.expose(), env injection, and placement are unavailable.</li>
        <li>Manual beacons with required config can wait for an explicit start() with valid values. Existing instances retain saved configuration when a new supervisor starts. Auto-start definitions need valid defaults if no instance has been started yet; use schema defaults or withConfig(). Invalid explicit starts reject without creating an instance.</li>
      </ul>

      <h3>Recovery and production boundaries</h3>
      <p>
        Signal leases last for the timeout plus one second. An interrupted attempt
        can be reclaimed when its lease expires if retry attempts remain; retries
        become eligible after 250 ms and need another drain. Completed steps are
        reused. Incomplete handlers and steps may execute again: external effects
        must be idempotent. Lease tokens fence stored writes, not requests already
        sent or uncooperative JavaScript.
      </p>
      <p>
        Keep the database name stable across page and worker entries. Change
        definitionVersion when handler or step semantics change; incompatible
        runs fail rather than reuse old checkpoints. Coordinate asset and worker
        updates, or isolate incompatible versions in separate database names.
        IndexedDB is origin-local storage that can be cleared or evicted, not a
        server backup. Store scans, retention, blocked upgrades, and cross-browser
        rollout behavior need further hardening. Never bundle server secrets or
        assume workers provide an untrusted-code sandbox or Node process isolation.
      </p>
      <p>
        See the <Link href="/docs/agent-skill">agent skill</Link> for building
        guidance, <a href="/llms.txt">llms.txt</a> for the documentation index,
        and <a href="/docs/browser.md">this guide as Markdown</a> for agent context.
      </p>
    </>
  );
}
