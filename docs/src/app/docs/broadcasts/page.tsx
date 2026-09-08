import { Metadata } from "next";
import Link from "next/link";
import { Code } from "../../components/Code";

export const metadata: Metadata = {
  title: "Broadcasts API — Station",
};

export default function BroadcastsPage() {
  return (
    <>
      <div className="eyebrow">API Reference</div>
      <h2 style={{ marginTop: 0 }}>Broadcasts</h2>
      <p>
        A broadcast chains multiple signals into a directed acyclic graph
        (DAG). Each node in the graph is a signal. Nodes execute when all their
        upstream dependencies complete. Outputs from upstream nodes are passed
        to downstream nodes automatically. The broadcast runner orchestrates
        the entire graph, handling fan-out, fan-in, conditional execution, and
        failure propagation.
      </p>
      <p>
        This reference describes the Node runtime. The shared builder also works
        with the <Link href="/docs/browser">experimental browser runtime</Link>.
        Read that guide for supported methods, explicit registration, IndexedDB
        recovery, and cooperative worker execution; Node runner guarantees and
        APIs do not apply in the browser.
      </p>

      {/* ── broadcast(name) ── */}

      <h3>
        <code>broadcast(name)</code>
      </h3>
      <p>
        Creates a named broadcast definition. The name must be unique, start
        with a letter, and contain only letters, digits, hyphens, and
        underscores. Returns a builder that connects signals into a dependency
        graph.
      </p>
      <Code>{`import { broadcast } from "station-broadcast";
import { signal, z } from "station-signal";

const validate = signal("validate")
  .input(z.object({ orderId: z.string() }))
  .output(z.object({ orderId: z.string(), total: z.number() }))
  .run(async (input) => {
    const order = await db.orders.findById(input.orderId);
    return { orderId: order.id, total: order.total };
  });

const charge = signal("charge")
  .input(z.object({ orderId: z.string(), total: z.number() }))
  .output(z.object({ chargeId: z.string() }))
  .run(async (input) => {
    const result = await paymentGateway.charge(input.total);
    return { chargeId: result.id };
  });

const notify = signal("notify")
  .input(z.object({ chargeId: z.string() }))
  .run(async (input) => {
    await emailService.sendReceipt(input.chargeId);
  });

export const orderFlow = broadcast("orderFlow")
  .input(validate)
  .then(charge)
  .then(notify)
  .build();`}</Code>

      <hr className="divider" />

      {/* ── Builder methods ── */}

      <h3>Builder methods</h3>

      <h4>
        <code>.input(signal)</code>
      </h4>
      <p>
        Sets the entry signal -- the root node of the DAG. This is required and
        must be called first. The entry signal&apos;s input type becomes the
        broadcast&apos;s input type: when you call{" "}
        <code>broadcast.trigger(data)</code>, that data is passed to this
        signal.
      </p>
      <Code>{`const pipeline = broadcast("pipeline")
  .input(validate)  // validate's input schema defines what .trigger() accepts
  // ...`}</Code>

      <h4>
        <code>.then(signal, opts?)</code>
      </h4>
      <p>
        Adds one or more downstream nodes. By default, each node depends on the
        most recently added tier (the &quot;last tier&quot;). Multiple signals
        passed to a single <code>.then()</code> call create parallel fan-out --
        they all depend on the same upstream tier and run concurrently.
      </p>
      <Code>{`// Single signal with options:
.then(charge, {
  as: "payment",
  after: ["validate"],
  map: (upstream) => ({ total: upstream.validate.total }),
  when: (upstream) => upstream.validate.total > 0,
})

// Fan-out (multiple signals, no options):
.then(emailReceipt, smsNotification, slackAlert)`}</Code>

      <table className="api-table">
        <thead>
          <tr>
            <th>Option</th>
            <th>Type</th>
            <th>Description</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td><code>as</code></td>
            <td><code>string</code></td>
            <td>
              Custom name for this node. Defaults to the signal&apos;s name.
              Used in <code>after</code> arrays and as the key in
              downstream <code>map</code> functions. Required when the same
              signal appears multiple times in a broadcast.
            </td>
          </tr>
          <tr>
            <td><code>after</code></td>
            <td><code>string[]</code></td>
            <td>
              Explicit dependency list. The node waits for all named nodes to
              complete before executing. Overrides the default &quot;depends on
              previous tier&quot; behavior. Use this for fan-in patterns.
            </td>
          </tr>
          <tr>
            <td><code>map</code></td>
            <td><code>(upstream: Record&lt;string, unknown&gt;) =&gt; unknown</code></td>
            <td>
              Transform function. Receives an object keyed by upstream node
              names, each containing that node&apos;s deserialized output.
              Returns the input for this signal. Without <code>map</code>, the
              behavior depends on the number of dependencies: a single
              dependency passes its output directly; multiple dependencies pass
              the entire upstream object.
            </td>
          </tr>
          <tr>
            <td><code>when</code></td>
            <td><code>(upstream: Record&lt;string, unknown&gt;) =&gt; boolean</code></td>
            <td>
              Guard function. Receives the same upstream object as{" "}
              <code>map</code>. Return <code>false</code> to skip this node.
              Skipped nodes (with skip reason <code>&quot;guard&quot;</code>) do
              not propagate failure downstream -- their dependents still
              execute, receiving <code>undefined</code> for the skipped
              node&apos;s output.
            </td>
          </tr>
        </tbody>
      </table>

      <div className="warn-box">
        Options (<code>as</code>, <code>after</code>, <code>map</code>,{" "}
        <code>when</code>) cannot be used with fan-out (multiple signals in a
        single <code>.then()</code> call). Use separate <code>.then()</code>{" "}
        calls with options for each signal instead.
      </div>

      <h4>
        <code>.every(interval)</code>
      </h4>
      <p>
        Makes the broadcast recurring. Accepts the same duration strings as
        signals: <code>&quot;30s&quot;</code>, <code>&quot;5m&quot;</code>,{" "}
        <code>&quot;1h&quot;</code>, <code>&quot;1d&quot;</code>. The broadcast
        runner enqueues a new run after each interval elapses. If a pending or
        running instance already exists, that tick is skipped to prevent
        overlap.
      </p>
      <Code>{`const hourlySync = broadcast("hourlySync")
  .input(fetchData)
  .then(transformData)
  .then(loadData)
  .every("1h")
  .withInput({ source: "production" })
  .build();`}</Code>

      <h4>
        <code>.withInput(data)</code>
      </h4>
      <p>
        Default input data for recurring broadcasts. Without this, recurring
        broadcasts run with <code>{`{}`}</code> as input. The data is passed to
        the entry signal.
      </p>

      <h4>
        <code>.onFailure(policy)</code>
      </h4>
      <p>
        Sets the failure policy that determines what happens when a node fails.
        Default: <code>&quot;fail-fast&quot;</code>.
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
            <td><code>&quot;fail-fast&quot;</code></td>
            <td>
              Stop the entire broadcast immediately. All running nodes are
              cancelled, all pending nodes are skipped. The broadcast is marked
              as failed.
            </td>
          </tr>
          <tr>
            <td><code>&quot;skip-downstream&quot;</code></td>
            <td>
              Mark the failed node, skip its direct and transitive dependents
              (with skip reason <code>&quot;upstream-failed&quot;</code>), but
              continue executing independent branches. The broadcast is marked
              as failed when all branches finish.
            </td>
          </tr>
          <tr>
            <td><code>&quot;continue&quot;</code></td>
            <td>
              Same as <code>&quot;skip-downstream&quot;</code> for node
              skipping, but the broadcast is marked as{" "}
              <code>&quot;completed&quot;</code> (with an error message noting
              the partial failure) rather than <code>&quot;failed&quot;</code>.
              Use this when some nodes are non-critical.
            </td>
          </tr>
        </tbody>
      </table>
      <Code>{`const resilientPipeline = broadcast("resilientPipeline")
  .input(fetchData)
  .then(sendEmail)       // non-critical: ok if this fails
  .then(updateDatabase)  // critical
  .onFailure("continue")
  .build();`}</Code>

      <h4>
        <code>.timeout(ms)</code>
      </h4>
      <p>
        Maximum total time for the entire broadcast execution in milliseconds.
        If the broadcast runs longer than this, all active nodes are cancelled
        and the broadcast is marked as failed with a timeout error. This is
        separate from per-signal timeouts, which still apply individually.
      </p>
      <Code>{`const timeBoundPipeline = broadcast("timeBoundPipeline")
  .input(validate)
  .then(processA)
  .then(processB)
  .timeout(60_000) // entire broadcast must finish within 60 seconds
  .build();`}</Code>

      <h4>
        <code>.build()</code>
      </h4>
      <p>
        Finalizes the broadcast definition. Validates the DAG: checks for
        duplicate node names, missing dependencies, and cycles. Throws{" "}
        <code>BroadcastValidationError</code> or{" "}
        <code>BroadcastCycleError</code> if the graph is invalid. Returns a{" "}
        <code>BroadcastDefinition</code> object that can be registered with the
        runner and triggered.
      </p>

      <hr className="divider" />

      {/* ── Patterns ── */}

      <h3>Patterns</h3>

      <h4>Linear chain</h4>
      <p>
        A &rarr; B &rarr; C. Each node depends on the previous. The output of
        each node is passed directly as input to the next.
      </p>
      <Code>{`const linear = broadcast("linear")
  .input(validate)   // A
  .then(charge)      // B: receives validate's output
  .then(notify)      // C: receives charge's output
  .build();`}</Code>

      <h4>Fan-out</h4>
      <p>
        A &rarr; [B, C, D]. Multiple nodes run in parallel after A completes.
        Each receives A&apos;s output.
      </p>
      <Code>{`const fanOut = broadcast("fanOut")
  .input(validate)
  .then(emailReceipt, smsNotification, slackAlert)
  .build();

// Equivalent to:
const fanOutExplicit = broadcast("fanOutExplicit")
  .input(validate)
  .then(emailReceipt, { after: ["validate"] })
  .then(smsNotification, { after: ["validate"] })
  .then(slackAlert, { after: ["validate"] })
  .build();`}</Code>

      <h4>Fan-in</h4>
      <p>
        [B, C] &rarr; D. Node D waits for both B and C to complete. Use{" "}
        <code>after</code> to declare dependencies on multiple upstream nodes,
        and <code>map</code> to combine their outputs.
      </p>
      <Code>{`const fanIn = broadcast("fanIn")
  .input(validate)
  .then(emailReceipt, { as: "email" })
  .then(notifyWarehouse, { as: "warehouse" })
  .then(generateReport, {
    after: ["email", "warehouse"],
    map: (upstream) => ({
      emailSent: upstream.email.sent,
      warehouseAck: upstream.warehouse.ackId,
    }),
  })
  .build();`}</Code>

      <h4>Conditional execution</h4>
      <p>
        Use <code>when</code> to skip nodes based on upstream results. Skipped
        nodes (reason: <code>&quot;guard&quot;</code>) do not count as failures
        and do not block their dependents.
      </p>
      <Code>{`const conditional = broadcast("conditional")
  .input(validate)
  .then(chargeCard, {
    when: (upstream) => upstream.validate.paymentMethod === "card",
    map: (upstream) => ({ amount: upstream.validate.total }),
  })
  .then(chargeBankTransfer, {
    after: ["validate"],
    when: (upstream) => upstream.validate.paymentMethod === "bank",
    map: (upstream) => ({ amount: upstream.validate.total }),
  })
  .then(sendConfirmation, {
    after: ["chargeCard", "chargeBankTransfer"],
  })
  .build();`}</Code>

      <h4>Data mapping</h4>
      <p>
        Use <code>map</code> to transform upstream outputs into the downstream
        signal&apos;s expected input format. The <code>upstream</code> argument
        is keyed by node name (or the <code>as</code> alias).
      </p>
      <Code>{`const mapped = broadcast("mapped")
  .input(fetchUser)
  .then(enrichProfile, {
    map: (upstream) => ({
      userId: upstream.fetchUser.id,
      email: upstream.fetchUser.email,
    }),
  })
  .build();`}</Code>

      <h4>Default data when upstream is skipped</h4>
      <p>
        When a node is guard-skipped, its output is <code>undefined</code> in
        downstream <code>map</code> functions. Use nullish coalescing to provide
        fallback values.
      </p>
      <Code>{`const withFallback = broadcast("withFallback")
  .input(validate)
  .then(enrichFromCache, {
    when: (upstream) => upstream.validate.cacheEnabled,
  })
  .then(process, {
    after: ["validate", "enrichFromCache"],
    map: (upstream) => ({
      data: upstream.validate.data,
      enrichment: upstream.enrichFromCache ?? { source: "none" },
    }),
  })
  .build();`}</Code>

      <hr className="divider" />

      {/* ── Triggering ── */}

      <h3>Triggering</h3>
      <p>
        Trigger a broadcast to enqueue it for execution. The input is passed to
        the entry signal. Returns a broadcast run ID.
      </p>
      <Code>{`// Trigger via the definition (uses the global broadcast adapter)
const runId = await orderFlow.trigger({ orderId: "ORD-9281" });

// Trigger via the runner (preferred — uses the runner's own adapter)
const runId = await broadcastRunner.trigger("orderFlow", { orderId: "ORD-9281" });

// Optionally wait for the broadcast to complete
const result = await broadcastRunner.waitForBroadcastRun(runId, {
  timeoutMs: 30_000,
  pollMs: 200,
});

if (result?.status === "completed") {
  console.log("Broadcast finished successfully");
} else if (result?.status === "failed") {
  console.error("Broadcast failed:", result.error);
}`}</Code>

      <hr className="divider" />

      {/* ── BroadcastRunner ── */}

      <h3>BroadcastRunner</h3>
      <p>
        The broadcast runner orchestrates DAG execution. It polls for triggered
        broadcasts, initializes node run records, triggers root signals, and
        advances the graph as nodes complete. It coordinates with a{" "}
        <code>SignalRunner</code> instance to execute individual signals and
        monitor their completion.
      </p>
      <Code>{`import { BroadcastRunner, ConsoleBroadcastSubscriber } from "station-broadcast";
import { BroadcastSqliteAdapter } from "station-adapter-sqlite/broadcast";

const broadcastRunner = new BroadcastRunner({
  signalRunner: runner,
  adapter: new BroadcastSqliteAdapter({ dbPath: "./data/broadcasts.db" }),
  subscribers: [new ConsoleBroadcastSubscriber()],
  pollIntervalMs: 1000,
});

broadcastRunner.register(orderFlow);
broadcastRunner.register(hourlySync);

// Start the broadcast runner (blocks until stop() is called)
await broadcastRunner.start();`}</Code>

      <div className="warn-box">
        Shutdown order matters. The broadcast runner must stop before the signal
        runner because it queries the signal adapter during shutdown to check
        node completion status. Stop them in this order:
        <Code>{`await broadcastRunner.stop({ graceful: true });
await signalRunner.stop({ graceful: true });`}</Code>
      </div>

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
            <td><code>signalRunner</code></td>
            <td><code>SignalRunner</code></td>
            <td>&mdash;</td>
            <td>
              Required. The signal runner instance that executes individual
              signals. The broadcast runner reads from the signal runner&apos;s
              adapter to track node completion.
            </td>
          </tr>
          <tr>
            <td><code>adapter</code></td>
            <td><code>BroadcastQueueAdapter</code></td>
            <td><code>BroadcastMemoryAdapter</code></td>
            <td>
              Storage backend for broadcast runs and node states. Use{" "}
              <code>BroadcastSqliteAdapter</code> for production persistence.
            </td>
          </tr>
          <tr>
            <td><code>broadcastsDir</code></td>
            <td><code>string</code></td>
            <td>&mdash;</td>
            <td>
              Directory path for auto-discovery. Recursively imports all{" "}
              <code>.ts</code> and <code>.js</code> files and registers any
              exported broadcast definitions.
            </td>
          </tr>
          <tr>
            <td><code>subscribers</code></td>
            <td><code>BroadcastSubscriber[]</code></td>
            <td><code>[]</code></td>
            <td>
              Array of subscriber objects notified on broadcast lifecycle events.
            </td>
          </tr>
          <tr>
            <td><code>pollIntervalMs</code></td>
            <td><code>number</code></td>
            <td><code>1000</code></td>
            <td>
              Milliseconds between poll ticks. Each tick checks for pending
              broadcasts, advances running broadcasts, and handles recurring
              schedules.
            </td>
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
            <td><code>register(definition)</code></td>
            <td><code>this</code></td>
            <td>
              Register a broadcast definition. Alternative to auto-discovery
              via <code>broadcastsDir</code>. Chainable. Warns on duplicate
              names.
            </td>
          </tr>
          <tr>
            <td><code>start()</code></td>
            <td><code>Promise&lt;void&gt;</code></td>
            <td>
              Start the poll loop. Discovers broadcasts from{" "}
              <code>broadcastsDir</code> (if set), installs shutdown handlers,
              and begins polling. Blocks until <code>stop()</code> is called.
            </td>
          </tr>
          <tr>
            <td><code>stop(opts?)</code></td>
            <td><code>Promise&lt;void&gt;</code></td>
            <td>
              Stop the runner. Accepts optional{" "}
              <code>{`{ graceful: boolean, timeoutMs: number }`}</code>. When
              graceful, waits for running broadcasts to finish (up to the
              timeout). Closes the adapter.
            </td>
          </tr>
          <tr>
            <td><code>trigger(name, input)</code></td>
            <td><code>Promise&lt;string&gt;</code></td>
            <td>
              Trigger a registered broadcast by name. Writes directly to this
              runner&apos;s adapter rather than the global singleton. Returns
              the broadcast run ID.
            </td>
          </tr>
          <tr>
            <td><code>waitForBroadcastRun(id, opts?)</code></td>
            <td><code>Promise&lt;BroadcastRun | null&gt;</code></td>
            <td>
              Poll until a broadcast run reaches a terminal status (completed,
              failed, or cancelled). Options:{" "}
              <code>{`{ pollMs?, timeoutMs? }`}</code>. Default timeout: 60
              seconds.
            </td>
          </tr>
          <tr>
            <td><code>cancel(broadcastRunId)</code></td>
            <td><code>Promise&lt;boolean&gt;</code></td>
            <td>
              Cancel a broadcast run. Cancels all running signal runs, skips
              all pending nodes, and marks the broadcast as cancelled. Returns
              false if the run does not exist or is already terminal.
            </td>
          </tr>
          <tr>
            <td><code>getBroadcastRun(id)</code></td>
            <td><code>Promise&lt;BroadcastRun | null&gt;</code></td>
            <td>Look up a broadcast run by its ID.</td>
          </tr>
          <tr>
            <td><code>getNodeRuns(broadcastRunId)</code></td>
            <td><code>Promise&lt;BroadcastNodeRun[]&gt;</code></td>
            <td>Get all node run records for a broadcast run.</td>
          </tr>
          <tr>
            <td><code>listRegistered()</code></td>
            <td><code>Array&lt;{`{ name, nodeCount, failurePolicy, timeout?, interval? }`}&gt;</code></td>
            <td>List metadata for all registered broadcast definitions.</td>
          </tr>
          <tr>
            <td><code>hasBroadcast(name)</code></td>
            <td><code>boolean</code></td>
            <td>Check whether a broadcast is registered by name.</td>
          </tr>
          <tr>
            <td><code>subscribe(subscriber)</code></td>
            <td><code>this</code></td>
            <td>Add a subscriber after construction. Chainable.</td>
          </tr>
        </tbody>
      </table>

      <hr className="divider" />

      {/* ── BroadcastQueueAdapter ── */}

      <h3>BroadcastQueueAdapter</h3>
      <p>
        The adapter interface for broadcast storage. Manages broadcast runs and
        their node runs. Two adapters ship with the framework:{" "}
        <code>BroadcastMemoryAdapter</code> (built into{" "}
        <code>station-broadcast</code>) and <code>BroadcastSqliteAdapter</code>{" "}
        (from <code>station-adapter-sqlite</code>).
      </p>
      <table className="api-table">
        <thead>
          <tr>
            <th>Method</th>
            <th>Signature</th>
            <th>Description</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td><code>addBroadcastRun(run)</code></td>
            <td><code>(BroadcastRun) =&gt; Promise&lt;void&gt;</code></td>
            <td>Insert a new broadcast run record.</td>
          </tr>
          <tr>
            <td><code>getBroadcastRun(id)</code></td>
            <td><code>(string) =&gt; Promise&lt;BroadcastRun | null&gt;</code></td>
            <td>Look up a broadcast run by ID.</td>
          </tr>
          <tr>
            <td><code>updateBroadcastRun(id, patch)</code></td>
            <td><code>(string, BroadcastRunPatch) =&gt; Promise&lt;void&gt;</code></td>
            <td>
              Partially update a broadcast run. Identity fields (<code>id</code>,{" "}
              <code>broadcastName</code>, <code>createdAt</code>) are immutable.
            </td>
          </tr>
          <tr>
            <td><code>getBroadcastRunsDue()</code></td>
            <td><code>() =&gt; Promise&lt;BroadcastRun[]&gt;</code></td>
            <td>
              Get all broadcast runs with <code>&quot;pending&quot;</code>{" "}
              status, ready for initialization.
            </td>
          </tr>
          <tr>
            <td><code>getBroadcastRunsRunning()</code></td>
            <td><code>() =&gt; Promise&lt;BroadcastRun[]&gt;</code></td>
            <td>
              Get all broadcast runs with <code>&quot;running&quot;</code>{" "}
              status, needing advancement.
            </td>
          </tr>
          <tr>
            <td><code>listBroadcastRuns(broadcastName)</code></td>
            <td><code>(string) =&gt; Promise&lt;BroadcastRun[]&gt;</code></td>
            <td>List all runs for a specific broadcast name.</td>
          </tr>
          <tr>
            <td><code>hasBroadcastRunWithStatus(name, statuses)</code></td>
            <td><code>(string, BroadcastRunStatus[]) =&gt; Promise&lt;boolean&gt;</code></td>
            <td>
              Check if any run exists for the given broadcast in one of the
              specified statuses. Used for recurring overlap prevention.
            </td>
          </tr>
          <tr>
            <td><code>purgeBroadcastRuns(olderThan, statuses)</code></td>
            <td><code>(Date, BroadcastRunStatus[]) =&gt; Promise&lt;number&gt;</code></td>
            <td>Delete broadcast runs in terminal statuses older than the cutoff. Returns count deleted.</td>
          </tr>
          <tr>
            <td><code>addNodeRun(nodeRun)</code></td>
            <td><code>(BroadcastNodeRun) =&gt; Promise&lt;void&gt;</code></td>
            <td>Insert a node run record.</td>
          </tr>
          <tr>
            <td><code>getNodeRun(id)</code></td>
            <td><code>(string) =&gt; Promise&lt;BroadcastNodeRun | null&gt;</code></td>
            <td>Look up a node run by ID.</td>
          </tr>
          <tr>
            <td><code>updateNodeRun(id, patch)</code></td>
            <td><code>(string, BroadcastNodeRunPatch) =&gt; Promise&lt;void&gt;</code></td>
            <td>
              Partially update a node run. Identity fields (<code>id</code>,{" "}
              <code>broadcastRunId</code>, <code>nodeName</code>,{" "}
              <code>signalName</code>) are immutable.
            </td>
          </tr>
          <tr>
            <td><code>getNodeRuns(broadcastRunId)</code></td>
            <td><code>(string) =&gt; Promise&lt;BroadcastNodeRun[]&gt;</code></td>
            <td>Get all node runs for a given broadcast run.</td>
          </tr>
          <tr>
            <td><code>generateId()</code></td>
            <td><code>() =&gt; string</code></td>
            <td>Generate a unique ID for runs and node runs.</td>
          </tr>
          <tr>
            <td><code>ping()</code></td>
            <td><code>() =&gt; Promise&lt;boolean&gt;</code></td>
            <td>Health check. Returns true if the adapter is operational.</td>
          </tr>
          <tr>
            <td><code>close()</code></td>
            <td><code>() =&gt; Promise&lt;void&gt;</code></td>
            <td>Optional. Release resources. Called automatically on stop.</td>
          </tr>
        </tbody>
      </table>

      <hr className="divider" />

      {/* ── BroadcastRun ── */}

      <h3>BroadcastRun</h3>
      <p>
        Represents a single execution of a broadcast.
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
            <td>Unique broadcast run identifier.</td>
          </tr>
          <tr>
            <td><code>broadcastName</code></td>
            <td><code>string</code></td>
            <td>Name of the broadcast definition.</td>
          </tr>
          <tr>
            <td><code>input</code></td>
            <td><code>string</code></td>
            <td>JSON-serialized input provided when triggered.</td>
          </tr>
          <tr>
            <td><code>status</code></td>
            <td><code>&quot;pending&quot; | &quot;running&quot; | &quot;completed&quot; | &quot;failed&quot; | &quot;cancelled&quot;</code></td>
            <td>Current lifecycle state.</td>
          </tr>
          <tr>
            <td><code>failurePolicy</code></td>
            <td><code>&quot;fail-fast&quot; | &quot;skip-downstream&quot; | &quot;continue&quot;</code></td>
            <td>The failure policy in effect for this run.</td>
          </tr>
          <tr>
            <td><code>timeout</code></td>
            <td><code>number | undefined</code></td>
            <td>Broadcast-level timeout in milliseconds, if set.</td>
          </tr>
          <tr>
            <td><code>interval</code></td>
            <td><code>string | undefined</code></td>
            <td>Recurring interval string, if this is a recurring broadcast.</td>
          </tr>
          <tr>
            <td><code>nextRunAt</code></td>
            <td><code>Date | undefined</code></td>
            <td>Scheduled time for the next recurring execution.</td>
          </tr>
          <tr>
            <td><code>createdAt</code></td>
            <td><code>Date</code></td>
            <td>When the broadcast run was created.</td>
          </tr>
          <tr>
            <td><code>startedAt</code></td>
            <td><code>Date | undefined</code></td>
            <td>When the broadcast began executing (first nodes triggered).</td>
          </tr>
          <tr>
            <td><code>completedAt</code></td>
            <td><code>Date | undefined</code></td>
            <td>When the broadcast reached a terminal state.</td>
          </tr>
          <tr>
            <td><code>error</code></td>
            <td><code>string | undefined</code></td>
            <td>
              Error message on failure. Also set on completed broadcasts with{" "}
              <code>&quot;continue&quot;</code> policy if any nodes failed
              (partial failure).
            </td>
          </tr>
        </tbody>
      </table>

      <h4>BroadcastNodeRun</h4>
      <p>
        Represents a single node&apos;s execution within a broadcast run.
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
            <td>Unique node run identifier.</td>
          </tr>
          <tr>
            <td><code>broadcastRunId</code></td>
            <td><code>string</code></td>
            <td>ID of the parent broadcast run.</td>
          </tr>
          <tr>
            <td><code>nodeName</code></td>
            <td><code>string</code></td>
            <td>
              Name of this node in the DAG (signal name or the{" "}
              <code>as</code> alias).
            </td>
          </tr>
          <tr>
            <td><code>signalName</code></td>
            <td><code>string</code></td>
            <td>Name of the underlying signal.</td>
          </tr>
          <tr>
            <td><code>signalRunId</code></td>
            <td><code>string | undefined</code></td>
            <td>
              ID of the signal run created for this node. Links to the{" "}
              <code>Run</code> record in the signal adapter.
            </td>
          </tr>
          <tr>
            <td><code>status</code></td>
            <td><code>&quot;pending&quot; | &quot;running&quot; | &quot;completed&quot; | &quot;failed&quot; | &quot;skipped&quot;</code></td>
            <td>Current node state.</td>
          </tr>
          <tr>
            <td><code>skipReason</code></td>
            <td><code>&quot;guard&quot; | &quot;upstream-failed&quot; | &quot;cancelled&quot; | undefined</code></td>
            <td>
              Why this node was skipped. Only set when status is{" "}
              <code>&quot;skipped&quot;</code>.{" "}
              <code>&quot;guard&quot;</code>: the <code>when</code> function
              returned false.{" "}
              <code>&quot;upstream-failed&quot;</code>: an upstream dependency
              failed.{" "}
              <code>&quot;cancelled&quot;</code>: the broadcast was cancelled.
            </td>
          </tr>
          <tr>
            <td><code>input</code></td>
            <td><code>string | undefined</code></td>
            <td>JSON-serialized input passed to the signal.</td>
          </tr>
          <tr>
            <td><code>output</code></td>
            <td><code>string | undefined</code></td>
            <td>JSON-serialized output from the completed signal.</td>
          </tr>
          <tr>
            <td><code>error</code></td>
            <td><code>string | undefined</code></td>
            <td>Error message if the node failed.</td>
          </tr>
          <tr>
            <td><code>startedAt</code></td>
            <td><code>Date | undefined</code></td>
            <td>When the node started executing.</td>
          </tr>
          <tr>
            <td><code>completedAt</code></td>
            <td><code>Date | undefined</code></td>
            <td>When the node reached a terminal state.</td>
          </tr>
        </tbody>
      </table>

      <hr className="divider" />

      {/* ── BroadcastSubscriber ── */}

      <h3>BroadcastSubscriber</h3>
      <p>
        All methods are optional. Implement only the events you need. Subscriber
        errors are caught and logged without affecting broadcast execution.
      </p>
      <table className="api-table">
        <thead>
          <tr>
            <th>Method</th>
            <th>Event data</th>
            <th>When it fires</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td><code>onBroadcastDiscovered</code></td>
            <td><code>{`{ broadcastName, filePath }`}</code></td>
            <td>A broadcast file was found during auto-discovery from <code>broadcastsDir</code>.</td>
          </tr>
          <tr>
            <td><code>onBroadcastQueued</code></td>
            <td><code>{`{ broadcastRun }`}</code></td>
            <td>A broadcast run was created and added to the queue.</td>
          </tr>
          <tr>
            <td><code>onBroadcastStarted</code></td>
            <td><code>{`{ broadcastRun }`}</code></td>
            <td>
              A broadcast run transitioned from <code>&quot;pending&quot;</code>{" "}
              to <code>&quot;running&quot;</code>. Node run records have been
              created and root nodes are about to be triggered.
            </td>
          </tr>
          <tr>
            <td><code>onBroadcastCompleted</code></td>
            <td><code>{`{ broadcastRun }`}</code></td>
            <td>
              All nodes reached terminal states and the broadcast is marked as
              completed. Under the <code>&quot;continue&quot;</code> policy, the{" "}
              <code>broadcastRun.error</code> field may contain a partial
              failure message.
            </td>
          </tr>
          <tr>
            <td><code>onBroadcastFailed</code></td>
            <td><code>{`{ broadcastRun, error }`}</code></td>
            <td>
              The broadcast failed. Under <code>&quot;fail-fast&quot;</code>,
              this fires immediately when any node fails. Under{" "}
              <code>&quot;skip-downstream&quot;</code>, this fires after all
              branches finish.
            </td>
          </tr>
          <tr>
            <td><code>onBroadcastCancelled</code></td>
            <td><code>{`{ broadcastRun }`}</code></td>
            <td>
              The broadcast was cancelled via{" "}
              <code>broadcastRunner.cancel()</code>.
            </td>
          </tr>
          <tr>
            <td><code>onNodeTriggered</code></td>
            <td><code>{`{ broadcastRun, nodeRun }`}</code></td>
            <td>
              A node&apos;s signal was triggered via <code>.trigger()</code>.
              The <code>nodeRun.signalRunId</code> is now set.
            </td>
          </tr>
          <tr>
            <td><code>onNodeCompleted</code></td>
            <td><code>{`{ broadcastRun, nodeRun }`}</code></td>
            <td>
              A node&apos;s signal completed. The <code>nodeRun.output</code>{" "}
              contains the JSON-serialized result.
            </td>
          </tr>
          <tr>
            <td><code>onNodeFailed</code></td>
            <td><code>{`{ broadcastRun, nodeRun, error }`}</code></td>
            <td>
              A node&apos;s signal failed, its <code>map</code> function threw,
              its <code>when</code> function threw, or input validation failed.
            </td>
          </tr>
          <tr>
            <td><code>onNodeSkipped</code></td>
            <td><code>{`{ broadcastRun, nodeRun, reason }`}</code></td>
            <td>
              A node was skipped. Reasons include: guard returned false,
              upstream dependency failed, or broadcast was cancelled.
            </td>
          </tr>
        </tbody>
      </table>

      <p>
        The built-in <code>ConsoleBroadcastSubscriber</code> logs all events to
        stdout with a <code>[station-broadcast]</code> prefix.
      </p>

      <hr className="divider" />

      {/* ── Dynamic broadcasts ── */}

      <h3>Dynamic broadcasts</h3>
      <p>
        Everything on this page describes file-defined broadcasts: definitions
        you build with <code>broadcast(...)</code> at module scope and ship in
        your codebase. Station also supports{" "}
        <Link href="/docs/dynamic-broadcasts">dynamic broadcasts</Link> —
        runtime-defined DAGs persisted through the broadcast adapter and
        edited over the v1 API or the dashboard&apos;s graph builder.
      </p>
      <p>
        The two registries are separate; a name in one never collides with a
        name in the other. The builder API documented above is unchanged —
        dynamic broadcasts are an opt-in additive surface, not a replacement.
        If you need to compose existing signals into a workflow at runtime
        without redeploying, see the{" "}
        <Link href="/docs/dynamic-broadcasts">Dynamic broadcasts</Link> guide.
      </p>
    </>
  );
}
