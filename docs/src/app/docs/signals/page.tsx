import { Metadata } from "next";
import Link from "next/link";
import { Code } from "../../components/Code";

export const metadata: Metadata = {
  title: "Signals API — Station",
};

export default function SignalsPage() {
  return (
    <>
      <div className="eyebrow">API Reference</div>
      <h2 style={{ marginTop: 0 }}>Signals</h2>
      <p>
        A signal is a named, type-safe background job. You define its input
        schema, handler function, and execution constraints. The runner picks it
        up, spawns an isolated child process, and manages retries, timeouts, and
        concurrency on your behalf.
      </p>
      <p>
        This reference describes the Node runtime. The shared builder also works
        with the <Link href="/docs/browser">experimental browser runtime</Link>.
        Read that guide for supported methods, explicit registration, IndexedDB
        recovery, and cooperative worker execution; Node runner guarantees and
        APIs do not apply in the browser.
      </p>

      {/* ── signal(name) ── */}

      <h3>
        <code>signal(name)</code>
      </h3>
      <p>
        Creates a named signal definition. The name must be unique across your
        application, start with a letter, and contain only letters, digits,
        hyphens, and underscores. Returns a builder with chainable methods.
      </p>
      <Code>{`import { signal, z } from "station-signal";

const sendEmail = signal("sendEmail")
  .input(z.object({
    to: z.string().email(),
    subject: z.string(),
    body: z.string(),
  }))
  .output(z.object({
    messageId: z.string(),
    sentAt: z.string().datetime(),
  }))
  .timeout(10_000)        // 10 seconds
  .retries(3)             // up to 4 total attempts
  .concurrency(5)         // max 5 concurrent sends
  .onComplete(async (output, input) => {
    console.log(\`Email \${output.messageId} sent to \${input.to}\`);
  })
  .run(async (input) => {
    const result = await emailService.send(input);
    return {
      messageId: result.id,
      sentAt: new Date().toISOString(),
    };
  });`}</Code>

      <hr className="divider" />

      {/* ── Builder methods ── */}

      <h3>Builder methods</h3>

      <h4>
        <code>.input(schema)</code>
      </h4>
      <p>
        Sets the Zod schema for input validation. Every call to{" "}
        <code>.trigger()</code> validates the provided data against this schema
        before enqueuing. If validation fails, the run is rejected immediately
        and never enters the queue. The schema also drives TypeScript type
        inference: your handler receives the exact inferred type, and the
        compiler enforces it at build time.
      </p>
      <Code>{`const processOrder = signal("processOrder")
  .input(z.object({
    orderId: z.string().uuid(),
    items: z.array(z.object({
      sku: z.string(),
      quantity: z.number().int().positive(),
    })),
  }))
  .run(async (input) => {
    // input is typed as { orderId: string; items: { sku: string; quantity: number }[] }
    for (const item of input.items) {
      await reserveInventory(item.sku, item.quantity);
    }
  });`}</Code>
      <p>
        If no input schema is provided, the signal accepts an empty object{" "}
        <code>{`{}`}</code> by default.
      </p>

      <h4>
        <code>.output(schema)</code>
      </h4>
      <p>
        Optional output schema. When provided, the handler&apos;s return value
        is validated against it. This is particularly useful when chaining
        signals inside broadcasts: the downstream signal&apos;s input type must
        match the upstream signal&apos;s output type. The validated output is
        JSON-serialized and stored on the run record, making it available to
        subscribers and the broadcast orchestrator.
      </p>
      <Code>{`const geocode = signal("geocode")
  .input(z.object({ address: z.string() }))
  .output(z.object({
    lat: z.number(),
    lng: z.number(),
  }))
  .run(async (input) => {
    const coords = await geocodingApi.lookup(input.address);
    return { lat: coords.latitude, lng: coords.longitude };
  });`}</Code>

      <h4>
        <code>.timeout(ms)</code>
      </h4>
      <p>
        Maximum execution time in milliseconds. If the handler exceeds this
        duration, the child process is killed with <code>SIGTERM</code> and the
        run is marked <code>&quot;failed&quot;</code> with a timeout error.
        Default: <code>300_000</code> (5 minutes). Set this lower for operations
        that should fail fast, such as HTTP requests or payment processing.
      </p>
      <Code>{`const healthCheck = signal("healthCheck")
  .input(z.object({ url: z.string().url() }))
  .timeout(5_000) // 5 seconds — fail fast if the service is down
  .run(async (input) => {
    const res = await fetch(input.url);
    if (!res.ok) throw new Error(\`Health check failed: \${res.status}\`);
  });`}</Code>

      <h4>
        <code>.retries(n)</code>
      </h4>
      <p>
        Maximum retry attempts after the initial failure. Total execution
        attempts = <code>1 + n</code>. Default: <code>0</code> (no retry).
        When a run fails and has remaining attempts, it is re-enqueued
        with <code>&quot;pending&quot;</code> status and an incremented attempt
        counter. The runner applies exponential backoff between retries
        (base delay configurable via{" "}
        <code>retryBackoffMs</code> on the runner). The retry delay doubles
        with each attempt: <code>base * 2^(attempt - 1)</code>.
      </p>
      <Code>{`const syncInventory = signal("syncInventory")
  .input(z.object({ warehouseId: z.string() }))
  .retries(3)  // up to 4 total attempts (1 initial + 3 retries)
  .run(async (input) => {
    await externalApi.sync(input.warehouseId);
  });`}</Code>

      <h4>
        <code>.concurrency(n)</code>
      </h4>
      <p>
        Maximum concurrent executions of this specific signal. When the limit
        is reached, additional runs remain in the queue and are picked up on
        subsequent poll ticks as slots open. This is separate from the
        runner-level <code>maxConcurrent</code> setting, which caps total
        concurrent executions across all signal types. Use per-signal
        concurrency to rate-limit API calls or protect database-heavy
        operations.
      </p>
      <Code>{`const callStripeApi = signal("callStripeApi")
  .input(z.object({ customerId: z.string(), amount: z.number() }))
  .concurrency(3) // max 3 concurrent Stripe API calls
  .retries(2)
  .run(async (input) => {
    await stripe.charges.create({
      customer: input.customerId,
      amount: input.amount,
      currency: "usd",
    });
  });`}</Code>
      <p>
        In a <Link href="/docs/network">Station Network</Link>, use
        <code>.concurrency({`{ station, network }`})</code> to set both the
        per-station limit and a fleet-wide limit enforced with shared leases.
        <code>.placement({`{ labels }`})</code> restricts claims to stations
        whose advertised labels match.
      </p>
      <Code>{`const render = signal("render")
  .concurrency({ station: 2, network: 10 })
  .placement({ labels: { gpu: "true" } })
  .run(renderJob);`}</Code>

      <h4>
        <code>.every(interval)</code>
      </h4>
      <p>
        Makes the signal recurring. Accepts human-readable duration strings:{" "}
        <code>&quot;30s&quot;</code>, <code>&quot;5m&quot;</code>,{" "}
        <code>&quot;1h&quot;</code>, <code>&quot;1d&quot;</code>. After
        each completion, the runner automatically enqueues the next run. If a
        pending or running instance already exists for this signal, the
        scheduler skips that tick and advances the schedule to prevent
        overlapping executions.
      </p>
      <Code>{`const cleanupExpiredSessions = signal("cleanupExpiredSessions")
  .every("15m")
  .run(async () => {
    const deleted = await db.sessions.deleteExpired();
    console.log(\`Cleaned up \${deleted} expired sessions\`);
  });`}</Code>

      <h4>
        <code>.withInput(data)</code>
      </h4>
      <p>
        Default input data for recurring signals. Without this, recurring
        signals run with <code>{`{}`}</code> as input. The data must conform to
        the input schema if one is defined.
      </p>
      <Code>{`const dailyReport = signal("dailyReport")
  .input(z.object({
    reportType: z.enum(["summary", "detailed"]),
    recipients: z.array(z.string().email()),
  }))
  .every("1d")
  .withInput({
    reportType: "summary",
    recipients: ["ops@example.com", "team@example.com"],
  })
  .run(async (input) => {
    const report = await generateReport(input.reportType);
    await sendReport(report, input.recipients);
  });`}</Code>

      <h4>
        <code>.env(...keys)</code>
      </h4>
      <p>
        Declares environment variables the signal requires. Before dispatching a
        run, the runner checks each key against the{" "}
        <Link href="/docs/environment">env store</Link> and the host{" "}
        <code>process.env</code>; if any is missing the run{" "}
        <strong>fails fast</strong> with a clear error instead of spawning a
        child that can&apos;t succeed. Provided values are injected into the
        child&apos;s <code>process.env</code>, so the handler reads them the
        usual way.
      </p>
      <Code>{`const charge = signal("charge")
  .input(z.object({ amount: z.number() }))
  .env("STRIPE_API_KEY")   // run fails fast if this is unset
  .run(async (input) => {
    const stripe = new Stripe(process.env.STRIPE_API_KEY!);
    await stripe.charges.create({ amount: input.amount });
  });`}</Code>

      <h4>
        <code>.step(name, fn)</code>
      </h4>
      <p>
        Adds a named execution step. Steps run sequentially within the same
        child process. The first step receives the signal&apos;s input. Each
        subsequent step receives the return value of the previous step. Step
        completion events are emitted to subscribers as each step finishes,
        giving you granular progress tracking. When using steps, finalize with{" "}
        <code>.build()</code> instead of <code>.run()</code>.
      </p>
      <Code>{`const processPayment = signal("processPayment")
  .input(z.object({
    orderId: z.string(),
    amount: z.number(),
    currency: z.string(),
  }))
  .step("validate", async (input) => {
    const order = await db.orders.findById(input.orderId);
    if (!order) throw new Error(\`Order \${input.orderId} not found\`);
    return { order, amount: input.amount, currency: input.currency };
  })
  .step("charge", async (prev) => {
    const charge = await paymentGateway.charge({
      amount: prev.amount,
      currency: prev.currency,
    });
    return { orderId: prev.order.id, chargeId: charge.id };
  })
  .step("confirm", async (prev) => {
    await db.orders.update(prev.orderId, { chargeId: prev.chargeId, status: "paid" });
    return { orderId: prev.orderId, chargeId: prev.chargeId };
  })
  .build();`}</Code>

      <h4>
        <code>.onComplete(fn)</code>
      </h4>
      <p>
        Post-completion callback. Called with <code>(output, input)</code> after
        the handler finishes successfully. Runs in the same child process as the
        handler. If the callback throws, the run is still marked as completed
        but an <code>onCompleteError</code> event is emitted to subscribers. Use
        this for side effects like sending notifications, updating caches, or
        triggering downstream signals.
      </p>
      <Code>{`const generateInvoice = signal("generateInvoice")
  .input(z.object({ orderId: z.string() }))
  .output(z.object({ invoiceUrl: z.string().url() }))
  .onComplete(async (output, input) => {
    await notificationService.send({
      channel: "email",
      template: "invoice-ready",
      data: { orderId: input.orderId, invoiceUrl: output.invoiceUrl },
    });
  })
  .run(async (input) => {
    const pdf = await renderInvoice(input.orderId);
    const url = await storage.upload(pdf);
    return { invoiceUrl: url };
  });`}</Code>
      <div className="info-box">
        <code>.onComplete()</code> can be called before or after{" "}
        <code>.run()</code>. When chaining after <code>.run()</code>, it returns
        the final <code>Signal</code> object. On a step-based builder, call it
        before <code>.build()</code>.
      </div>

      <h4>
        <code>.run(handler)</code>
      </h4>
      <p>
        Sets the handler function and finalizes the signal. The handler receives
        the validated input and should return the output (or void). The handler
        runs in an isolated child process spawned by the runner, so it has its
        own memory space and cannot crash the runner.
      </p>
      <Code>{`const resizeImage = signal("resizeImage")
  .input(z.object({
    sourceUrl: z.string().url(),
    width: z.number().int().positive(),
    height: z.number().int().positive(),
  }))
  .run(async (input) => {
    const image = await downloadImage(input.sourceUrl);
    const resized = await sharp(image).resize(input.width, input.height).toBuffer();
    await storage.upload(resized);
  });`}</Code>

      <h4>
        <code>.build()</code>
      </h4>
      <p>
        Finalizes a step-based signal. Use this instead of{" "}
        <code>.run()</code> when the signal is defined with{" "}
        <code>.step()</code> calls. Returns the same <code>Signal</code> object.
      </p>

      <hr className="divider" />

      {/* ── Signal instance ── */}

      <h3>Signal instance</h3>
      <p>
        After calling <code>.run()</code> or <code>.build()</code>, you get a{" "}
        <code>Signal</code> object. This is the handle you use to trigger runs
        and the object you pass to the runner for registration.
      </p>
      <table className="api-table">
        <thead>
          <tr>
            <th>Property</th>
            <th>Type</th>
            <th>Description</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td><code>.name</code></td>
            <td><code>string</code></td>
            <td>The signal name passed to <code>signal()</code>.</td>
          </tr>
          <tr>
            <td><code>.inputSchema</code></td>
            <td><code>z.ZodType</code></td>
            <td>The Zod input schema. Defaults to <code>z.object({`{}`})</code> if none was provided.</td>
          </tr>
          <tr>
            <td><code>.outputSchema</code></td>
            <td><code>z.ZodType | undefined</code></td>
            <td>The Zod output schema, if one was set via <code>.output()</code>.</td>
          </tr>
          <tr>
            <td><code>.timeout</code></td>
            <td><code>number</code></td>
            <td>Timeout in milliseconds. Default: <code>300_000</code>.</td>
          </tr>
          <tr>
            <td><code>.maxAttempts</code></td>
            <td><code>number</code></td>
            <td>Total attempts (1 + retries). Default: <code>1</code>.</td>
          </tr>
          <tr>
            <td><code>.maxConcurrency</code></td>
            <td><code>number | undefined</code></td>
            <td>Per-signal concurrency limit, if set.</td>
          </tr>
          <tr>
            <td><code>.interval</code></td>
            <td><code>string | undefined</code></td>
            <td>Recurring interval string (e.g. <code>&quot;5m&quot;</code>), if set.</td>
          </tr>
          <tr>
            <td><code>.recurringInput</code></td>
            <td><code>TInput | undefined</code></td>
            <td>Default input for recurring runs, if set via <code>.withInput()</code>.</td>
          </tr>
          <tr>
            <td><code>.handler</code></td>
            <td><code>Function | undefined</code></td>
            <td>The handler function, if defined via <code>.run()</code>.</td>
          </tr>
          <tr>
            <td><code>.steps</code></td>
            <td><code>StepDefinition[] | undefined</code></td>
            <td>Array of step definitions, if defined via <code>.step()</code>.</td>
          </tr>
        </tbody>
      </table>

      <h4>
        <code>.trigger(input)</code>
      </h4>
      <p>
        Enqueues a run for execution. Validates the input against the schema
        first. Returns a <code>Promise&lt;string&gt;</code> resolving to the
        unique run ID. Throws <code>SignalValidationError</code> if the input
        fails validation. The run is written to the adapter with{" "}
        <code>&quot;pending&quot;</code> status and picked up by the runner on
        the next poll tick.
      </p>
      <Code>{`const runId = await sendEmail.trigger({
  to: "user@example.com",
  subject: "Order Confirmation",
  body: "Your order has been placed.",
});

console.log(\`Enqueued run: \${runId}\`);`}</Code>

      <hr className="divider" />

      {/* ── SignalRunner ── */}

      <h3>SignalRunner</h3>
      <p>
        The runner is the long-running process that polls the adapter for due
        entries, spawns isolated child processes to execute signal handlers, and
        manages the full signal lifecycle: enqueue, dispatch, execute, retry,
        timeout, and completion. It also handles recurring signal scheduling,
        per-signal concurrency enforcement, and graceful shutdown on{" "}
        <code>SIGINT</code>/<code>SIGTERM</code>.
      </p>
      <Code>{`import { SignalRunner, ConsoleSubscriber } from "station-signal";
import { SqliteAdapter } from "station-adapter-sqlite";

const runner = new SignalRunner({
  signalsDir: "./src/signals",
  adapter: new SqliteAdapter({ dbPath: "./data/signals.db" }),
  subscribers: [new ConsoleSubscriber()],
  pollIntervalMs: 1000,
  maxConcurrent: 10,
  retryBackoffMs: 2000,
});

await runner.start();`}</Code>

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
            <td><code>signalsDir</code></td>
            <td><code>string</code></td>
            <td>&mdash;</td>
            <td>
              Directory path for auto-discovery. The runner recursively imports
              all <code>.ts</code> and <code>.js</code> files and registers any
              exported signal objects. Paths are resolved relative to the working
              directory.
            </td>
          </tr>
          <tr>
            <td><code>adapter</code></td>
            <td><code>SignalQueueAdapter</code></td>
            <td><code>MemoryAdapter</code></td>
            <td>
              Storage backend for run persistence. The default{" "}
              <code>MemoryAdapter</code> is in-process only and loses data on
              restart. Use <code>SqliteAdapter</code> for production. The runner
              automatically calls <code>configure({`{ adapter }`})</code> so
              child processes can access the same adapter.
            </td>
          </tr>
          <tr>
            <td><code>subscribers</code></td>
            <td><code>SignalSubscriber[]</code></td>
            <td><code>[]</code></td>
            <td>
              Array of subscriber objects notified on lifecycle events.
              Subscribers have all-optional methods; implement only the events
              you need.
            </td>
          </tr>
          <tr>
            <td><code>pollIntervalMs</code></td>
            <td><code>number</code></td>
            <td><code>1000</code></td>
            <td>
              Milliseconds between poll ticks. Each tick checks for due runs,
              running timeouts, and recurring schedules. Lower values give
              faster pickup but higher CPU usage.
            </td>
          </tr>
          <tr>
            <td><code>maxConcurrent</code></td>
            <td><code>number</code></td>
            <td><code>5</code></td>
            <td>
              Global maximum concurrent child processes across all signal types.
              When this limit is reached, no new runs are dispatched until a
              slot opens. This is independent of per-signal{" "}
              <code>.concurrency()</code> limits.
            </td>
          </tr>
          <tr>
            <td><code>maxAttempts</code></td>
            <td><code>number</code></td>
            <td><code>1</code></td>
            <td>
              Default max attempts for signals that do not specify their own
              via <code>.retries()</code>. Per-signal settings override this.
            </td>
          </tr>
          <tr>
            <td><code>retryBackoffMs</code></td>
            <td><code>number</code></td>
            <td><code>1000</code></td>
            <td>
              Base delay in milliseconds for exponential retry backoff. The
              actual delay is{" "}
              <code>retryBackoffMs * 2^(attempt - 1)</code>. First retry waits
              1s, second 2s, third 4s, and so on.
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
            <td><code>start()</code></td>
            <td><code>Promise&lt;void&gt;</code></td>
            <td>
              Start the poll loop. Discovers signals from{" "}
              <code>signalsDir</code> (if set), installs{" "}
              <code>SIGINT</code>/<code>SIGTERM</code> shutdown handlers, and
              begins polling. This method blocks until <code>stop()</code> is
              called.
            </td>
          </tr>
          <tr>
            <td><code>stop(opts?)</code></td>
            <td><code>Promise&lt;void&gt;</code></td>
            <td>
              Gracefully stop the runner. Accepts optional{" "}
              <code>{`{ graceful?: boolean, timeoutMs?: number }`}</code>. When
              graceful, waits for active child processes to finish (up to the
              timeout), then kills any remaining. Closes the adapter to release
              resources.
            </td>
          </tr>
          <tr>
            <td><code>register(name, filePath, opts?)</code></td>
            <td><code>this</code></td>
            <td>
              Manually register a signal by name and file path. Alternative to
              auto-discovery via <code>signalsDir</code>. Accepts optional{" "}
              <code>{`{ maxConcurrency }`}</code>.
            </td>
          </tr>
          <tr>
            <td><code>listRegistered()</code></td>
            <td><code>Array&lt;{`{ name, filePath, maxConcurrency? }`}&gt;</code></td>
            <td>Returns metadata for all registered signals.</td>
          </tr>
          <tr>
            <td><code>hasSignal(name)</code></td>
            <td><code>boolean</code></td>
            <td>Check whether a signal is registered by name.</td>
          </tr>
          <tr>
            <td><code>getRun(id)</code></td>
            <td><code>Promise&lt;Run | null&gt;</code></td>
            <td>Look up a run by its ID.</td>
          </tr>
          <tr>
            <td><code>listRuns(signalName)</code></td>
            <td><code>Promise&lt;Run[]&gt;</code></td>
            <td>List all runs for a specific signal.</td>
          </tr>
          <tr>
            <td><code>getSteps(runId)</code></td>
            <td><code>Promise&lt;Step[]&gt;</code></td>
            <td>Get all step records for a multi-step run.</td>
          </tr>
          <tr>
            <td><code>waitForRun(runId, opts?)</code></td>
            <td><code>Promise&lt;Run | null&gt;</code></td>
            <td>
              Poll until a run reaches a terminal status (completed, failed, or
              cancelled). Options:{" "}
              <code>{`{ pollMs?, timeoutMs?, waitForExistence? }`}</code>.
              Returns null if the run does not exist and{" "}
              <code>waitForExistence</code> is false.
            </td>
          </tr>
          <tr>
            <td><code>cancel(runId)</code></td>
            <td><code>Promise&lt;boolean&gt;</code></td>
            <td>
              Cancel a specific run. Marks it as <code>&quot;cancelled&quot;</code>{" "}
              and kills the child process if running. Returns false if the run
              does not exist or is already in a terminal state.
            </td>
          </tr>
          <tr>
            <td><code>purgeCompleted(olderThanMs)</code></td>
            <td><code>Promise&lt;number&gt;</code></td>
            <td>
              Delete completed, failed, and cancelled runs older than the
              specified age in milliseconds. Returns the count of purged runs.
            </td>
          </tr>
          <tr>
            <td><code>getAdapter()</code></td>
            <td><code>SignalQueueAdapter</code></td>
            <td>
              Access the underlying queue adapter. Used by the broadcast
              runner to coordinate with the signal layer.
            </td>
          </tr>
          <tr>
            <td><code>subscribe(subscriber)</code></td>
            <td><code>this</code></td>
            <td>Add a subscriber after construction. Chainable.</td>
          </tr>
        </tbody>
      </table>

      <h4>
        <code>SignalRunner.create(signalsDir, opts?)</code>
      </h4>
      <p>
        Static factory method. Creates a runner with the given signals directory
        and a default <code>ConsoleSubscriber</code> if no subscribers are
        provided.
      </p>
      <Code>{`const runner = SignalRunner.create("./src/signals", {
  adapter: new SqliteAdapter({ dbPath: "./data/signals.db" }),
  maxConcurrent: 10,
});`}</Code>

      <hr className="divider" />

      {/* ── SignalQueueAdapter ── */}

      <h3>SignalQueueAdapter</h3>
      <p>
        The adapter interface defines storage operations for runs and steps.
        Implement this to use a custom storage backend. Two adapters ship with
        the framework: <code>MemoryAdapter</code> (built into{" "}
        <code>station-signal</code>) and <code>SqliteAdapter</code> (from{" "}
        <code>station-adapter-sqlite</code>).
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
            <td><code>addRun(run)</code></td>
            <td><code>(Run) =&gt; Promise&lt;void&gt;</code></td>
            <td>Insert a new run record into the store.</td>
          </tr>
          <tr>
            <td><code>removeRun(id)</code></td>
            <td><code>(string) =&gt; Promise&lt;void&gt;</code></td>
            <td>Delete a run and its associated steps by run ID.</td>
          </tr>
          <tr>
            <td><code>getRun(id)</code></td>
            <td><code>(string) =&gt; Promise&lt;Run | null&gt;</code></td>
            <td>Look up a single run by ID. Returns null if not found.</td>
          </tr>
          <tr>
            <td><code>getRunsDue()</code></td>
            <td><code>() =&gt; Promise&lt;Run[]&gt;</code></td>
            <td>
              Get all runs with <code>&quot;pending&quot;</code> status whose{" "}
              <code>nextRunAt</code> is in the past (or unset). Results are
              sorted by creation time, oldest first.
            </td>
          </tr>
          <tr>
            <td><code>getRunsRunning()</code></td>
            <td><code>() =&gt; Promise&lt;Run[]&gt;</code></td>
            <td>
              Get all runs with <code>&quot;running&quot;</code> status. Used by
              the runner for timeout detection.
            </td>
          </tr>
          <tr>
            <td><code>updateRun(id, patch)</code></td>
            <td><code>(string, RunPatch) =&gt; Promise&lt;void&gt;</code></td>
            <td>
              Partially update a run. Identity fields (<code>id</code>,{" "}
              <code>signalName</code>, <code>kind</code>,{" "}
              <code>createdAt</code>) are immutable and excluded from the patch
              type.
            </td>
          </tr>
          <tr>
            <td><code>listRuns(signalName)</code></td>
            <td><code>(string) =&gt; Promise&lt;Run[]&gt;</code></td>
            <td>List all runs for a specific signal name.</td>
          </tr>
          <tr>
            <td><code>hasRunWithStatus(name, statuses)</code></td>
            <td><code>(string, RunStatus[]) =&gt; Promise&lt;boolean&gt;</code></td>
            <td>
              Check if any run exists for the given signal in one of the
              specified statuses. Used for recurring overlap prevention.
            </td>
          </tr>
          <tr>
            <td><code>purgeRuns(olderThan, statuses)</code></td>
            <td><code>(Date, RunStatus[]) =&gt; Promise&lt;number&gt;</code></td>
            <td>
              Delete runs in the given statuses that completed before the
              cutoff date. Returns the count deleted.
            </td>
          </tr>
          <tr>
            <td><code>addStep(step)</code></td>
            <td><code>(Step) =&gt; Promise&lt;void&gt;</code></td>
            <td>Insert a step record.</td>
          </tr>
          <tr>
            <td><code>updateStep(id, patch)</code></td>
            <td><code>(string, StepPatch) =&gt; Promise&lt;void&gt;</code></td>
            <td>Partially update a step record.</td>
          </tr>
          <tr>
            <td><code>getSteps(runId)</code></td>
            <td><code>(string) =&gt; Promise&lt;Step[]&gt;</code></td>
            <td>Get all steps for a given run ID.</td>
          </tr>
          <tr>
            <td><code>removeSteps(runId)</code></td>
            <td><code>(string) =&gt; Promise&lt;void&gt;</code></td>
            <td>Delete all steps for a given run ID.</td>
          </tr>
          <tr>
            <td><code>generateId()</code></td>
            <td><code>() =&gt; string</code></td>
            <td>
              Generate a unique run ID. The built-in adapters use{" "}
              <code>crypto.randomUUID()</code>.
            </td>
          </tr>
          <tr>
            <td><code>ping()</code></td>
            <td><code>() =&gt; Promise&lt;boolean&gt;</code></td>
            <td>Health check. Returns true if the adapter is operational.</td>
          </tr>
          <tr>
            <td><code>close()</code></td>
            <td><code>() =&gt; Promise&lt;void&gt;</code></td>
            <td>
              Optional. Release resources (database connections, file handles).
              Called automatically by the runner on stop.
            </td>
          </tr>
        </tbody>
      </table>

      <hr className="divider" />

      {/* ── Run ── */}

      <h3>Run</h3>
      <p>
        The <code>Run</code> interface represents a single execution of a
        signal. It is the primary record stored by the adapter.
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
            <td>Unique run identifier (UUID).</td>
          </tr>
          <tr>
            <td><code>signalName</code></td>
            <td><code>string</code></td>
            <td>Name of the signal this run belongs to.</td>
          </tr>
          <tr>
            <td><code>kind</code></td>
            <td><code>&quot;trigger&quot; | &quot;recurring&quot;</code></td>
            <td>
              Whether this run was created by an explicit{" "}
              <code>.trigger()</code> call or by the recurring scheduler.
            </td>
          </tr>
          <tr>
            <td><code>input</code></td>
            <td><code>string</code></td>
            <td>JSON-serialized input data.</td>
          </tr>
          <tr>
            <td><code>output</code></td>
            <td><code>string | undefined</code></td>
            <td>JSON-serialized output from the handler, set on completion.</td>
          </tr>
          <tr>
            <td><code>error</code></td>
            <td><code>string | undefined</code></td>
            <td>Error message, set on failure or timeout.</td>
          </tr>
          <tr>
            <td><code>status</code></td>
            <td><code>&quot;pending&quot; | &quot;running&quot; | &quot;completed&quot; | &quot;failed&quot; | &quot;cancelled&quot;</code></td>
            <td>
              Current lifecycle state. Transitions: pending &rarr; running
              &rarr; completed/failed. Can also be cancelled from any
              non-terminal state.
            </td>
          </tr>
          <tr>
            <td><code>attempts</code></td>
            <td><code>number</code></td>
            <td>Number of attempts executed so far. Starts at 0, incremented when dispatched.</td>
          </tr>
          <tr>
            <td><code>maxAttempts</code></td>
            <td><code>number</code></td>
            <td>Maximum allowed attempts (1 + retries).</td>
          </tr>
          <tr>
            <td><code>timeout</code></td>
            <td><code>number</code></td>
            <td>Timeout in milliseconds for this run.</td>
          </tr>
          <tr>
            <td><code>interval</code></td>
            <td><code>string | undefined</code></td>
            <td>Recurring interval string, present only for recurring runs.</td>
          </tr>
          <tr>
            <td><code>nextRunAt</code></td>
            <td><code>Date | undefined</code></td>
            <td>Earliest time this run should be picked up.</td>
          </tr>
          <tr>
            <td><code>lastRunAt</code></td>
            <td><code>Date | undefined</code></td>
            <td>Timestamp of the most recent execution attempt.</td>
          </tr>
          <tr>
            <td><code>startedAt</code></td>
            <td><code>Date | undefined</code></td>
            <td>When the current attempt started (reset on retry).</td>
          </tr>
          <tr>
            <td><code>completedAt</code></td>
            <td><code>Date | undefined</code></td>
            <td>When the run reached a terminal state.</td>
          </tr>
          <tr>
            <td><code>createdAt</code></td>
            <td><code>Date</code></td>
            <td>When the run was created.</td>
          </tr>
        </tbody>
      </table>

      <h4>Step</h4>
      <p>
        For multi-step signals, each step has its own record:
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
            <td>Unique step identifier.</td>
          </tr>
          <tr>
            <td><code>runId</code></td>
            <td><code>string</code></td>
            <td>ID of the parent run.</td>
          </tr>
          <tr>
            <td><code>name</code></td>
            <td><code>string</code></td>
            <td>Step name as defined in <code>.step(name, fn)</code>.</td>
          </tr>
          <tr>
            <td><code>status</code></td>
            <td><code>&quot;pending&quot; | &quot;running&quot; | &quot;completed&quot; | &quot;failed&quot;</code></td>
            <td>Current step state.</td>
          </tr>
          <tr>
            <td><code>input</code></td>
            <td><code>string | undefined</code></td>
            <td>JSON-serialized input passed to this step.</td>
          </tr>
          <tr>
            <td><code>output</code></td>
            <td><code>string | undefined</code></td>
            <td>JSON-serialized return value of this step.</td>
          </tr>
          <tr>
            <td><code>error</code></td>
            <td><code>string | undefined</code></td>
            <td>Error message if the step failed.</td>
          </tr>
          <tr>
            <td><code>startedAt</code></td>
            <td><code>Date | undefined</code></td>
            <td>When step execution started.</td>
          </tr>
          <tr>
            <td><code>completedAt</code></td>
            <td><code>Date | undefined</code></td>
            <td>When step execution finished.</td>
          </tr>
        </tbody>
      </table>

      <hr className="divider" />

      {/* ── SignalSubscriber ── */}

      <h3>SignalSubscriber</h3>
      <p>
        All methods are optional. Implement only the events you need. Subscriber
        methods are called synchronously and should not throw. If a subscriber
        throws, the error is caught, logged, and does not affect signal
        execution.
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
            <td><code>onSignalDiscovered</code></td>
            <td><code>{`{ signalName, filePath }`}</code></td>
            <td>A signal file was found during auto-discovery from <code>signalsDir</code>.</td>
          </tr>
          <tr>
            <td><code>onRunDispatched</code></td>
            <td><code>{`{ run }`}</code></td>
            <td>
              A run was marked as <code>&quot;running&quot;</code> and the child
              process is about to spawn.
            </td>
          </tr>
          <tr>
            <td><code>onRunStarted</code></td>
            <td><code>{`{ run }`}</code></td>
            <td>
              The child process confirmed it found the signal and is about to
              execute the handler.
            </td>
          </tr>
          <tr>
            <td><code>onRunCompleted</code></td>
            <td><code>{`{ run, output? }`}</code></td>
            <td>The handler finished successfully. <code>output</code> is the JSON-serialized return value.</td>
          </tr>
          <tr>
            <td><code>onRunTimeout</code></td>
            <td><code>{`{ run }`}</code></td>
            <td>
              A running run exceeded its timeout. The child process is killed.
              If retries remain, the run is re-enqueued; otherwise it fails.
            </td>
          </tr>
          <tr>
            <td><code>onRunRetry</code></td>
            <td><code>{`{ run, attempt, maxAttempts }`}</code></td>
            <td>
              A failed run was reset to <code>&quot;pending&quot;</code> for
              another attempt. <code>attempt</code> is the current attempt
              number.
            </td>
          </tr>
          <tr>
            <td><code>onRunFailed</code></td>
            <td><code>{`{ run, error? }`}</code></td>
            <td>
              A run failed terminally. All retries are exhausted, or the error
              was marked as non-retryable.
            </td>
          </tr>
          <tr>
            <td><code>onRunCancelled</code></td>
            <td><code>{`{ run }`}</code></td>
            <td>A run was cancelled via <code>runner.cancel()</code>.</td>
          </tr>
          <tr>
            <td><code>onRunSkipped</code></td>
            <td><code>{`{ run, reason }`}</code></td>
            <td>A due run was skipped because the per-signal concurrency limit was reached or backoff has not elapsed.</td>
          </tr>
          <tr>
            <td><code>onRunRescheduled</code></td>
            <td><code>{`{ run, nextRunAt }`}</code></td>
            <td>A recurring run was enqueued and the next execution time was computed.</td>
          </tr>
          <tr>
            <td><code>onStepStarted</code></td>
            <td><code>{`{ run, step }`}</code></td>
            <td>A step within a multi-step run started execution.</td>
          </tr>
          <tr>
            <td><code>onStepCompleted</code></td>
            <td><code>{`{ run, step }`}</code></td>
            <td>A step completed successfully.</td>
          </tr>
          <tr>
            <td><code>onStepFailed</code></td>
            <td><code>{`{ run, step }`}</code></td>
            <td>A step threw an error.</td>
          </tr>
          <tr>
            <td><code>onCompleteError</code></td>
            <td><code>{`{ run, error }`}</code></td>
            <td>
              The <code>onComplete</code> callback threw. The run is still
              marked as completed because the handler itself succeeded.
            </td>
          </tr>
          <tr>
            <td><code>onLogOutput</code></td>
            <td><code>{`{ run, level, message }`}</code></td>
            <td>
              Console output (<code>stdout</code> or <code>stderr</code>)
              captured from the child process.
            </td>
          </tr>
        </tbody>
      </table>

      <p>
        The built-in <code>ConsoleSubscriber</code> logs all events to stdout
        with a <code>[station-signal]</code> prefix.
      </p>

      <hr className="divider" />

      {/* ── configure() ── */}

      <h3>
        <code>configure()</code>
      </h3>
      <p>
        Sets a global default adapter. When the runner spawns a child process,
        that child may need to enqueue new runs (for example, if a signal&apos;s
        handler calls <code>.trigger()</code> on another signal). The child
        process reconstructs the adapter from serialized metadata and calls{" "}
        <code>configure()</code> automatically. You rarely need to call this
        directly; the runner does it for you in its constructor.
      </p>
      <Code>{`import { configure } from "station-signal";
import { SqliteAdapter } from "station-adapter-sqlite";

configure({
  adapter: new SqliteAdapter({ dbPath: "./data/signals.db" }),
});`}</Code>
      <div className="info-box">
        If <code>configure()</code> is called more than once, a warning is
        logged and the previous adapter is replaced. Each runner should use its
        own adapter instance.
      </div>

      <hr className="divider" />

      {/* ── Re-exported Zod ── */}

      <h3>Re-exported Zod</h3>
      <Code>{`import { signal, z } from "station-signal";`}</Code>
      <p>
        <code>station-signal</code> re-exports <code>z</code> from Zod v4. One
        import for schema definitions and signal definitions. No need to install
        Zod as a separate dependency.
      </p>
    </>
  );
}
