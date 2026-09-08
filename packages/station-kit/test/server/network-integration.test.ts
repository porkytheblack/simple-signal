import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { SqliteAdapter } from "station-adapter-sqlite";
import { StationNetworkSqliteAdapter } from "station-adapter-sqlite/network";
import { ScheduleSqliteAdapter } from "station-adapter-sqlite/schedules";
import type { Run, SignalSubscriber } from "station-signal";
import { resolveConfig } from "../../src/config/schema.js";
import { createStation, type StationInstance } from "../../src/server/index.js";

const signalsDir = fileURLToPath(new URL("./fixtures/signals", import.meta.url));
process.env.__STATION_TSX ??= fileURLToPath(import.meta.resolve("tsx"));

async function waitFor<T>(read: () => Promise<T | undefined>, label: string, timeoutMs = 30_000): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const value = await read();
    if (value !== undefined) return value;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error(`Timed out waiting for ${label}`);
}

async function getFreePort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  const port = address.port;
  await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  return port;
}

test("Headquarters and two stations route, bound, and place real signal processes", async (t) => {
  const dir = mkdtempSync(join(tmpdir(), "station-network-e2e-"));
  const queuePath = join(dir, "queue.db");
  const networkPath = join(dir, "network.db");
  const schedulePath = join(dir, "schedules.db");
  const hqPort = await getFreePort();
  const hqQueue = new SqliteAdapter({ dbPath: queuePath });
  const stationAQueue = new SqliteAdapter({ dbPath: queuePath });
  const stationBQueue = new SqliteAdapter({ dbPath: queuePath });
  const hqNetwork = new StationNetworkSqliteAdapter({ dbPath: networkPath });
  const stationANetwork = new StationNetworkSqliteAdapter({ dbPath: networkPath });
  const stationBNetwork = new StationNetworkSqliteAdapter({ dbPath: networkPath });
  const scheduleAdapter = new ScheduleSqliteAdapter({ dbPath: schedulePath });

  let active = 0;
  let maxActive = 0;
  const activeByStation = new Map<string, number>();
  const maxByStation = new Map<string, number>();
  const terminal = new Set<string>();
  const subscriber = (stationId: string): SignalSubscriber => ({
    onRunStarted: () => {
      active++;
      maxActive = Math.max(maxActive, active);
      const current = (activeByStation.get(stationId) ?? 0) + 1;
      activeByStation.set(stationId, current);
      maxByStation.set(stationId, Math.max(maxByStation.get(stationId) ?? 0, current));
    },
    onRunCompleted: ({ run }) => {
      active--;
      activeByStation.set(stationId, (activeByStation.get(stationId) ?? 1) - 1);
      terminal.add(run.id);
    },
    onRunFailed: ({ run }) => terminal.add(run.id),
  });

  const common = {
    host: "127.0.0.1",
    port: 0,
    open: false,
    signalsDir,
    runner: { pollIntervalMs: 10, maxConcurrent: 8 },
  };
  const stations: StationInstance[] = [];
  try {
    stations.push(await createStation(resolveConfig({
      ...common,
      port: hqPort,
      role: "headquarters",
      adapter: hqQueue,
      scheduleAdapter,
      auth: { username: "e2e", password: "correct horse battery staple" },
      stationDir: "hq",
      network: { id: "e2e", stationId: "hq", adapter: hqNetwork, heartbeatIntervalMs: 50, leaseDurationMs: 250 },
    }), dir));
    stations.push(await createStation(resolveConfig({
      ...common,
      role: "station",
      adapter: stationAQueue,
      stationDir: "station-a",
      subscribers: { signal: [subscriber("station-a")] },
      network: { id: "e2e", stationId: "station-a", adapter: stationANetwork, labels: { gpu: "true" }, heartbeatIntervalMs: 50, leaseDurationMs: 250 },
    }), dir));
    stations.push(await createStation(resolveConfig({
      ...common,
      role: "station",
      adapter: stationBQueue,
      stationDir: "station-b",
      subscribers: { signal: [subscriber("station-b")] },
      network: { id: "e2e", stationId: "station-b", adapter: stationBNetwork, labels: { gpu: "false" }, heartbeatIntervalMs: 50, leaseDurationMs: 250 },
    }), dir));
    for (const station of stations) await station.start();

    const nodes = await hqNetwork.listStations({ networkId: "e2e" });
    assert.deepEqual(nodes.map((node) => node.id).sort(), ["hq", "station-a", "station-b"]);
    assert.ok(nodes.filter((node) => node.role === "station")
      .every((node) => node.definitions.signals.includes("network-work")));

    const apiBase = `http://127.0.0.1:${hqPort}/api/v1`;
    const loginResponse = await fetch(`${apiBase}/auth/login`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ username: "e2e", password: "correct horse battery staple" }),
    });
    assert.equal(loginResponse.status, 200);
    const cookie = loginResponse.headers.get("set-cookie")?.split(";", 1)[0];
    assert.ok(cookie);
    const catalogResponse = await fetch(`${apiBase}/signals`, { headers: { cookie } });
    assert.equal(catalogResponse.status, 200);
    const catalog = await catalogResponse.json() as { data: Array<{ name: string }> };
    assert.ok(catalog.data.some((signal) => signal.name === "network-work"));
    const stationResponse = await fetch(`${apiBase}/stations`, { headers: { cookie } });
    assert.equal(stationResponse.status, 200);
    const inventory = await stationResponse.json() as { data: Array<{ id: string }> };
    assert.deepEqual(inventory.data.map((station) => station.id).sort(), ["hq", "station-a", "station-b"]);

    const runIds: string[] = [];
    const batchStartedAt = performance.now();
    const triggerResponse = await fetch(`${apiBase}/trigger`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({ signalName: "network-work", input: { id: 0, delayMs: 80 } }),
    });
    assert.equal(triggerResponse.status, 201);
    const triggered = await triggerResponse.json() as { data: { id: string } };
    runIds.push(triggered.data.id);

    for (let id = 1; id < 12; id++) {
      const runId = hqQueue.generateId();
      runIds.push(runId);
      await hqQueue.addRun({
        id: runId, signalName: "network-work", kind: "trigger",
        input: JSON.stringify({ id, delayMs: 80 }), status: "pending",
        attempts: 0, maxAttempts: 1, timeout: 10_000, createdAt: new Date(),
      });
    }
    await waitFor(() => terminal.size === runIds.length ? Promise.resolve(true) : Promise.resolve(undefined), "network runs");
    const batchElapsedMs = performance.now() - batchStartedAt;
    const runs = await Promise.all(runIds.map((id) => hqQueue.getRun(id))) as Run[];
    assert.ok(runs.every((run) => run.status === "completed" && run.attempts === 1));
    assert.deepEqual(new Set(runs.map((run) => run.stationId)), new Set(["station-a", "station-b"]));
    assert.ok(maxActive <= 3, `network concurrency exceeded: ${maxActive}`);
    assert.ok((maxByStation.get("station-a") ?? 0) <= 2);
    assert.ok((maxByStation.get("station-b") ?? 0) <= 2);
    t.diagnostic(`12 child-process runs completed in ${batchElapsedMs.toFixed(1)}ms; observed fleet concurrency ${maxActive}`);
    const apiRunResponse = await fetch(`${apiBase}/runs/${runIds[0]}`, { headers: { cookie } });
    assert.equal(apiRunResponse.status, 200);
    const apiRun = await apiRunResponse.json() as { data: { status: string; stationId?: string } };
    assert.equal(apiRun.data.status, "completed");
    assert.ok(apiRun.data.stationId);

    const scheduledFor = new Date(Date.now() + 250);
    const now = new Date();
    await scheduleAdapter.add({
      id: "gpu-schedule",
      kind: "signal",
      target: "gpu-work",
      interval: "1h",
      overlapPolicy: "skip",
      misfirePolicy: "fire-once",
      input: { id: 99, delayMs: 20 },
      enabled: true,
      nextRunAt: scheduledFor,
      createdAt: now,
      updatedAt: now,
    });
    const scheduled = await waitFor(async () => {
      const value = await scheduleAdapter.get("gpu-schedule");
      return value?.lastRunId ? value : undefined;
    }, "scheduled run");
    assert.equal(scheduled.lastRunStatus, "triggered");
    const gpuId = scheduled.lastRunId!;
    const gpuRun = await waitFor(async () => {
      const run = await hqQueue.getRun(gpuId);
      return run?.status === "completed" ? run : undefined;
    }, "placed GPU run");
    assert.equal(gpuRun.stationId, "station-a");
    assert.equal(gpuRun.scheduleId, "gpu-schedule");
    assert.equal(gpuRun.scheduledFor?.toISOString(), scheduledFor.toISOString());
    const startDelayMs = gpuRun.startedAt!.getTime() - scheduledFor.getTime();
    // Scheduling makes work eligible; polling, process startup and host load can
    // delay execution. The bounded wait above checks eventual completion. Keep
    // latency as a diagnostic rather than imposing a one-second performance SLA
    // on an integration test that runs alongside the rest of the workspace.
    assert.ok(startDelayMs >= 0, `scheduled run started ${-startDelayMs}ms before it was due`);
    t.diagnostic(`scheduled GPU run started ${startDelayMs}ms after its requested time`);
  } finally {
    for (const station of stations.reverse()) await station.stop();
    rmSync(dir, { recursive: true, force: true });
  }
});
