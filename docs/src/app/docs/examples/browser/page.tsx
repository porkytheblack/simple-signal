import Link from "next/link";
import { Code } from "../../../components/Code";

export const metadata = { title: "Browser lab example — Station" };

export default function BrowserExamplePage() {
  return (
    <>
      <div className="eyebrow">Example</div>
      <h2 style={{ marginTop: 0 }}>Browser lab</h2>
      <p>
        <code>examples/17-browser</code> runs all three Station primitives locally
        in Web Workers and service workers. The static file server does not run
        the jobs. Start here before adapting the <Link href="/docs/browser">browser runtime guide</Link>
        {" "}to your own application.
      </p>
      <Code>{`pnpm install
pnpm dev:browser
# Open http://127.0.0.1:4317`}</Code>
      <h3>Exercise the execution contract</h3>
      <ol>
        <li>Queue a local report in Web Worker mode. After a step is saved, interrupt the worker and resume. Its seven-second lease must expire before a new attempt reuses the saved steps.</li>
        <li>Try a temporary failure and reload the page. Observe persisted checkpoints and the attempt count.</li>
        <li>Run text analysis: word and character counts fan out, join into a report, and conditionally highlight longer text. Simulate a branch failure to see dependent nodes skipped.</li>
        <li>Start pulse and recovering client. Inspect heartbeat, incarnation, desired state, and logs. The recovering client deliberately fails on its first incarnation.</li>
        <li>Switch to service-worker mode. Signals and DAGs run on wakes; beacons run bounded slices and suspend between them. Stop a beacon and reload to verify it stays stopped.</li>
        <li>After the offline shell is cached, stop the static server and reload. Local demo work can execute offline; application handlers that fetch remote data still need connectivity.</li>
      </ol>
      <h3>Run browser checks</h3>
      <p>
        Stop manually started demo beacons, then use the Run browser checks link
        to navigate to <code>/tests.html</code>. Close other demo tabs so their
        executors do not claim integration-test work. Checks use real IndexedDB,
        worker termination, service-worker execution, ownership fencing, DAG
        recovery, and beacon lifecycle behavior. The suite is not part of
        {" "}<code>pnpm test</code> or CI and does not certify all browsers or
        execution after browser exit.
      </p>
      <h3>Files to adapt</h3>
      <table className="api-table">
        <thead><tr><th>File</th><th>Purpose</th></tr></thead>
        <tbody>
          <tr><td>src/signals.ts, src/workloads.ts</td><td>Shared definitions and registry.</td></tr>
          <tr><td>src/worker.ts</td><td>Independent job drains and beacon ticks.</td></tr>
          <tr><td>src/sw.ts</td><td>Bounded wake handling, optional Background Sync, and demo-only shell caching.</td></tr>
          <tr><td>src/app.ts</td><td>Enqueueing, mode controls, and persisted activity views.</td></tr>
          <tr><td>build.mjs, serve.mjs</td><td>Browser bundles and a localhost static server. No hot reload; rebuild after source changes.</td></tr>
        </tbody>
      </table>
      <p>
        <a href="https://github.com/porkytheblack/station/tree/main/examples/17-browser">Browse the source</a>.
        The lab is experimental: it promises recoverable local state, not
        continuous polling after a PWA closes. Read the guide&apos;s configuration
        workaround and storage/versioning limits before using custom definitions.
      </p>
    </>
  );
}
