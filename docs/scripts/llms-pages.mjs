export const site = {
  name: "Station",
  origin: "https://station.dterminal.net",
  summary:
    "Type-safe background jobs, recurring schedules, distributed Station Networks, long-running beacons, DAG workflows, and experimental browser execution for TypeScript.",
};

export const pageGroups = [
  {
    heading: "Start here",
    pages: [
      { route: "/docs/getting-started", title: "Getting started", description: "Install Station, define and run a signal, add persistence, and prepare a production configuration." },
      { route: "/docs/browser", title: "Browser runtime (experimental)", description: "Build signals, DAGs, and beacons in Web Workers or service workers with IndexedDB, explicit wake handling, recovery, and browser execution limits. Includes the required-config beacon workaround." },
      { route: "/docs/dashboard", title: "Dashboard guide", description: "Operate the StationKit dashboard, inspect runs, and understand Headquarters fleet views." },
      { route: "/docs/network", title: "Station Networks", description: "Scale execution across Headquarters and worker stations with placement, capacity, leases, and draining." },
      { route: "/docs/agent-skill", title: "Agent skill", description: "Install and use the Station coding-agent skill and its bundled API references." },
    ],
  },
  {
    heading: "Guides and operations",
    pages: [
      { route: "/docs/remote-triggers", title: "Remote triggers", description: "Trigger Station signals from another service through the authenticated HTTP API." },
      { route: "/docs/dynamic-broadcasts", title: "Dynamic broadcasts", description: "Create runtime-defined DAG workflows with expressions, validation, and versioned definitions." },
      { route: "/docs/schedules", title: "Schedules", description: "Configure interval and cron schedules with timezones, overlap policy, and misfire handling." },
      { route: "/docs/environment", title: "Environment variables", description: "Manage global and target-scoped runtime variables without exposing secret values." },
      { route: "/docs/tauri-desktop", title: "Tauri desktop", description: "Bundle Station as a local Tauri sidecar with provisioned authentication." },
    ],
  },
  {
    heading: "API reference",
    pages: [
      { route: "/docs/signals", title: "Signals", description: "Signal builder, runner, queue adapter, lifecycle, concurrency, placement, and trigger APIs." },
      { route: "/docs/broadcasts", title: "Broadcasts", description: "Static and dynamic DAG workflows, execution policies, adapters, and subscribers." },
      { route: "/docs/beacons", title: "Beacons", description: "Supervised long-running processes, instances, restart policies, health, and service proxying." },
      { route: "/docs/expressions", title: "Expressions", description: "Deterministic expression AST, parser, evaluator, validation, and workflow references." },
      { route: "/docs/adapters", title: "Adapters", description: "Memory, SQLite, PostgreSQL, MySQL, and Redis persistence and coordination adapters." },
      { route: "/docs/station", title: "StationKit", description: "Configuration, CLI, dashboard, authentication, REST API, runners, and deployment." },
    ],
  },
  {
    heading: "Examples",
    pages: [
      { route: "/docs/examples", title: "Examples overview", description: "Index of complete examples arranged from first signal to distributed fleets." },
      { route: "/docs/examples/browser", title: "Browser lab", description: "Run the local browser prototype, interrupt and recover work, exercise all three primitives, and run real-browser checks." },
      { route: "/docs/examples/basic", title: "Basic signal", description: "Minimal signal definition and trigger." },
      { route: "/docs/examples/with-output", title: "Typed output", description: "Declare and consume validated signal output." },
      { route: "/docs/examples/with-steps", title: "Signal steps", description: "Checkpoint multi-step work and inspect step progress." },
      { route: "/docs/examples/recurring", title: "Recurring signal", description: "Run a signal on a simple recurring interval." },
      { route: "/docs/examples/with-retries", title: "Retries", description: "Retry failed work with bounded attempts and backoff." },
      { route: "/docs/examples/with-sqlite", title: "SQLite persistence", description: "Persist signal state locally with the SQLite adapter." },
      { route: "/docs/examples/broadcast", title: "Broadcast workflow", description: "Compose signals into a typed DAG workflow." },
      { route: "/docs/examples/etl-pipeline", title: "ETL pipeline", description: "Extract, transform, and load data as a multi-stage broadcast." },
      { route: "/docs/examples/ci-pipeline", title: "CI pipeline", description: "Model build, test, and deployment stages with workflow dependencies." },
      { route: "/docs/examples/fleet-monitor", title: "Fleet monitor", description: "Supervise a long-running process with beacon health and restart behavior." },
      { route: "/docs/examples/beacon", title: "Beacon service", description: "Define, configure, start, and stop a supervised beacon instance." },
      { route: "/docs/examples/station-network", title: "Station Network", description: "Run a Headquarters and two workers against shared SQLite coordination." },
    ],
  },
];

export const pages = pageGroups.flatMap((group) => group.pages);
