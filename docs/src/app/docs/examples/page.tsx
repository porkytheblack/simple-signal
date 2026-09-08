import { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Examples — Station",
};

const examples = [
  {
    href: "/docs/examples/browser",
    title: "Browser lab — Experimental",
    desc: "Run signals, DAGs, and beacons on the device with IndexedDB recovery and worker execution.",
    tags: ["browser", "workers", "IndexedDB"],
  },
  {
    href: "/docs/examples/basic",
    title: "01 — Basic",
    desc: "The simplest signal. Define it, trigger it, done.",
    tags: ["signal", "trigger"],
  },
  {
    href: "/docs/examples/with-output",
    title: "02 — With Output",
    desc: "Signals that return typed values and react to completion.",
    tags: ["signal", "output", "onComplete"],
  },
  {
    href: "/docs/examples/with-steps",
    title: "03 — With Steps",
    desc: "Multi-step signals where each step's output pipes to the next.",
    tags: ["signal", "steps", "subscriber"],
  },
  {
    href: "/docs/examples/recurring",
    title: "04 — Recurring",
    desc: "Signals that fire on a schedule without manual triggers.",
    tags: ["signal", "recurring"],
  },
  {
    href: "/docs/examples/with-retries",
    title: "05 — With Retries",
    desc: "Automatic retry behavior for flaky operations.",
    tags: ["signal", "retries", "timeout"],
  },
  {
    href: "/docs/examples/with-sqlite",
    title: "06 — With SQLite",
    desc: "Persistent storage with separate trigger and runner processes.",
    tags: ["signal", "sqlite", "configure"],
  },
  {
    href: "/docs/examples/broadcast",
    title: "07 — Broadcast",
    desc: "DAG workflow orchestration with fan-out and conditional execution.",
    tags: ["broadcast", "fan-out", "when"],
  },
  {
    href: "/docs/examples/etl-pipeline",
    title: "08 — ETL Pipeline",
    desc: "Extract-transform-load with multi-step signals in a linear broadcast.",
    tags: ["broadcast", "steps", "retries"],
  },
  {
    href: "/docs/examples/ci-pipeline",
    title: "09 — CI Pipeline",
    desc: "Fan-out, branch guards, result fallback. The most complex DAG.",
    tags: ["broadcast", "fan-out", "guard", "sqlite"],
  },
  {
    href: "/docs/examples/fleet-monitor",
    title: "10 — Fleet Monitor",
    desc: "Six parallel health checks converging into an aggregate report.",
    tags: ["broadcast", "recurring", "continue", "sqlite"],
  },
  {
    href: "/docs/examples/beacon",
    title: "11 — Beacon",
    desc: "A supervised server, poller, and reconnecting client with restart + backoff.",
    tags: ["beacon", "server", "poll", "backoff"],
  },
  {
    href: "/docs/examples/station-network",
    title: "12 — Station Network",
    desc: "One Headquarters and two workers with fleet limits, placement, schedules, and draining.",
    tags: ["network", "headquarters", "scaling", "sqlite"],
  },
];

export default function ExamplesPage() {
  return (
    <>
      <div className="eyebrow">Showcase</div>
      <h2 style={{ marginTop: 0 }}>Examples</h2>
      <p>
        Guided examples from local browser workers and a single Node signal to a
        multi-process Station Network. Each links concepts to working source in the repository.
      </p>

      <div className="examples-grid">
        {examples.map((ex) => (
          <Link key={ex.href} href={ex.href} className="example-card">
            <div className="example-card-title">{ex.title}</div>
            <div className="example-card-desc">{ex.desc}</div>
            <div className="example-card-tags">
              {ex.tags.map((tag) => (
                <span key={tag} className="example-tag">{tag}</span>
              ))}
            </div>
          </Link>
        ))}
      </div>
    </>
  );
}
