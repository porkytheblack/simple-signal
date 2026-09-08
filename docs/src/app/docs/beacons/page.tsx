import { Metadata } from "next";
import Link from "next/link";
import { Code } from "../../components/Code";

export const metadata: Metadata = {
  title: "Beacons API — Station",
};

export default function BeaconsPage() {
  return (
    <>
      <div className="eyebrow">API Reference</div>
      <h2 style={{ marginTop: 0 }}>Beacons</h2>
      <p>
        A <strong>beacon</strong> is a long-running, supervised process. Where a{" "}
        <Link href="/docs/signals">signal</Link> runs to completion and exits,
        and a <Link href="/docs/broadcasts">broadcast</Link> wires signals into a
        DAG, a beacon <em>stays up</em> — an HTTP server, a queue consumer, a
        poller, a websocket client. The <code>BeaconRunner</code> supervises each
        beacon in its own child process: it keeps it alive according to a restart
        policy, backs off between restarts, detects startup timeouts and heartbeat
        stalls, and shuts it down gracefully — reconciling a per-beacon{" "}
        <strong>desired state</strong>{" "}
        (running / stopped) you can flip at runtime.
      </p>
      <p>
        This reference describes the Node runtime. The shared builder also works
        with the <Link href="/docs/browser">experimental browser runtime</Link>.
        Read that guide for supported methods, explicit registration, IndexedDB
        recovery, and cooperative worker execution; Node runner guarantees and
        APIs do not apply in the browser.
      </p>

      {/* ── beacon(name) ── */}

      <h3>
        <code>beacon(name)</code>
      </h3>
      <p>
        Creates a named beacon definition. The name must be unique, start with a
        letter, and contain only letters, digits, hyphens, and underscores.
        Returns a builder. There are two terminals: <code>.run()</code> for a
        general long-running handler, and <code>.poll()</code> for a
        framework-managed interval loop. Import <code>beacon</code> and{" "}
        <code>z</code> from <code>station-beacon</code>.
      </p>
      <Code>{`import { beacon, z } from "station-beacon";
import { createServer } from "node:http";

export const webhookServer = beacon("webhook-server")
  .config(z.object({ port: z.number().default(8080) }))
  .restart("always")
  .run(async (ctx) => {
    const server = createServer(handler).listen(ctx.config.port);
    ctx.ready();                       // mark healthy (optional)
    ctx.onStop(() => server.close());  // cleanup when asked to stop
    await ctx.untilStopped();          // park until stopped
  });`}</Code>

      <div className="warn-box">
        A beacon isn&apos;t triggered like a signal — it is started, stopped, and
        restarted by the <code>BeaconRunner</code>, which keeps it alive per its
        restart policy. Export one beacon per file for auto-discovery.
      </div>

      <hr className="divider" />

      {/* ── Builder methods ── */}

      <h3>Builder methods</h3>

      <h4>
        <code>.config(schema)</code> &middot; <code>.withConfig(data)</code>
      </h4>
      <p>
        <code>.config()</code> declares a Zod schema for the beacon&apos;s
        configuration. It is validated (with defaults applied) in the child
        process before each start; the parsed value is available as{" "}
        <code>ctx.config</code>. An invalid config is a <em>fatal</em> error — the
        beacon goes to <code>errored</code> and is never restarted (retrying with
        the same bad config would just loop). <code>.withConfig()</code> sets the
        default config used when the beacon is started without an override.
      </p>
      <Code>{`beacon("indexer")
  .config(z.object({ batchSize: z.number().default(100), source: z.string() }))
  .withConfig({ source: "s3://bucket/data" })
  .run(async (ctx) => { /* ctx.config.batchSize === 100 */ });`}</Code>

      <h4>
        <code>.restart(policy)</code>
      </h4>
      <p>
        How the supervisor reacts when the process exits. Default:{" "}
        <code>&quot;on-failure&quot;</code>.
      </p>
      <table className="api-table">
        <thead>
          <tr>
            <th>Policy</th>
            <th>Behavior</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td><code>&quot;always&quot;</code></td>
            <td>
              Bring it back up on any exit — clean or crash. For servers and
              clients that should always be running.
            </td>
          </tr>
          <tr>
            <td><code>&quot;on-failure&quot;</code></td>
            <td>
              Restart only on a crash/failure, a heartbeat stall, or a startup
              timeout. A clean return parks the beacon. The default.
            </td>
          </tr>
          <tr>
            <td><code>&quot;never&quot;</code></td>
            <td>Run once — a clean return or a failure is terminal.</td>
          </tr>
        </tbody>
      </table>

      <h4>
        <code>.backoff(base, opts?)</code>
      </h4>
      <p>
        Configures exponential backoff between restarts. <code>base</code> is the
        first-restart delay (an interval string like{" "}
        <code>&quot;1s&quot;</code> or a millisecond number). The delay grows as{" "}
        <code>base &times; factor^n</code>, capped at <code>max</code>. After the
        process stays up longer than <code>resetAfter</code>, the consecutive-
        restart counter resets, so a beacon that ran fine for a while then blips
        restarts quickly instead of at the top of the curve.
      </p>
      <table className="api-table">
        <thead>
          <tr>
            <th>Option</th>
            <th>Type</th>
            <th>Default</th>
            <th>Description</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td><code>factor</code></td>
            <td><code>number</code></td>
            <td><code>2</code></td>
            <td>Multiplier applied per consecutive restart. Must be &ge; 1.</td>
          </tr>
          <tr>
            <td><code>max</code></td>
            <td><code>string | number</code></td>
            <td><code>&quot;30s&quot;</code></td>
            <td>Upper bound on any single restart delay.</td>
          </tr>
          <tr>
            <td><code>resetAfter</code></td>
            <td><code>string | number</code></td>
            <td><code>&quot;60s&quot;</code></td>
            <td>Uptime after which the consecutive-restart counter resets.</td>
          </tr>
        </tbody>
      </table>
      <Code>{`beacon("stream-consumer")
  .restart("on-failure")
  .backoff("1s", { factor: 2, max: "30s", resetAfter: "60s" })
  .run(connectAndConsume);`}</Code>

      <h4>
        <code>.heartbeat(interval, opts?)</code>
      </h4>
      <p>
        Opts into stall detection. The handler must call{" "}
        <code>ctx.heartbeat()</code> at least every <code>interval</code>; if the
        supervisor sees no heartbeat within the timeout (default 3&times; the
        interval) it treats the process as stalled and restarts it. The clock
        starts when the handler actually starts, so process boot time never
        counts against the deadline.
      </p>
      <Code>{`beacon("worker")
  .heartbeat("10s", { timeout: "45s" })
  .run(async (ctx) => {
    ctx.ready();
    for await (const job of queue.stream({ signal: ctx.signal })) {
      ctx.heartbeat();
      await process(job);
    }
  });`}</Code>

      <h4>
        <code>.startupTimeout(ms)</code>
      </h4>
      <p>
        Sets a deadline, measured from spawn, for the beacon to reach ready via{" "}
        <code>ctx.ready()</code>. If it doesn&apos;t come up in time the
        supervisor kills the process and restarts it per the restart policy,
        recording the exit reason as <code>startup-timeout</code>. This catches
        two things heartbeat detection can&apos;t: a boot or module import that
        never resolves (the handler never even runs), and a handler that starts
        but wedges before it&apos;s ready — a server that never binds its port,
        say. Startup timeout covers the pre-ready window; heartbeats cover
        everything after. Off by default; requires the beacon to call{" "}
        <code>ctx.ready()</code>.
      </p>
      <Code>{`beacon("api-server")
  .startupTimeout("30s")  // must call ctx.ready() within 30s of spawn
  .heartbeat("10s")       // ...and keep reporting liveness once ready
  .run(async (ctx) => {
    const server = await listen(ctx.config.port);
    ctx.ready();
    ctx.onStop(() => server.close());
    await ctx.untilStopped();
  });`}</Code>

      <h4>
        <code>.stopTimeout(ms)</code>
      </h4>
      <p>
        Sets the grace period a beacon gets to exit after a stop is requested
        before it is force-killed (default <code>&quot;10s&quot;</code>).
      </p>

      <h4>
        <code>.manualStart()</code> &middot; <code>.onDemand()</code> &middot;{" "}
        <code>.maxInstances(n)</code>
      </h4>
      <p>
        These decide how a beacon comes to be running. By default a beacon is
        seeded with one instance on discovery and started.{" "}
        <code>.manualStart()</code> still seeds that instance but leaves it
        stopped until <code>startBeacon(name)</code> is called.{" "}
        <code>.onDemand()</code> seeds nothing — the beacon becomes a template
        whose instances are created at runtime, each with its own config. See{" "}
        <a href="#instances">Instances</a> below. <code>.maxInstances(n)</code>{" "}
        caps how many can exist at once.
      </p>

      <h4>
        <code>.env(...keys)</code>
      </h4>
      <p>
        Declares <Link href="/docs/environment">environment variables</Link> the
        beacon requires. Before each launch the supervisor checks each key
        against the env store and the host <code>process.env</code>; if any is
        missing it marks the beacon <code>errored</code> instead of spawning a
        process that can&apos;t come up. Provided values are injected into the
        child&apos;s <code>process.env</code>.
      </p>
      <Code>{`beacon("price-feed")
  .env("EXCHANGE_API_KEY")   // errored (not spawned) if unset
  .restart("always")
  .run(async (ctx) => { /* ... */ });`}</Code>

      <h4><code>.placement({`{ labels }`})</code></h4>
      <p>
        In a <Link href="/docs/network">Station Network</Link>, restricts the
        beacon to execution stations whose labels exactly match. A shared,
        fenced instance lease ensures only one eligible station owns each
        instance.
      </p>

      <h4>
        <code>.run(handler)</code>
      </h4>
      <p>
        Finalizes with a long-running handler. It runs until it returns, throws,
        or <code>ctx.signal</code> aborts. Use it for servers and stream clients.
        A server handler typically starts the thing, calls{" "}
        <code>ctx.ready()</code>, registers <code>ctx.onStop()</code> cleanup, and
        parks on <code>await ctx.untilStopped()</code>. Returning early is treated
        as a clean completion.
      </p>

      <h4>
        <code>.poll(interval, fn)</code>
      </h4>
      <p>
        Finalizes as a poller — the framework calls <code>fn</code> every{" "}
        <code>interval</code> until the beacon is stopped, and marks it ready on
        the first tick. Throwing from <code>fn</code> crashes the incarnation and
        lets the restart policy take over; catch inside <code>fn</code> to keep
        polling through transient errors.
      </p>
      <Code>{`beacon("price-watcher").poll("30s", async (ctx) => {
  const price = await fetchPrice({ signal: ctx.signal });
  if (price > 100) await priceAlert.trigger({ price });
});`}</Code>

      <hr className="divider" />

      {/* ── Context ── */}

      <h3>The beacon context</h3>
      <p>
        Every handler receives a <code>ctx</code> — its window into the
        supervisor.
      </p>
      <table className="api-table">
        <thead>
          <tr>
            <th>Member</th>
            <th>Type</th>
            <th>Description</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td><code>ctx.config</code></td>
            <td><code>TConfig</code></td>
            <td>Validated config for this incarnation (schema defaults applied).</td>
          </tr>
          <tr>
            <td><code>ctx.name</code></td>
            <td><code>string</code></td>
            <td>The beacon&apos;s name.</td>
          </tr>
          <tr>
            <td><code>ctx.incarnation</code></td>
            <td><code>number</code></td>
            <td>1 on first start, incremented on each supervised restart.</td>
          </tr>
          <tr>
            <td><code>ctx.signal</code></td>
            <td><code>AbortSignal</code></td>
            <td>
              Fires when the beacon should stop. Pass it to <code>fetch</code>,
              stream iterators, etc. so in-flight work unwinds promptly.
            </td>
          </tr>
          <tr>
            <td><code>ctx.ready()</code></td>
            <td><code>() =&gt; void</code></td>
            <td>Mark the beacon ready/healthy (records <code>readyAt</code>). Optional.</td>
          </tr>
          <tr>
            <td><code>ctx.heartbeat()</code></td>
            <td><code>() =&gt; void</code></td>
            <td>Report liveness. Required if you declared <code>.heartbeat()</code>.</td>
          </tr>
          <tr>
            <td><code>ctx.expose(opts)</code></td>
            <td><code>() =&gt; void</code></td>
            <td>Advertise an HTTP/WebSocket protocol, port, and optional base path for Headquarters discovery and HTTP proxying.</td>
          </tr>
          <tr>
            <td><code>ctx.log(msg)</code></td>
            <td><code>(string) =&gt; void</code></td>
            <td>Emit a structured log line to subscribers.</td>
          </tr>
          <tr>
            <td><code>ctx.onStop(fn)</code></td>
            <td><code>(fn) =&gt; void</code></td>
            <td>Register cleanup to run when a stop is requested. Multiple run in order.</td>
          </tr>
          <tr>
            <td><code>ctx.untilStopped()</code></td>
            <td><code>() =&gt; Promise&lt;void&gt;</code></td>
            <td>Resolves when <code>ctx.signal</code> aborts — the idiomatic tail of a server handler.</td>
          </tr>
        </tbody>
      </table>

      <hr className="divider" />

      {/* ── Modes ── */}

      <h3>The three modes</h3>

      <h4>Server</h4>
      <p>
        Start the server, mark ready, register cleanup, and park on{" "}
        <code>untilStopped()</code>. <code>restart(&quot;always&quot;)</code>{" "}
        keeps it up.
      </p>
      <Code>{`export const api = beacon("api")
  .config(z.object({ port: z.number().default(3000) }))
  .restart("always")
  .run(async (ctx) => {
    const server = createServer(app).listen(ctx.config.port);
    ctx.ready();
    ctx.onStop(() => new Promise((r) => server.close(() => r())));
    await ctx.untilStopped();
  });`}</Code>

      <h4>Poller</h4>
      <p>
        The framework drives the interval; the beacon can trigger signals as it
        polls.
      </p>
      <Code>{`export const healthPoller = beacon("health-poller").poll("15s", async (ctx) => {
  const res = await fetch("https://api.example.com/health", { signal: ctx.signal });
  if (!res.ok) await pageOncall.trigger({ status: res.status });
});`}</Code>

      <h4>Client</h4>
      <p>
        Maintain a connection; throwing on a dropped connection lets the
        supervisor reconnect with backoff. Heartbeats guard against a silently
        wedged connection.
      </p>
      <Code>{`export const consumer = beacon("consumer")
  .restart("on-failure")
  .backoff("1s", { max: "30s" })
  .heartbeat("10s")
  .run(async (ctx) => {
    const conn = await connect();
    ctx.ready();
    for await (const msg of conn.stream({ signal: ctx.signal })) {
      ctx.heartbeat();
      await ingest.trigger(msg);
    }
  });`}</Code>

      <hr className="divider" />

      {/* ── BeaconRunner ── */}

      <h3>BeaconRunner</h3>
      <p>
        The supervisor. It discovers beacons, runs each enabled one in its own
        child process, keeps it alive per its restart policy, and reconciles the
        per-beacon desired state each tick.
      </p>
      <Code>{`import path from "node:path";
import { BeaconRunner, ConsoleBeaconSubscriber } from "station-beacon";

const runner = new BeaconRunner({
  beaconsDir: path.join(import.meta.dirname, "beacons"),
  subscribers: [new ConsoleBeaconSubscriber()],
  signalRunner, // optional — lets beacons trigger signals into the shared queue
});

await runner.start(); // discovers beacons and supervises them (blocks until stop)`}</Code>

      <h4>Constructor options</h4>
      <table className="api-table">
        <thead>
          <tr>
            <th>Option</th>
            <th>Type</th>
            <th>Default</th>
            <th>Description</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td><code>beaconsDir</code></td>
            <td><code>string</code></td>
            <td>&mdash;</td>
            <td>
              Directory for auto-discovery. Recursively imports{" "}
              <code>.ts</code>/<code>.js</code> files and registers exported
              beacon definitions.
            </td>
          </tr>
          <tr>
            <td><code>adapter</code></td>
            <td><code>BeaconStateAdapter</code></td>
            <td><code>BeaconMemoryAdapter</code></td>
            <td>Storage for supervision state (status, desired state, counters, events).</td>
          </tr>
          <tr>
            <td><code>signalRunner</code></td>
            <td><code>SignalRunner</code></td>
            <td>&mdash;</td>
            <td>
              Wire a signal runner so beacons can <code>signal.trigger()</code>{" "}
              into the same queue it drains (its adapter manifest is passed to
              children).
            </td>
          </tr>
          <tr>
            <td><code>signalAdapter</code></td>
            <td><code>SignalQueueAdapter</code></td>
            <td>&mdash;</td>
            <td>Alternative to <code>signalRunner</code> — pass the signal adapter directly.</td>
          </tr>
          <tr>
            <td><code>subscribers</code></td>
            <td><code>BeaconSubscriber[]</code></td>
            <td><code>[]</code></td>
            <td>Objects notified on beacon lifecycle events.</td>
          </tr>
          <tr>
            <td><code>pollIntervalMs</code></td>
            <td><code>number</code></td>
            <td><code>1000</code></td>
            <td>Milliseconds between reconcile ticks.</td>
          </tr>
        </tbody>
      </table>

      <h4>Methods</h4>
      <table className="api-table">
        <thead>
          <tr>
            <th>Method</th>
            <th>Returns</th>
            <th>Description</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td><code>start()</code></td>
            <td><code>Promise&lt;void&gt;</code></td>
            <td>
              Discover beacons, seed/resume state, install shutdown handlers, and
              run the reconcile loop. Blocks until <code>stop()</code>.
            </td>
          </tr>
          <tr>
            <td><code>stop(opts?)</code></td>
            <td><code>Promise&lt;void&gt;</code></td>
            <td>
              Stop the supervisor. With{" "}
              <code>{`{ graceful: true, timeoutMs }`}</code>, running beacons are
              asked to stop and awaited before being force-killed. Desired state
              is left untouched so a restart resumes them.
            </td>
          </tr>
          <tr>
            <td><code>startBeacon(name, opts?)</code></td>
            <td><code>Promise&lt;void&gt;</code></td>
            <td>
              Set desired state to running and schedule an immediate launch.
              Accepts <code>{`{ config }`}</code> to override the config for this
              run. Recovers an <code>errored</code> beacon.
            </td>
          </tr>
          <tr>
            <td><code>stopBeacon(name)</code></td>
            <td><code>Promise&lt;void&gt;</code></td>
            <td>Set desired state to stopped and gracefully stop the running incarnation.</td>
          </tr>
          <tr>
            <td><code>restartBeacon(name)</code></td>
            <td><code>Promise&lt;void&gt;</code></td>
            <td>Gracefully stop the current incarnation, then relaunch with a fresh incarnation.</td>
          </tr>
          <tr>
            <td><code>createInstance(name, opts?)</code></td>
            <td><code>Promise&lt;BeaconInstance&gt;</code></td>
            <td>
              Create a new instance with its own config and (by default) start
              it. <code>{`{ id?, label?, config?, start? }`}</code>.
            </td>
          </tr>
          <tr>
            <td><code>updateInstance(id, opts)</code></td>
            <td><code>Promise&lt;BeaconInstance&gt;</code></td>
            <td>
              Change an instance&apos;s <code>config</code> or <code>label</code>.
              Takes effect on the next start, or immediately with{" "}
              <code>{`{ restart: true }`}</code>.
            </td>
          </tr>
          <tr>
            <td><code>deleteInstance(id, opts?)</code></td>
            <td><code>Promise&lt;void&gt;</code></td>
            <td>
              Stop the instance and remove its record. Runtime-created instances
              only — stop a definition-owned one instead.
            </td>
          </tr>
          <tr>
            <td><code>startInstance(id, opts?)</code> &middot; <code>stopInstance(id)</code> &middot; <code>restartInstance(id)</code></td>
            <td><code>Promise&lt;void&gt;</code></td>
            <td>The per-instance equivalents of the definition-level controls above.</td>
          </tr>
          <tr>
            <td><code>stopAllInstances(name)</code></td>
            <td><code>Promise&lt;number&gt;</code></td>
            <td>Stop every instance of a beacon; returns how many were stopped.</td>
          </tr>
          <tr>
            <td><code>getInstance(id)</code></td>
            <td><code>Promise&lt;BeaconInstance | null&gt;</code></td>
            <td>
              An instance record by id (status, desired state, counters,
              timestamps). A beacon&apos;s definition-owned instance uses the
              beacon name as its id.
            </td>
          </tr>
          <tr>
            <td><code>listInstances(filter?)</code></td>
            <td><code>Promise&lt;BeaconInstance[]&gt;</code></td>
            <td>All known instance records, optionally narrowed with <code>{`{ beaconName }`}</code>.</td>
          </tr>
          <tr>
            <td><code>whenReady()</code></td>
            <td><code>Promise&lt;void&gt;</code></td>
            <td>
              Resolves once <code>start()</code> has finished discovery,
              hydration, and seeding. <code>start()</code> itself never settles
              while supervising, so await this before serving an API or creating
              instances at boot.
            </td>
          </tr>
          <tr>
            <td><code>register(beacon, filePath)</code></td>
            <td><code>this</code></td>
            <td>Register a beacon explicitly (alternative to <code>beaconsDir</code>). Call before <code>start()</code>.</td>
          </tr>
          <tr>
            <td><code>listRegistered()</code></td>
            <td><code>Array&lt;{`{ name, filePath, mode, restartPolicy, startMode, maxInstances }`}&gt;</code></td>
            <td>Metadata for all registered beacons.</td>
          </tr>
          <tr>
            <td><code>subscribe(subscriber)</code></td>
            <td><code>this</code></td>
            <td>Add a subscriber after construction.</td>
          </tr>
        </tbody>
      </table>

      <h4>Runtime control</h4>
      <p>
        Flip a beacon&apos;s desired state at any time — the supervisor
        reconciles toward it on the next tick.
      </p>
      <Code>{`await runner.stopBeacon("consumer");            // stop and keep stopped
await runner.startBeacon("consumer", {          // start with a config override
  config: { source: "s3://other-bucket" },
});
await runner.restartBeacon("consumer");         // graceful stop, then relaunch

const inst = await runner.getInstance("consumer");
// { status: "running", desiredState: "running", incarnation: 3, restartCount: 0, ... }`}</Code>

      <hr className="divider" />

      {/* ── Instances ── */}

      <h3 id="instances">Running many instances of one beacon</h3>
      <p>
        A beacon definition can back many running <strong>instances</strong>.
        Each is supervised independently — its own process, config, status,
        restart counter, and logs — so the same beacon can run once per tenant,
        queue, or stream, driven from the dashboard or the API.
      </p>
      <table className="api-table">
        <thead>
          <tr>
            <th>Start mode</th>
            <th>Behaviour</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td><code>auto</code> (default)</td>
            <td>One instance is seeded on discovery and started. Its id is the beacon name.</td>
          </tr>
          <tr>
            <td><code>.manualStart()</code></td>
            <td>One instance is seeded but left stopped until someone starts it.</td>
          </tr>
          <tr>
            <td><code>.onDemand()</code></td>
            <td>Nothing is seeded. Instances exist only once created at runtime.</td>
          </tr>
        </tbody>
      </table>
      <p>
        The instance seeded from the file has <code>origin: &quot;definition&quot;</code>{" "}
        and uses the beacon name as its id, so <code>startBeacon</code> /{" "}
        <code>stopBeacon</code> keep acting on it. Instances created at runtime
        have <code>origin: &quot;api&quot;</code>, their own ids, and can be
        deleted outright.
      </p>
      <Code>{`// beacons/queue-worker.ts — a template, not a single process
export const queueWorker = beacon("queue-worker")
  .config(z.object({ queue: z.string(), batchSize: z.number().default(10) }))
  .onDemand()
  .maxInstances(8)
  .run(async (ctx) => {
    ctx.log(\`worker \${ctx.instanceId} draining \${ctx.config.queue}\`);
    ctx.ready();
    await ctx.untilStopped();
  });`}</Code>
      <Code>{`// start() only settles when the supervisor stops, so wait for setup
runner.start().catch(console.error);
await runner.whenReady();

const worker = await runner.createInstance("queue-worker", {
  id: "worker-acme",                            // optional — generated when omitted
  label: "acme",
  config: { queue: "acme", batchSize: 25 },     // validated against the config schema
});                                             // starts immediately (start: false to stage it)

await runner.listInstances({ beaconName: "queue-worker" });
await runner.updateInstance(worker.id, { config: { queue: "acme2" }, restart: true });
await runner.stopInstance(worker.id);
await runner.deleteInstance(worker.id);         // stops the process, then removes the record`}</Code>
      <p>
        Instance ids are unique across all beacons, must match{" "}
        <code>/^[a-zA-Z0-9][a-zA-Z0-9._:-]*$/</code>, and are at most 128
        characters. Runtime-created instances are persisted, so a supervisor
        restart resumes them; an instance whose definition is no longer
        registered is surfaced as <code>errored</code> with an explanation rather
        than silently dropped.
      </p>

      <h4>Over the API</h4>
      <p>
        The same operations are available over HTTP. The authenticated v1 API
        mirrors these under <code>/api/v1</code>, with creating and starting on
        the <code>trigger</code> scope, stopping on <code>cancel</code>, and
        editing or deleting an instance on <code>admin</code>.
      </p>
      <Code>{`POST   /api/beacons/:name/instances                 { id?, label?, config?, start? }
GET    /api/beacons/:name/instances
GET    /api/beacons/:name/instances/:id
POST   /api/beacons/:name/instances/:id/{start,stop,restart}
PATCH  /api/beacons/:name/instances/:id             { config?, label?, restart? }
DELETE /api/beacons/:name/instances/:id
POST   /api/beacons/:name/stop?all=true             stop every instance`}</Code>
      <p>
        Creation failures are distinguishable: <code>400 invalid_config</code>,{" "}
        <code>404 not_found</code> for an unknown beacon,{" "}
        <code>409 instance_exists</code> for a taken id, and{" "}
        <code>409 instance_limit</code> at the cap.
      </p>

      <hr className="divider" />

      {/* ── BeaconInstance ── */}

      <h3>BeaconInstance</h3>
      <p>
        The supervised record for one instance of a beacon, updated as
        incarnations start, become ready, and exit. A definition may have many.
      </p>
      <table className="api-table">
        <thead>
          <tr>
            <th>Field</th>
            <th>Type</th>
            <th>Description</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td><code>id</code></td>
            <td><code>string</code></td>
            <td>
              Unique instance id. A beacon&apos;s definition-owned instance uses
              the beacon name.
            </td>
          </tr>
          <tr>
            <td><code>beaconName</code></td>
            <td><code>string</code></td>
            <td>The name of the beacon definition this instance runs.</td>
          </tr>
          <tr>
            <td><code>label</code></td>
            <td><code>string | undefined</code></td>
            <td>Optional human-readable label for a runtime-created instance.</td>
          </tr>
          <tr>
            <td><code>origin</code></td>
            <td><code>&quot;definition&quot; | &quot;api&quot;</code></td>
            <td>
              Whether the instance was seeded from the beacon file or created at
              runtime. Only <code>api</code> instances can be deleted.
            </td>
          </tr>
          <tr>
            <td><code>status</code></td>
            <td><code>&quot;stopped&quot; | &quot;starting&quot; | &quot;running&quot; | &quot;stopping&quot; | &quot;backoff&quot; | &quot;errored&quot;</code></td>
            <td>
              Observed lifecycle status. <code>backoff</code> means a (re)start is
              scheduled at <code>nextRestartAt</code>; <code>errored</code> is
              terminal (won&apos;t auto-restart).
            </td>
          </tr>
          <tr>
            <td><code>desiredState</code></td>
            <td><code>&quot;running&quot; | &quot;stopped&quot;</code></td>
            <td>What the operator wants. The supervisor reconciles toward this.</td>
          </tr>
          <tr>
            <td><code>incarnation</code></td>
            <td><code>number</code></td>
            <td>How many times the beacon has been started over its lifetime.</td>
          </tr>
          <tr>
            <td><code>restartCount</code></td>
            <td><code>number</code></td>
            <td>Consecutive restart attempts since the beacon was last healthy.</td>
          </tr>
          <tr>
            <td><code>pid</code></td>
            <td><code>number | undefined</code></td>
            <td>OS process id of the current incarnation, when running.</td>
          </tr>
          <tr>
            <td><code>readyAt</code> / <code>startedAt</code> / <code>lastHeartbeatAt</code></td>
            <td><code>Date | undefined</code></td>
            <td>Timestamps for readiness, incarnation start, and the last heartbeat.</td>
          </tr>
          <tr>
            <td><code>lastExitReason</code></td>
            <td><code>&quot;clean&quot; | &quot;failure&quot; | &quot;stopped&quot; | &quot;stalled&quot; | &quot;startup-timeout&quot;</code></td>
            <td>How the most recent incarnation ended.</td>
          </tr>
          <tr>
            <td><code>lastError</code> / <code>nextRestartAt</code></td>
            <td><code>string</code> / <code>Date | undefined</code></td>
            <td>Last error message; and, in <code>backoff</code>, when the next restart fires.</td>
          </tr>
        </tbody>
      </table>

      <hr className="divider" />

      {/* ── Subscribers ── */}

      <h3>BeaconSubscriber</h3>
      <p>
        All methods are optional. Subscriber errors are caught and logged without
        affecting supervision. The built-in{" "}
        <code>ConsoleBeaconSubscriber</code> logs every event with a{" "}
        <code>[station-beacon]</code> prefix.
      </p>
      <table className="api-table">
        <thead>
          <tr>
            <th>Method</th>
            <th>When it fires</th>
          </tr>
        </thead>
        <tbody>
          <tr><td><code>onBeaconDiscovered</code></td><td>A beacon file was found during auto-discovery.</td></tr>
          <tr><td><code>onBeaconInstanceCreated</code></td><td>A new instance was created at runtime (dashboard / API).</td></tr>
          <tr><td><code>onBeaconInstanceRemoved</code></td><td>A runtime-created instance was stopped and removed.</td></tr>
          <tr><td><code>onBeaconStarting</code></td><td>The supervisor is about to spawn a child process.</td></tr>
          <tr><td><code>onBeaconStarted</code></td><td>The child reported the handler has started executing.</td></tr>
          <tr><td><code>onBeaconReady</code></td><td>The handler called <code>ctx.ready()</code>.</td></tr>
          <tr><td><code>onBeaconHeartbeat</code></td><td>A heartbeat was received.</td></tr>
          <tr><td><code>onBeaconExited</code></td><td>The child process exited (with <code>reason</code> and <code>code</code>).</td></tr>
          <tr><td><code>onBeaconRestartScheduled</code></td><td>A restart was scheduled after an exit (with the backoff delay).</td></tr>
          <tr><td><code>onBeaconStopped</code></td><td>The beacon reached a cleanly stopped state.</td></tr>
          <tr><td><code>onBeaconErrored</code></td><td>The beacon failed terminally and will not be restarted.</td></tr>
          <tr><td><code>onBeaconStalled</code></td><td>A heartbeat deadline or startup timeout was missed; the process is being restarted.</td></tr>
          <tr><td><code>onBeaconLog</code></td><td>Log output — from <code>ctx.log()</code> or captured stdout/stderr.</td></tr>
        </tbody>
      </table>

      <hr className="divider" />

      {/* ── Triggering signals ── */}

      <h3>Triggering signals from a beacon</h3>
      <p>
        Beacons commonly trigger <Link href="/docs/signals">signals</Link> — a
        poller firing an alert, a consumer enqueuing work. Wire a{" "}
        <code>SignalRunner</code> into the <code>BeaconRunner</code> and use a{" "}
        <strong>persistent</strong> signal adapter so the trigger — which happens
        in the beacon&apos;s child process — reaches the same queue the{" "}
        <code>SignalRunner</code> drains.
      </p>
      <Code>{`import { SignalRunner } from "station-signal";
import { BeaconRunner } from "station-beacon";
import { SqliteAdapter } from "station-adapter-sqlite";

const signalRunner = new SignalRunner({
  signalsDir: "./signals",
  adapter: new SqliteAdapter({ dbPath: "./jobs.db" }),
});

const beaconRunner = new BeaconRunner({
  beaconsDir: "./beacons",
  signalRunner, // beacons can now signal.trigger() into the shared queue
});

await signalRunner.start();
await beaconRunner.start();`}</Code>

      <div className="warn-box">
        With the default in-memory adapter a beacon&apos;s{" "}
        <code>signal.trigger()</code> writes to an isolated adapter in its own
        child process, so the parent <code>SignalRunner</code> never sees it. Use
        a persistent signal adapter (SQLite/Postgres/&hellip;) whenever beacons
        trigger signals.
      </div>

      <h3>Dashboard</h3>
      <p>
        Point the <Link href="/docs/dashboard">dashboard</Link> at a beacons
        directory and it supervises them and surfaces them under a{" "}
        <strong>Beacons</strong> page — live status, incarnation and restart
        counts, lifecycle events, streaming logs, and start / stop / restart
        controls.
      </p>
      <Code>{`// station.config.ts
import { defineConfig } from "station-kit";

export default defineConfig({
  beaconsDir: "./beacons",
  // beaconAdapter: new BeaconSqliteAdapter(...),  // optional, for durable state
});`}</Code>
      <p>
        Then run <code>npx station</code> and open <code>/beacons</code>. A
        beacon&apos;s page lists its instances, builds new ones from the config
        schema, and scopes logs and controls to the selected instance. The REST
        surface behind the page (see <a href="#instances">Instances</a>) is
        available for your own tooling, and{" "}
        <code>beaconMaxInstances</code> in <code>defineConfig</code> sets the
        default instance cap.
      </p>

      <h3>Persistence</h3>
      <p>
        Supervision state (the instance record + lifecycle event log) lives
        behind a <code>BeaconStateAdapter</code>. The default{" "}
        <code>BeaconMemoryAdapter</code> is single-process; on restart the
        supervisor re-derives desired state from each beacon&apos;s start mode,
        and runtime-created instances do not survive. For durable state across
        restarts — and to keep instances created through the API — use a{" "}
        <code>/beacon</code> subpath adapter:
      </p>
      <Code>{`import { BeaconSqliteAdapter } from "station-adapter-sqlite/beacon";
// or /postgres/beacon, /mysql/beacon (async .create()), /redis/beacon

const adapter = new BeaconSqliteAdapter({ dbPath: "./station.db" });
// new BeaconRunner({ beaconsDir, adapter })
// or defineConfig({ beaconsDir, beaconAdapter: adapter })`}</Code>
      <p>
        Each adapter persists the instance records and the lifecycle event log,
        so a supervisor restart resumes desired state, brings back instances
        created through the API, and keeps the dashboard&apos;s history. A
        database written before instances existed is migrated in place on first
        open — the old per-beacon record becomes that beacon&apos;s
        definition-owned instance, keeping its desired state and counters.
      </p>
    </>
  );
}
