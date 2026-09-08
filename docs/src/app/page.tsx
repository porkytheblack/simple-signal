import Link from "next/link";
import Image from "next/image";
import { Code } from "./components/Code";
import { TowerIllustration } from "./components/TowerIcon";

function CronIcon() {
  return (
    <svg className="feature-icon" viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg">
      <rect x="4" y="14" width="24" height="4" stroke="currentColor" strokeWidth="1.5" />
      <path d="M4 16L16 6L28 16" stroke="currentColor" strokeWidth="1.5" />
      <line x1="16" y1="18" x2="16" y2="28" stroke="currentColor" strokeWidth="1.5" />
      <line x1="4" y1="28" x2="28" y2="28" stroke="currentColor" strokeWidth="1.5" />
    </svg>
  );
}

function HistoryIcon() {
  return (
    <svg className="feature-icon" viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg">
      <circle cx="16" cy="16" r="11" stroke="currentColor" strokeWidth="1.5" />
      <path d="M16 8V16L21 21" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      <circle cx="16" cy="16" r="2" fill="currentColor" />
    </svg>
  );
}

function RetryIcon() {
  return (
    <svg className="feature-icon" viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path d="M8 24L8 8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      <path d="M16 24L16 14" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      <path d="M24 24L24 18" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      <path d="M5 24H27" stroke="currentColor" strokeWidth="1.5" />
      <path d="M8 8C8 8 10 4 13 8C16 12 18 6 20 6C22 6 22 10 24 10" stroke="currentColor" strokeWidth="1.2" opacity="0.5" />
    </svg>
  );
}

function TypeSafeIcon() {
  return (
    <svg className="feature-icon" viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path d="M6 10C6 8 8 6 10 6H22C24 6 26 8 26 10V22C26 24 24 26 22 26H10C8 26 6 24 6 22V10Z" stroke="currentColor" strokeWidth="1.5" />
      <path d="M12 16L15 19L20 13" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function ConcurrencyIcon() {
  return (
    <svg className="feature-icon" viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path d="M16 4L28 10V22L16 28L4 22V10L16 4Z" stroke="currentColor" strokeWidth="1.5" />
      <path d="M16 4L16 28" stroke="currentColor" strokeWidth="1" opacity="0.4" />
      <path d="M4 10L28 10" stroke="currentColor" strokeWidth="1" opacity="0.4" />
      <path d="M4 22L28 22" stroke="currentColor" strokeWidth="1" opacity="0.4" />
    </svg>
  );
}

function DagIcon() {
  return (
    <svg className="feature-icon" viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg">
      <circle cx="10" cy="10" r="4" stroke="currentColor" strokeWidth="1.5" />
      <circle cx="22" cy="22" r="4" stroke="currentColor" strokeWidth="1.5" />
      <path d="M14 10H18C20 10 22 12 22 14V18" stroke="currentColor" strokeWidth="1.5" />
    </svg>
  );
}

function BeaconIcon() {
  return (
    <svg className="feature-icon" viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg">
      <circle cx="16" cy="7" r="2.5" stroke="currentColor" strokeWidth="1.5" />
      <path d="M16 9.5V26" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      <path d="M11 26L16 20L21 26" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
      <path d="M9 7C7.5 8 7 9.5 7 11" stroke="currentColor" strokeWidth="1.2" opacity="0.5" strokeLinecap="round" />
      <path d="M23 7C24.5 8 25 9.5 25 11" stroke="currentColor" strokeWidth="1.2" opacity="0.5" strokeLinecap="round" />
    </svg>
  );
}

function NetworkIcon() {
  return (
    <svg className="feature-icon" viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg">
      <circle cx="7" cy="16" r="3.5" stroke="currentColor" strokeWidth="1.5" />
      <circle cx="25" cy="8" r="3.5" stroke="currentColor" strokeWidth="1.5" />
      <circle cx="25" cy="24" r="3.5" stroke="currentColor" strokeWidth="1.5" />
      <path d="M10.5 16H16M16 16V8H21.5M16 16V24H21.5" stroke="currentColor" strokeWidth="1.5" />
    </svg>
  );
}

function GridIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
      <rect x="0" y="0" width="5" height="5" fill="currentColor" opacity="0.6" />
      <rect x="7" y="0" width="5" height="5" fill="currentColor" />
      <rect x="0" y="7" width="5" height="5" fill="currentColor" />
      <rect x="7" y="7" width="5" height="5" fill="currentColor" opacity="0.6" />
    </svg>
  );
}

function HeartIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path d="M8 14S1.5 9.5 1.5 5.5C1.5 3 3.5 1.5 5.5 1.5C6.8 1.5 7.6 2.2 8 2.8C8.4 2.2 9.2 1.5 10.5 1.5C12.5 1.5 14.5 3 14.5 5.5C14.5 9.5 8 14 8 14Z" stroke="currentColor" strokeWidth="1" />
    </svg>
  );
}

const features = [
  {
    icon: CronIcon,
    name: "Scheduling & triggers",
    desc: "Intervals plus five-field cron in an IANA timezone. Preview future occurrences, trigger on demand, and claim each fleet occurrence exactly once.",
  },
  {
    icon: HistoryIcon,
    name: "Run history",
    desc: "Every execution recorded with input, output, errors, timing, and attempt count. Query through the adapter or browse with Station's monitoring dashboard.",
  },
  {
    icon: RetryIcon,
    name: "Automatic retries",
    desc: "Per-signal retry count with exponential backoff. .retries(3) gives 4 total attempts. Failed jobs re-enqueue automatically without intervention.",
  },
  {
    icon: TypeSafeIcon,
    name: "Type-safe inputs",
    desc: "Zod schemas validate every trigger payload before it enters the queue. TypeScript infers handler argument types from the schema. Invalid data never reaches your handler.",
  },
  {
    icon: ConcurrencyIcon,
    name: "Concurrency limits",
    desc: "Bound a signal per Station and across the whole network. Add placement labels so GPU, regional, or specialized work only reaches eligible workers.",
  },
  {
    icon: DagIcon,
    name: "Workflow DAGs",
    desc: "Chain signals into directed acyclic graphs with broadcasts. Fan-out to parallel nodes, fan-in with data aggregation, conditional execution via guard functions.",
  },
  {
    icon: BeaconIcon,
    name: "Long-running beacons",
    desc: "Supervise long-lived processes — servers, pollers, and clients — with restart policies, exponential backoff, heartbeat stall detection, and graceful shutdown.",
  },
  {
    icon: NetworkIcon,
    name: "Station Networks",
    desc: "Put Headquarters in front of a fleet. Route stateless work, drain workers, deduplicate schedules, supervise beacons, and inspect everything from one dashboard.",
  },
];

export default function LandingPage() {
  return (
    <main>
      {/* ── Hero ── */}
      <section className="landing-hero">
        <div className="landing-hero-left">
          <div className="landing-hero-tag">For your AI agents, emails, payments, and more</div>
          <h1 className="landing-hero-title">
            A simple background<br className="desktop-break" />{" "}
            jobs framework.
          </h1>
          <p className="landing-hero-sub">
            Start as one TypeScript process with SQLite. Grow into a Station
            Network backed by PostgreSQL, MySQL, or Redis when you need more
            capacity. Retries, cron scheduling, workflows, long-running services,
            and a fleet dashboard are included. For work on the device, explore
            the <Link href="/docs/browser">experimental browser runtime</Link>
            {" "}with local signals, workflows, and beacons.
          </p>
          <div className="landing-hero-cta">
            <Link href="/docs/getting-started" className="btn-primary">
              <GridIcon />
              Get started
            </Link>
            <Link href="/docs/signals" className="btn-secondary">
              API reference &rarr;
            </Link>
          </div>
        </div>

        <div className="landing-hero-right">
          <div className="hatch-bg" style={{ position: "absolute", inset: 0 }} />
          <div className="landing-tower-container">
            <TowerIllustration />
          </div>
        </div>
      </section>

      {/* ── Love Letter ── */}
      <section className="landing-letter">
        <div className="letter-inner">
          <div className="letter-heading">
            <span className="section-number">// 00</span>
            <h2 className="section-heading">
              A love letter to<br className="desktop-break" /> everything you automate.
            </h2>
          </div>

          <div className="letter-uses">
            <div className="letter-use">
              <HeartIcon className="letter-heart" />
              <span className="letter-use-label">Your AI agents</span>
              <span className="letter-use-desc">that run on a schedule, retry on failure, and report back when they&apos;re done.</span>
            </div>
            <div className="letter-use">
              <HeartIcon className="letter-heart" />
              <span className="letter-use-label">Your emails</span>
              <span className="letter-use-desc">that go out in the background without blocking your request handler.</span>
            </div>
            <div className="letter-use">
              <HeartIcon className="letter-heart" />
              <span className="letter-use-label">Your payments</span>
              <span className="letter-use-desc">that process reliably with retries, even when a provider hiccups.</span>
            </div>
            <div className="letter-use">
              <HeartIcon className="letter-heart" />
              <span className="letter-use-label">Your reports</span>
              <span className="letter-use-desc">that generate overnight and land in an inbox by morning.</span>
            </div>
            <div className="letter-use">
              <HeartIcon className="letter-heart" />
              <span className="letter-use-label">Your webhooks</span>
              <span className="letter-use-desc">that fan out to downstream services without you babysitting the queue.</span>
            </div>
          </div>

          <div className="letter-pillars">
            <div className="letter-pillar">
              <span className="letter-pillar-num">01</span>
              <span className="letter-pillar-label">Simple code</span>
              <span className="letter-pillar-desc">Define a signal in TypeScript. Schema in, handler out. That&apos;s it.</span>
            </div>
            <div className="letter-pillar">
              <span className="letter-pillar-num">02</span>
              <span className="letter-pillar-label">Simple deployment</span>
              <span className="letter-pillar-desc">SQLite when one process is enough. Shared adapters and execution stations when it is not.</span>
            </div>
            <div className="letter-pillar">
              <span className="letter-pillar-num">03</span>
              <span className="letter-pillar-label">Simple monitoring</span>
              <span className="letter-pillar-desc">Every run recorded. Station dashboard included. One command to start.</span>
            </div>
          </div>
        </div>
      </section>

      <div className="field-divider" />

      {/* ── Features ── */}
      <section className="landing-features">
        <div className="section-header">
          <div>
            <span className="section-number">// 01</span>
            <h2 className="section-heading">
              What you get.
            </h2>
          </div>
          <p className="section-desc">
            Everything you need for production background jobs. Nothing you don&apos;t.
          </p>
        </div>

        <div className="features-grid">
          {features.map((f) => (
            <div key={f.name} className="feature-card">
              <f.icon />
              <h3 className="feature-name">{f.name}</h3>
              <p className="feature-desc">{f.desc}</p>
            </div>
          ))}
        </div>
      </section>

      <div className="field-divider" />

      {/* ── Code section ── */}
      <section className="landing-code-section">
        <div className="landing-code-inner">
          <div className="landing-code-copy">
            <span className="section-number">// 02</span>
            <h2 className="section-heading">
              Define it in TypeScript.<br className="desktop-break" /><em>Run it anywhere.</em>
            </h2>
            <p>
              A signal is a background job definition &mdash; input schema, handler
              function, execution constraints. Define them in your codebase. The
              runner auto-discovers signal files, handles scheduling, retries,
              timeouts, and concurrency. StationKit adds configuration only when
              you want the dashboard or a multi-process network.
            </p>
            <Link href="/docs/getting-started" className="btn-primary">
              View documentation &rarr;
            </Link>
          </div>

          <div className="landing-code-block">
            <div className="landing-code-block-tab">love-letter.ts</div>
            <pre>
              <Code bare>{`import { signal, z } from "station-signal"

export const loveLetter = signal("loveLetter")
  .input(z.object({ to: z.string() }))
  .every("1d")
  .retries(2)

  // Step 1: compose the letter
  .step("compose", async (input) => {
    const letter = await ai.generate(
      "To all the jobs I love..."
    )
    return { to: input.to, letter }
  })

  // Step 2: send it
  .step("send", async (prev) => {
    await mailer.send({ to: prev.to, body: prev.letter })
    return prev
  })

  // Step 3: tip a dollar
  .step("tip", async (prev) => {
    await wallet.send(prev.to, 1.00)
  })

  .build()`}</Code>
            </pre>
          </div>
        </div>
      </section>

      <div className="field-divider" />

      {/* ── Network section ── */}
      <section className="landing-network">
        <div className="landing-network-copy">
          <span className="section-number">// 03</span>
          <h2 className="section-heading">One Station when you&apos;re small.<br className="desktop-break" /> A whole network when you&apos;re not.</h2>
          <p>
            Headquarters gives clients one API while execution stations advertise
            capacity, labels, and definitions. Atomic claims choose one owner for
            every run and schedule occurrence; leases recover work when a worker
            disappears. Drain nodes and watch the entire fleet from the dashboard.
          </p>
          <div className="landing-network-actions">
            <Link href="/docs/network" className="btn-primary">Read the network guide &rarr;</Link>
            <Link href="/docs/examples/station-network" className="btn-secondary">Run the local fleet</Link>
          </div>
        </div>
        <div className="landing-network-visual">
          <img src="/screenshots/station-network.png" alt="Station Network dashboard with Headquarters and two execution stations" />
          <div className="landing-network-caption">LIVE FLEET INVENTORY · CAPACITY · DRAINING · HEARTBEATS</div>
        </div>
      </section>

      {/* ── Landscape / comparison section ── */}
      <section className="landing-landscape">
        <div className="section-header">
          <div>
            <span className="section-number">// 04</span>
            <h2 className="section-heading">
              Why another<br className="desktop-break" /> background jobs library?
            </h2>
          </div>
          <p className="section-desc">
            Existing solutions work. They also come with trade-offs Station doesn&apos;t.
          </p>
        </div>

        <div className="landscape-grid">
          <div className="landscape-cell">
            <div className="landscape-label">Self-hosted queues</div>
            <div className="landscape-title">Bull, BullMQ, Agenda</div>
            <ul className="landscape-items">
              <li>Requires Redis or MongoDB</li>
              <li>Docker and ops overhead</li>
              <li>Complex configuration</li>
              <li>Full control over execution</li>
            </ul>
          </div>

          <div className="landscape-cell">
            <div className="landscape-label">Managed services</div>
            <div className="landscape-title">Trigger.dev, Inngest</div>
            <ul className="landscape-items">
              <li>Hosted infrastructure</li>
              <li>Additional cloud bill</li>
              <li>Data on third-party servers</li>
              <li>Vendor-specific APIs</li>
            </ul>
          </div>

          <div className="landscape-cell landscape-cell-signal">
            <div className="landscape-label">This library</div>
            <div className="landscape-title">Station</div>
            <ul className="landscape-items landscape-items-signal">
              <li>SQLite by default; shared adapters when you scale</li>
              <li>One process or a fleet of execution stations</li>
              <li>Runs on your servers with no hosted control plane</li>
              <li>One API and dashboard across the network</li>
              <li>Full TypeScript with Zod validation</li>
              <li>Same reliability: retries, timeouts, concurrency</li>
            </ul>
          </div>
        </div>
      </section>

      <div className="field-divider" />

      {/* ── CTA section ── */}
      <section className="landing-cta">
        <span className="section-number">// Get started</span>
        <h2 className="section-heading">Five minutes to your first signal.</h2>
        <p>
          Install the runtime and StationKit, define a signal, then start Station.
          SQLite is enough for the first process.
        </p>
        <div className="landing-cta-install">
          <code>pnpm add station-signal station-kit</code>
        </div>
        <Link href="/docs/getting-started" className="btn-primary">
          Read the guide
        </Link>
      </section>

      {/* ── Footer ── */}
      <footer className="landing-footer">
        <div className="landing-footer-logo">Station</div>
        <div className="landing-footer-meta">
          <div className="landing-footer-copy">
            Open source background jobs for Node.js
          </div>
          <div className="landing-footer-credit">
            <span>A product by</span>
            <Image
              className="landing-footer-cradle-mark"
              src="/cradle-research.svg"
              width={28}
              height={28}
              alt=""
              aria-hidden="true"
            />
            <span className="landing-footer-cradle-name">Cradle Research</span>
          </div>
        </div>
      </footer>
    </main>
  );
}
