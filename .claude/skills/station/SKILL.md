---
name: station
description: Build, scale, test, or operate TypeScript background work with Station. Use for station-kit configuration, signals, broadcasts, beacons, runtime schedules, Station Networks and Headquarters, fleet concurrency and placement, SQLite/PostgreSQL/MySQL/Redis adapters, the dashboard and v1 API, browser-local signals/workflows/beacons in Web Workers or service workers, environment variables, subscribers, deployment, or Station troubleshooting.
---

# Build with Station

Choose the runtime first. For browser-local execution, read [browser.md](browser.md)
and use `BrowserStation` from `station-browser` with explicit registries and
IndexedDB. It is experimental and not yet in npm release automation. Do not
create a Node server, native companion, or Station Network for browser-only work.
Do not promise continuous polling after a PWA closes.

For Node applications, use `station-kit` as the application entry point. Create a `station.config.ts`
with `defineConfig`, export definitions from the configured directories, and run
the application with `npx station`. Construct runners directly only for an
embedded/headless runtime or a focused test that cannot use `station-kit`.

The workflow and Node runner examples below apply to server and desktop work.
Browser builds follow the host setup and supported subset in [browser.md](browser.md).

## Follow this workflow

1. Inspect `package.json`, `station.config.ts`, definition directories, and the
   selected adapters before changing code.
2. Decide whether the process is `standalone`, `headquarters`, or `station`.
   Keep `standalone` for a single node. Use a network only when multiple
   processes must share work or supervise services.
3. Match every shared concern to a durable backend. In a network, share the
   signal queue and network adapter across all nodes; share beacon state when
   running beacons; share schedules across Headquarters replicas.
4. Export signals, broadcasts, and beacons from their files so auto-discovery
   can find them.
5. Validate inputs with the `z` re-export from the relevant Station package.
6. Run typecheck, package tests, and a realistic local integration test. For a
   network, start one Headquarters and at least two stations against shared
   storage and verify ownership, concurrency, placement, and shutdown.

## Apply these rules

- Import `signal` and `z` from `station-signal`; do not add a separate Zod
  dependency merely for Station schemas.
- Use `.run()` for one-handler signals. Use `.step(...).build()` for multi-step
  signals. Do not mix the two forms.
- Use `.js` in relative ESM import paths, including imports whose source file is
  TypeScript.
- Treat `.retries(n)` as `n` retries after the initial attempt.
- Treat `.trigger()` as enqueue-only. Use `runner.waitForRun(id)` when code must
  wait for a terminal result.
- Use subscribers for metrics, audit logs, alerts, and other cross-cutting
  effects. Pass them through `defineConfig({ subscribers: ... })`.
- Stop beacons, then broadcasts, then signals during a hand-built shutdown.
  `station-kit` already applies the safe order.
- Instantiate MySQL adapters with their async `.create()` factories. Other
  official adapters use constructors.
- Import broadcast, beacon, schedule, env, and network adapters from their
  package subpaths: `/broadcast`, `/beacon`, `/schedules`, `/env`, `/network`.
- Use memory adapters only for tests or a single process. They cannot coordinate
  separate processes.
- Use runtime schedules for editable interval/cron schedules. Use `.every()`
  for schedules owned by code. Provide an adapter with atomic `claimDue` in a
  multi-controller deployment.
- Treat a scheduled timestamp as the moment work becomes eligible. Polling,
  queue pressure, and capacity can delay the handler start. Station advances
  from the planned occurrence so polling delay does not accumulate as drift.
- Use beacons for supervised long-running servers, pollers, and clients. Use
  signals for bounded jobs and broadcasts for DAG orchestration.
- Keep expressions pure and JSON-serializable. Put arbitrary code in a signal.
- Never expose an unauthenticated Station on a non-loopback interface. Protect
  the v1 API with a session or scoped API key.

## Configure a standalone station

```ts
// station.config.ts
import { defineConfig } from "station-kit";
import { SqliteAdapter } from "station-adapter-sqlite";
import { BroadcastSqliteAdapter } from "station-adapter-sqlite/broadcast";
import { BeaconSqliteAdapter } from "station-adapter-sqlite/beacon";
import { ScheduleSqliteAdapter } from "station-adapter-sqlite/schedules";

const dbPath = "./station.db";

export default defineConfig({
  signalsDir: "./src/signals",
  broadcastsDir: "./src/broadcasts",
  beaconsDir: "./src/beacons",
  adapter: new SqliteAdapter({ dbPath }),
  broadcastAdapter: new BroadcastSqliteAdapter({ dbPath }),
  beaconAdapter: new BeaconSqliteAdapter({ dbPath }),
  scheduleAdapter: new ScheduleSqliteAdapter({ dbPath }),
  auth: {
    username: process.env.STATION_AUTH_USERNAME!,
    password: process.env.STATION_AUTH_PASSWORD!,
  },
});
```

Run it with:

```bash
npx station
npx station deploy
```

For pnpm 10 and SQLite, allow the native build in the consumer package:

```json
{
  "pnpm": { "onlyBuiltDependencies": ["better-sqlite3"] }
}
```

## Define signals

```ts
import { signal, z } from "station-signal";

export const render = signal("render")
  .input(z.object({ assetId: z.string() }))
  .output(z.object({ url: z.string().url() }))
  .timeout(60_000)
  .retries(2)
  .concurrency(4)
  .run(async ({ assetId }) => ({ url: await renderAsset(assetId) }));
```

For network-aware limits and placement:

```ts
export const gpuRender = signal("gpu-render")
  .input(z.object({ assetId: z.string() }))
  .concurrency({ station: 2, network: 10 })
  .placement({ labels: { gpu: "true", region: "ke" } })
  .run(async ({ assetId }) => renderOnGpu(assetId));
```

The station limit bounds one worker process. The network limit uses shared,
fenced controller leases across the fleet. Placement labels match exactly.

## Build broadcasts

```ts
import { broadcast } from "station-broadcast";
import { checkout } from "../signals/checkout.js";
import { lint } from "../signals/lint.js";
import { test } from "../signals/test.js";
import { deploy } from "../signals/deploy.js";

export const pipeline = broadcast("pipeline")
  .input(checkout)
  .then(lint, test)
  .then(deploy)
  .onFailure("fail-fast")
  .build();
```

Use runtime-editable dynamic broadcasts only when operators must change the DAG
without a deployment. They use the v1 API and pure expressions for mappings and
guards; Station snapshots the chosen definition version into each run.

## Build beacons

```ts
import { beacon, z } from "station-beacon";

export const gateway = beacon("gateway")
  .config(z.object({ port: z.number().int().positive() }))
  .placement({ labels: { region: "ke" } })
  .restart("on-failure")
  .run(async (ctx) => {
    const server = await startServer(ctx.config.port);
    ctx.expose({ protocol: "http", port: ctx.config.port, path: "/gateway" });
    ctx.ready();
    await ctx.untilStopped();
    await server.close();
  });
```

Call `ctx.ready()` only after the service is usable. Long-running handlers must
observe `ctx.signal`, use `ctx.untilStopped()`, or run another abort-aware loop.
Use `.poll(interval, fn)` instead of `.run()` for pollers; never use both.

## Scale with a Station Network

Use one logical Headquarters and one or more execution stations. Headquarters
accepts API requests, exposes fleet inventory, and reconciles schedules. It
does not claim signal work or own beacons. Stations advertise definitions and
capacity, then atomically claim eligible work from the shared queue.

```ts
// station.hq.config.ts
import { defineConfig } from "station-kit";
import { PostgresAdapter } from "station-adapter-postgres";
import { StationNetworkPostgresAdapter } from "station-adapter-postgres/network";
import { SchedulePostgresAdapter } from "station-adapter-postgres/schedules";

const connectionString = process.env.DATABASE_URL!;

export default defineConfig({
  role: "headquarters",
  signalsDir: "./src/signals",
  adapter: new PostgresAdapter({ connectionString }),
  scheduleAdapter: new SchedulePostgresAdapter({ connectionString }),
  network: {
    id: "production",
    stationId: "hq-1",
    adapter: new StationNetworkPostgresAdapter({ connectionString }),
  },
  auth: {
    username: process.env.STATION_AUTH_USERNAME!,
    password: process.env.STATION_AUTH_PASSWORD!,
  },
});
```

```ts
// station.worker.config.ts
export default defineConfig({
  role: "station",
  signalsDir: "./src/signals",
  beaconsDir: "./src/beacons",
  adapter: new PostgresAdapter({ connectionString }),
  beaconAdapter,
  network: {
    id: "production",
    stationId: process.env.STATION_ID!,
    name: process.env.STATION_NAME,
    adapter: new StationNetworkPostgresAdapter({ connectionString }),
    labels: { region: process.env.REGION!, gpu: process.env.HAS_GPU! },
    endpoint: process.env.STATION_ENDPOINT,
  },
  runner: { maxConcurrent: 12 },
});
```

Assign a stable, unique `stationId` to every process. Keep the `network.id`
identical. Advertise an `endpoint` only when Headquarters can reach it. Drain a
station before maintenance so it stops claiming new work while current work
finishes. A worker loss is recovered after its run lease expires; fencing
prevents the old process from completing the recovered attempt.

For exposed HTTP beacon services, Headquarters proxies through:

```text
/api/v1/beacons/:name/instances/:id/proxy/*
```

Require a `trigger` or `admin` scope. The owner must be online and advertise a
reachable HTTP(S) endpoint. WebSocket upgrades are not proxied; connect to the
station endpoint directly.

## Verify the result

Run the repository's own scripts first:

```bash
pnpm typecheck
pnpm build
pnpm test
```

For network changes, also exercise a real local topology with shared durable
adapters and assert:

- one atomic owner per run and per schedule occurrence;
- distribution across multiple eligible stations;
- per-station and network concurrency never exceed their declarations;
- label placement excludes ineligible stations;
- draining prevents new claims;
- expired leases recover and stale owners cannot commit terminal state;
- a scheduled run retains `scheduleId` and `scheduledFor`;
- beacon service ownership and proxy authorization are enforced;
- graceful shutdown closes producers before their dependent adapters.

Treat microbenchmarks as local diagnostics, not production capacity promises.
Measure the intended production adapter and workload before sizing a fleet.

## Read the focused references

- Read [browser.md](browser.md) first for browser-local applications: shared
  registries, Web Worker/service-worker hosts, cooperative execution, API usage,
  versioning, and required-config beacon workarounds.
- Read [api-reference.md](api-reference.md) for exact types, methods, adapters,
  v1 endpoints, and package exports. Station Networks are in §15.
- Read [examples.md](examples.md) for complete applications and deployment
  patterns. The multi-process Headquarters/worker example is §26.
- Prefer the relevant section rather than loading either reference wholesale.
