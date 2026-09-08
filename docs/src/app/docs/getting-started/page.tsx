import Link from "next/link";
import { Code } from "../../components/Code";

export const metadata = { title: "Getting Started — Station" };

export default function GettingStartedPage() {
  return (
    <>
      <div className="eyebrow">Guide</div>
      <h2 style={{ marginTop: 0 }}>Getting started</h2>
      <p>
        This guide walks through Station from first install to a production-ready
        setup with persistence, recurring jobs, multi-step pipelines, and lifecycle
        observers.
      </p>

      <p>
        This page covers the Node runtime. For local execution inside a web app,
        follow the <Link href="/docs/browser">experimental browser guide</Link>
        {" "}instead: it uses BrowserStation and IndexedDB with explicit worker hosts.
      </p>

      {/* ── Prerequisites ── */}

      <h3>Prerequisites</h3>
      <ul>
        <li>Node.js 18 or later</li>
        <li>A package manager (pnpm, npm, or yarn)</li>
        <li>
          A TypeScript project configured for ES modules (<code>{`"type": "module"`}</code> in
          your package.json)
        </li>
      </ul>

      <hr className="divider" />

      {/* ── 1. Install ── */}

      <h3>1. Install</h3>
      <Code>{`pnpm add station-signal station-kit`}</Code>
      <p>
        <code>station-signal</code> is where you define jobs;{" "}
        <code>station-kit</code> is how you run them — it is Station&apos;s entry
        point, and it wires the runners, dashboard, and API for you.
      </p>
      <div className="info-box">
        <p>
          station-signal re-exports <code>z</code> from Zod. There is no need to
          install Zod separately.
        </p>
      </div>

      <hr className="divider" />

      {/* ── 2. Define a signal ── */}

      <h3>2. Define a signal</h3>
      <p>
        A signal is a named, type-safe background job definition. It declares an
        input schema, execution constraints, and a handler function using a
        builder pattern. Signals are defined in their own files so the runner can
        auto-discover them.
      </p>
      <Code>{`// signals/send-email.ts
import { signal, z } from "station-signal";

export const sendEmail = signal("sendEmail")
  .input(z.object({
    to: z.string(),
    subject: z.string(),
    body: z.string(),
  }))
  .timeout(30_000)
  .retries(2)
  .run(async (input) => {
    console.log(\`Sending email to \${input.to}\`);
    // Your email sending logic here
  });`}</Code>

      <h4>Builder methods</h4>
      <table className="api-table">
        <thead>
          <tr>
            <th>Method</th>
            <th>Description</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td><code>.input(schema)</code></td>
            <td>
              Zod schema for the job payload. Every <code>.trigger()</code> call
              is validated against this schema. If validation fails, the run
              never starts.
            </td>
          </tr>
          <tr>
            <td><code>.timeout(30_000)</code></td>
            <td>
              Maximum execution time in milliseconds. If the handler exceeds
              this duration, the run is killed and marked as timed out.
              Default: <code>300_000</code> (5 minutes).
            </td>
          </tr>
          <tr>
            <td><code>.retries(2)</code></td>
            <td>
              Number of retry attempts after the initial failure. A value
              of <code>2</code> means 3 total attempts (1 initial + 2 retries).
              Default: <code>0</code> (no retry).
            </td>
          </tr>
          <tr>
            <td><code>.run(handler)</code></td>
            <td>
              The handler function. Receives the validated input. Runs in an
              isolated child process spawned by the runner.
            </td>
          </tr>
        </tbody>
      </table>

      <hr className="divider" />

      {/* ── 3. Run it ── */}

      <h3>3. Run it</h3>
      <p>
        Station apps are configured in one file and started with one command.{" "}
        <code>defineConfig</code> points Station at your signal directory; the{" "}
        <code>station</code> CLI discovers what is there and runs it.
      </p>
      <Code>{`// station.config.ts
import { defineConfig } from "station-kit";

export default defineConfig({
  signalsDir: "./signals",
});`}</Code>
      <Code>{`npx station`}</Code>
      <p>
        That one command starts the signal runner, serves the dashboard on{" "}
        <code>http://localhost:4400</code>, and exposes the authenticated v1 API
        — so you can watch runs, inspect logs, and trigger jobs without writing
        any of that yourself. Add <code>broadcastsDir</code> and{" "}
        <code>beaconsDir</code> later and the matching runners are wired the same
        way, including the shutdown ordering between them.
      </p>

      <table className="api-table">
        <thead>
          <tr>
            <th>Config field</th>
            <th>Description</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td><code>signalsDir</code></td>
            <td>
              Path to a directory of signal files. Station auto-discovers every{" "}
              <code>.ts</code> or <code>.js</code> file that exports a signal and
              registers it at startup.
            </td>
          </tr>
          <tr>
            <td><code>adapter</code></td>
            <td>
              Where run state is persisted. Defaults to in-memory — see{" "}
              <strong>step 5</strong>.
            </td>
          </tr>
          <tr>
            <td><code>port</code></td>
            <td>Dashboard / API port. Defaults to <code>4400</code>.</td>
          </tr>
          <tr>
            <td><code>runner.pollIntervalMs</code></td>
            <td>
              How often the runner checks for due entries. Defaults to one
              second.
            </td>
          </tr>
        </tbody>
      </table>

      <div className="warn-box">
        <p>
          By default, Station uses an in-memory adapter. All jobs are lost on
          restart. See <strong>step 5</strong> below for production-grade persistence.
        </p>
      </div>

      <h4>Embedding: constructing a runner yourself</h4>
      <p>
        <code>SignalRunner</code> is also exported directly, for the cases
        station-kit deliberately doesn&apos;t cover: embedding Station inside a
        server process you already own, a headless worker that must not bind a
        port, or tests. Reach for it only then — you take on wiring the storage,
        subscribers, and shutdown ordering yourself.
      </p>
      <Code>{`// runner.ts — the escape hatch, not the default
import path from "node:path";
import { SignalRunner } from "station-signal";

const runner = new SignalRunner({
  signalsDir: path.join(import.meta.dirname, "signals"),
});

runner.start();`}</Code>

      <hr className="divider" />

      {/* ── 4. Trigger a signal ── */}

      <h3>4. Trigger a signal</h3>
      <Code>{`import { sendEmail } from "./signals/send-email.js";

const runId = await sendEmail.trigger({
  to: "user@example.com",
  subject: "Welcome",
  body: "Thanks for signing up.",
});

console.log(\`Enqueued run: \${runId}\`);`}</Code>

      <table className="api-table">
        <thead>
          <tr>
            <th>Behavior</th>
            <th>Detail</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>Validation</td>
            <td>
              <code>.trigger()</code> validates the input against the Zod schema
              before enqueuing. Invalid input throws immediately.
            </td>
          </tr>
          <tr>
            <td>Return value</td>
            <td>
              Returns a run ID (string) immediately. The call does not wait for
              execution.
            </td>
          </tr>
          <tr>
            <td>Execution</td>
            <td>
              The runner picks up the job on its next poll tick and spawns a
              child process to run the handler.
            </td>
          </tr>
        </tbody>
      </table>

      <div className="info-box">
        <p>
          The <code>.js</code> extension in the import path is required for ESM
          resolution, even when your source files are <code>.ts</code>.
        </p>
      </div>

      <hr className="divider" />

      {/* ── 5. Add persistence (SQLite) ── */}

      <h3>5. Add persistence (SQLite)</h3>
      <p>
        The default in-memory adapter loses all jobs on process restart. For
        anything beyond local development, use the SQLite adapter.
      </p>
      <Code>{`pnpm add station-adapter-sqlite`}</Code>
      <div className="info-box">
        <strong>pnpm 10+:</strong> better-sqlite3 requires native compilation.
        Add <code>{`{ "pnpm": { "onlyBuiltDependencies": ["better-sqlite3"] } }`}</code> to
        your <code>package.json</code> and re-run <code>pnpm install</code>.
        See <a href="/docs/adapters">Adapters</a> for details.
      </div>
      <Code>{`// station.config.ts
import { defineConfig } from "station-kit";
import { SqliteAdapter } from "station-adapter-sqlite";

export default defineConfig({
  signalsDir: "./signals",
  adapter: new SqliteAdapter({ dbPath: "./jobs.db" }),
});`}</Code>

      <table className="api-table">
        <thead>
          <tr>
            <th>Detail</th>
            <th>Description</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>Engine</td>
            <td>
              Uses better-sqlite3 under the hood with WAL mode enabled for
              concurrent reads.
            </td>
          </tr>
          <tr>
            <td>Setup</td>
            <td>
              Tables and indexes are created automatically on first run. No
              migrations needed.
            </td>
          </tr>
          <tr>
            <td>Database file</td>
            <td>
              Created at the path you provide. Use an absolute path to avoid
              ambiguity.
            </td>
          </tr>
        </tbody>
      </table>

      <h4>Shared adapter for separate processes</h4>
      <p>
        When triggers happen in a different process than the runner (common in
        web servers), both processes need access to the same adapter instance.
        Use the <code>configure()</code> function to set a global default.
      </p>
      <Code>{`// config.ts
import { configure } from "station-signal";
import { SqliteAdapter } from "station-adapter-sqlite";

configure({
  adapter: new SqliteAdapter({ dbPath: "./jobs.db" }),
});`}</Code>
      <p>
        Import the config module before any signal imports in your trigger
        process:
      </p>
      <Code>{`// In your web server or trigger process
import "./config.js"; // Run configure() first
import { sendEmail } from "./signals/send-email.js";

await sendEmail.trigger({
  to: "user@example.com",
  subject: "Order confirmation",
  body: "Your order has been placed.",
});`}</Code>

      <hr className="divider" />

      {/* ── 6. Recurring signals ── */}

      <h3>6. Recurring signals</h3>
      <p>
        Signals can run on a fixed interval. The runner handles scheduling,
        re-enqueuing, and retry logic automatically.
      </p>
      <Code>{`// signals/health-check.ts
import { signal } from "station-signal";

export const healthCheck = signal("healthCheck")
  .every("5m")
  .run(async () => {
    const res = await fetch("https://api.example.com/health");
    if (!res.ok) throw new Error(\`Health check failed: \${res.status}\`);
  });`}</Code>

      <table className="api-table">
        <thead>
          <tr>
            <th>Behavior</th>
            <th>Detail</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>Intervals</td>
            <td>
              <code>.every()</code> accepts interval
              strings: <code>{`"30s"`}</code>, <code>{`"5m"`}</code>, <code>{`"1h"`}</code>, <code>{`"1d"`}</code>.
            </td>
          </tr>
          <tr>
            <td>Scheduling</td>
            <td>
              The runner automatically schedules the first execution at startup
              and re-enqueues after each completion.
            </td>
          </tr>
          <tr>
            <td>Input</td>
            <td>
              No input schema needed for recurring signals. If your recurring
              signal requires input, chain <code>.withInput(data)</code> to
              provide a default payload.
            </td>
          </tr>
          <tr>
            <td>Failures</td>
            <td>
              If a recurring signal fails, retry rules apply. After all attempts
              are exhausted, it re-enqueues for the next interval.
            </td>
          </tr>
        </tbody>
      </table>

      <hr className="divider" />

      {/* ── 7. Multi-step signals ── */}

      <h3>7. Multi-step signals</h3>
      <p>
        For pipelines where each stage transforms data for the next, use steps
        instead of a single handler.
      </p>
      <Code>{`// signals/process-order.ts
import { signal, z } from "station-signal";

export const processOrder = signal("processOrder")
  .input(z.object({ orderId: z.string(), amount: z.number() }))
  .step("validate", async (input) => {
    if (input.amount <= 0) throw new Error("Invalid amount");
    return { ...input, validated: true };
  })
  .step("charge", async (prev) => {
    const chargeId = await payments.charge(prev.amount);
    return { orderId: prev.orderId, chargeId };
  })
  .step("notify", async (prev) => {
    await notify(\`Order \${prev.orderId} charged: \${prev.chargeId}\`);
  })
  .build();`}</Code>

      <table className="api-table">
        <thead>
          <tr>
            <th>Behavior</th>
            <th>Detail</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>Data flow</td>
            <td>
              Each <code>.step()</code> receives the return value of the
              previous step as its input. The first step receives the
              validated signal input.
            </td>
          </tr>
          <tr>
            <td>Execution</td>
            <td>
              Steps run sequentially within a single child process.
            </td>
          </tr>
          <tr>
            <td>Failure</td>
            <td>
              If any step throws, the entire run fails and retries from the
              beginning (if retries are configured).
            </td>
          </tr>
          <tr>
            <td>Finalization</td>
            <td>
              Use <code>.build()</code> instead of <code>.run()</code> when
              defining steps.
            </td>
          </tr>
        </tbody>
      </table>

      <hr className="divider" />

      {/* ── 8. Subscribers ── */}

      <h3>8. Subscribers</h3>
      <p>
        Subscribers observe the signal lifecycle. Use them for logging, metrics,
        alerting, or any side effect that should not live inside a handler.
      </p>
      <p>
        Register them in <code>station.config.ts</code>. Yours run alongside the
        subscribers Station wires for the dashboard and event stream — additive,
        never instead of them.
      </p>
      <Code>{`// station.config.ts
import { defineConfig } from "station-kit";
import { ConsoleSubscriber } from "station-signal";

export default defineConfig({
  signalsDir: "./signals",
  subscribers: {
    signal: [
      new ConsoleSubscriber(), // Built-in: logs all events to stdout
      {
        onRunStarted({ run }) {
          metrics.increment("signal.started", { name: run.signalName });
        },
        onRunCompleted({ run }) {
          metrics.increment("signal.completed", { name: run.signalName });
        },
        onRunFailed({ run, error }) {
          alerting.send(\`Signal \${run.signalName} failed: \${error}\`);
        },
      },
    ],
    // broadcast: [...] and beacon: [...] take their own subscriber shapes
  },
});`}</Code>
      <div className="info-box">
        <p>
          Station&apos;s own subscribers always run first, and the runner catches
          and logs anything a subscriber throws — so a slow or broken subscriber
          of yours can neither stall the dashboard nor fail a run.
        </p>
      </div>

      <table className="api-table">
        <thead>
          <tr>
            <th>Event</th>
            <th>Description</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td><code>onRunDispatched</code></td>
            <td>A run was picked up from the queue and dispatched for execution.</td>
          </tr>
          <tr>
            <td><code>onRunStarted</code></td>
            <td>A child process began executing the handler.</td>
          </tr>
          <tr>
            <td><code>onRunCompleted</code></td>
            <td>The handler finished successfully.</td>
          </tr>
          <tr>
            <td><code>onRunFailed</code></td>
            <td>The handler threw an error (after all retries exhausted).</td>
          </tr>
          <tr>
            <td><code>onRunRetry</code></td>
            <td>A failed run is being retried.</td>
          </tr>
          <tr>
            <td><code>onRunTimeout</code></td>
            <td>The handler exceeded its timeout and was killed.</td>
          </tr>
        </tbody>
      </table>

      <div className="info-box">
        <p>
          All subscriber methods are optional. Implement only the events you
          care about. <code>ConsoleSubscriber</code> is a built-in subscriber
          that logs every event to stdout.
        </p>
      </div>

      <hr className="divider" />

      {/* ── Next steps ── */}

      <h3>Next steps</h3>
      <table className="api-table">
        <thead>
          <tr>
            <th>Resource</th>
            <th>Description</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td><Link href="/docs/signals">Signals API</Link></td>
            <td>Full builder reference, runner options, adapter interface.</td>
          </tr>
          <tr>
            <td><Link href="/docs/broadcasts">Broadcasts</Link></td>
            <td>Chain signals into DAG workflows with fan-out and fan-in.</td>
          </tr>
          <tr>
            <td><Link href="/docs/beacons">Beacons</Link></td>
            <td>Long-running supervised processes &mdash; servers, pollers, clients.</td>
          </tr>
          <tr>
            <td><Link href="/docs/adapters">Adapters</Link></td>
            <td>SQLite adapter details and custom adapter interface.</td>
          </tr>
          <tr>
            <td><Link href="/docs/station">Station</Link></td>
            <td>Real-time monitoring dashboard for signals and broadcasts.</td>
          </tr>
          <tr>
            <td><Link href="/docs/examples">Examples</Link></td>
            <td>Complete working examples covering common patterns.</td>
          </tr>
        </tbody>
      </table>
    </>
  );
}
