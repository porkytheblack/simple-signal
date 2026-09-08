import { BrowserStation, IndexedDBStore, signal, z, type BrowserRun } from "station-browser";
import { database, signals, report } from "./signals.js";
import { extendedTests } from "./extended-tests.js";
import { analysis, beacons, broadcasts, pulse } from "./workloads.js";

const results = document.getElementById("results")!;
const messages: string[] = [];
let failures = 0;
const delay = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
function assert(value: unknown, message: string): asserts value { if (!value) throw new Error(message); }
async function until<T>(read: () => Promise<T>, predicate: (value: T) => boolean, timeout = 12_000): Promise<T> {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const value = await read();
    if (predicate(value)) return value;
    await delay(80);
  }
  throw new Error("Timed out waiting for expected state");
}
async function test(name: string, fn: () => Promise<void>) {
  try { await fn(); messages.push(`PASS  ${name}`); }
  catch (error) { failures++; messages.push(`FAIL  ${name}\n      ${String(error)}`); }
  results.textContent = messages.join("\n");
}
async function isolated(fn: (database: string) => Promise<void>) {
  const database = `station-test-${crypto.randomUUID()}`;
  await fn(database);
  // Each test closes its connections; deletion intentionally never touches demo data.
  indexedDB.deleteDatabase(database);
}

await test("Input validation prevents invalid jobs from entering the queue", () => isolated(async (database) => {
  const job = signal("validated").input(z.object({ count: z.number() })).run(async () => {});
  const station = new BrowserStation({ database, signals: [job] });
  let rejected = false;
  try { await station.trigger("validated", { count: "bad" }); } catch { rejected = true; }
  assert(rejected && (await station.store.list()).length === 0, "Invalid input was accepted");
  await station.store.close();
}));

await test("Two runtimes atomically claim one run; overlapping drains do not duplicate it", () => isolated(async (database) => {
  let calls = 0;
  const job = signal("once").input(z.object({})).run(async () => { calls++; await delay(40); return; });
  const a = new BrowserStation({ database, signals: [job] });
  const b = new BrowserStation({ database, signals: [job] });
  const id = await a.trigger(job, {});
  await Promise.all([a.drain(), a.drain(), b.drain()]);
  assert(calls === 1 && (await a.store.get(id))?.status === "completed", `Executed ${calls} times`);
  await a.store.close(); await b.store.close();
}));

await test("A new runtime retries from persisted steps after the original connection closes", () => isolated(async (database) => {
  let firstCalls = 0;
  let secondCalls = 0;
  const job = signal("resume").input(z.object({})).retries(1)
    .step("saved", async () => { firstCalls++; return 42; })
    .step("flaky", async (value) => { secondCalls++; if (secondCalls === 1) throw new Error("temporary"); return value + 1; }).build();
  const a = new BrowserStation({ database, signals: [job] });
  const id = await a.trigger(job, {});
  await a.drain(); await a.store.close(); await delay(280);
  const b = new BrowserStation({ database, signals: [job] });
  await b.drain();
  const run = await b.store.get(id);
  assert(run?.status === "completed" && run.output === "43" && firstCalls === 1 && secondCalls === 2, "Checkpoint was not reused");
  await b.store.close();
}));

await test("Expired leases recover and stale owners cannot checkpoint or complete", () => isolated(async (database) => {
  const store = new IndexedDBStore(database);
  const run: BrowserRun = {
    id: crypto.randomUUID(), signalName: "lease", kind: "trigger", input: "{}", status: "running",
    attempts: 1, maxAttempts: 2, timeout: 1_000, createdAt: new Date(), checkpoints: [],
    definitionVersion: "1", leaseToken: "old-owner", leaseExpiresAt: new Date(Date.now() - 1),
  };
  await store.add(run);
  const claimed = await store.claim(["lease"], "new-owner");
  assert(claimed?.attempts === 2, "Expired job was not recovered");
  assert(!await store.checkpoint(run.id, "old-owner", { name: "late", completedAt: new Date() }), "Stale checkpoint accepted");
  assert(!await store.finish(run.id, "old-owner", { output: "42" }), "Stale result accepted");
  assert(await store.finish(run.id, claimed.leaseToken!, { output: "43" }), "Current result rejected");
  await store.close();
}));

await test("Exhausted interrupted runs fail; cancellation fences the active handler", () => isolated(async (database) => {
  const store = new IndexedDBStore(database);
  const id = crypto.randomUUID();
  await store.add({ id, signalName: "exhausted", kind: "trigger", input: "{}", status: "running", attempts: 1,
    maxAttempts: 1, timeout: 100, createdAt: new Date(), checkpoints: [], definitionVersion: "1",
    leaseToken: "expired", leaseExpiresAt: new Date(0) });
  assert(!await store.claim(["exhausted"], "new"), "Exhausted run was claimed");
  assert((await store.get(id))?.status === "failed", "Exhausted run did not fail");
  const job = signal("cancel").input(z.object({})).timeout(1_000).run(async () => { await delay(100); });
  const station = new BrowserStation({ database, signals: [job] });
  const cancelId = await station.trigger(job, {});
  const draining = station.drain();
  await until(() => store.get(cancelId), (run) => run?.status === "running");
  await store.cancel(cancelId); await draining;
  assert((await store.get(cancelId))?.status === "cancelled", "Cancelled handler overwrote status");
  await station.store.close(); await store.close();
}));

await test("Timeouts reject late checkpoints and output schema failures are recorded", () => isolated(async (database) => {
  const slow = signal("slow").input(z.object({})).timeout(30)
    .step("too-late", async () => { await delay(130); return 42; }).build();
  const invalid = signal("bad-output").input(z.object({})).output(z.number()).run(async () => "wrong" as unknown as number);
  const station = new BrowserStation({ database, signals: [slow, invalid] });
  const slowId = await station.trigger(slow, {});
  const invalidId = await station.trigger(invalid, {});
  await station.drain(); await delay(160);
  const run = await station.store.get(slowId);
  assert(run?.status === "failed" && run.checkpoints.length === 0 && run.error === "Signal timed out", "Late handler modified timed-out run");
  assert((await station.store.get(invalidId))?.status === "failed", "Invalid output was accepted");
  await station.store.close();
}));

await test("Changed definitions cannot resume old jobs; unsupported features fail explicitly", () => isolated(async (database) => {
  let called = false;
  const job = signal("versioned").input(z.object({})).run(async () => { called = true; });
  const a = new BrowserStation({ database, signals: [job], definitionVersion: "1" });
  const id = await a.trigger(job, {});
  const b = new BrowserStation({ database, signals: [job], definitionVersion: "2" });
  await b.drain();
  assert(!called && (await a.store.get(id))?.status === "failed", "Old job used new definition");
  let rejected = false;
  try { new BrowserStation({ signals: [signal("scheduled").every("every 5s").run(async () => {})] }); } catch { rejected = true; }
  assert(rejected, "Unsupported scheduling was silently accepted");
  await a.store.close(); await b.store.close();
}));

await test("Terminating a real Web Worker preserves checkpoints; a new worker recovers", async () => {
  const station = new BrowserStation({ database, signals });
  const id = await station.trigger(report, { text: "Browser integration recovery check" });
  let worker = new Worker(new URL("./worker.js", import.meta.url), { type: "module" });
  try {
    const first = await until(() => station.store.get(id), (run) => (run?.checkpoints.length ?? 0) >= 1);
    worker.terminate();
    const savedAt = first!.checkpoints[0].completedAt.getTime();
    worker = new Worker(new URL("./worker.js", import.meta.url), { type: "module" });
    const final = await until(() => station.store.get(id), (run) => run?.status === "completed", 15_000);
    assert(final!.attempts === 2, "Run did not recover as a new attempt");
    assert(final!.checkpoints[0].completedAt.getTime() === savedAt, "Saved step was repeated");
    assert(final!.stationId === "web-worker", "Unexpected executor");
  } finally { worker.terminate(); await station.store.close(); }
});

await test("A real service worker executes queued work through a message wake event", async () => {
  assert("serviceWorker" in navigator, "Service workers unavailable on this origin");
  await navigator.serviceWorker.register("./sw.js", { type: "module" });
  const registration = await navigator.serviceWorker.ready;
  const station = new BrowserStation({ database, signals });
  const id = await station.trigger(report, { text: "Service worker execution check" });
  const channel = new MessageChannel();
  const response = new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error("No response from service worker")), 15_000);
    channel.port1.onmessage = (event) => {
      clearTimeout(timeout);
      if (event.data.error) reject(new Error(event.data.error)); else resolve();
    };
  });
  try {
    registration.active!.postMessage({ type: "station:drain" }, [channel.port2]);
    await response;
    const run = await station.store.get(id);
    assert(run?.status === "completed" && run.stationId === "service-worker", "Service worker did not execute the job");
  } finally { channel.port1.close(); await station.store.close(); }
});

await extendedTests(test);

await test("Real worker termination recovers both a DAG and a desired-running beacon", async () => {
  const station = new BrowserStation({ database, signals, beacons, broadcasts });
  const id = await station.triggerBroadcast(analysis.name, { text: "short text" });
  await station.beacons.start(pulse.name);
  let worker = new Worker(new URL("./worker.js", import.meta.url), { type: "module" });
  try {
    await until(() => station.broadcasts.list(), (runs) => runs.find((run) => run.id === id)?.nodes[0].status === "completed");
    const before = (await station.beacons.list()).find((instance) => instance.id === pulse.name)!;
    worker.terminate();
    worker = new Worker(new URL("./worker.js", import.meta.url), { type: "module" });
    const runs = await until(() => station.broadcasts.list(), (runs) => runs.find((run) => run.id === id)?.status === "completed", 15_000);
    const final = runs.find((run) => run.id === id)!;
    const root = await station.store.get(final.nodes[0].signalRunId!);
    assert(root?.attempts === 1 && final.nodes.at(-1)?.skipReason === "guard", "Root was repeated or guard lost");
    const instances = await until(() => station.beacons.list(), (all) => (all.find((instance) => instance.id === pulse.name)?.incarnation ?? 0) > before.incarnation);
    assert(instances.find((instance) => instance.id === pulse.name)?.owner === "web-worker", "Beacon did not resume in the worker");
    await station.beacons.stop(pulse.name);
    await until(() => station.beacons.list(), (all) => all.find((instance) => instance.id === pulse.name)?.status === "stopped");
  } finally { worker.terminate(); await station.beacons.stop(pulse.name); await station.store.close(); }
});

await test("Real service-worker wake completes a broadcast and suspends a beacon slice", async () => {
  const registration = await navigator.serviceWorker.ready;
  const station = new BrowserStation({ database, signals, beacons, broadcasts });
  const id = await station.triggerBroadcast(analysis.name, { text: "service worker branch check" });
  await station.beacons.start(pulse.name);
  const channel = new MessageChannel();
  const response = new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error("Service-worker wake did not settle")), 15_000);
    channel.port1.onmessage = (event) => {
      clearTimeout(timeout);
      if (event.data.error) reject(new Error(event.data.error)); else resolve();
    };
  });
  try {
    registration.active!.postMessage({ type: "station:drain" }, [channel.port2]);
    await response;
    const run = (await station.broadcasts.list()).find((run) => run.id === id)!;
    assert(run.status === "completed", "Service-worker broadcast did not complete");
    for (const node of run.nodes.filter((node) => node.signalRunId)) {
      assert((await station.store.get(node.signalRunId!))?.stationId === "service-worker", "Node used the wrong executor");
    }
    const instance = (await station.beacons.list()).find((instance) => instance.id === pulse.name)!;
    assert(instance.status === "suspended" && instance.desired === "running" && instance.owner === "service-worker", "Beacon did not suspend after the wake");
  } finally { channel.port1.close(); await station.beacons.stop(pulse.name); await station.store.close(); }
});

messages.push(`\n${messages.length - failures}/${messages.length} checks passed`);
results.textContent = messages.join("\n");
document.title = failures ? `FAIL: ${failures} browser checks` : "PASS: Station browser checks";
document.body.dataset.testStatus = failures ? "failed" : "passed";
