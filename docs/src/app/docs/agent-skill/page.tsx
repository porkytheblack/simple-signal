import { Metadata } from "next";
import { Code } from "../../components/Code";

export const metadata: Metadata = {
  title: "Agent Skill — Station",
};

export default function AgentSkillPage() {
  return (
    <>
      <div className="eyebrow">Guide</div>
      <h2 style={{ marginTop: 0 }}>Agent skill</h2>
      <p>
        Station ships with a Claude Code skill that teaches the AI assistant how
        to build with every Station package. Once installed, Claude knows how to
        create signals, broadcasts, beacons, schedules, Station Networks,
        adapters, subscribers, browser workers, and dashboard configs without you having to
        explain the API.
      </p>

      <hr className="divider" />

      {/* ── What is a skill ── */}

      <h3>What is a skill?</h3>
      <p>
        A Claude Code skill is a set of markdown files that get injected into
        Claude&rsquo;s context when relevant. Skills contain API references,
        code patterns, and rules that guide the assistant&rsquo;s output. The
        Station skill covers the framework packages, official adapters,
        Station Networks, and the REST API.
      </p>

      <hr className="divider" />

      {/* ── Install ── */}

      <h3>Install</h3>
      <Code>{`npx skills add porkytheblack/station`}</Code>

      <p>
        The skill directory includes these focused references:
      </p>
      <table className="api-table">
        <thead>
          <tr>
            <th>File</th>
            <th>Description</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td><code>browser.md</code></td>
            <td>BrowserStation setup, worker and service-worker hosting, API usage, supported definitions, recovery, and known limits. Read this first for browser-local work.</td>
          </tr>
          <tr>
            <td><code>SKILL.md</code></td>
            <td>
              Main skill file. Contains critical rules, code patterns, builder
              workflows, network operations, and verification guidance. This
              concise file is what Claude reads first.
            </td>
          </tr>
          <tr>
            <td><code>api-reference.md</code></td>
            <td>
              Exhaustive package and v1 REST API reference, including signals,
              broadcasts, beacons, schedules, environment variables, expressions,
              Station Networks, adapters, station-kit, and station-tauri.
            </td>
          </tr>
          <tr>
            <td><code>examples.md</code></td>
            <td>
              Node examples and a linked browser walkthrough covering signals, pipelines, beacons,
              runtime schedules, environment variables, all four adapter
              backends, deployment, and a Headquarters/worker topology.
            </td>
          </tr>
        </tbody>
      </table>

      <hr className="divider" />

      {/* ── Usage ── */}

      <h3>Usage</h3>
      <p>
        Once installed, the skill activates automatically when you ask Claude
        about Station topics. You can also invoke it explicitly:
      </p>
      <Code>{`/station`}</Code>
      <p>
        Example prompts that trigger the skill:
      </p>
      <ul>
        <li>&ldquo;Create a signal that sends welcome emails with retry&rdquo;</li>
        <li>&ldquo;Set up a broadcast DAG for my CI pipeline&rdquo;</li>
        <li>&ldquo;Run a local workflow and a polling beacon in browser workers&rdquo;</li>
        <li>&ldquo;Configure PostgreSQL adapters for signals and broadcasts&rdquo;</li>
        <li>&ldquo;Scale this across a Headquarters and three GPU stations&rdquo;</li>
        <li>&ldquo;Add a runner with SQLite persistence and graceful shutdown&rdquo;</li>
        <li>&ldquo;Write a subscriber that posts failures to Slack&rdquo;</li>
      </ul>

      <hr className="divider" />

      {/* ── What the skill knows ── */}

      <h3>What the skill knows</h3>
      <table className="api-table">
        <thead>
          <tr>
            <th>Topic</th>
            <th>Coverage</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>Browser runtime</td>
            <td>Explicit registries, IndexedDB queues and checkpoints, worker drains, bounded service-worker wake slices, cooperative beacons, and configuration workarounds. See the <a href="/docs/browser">browser guide</a>.</td>
          </tr>
          <tr>
            <td>Signals</td>
            <td>
              Builder chain (<code>.input()</code>, <code>.output()</code>,{" "}
              <code>.timeout()</code>, <code>.retries()</code>,{" "}
              <code>.concurrency()</code>, <code>.placement()</code>,{" "}
              <code>.every()</code>, <code>.onComplete()</code>,{" "}
              <code>.run()</code>), multi-step pipelines (<code>.step()</code> +{" "}
              <code>.build()</code>), triggering, validation
            </td>
          </tr>
          <tr>
            <td>Broadcasts</td>
            <td>
              DAG builder (<code>.node()</code>, <code>.then()</code>),
              conditional nodes (<code>when</code>), failure policies, input/output
              mapping, fan-out and fan-in patterns
            </td>
          </tr>
          <tr>
            <td>Adapters</td>
            <td>
              SQLite, PostgreSQL, MySQL, and Redis for signals, broadcasts,
              beacons, schedules, environment variables, and network state.
              Constructor patterns, connection options, and subpath imports
            </td>
          </tr>
          <tr>
            <td>Station Networks</td>
            <td>
              Headquarters and station roles, shared storage, atomic run claims,
              fencing and recovery, per-station/fleet concurrency, placement,
              draining, inventory, and beacon HTTP proxying
            </td>
          </tr>
          <tr>
            <td>Schedules</td>
            <td>
              Editable interval and timezone-aware cron schedules, overlap and
              misfire policies, atomic occurrence claims, and timing semantics
            </td>
          </tr>
          <tr>
            <td>Beacons</td>
            <td>
              Supervised servers, pollers, and clients; restart policies,
              instances, placement, exposure, and graceful shutdown
            </td>
          </tr>
          <tr>
            <td>Runners</td>
            <td>
              <code>SignalRunner</code>, <code>BroadcastRunner</code>, and
              <code>BeaconRunner</code> setup,
              auto-discovery, manual registration, graceful shutdown, poll
              intervals
            </td>
          </tr>
          <tr>
            <td>Subscribers</td>
            <td>
              Lifecycle events for signal, broadcast, and beacon runners.
              Custom subscriber patterns for logging, metrics, and alerting
            </td>
          </tr>
          <tr>
            <td>Remote triggers</td>
            <td>
              <code>configure({"{ endpoint, apiKey }"})</code>,{" "}
              <code>HttpTriggerAdapter</code>, environment variables,
              Station REST API endpoints
            </td>
          </tr>
          <tr>
            <td>Dashboard</td>
            <td>
              <code>station.config.ts</code> options, CLI usage, auth
              configuration
            </td>
          </tr>
        </tbody>
      </table>

      <hr className="divider" />

      {/* ── Updating ── */}

      <h3>Documentation for other agents</h3>
      <p>
        Use <a href="/llms.txt">llms.txt</a> to find focused Markdown pages,
        including <a href="/docs/browser.md">the browser guide</a> and
        {" "}<a href="/docs/examples/browser.md">the lab walkthrough</a>.
        <a href="/llms-full.txt"> The full reference</a> includes all generated
        documentation. These files are rebuilt from the site pages.
      </p>

      <h3>Updating</h3>
      <p>
        Re-run the install command to pull the latest version:
      </p>
      <Code>{`npx skills add porkytheblack/station`}</Code>
    </>
  );
}
