import { BrowserStation, beacon, broadcast, signal, sleepOrAbort, z } from "station-browser";

const delay = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
function assert(value: unknown, message: string): asserts value { if (!value) throw new Error(message); }
type Test = (name: string, fn: () => Promise<void>) => Promise<void>;
async function isolated(fn: (database: string) => Promise<void>) {
  const database = `station-extended-${crypto.randomUUID()}`;
  await fn(database);
  indexedDB.deleteDatabase(database);
}
async function pump(station: BrowserStation, duration = 300) {
  const until = Date.now() + duration;
  while (Date.now() < until) { await station.beacons.tick(); await delay(20); }
}

export async function extendedTests(test: Test) {
  await test("Broadcast fan-out overlaps execution and fan-in receives both outputs", () => isolated(async (database) => {
    let active = 0; let peak = 0;
    const root = signal("root").input(z.object({})).output(z.number()).run(async () => 2);
    const branch = (name: string) => signal(name).input(z.number()).output(z.number()).run(async (n) => {
      peak = Math.max(peak, ++active); await delay(50); active--; return n + 1;
    });
    const a = branch("a"); const b = branch("b");
    const join = signal("join").input(z.object({ a: z.number(), b: z.number() })).output(z.number()).run(async ({ a, b }) => a + b);
    const dag = broadcast("fanout").input(root).then(a, b).then(join).build();
    const station = new BrowserStation({ database, broadcasts: [dag] });
    await station.triggerBroadcast(dag.name, {}); await station.drain();
    const run = (await station.broadcasts.list())[0];
    assert(run.status === "completed" && run.nodes.at(-1)?.output === "6" && peak === 2, "Fan-out or join failed");
    await station.store.close();
  }));

  await test("Two broadcast coordinators cannot duplicate child jobs, including after reopening", () => isolated(async (database) => {
    let calls = 0;
    const root = signal("root").input(z.object({})).output(z.number()).run(async () => { calls++; return 2; });
    const end = signal("end").input(z.number()).output(z.number()).run(async (n) => { calls++; return n + 1; });
    const dag = broadcast("recover-dag").input(root).then(end).build();
    const a = new BrowserStation({ database, broadcasts: [dag] });
    const b = new BrowserStation({ database, broadcasts: [dag] });
    await a.triggerBroadcast(dag.name, {});
    await Promise.all([a.broadcasts.advance(), b.broadcasts.advance()]);
    assert((await a.store.list()).length === 1, "Duplicate root enqueued");
    await a.drain({ maxJobs: 1 }); await a.store.close();
    const c = new BrowserStation({ database, broadcasts: [dag] });
    await Promise.all([b.drain(), c.drain()]);
    assert(calls === 2 && (await c.store.list()).length === 2 && (await c.broadcasts.list())[0].status === "completed", "Recovery duplicated work");
    await b.store.close(); await c.store.close();
  }));

  await test("Guard skips remain distinct from failed branches and allow mapped successors", () => isolated(async (database) => {
    let guardedCalls = 0;
    const root = signal("root").input(z.object({})).output(z.number()).run(async () => 1);
    const skip = signal("skip").input(z.number()).output(z.number()).run(async (n) => { guardedCalls++; return n; });
    const end = signal("end").input(z.object({})).run(async () => {});
    const dag = broadcast("guarded").input(root).then(skip, { when: () => false }).then(end, { map: () => ({}) }).build();
    const station = new BrowserStation({ database, broadcasts: [dag] });
    await station.triggerBroadcast(dag.name, {}); await station.drain();
    const run = (await station.broadcasts.list())[0];
    assert(!guardedCalls && run.status === "completed" && run.nodes[1].skipReason === "guard" && run.nodes[2].status === "completed", "Guard handling failed");
    await station.store.close();
  }));

  for (const policy of ["fail-fast", "skip-downstream", "continue"] as const) {
    await test(`Broadcast ${policy} handles a failed branch and independent work`, () => isolated(async (database) => {
      const root = signal("root").input(z.object({})).output(z.number()).run(async () => 1);
      const bad = signal("bad").input(z.number()).output(z.number()).run(async () => { throw new Error("broken branch"); });
      const good = signal("good").input(z.number()).output(z.number()).run(async (n) => n);
      const dependent = signal("dependent").input(z.number()).output(z.number()).run(async (n) => n);
      const independent = signal("independent").input(z.number()).output(z.number()).run(async (n) => n);
      const dag = broadcast("policy").input(root).then(bad, good).then(dependent, { after: [bad.name] })
        .then(independent, { after: [good.name] }).onFailure(policy).build();
      const station = new BrowserStation({ database, broadcasts: [dag] });
      await station.triggerBroadcast(dag.name, {}); await station.drain();
      const run = (await station.broadcasts.list())[0];
      assert(run.status === (policy === "continue" ? "completed" : "failed"), "Wrong terminal status");
      assert(run.nodes.find((n) => n.name === "dependent")?.status === "skipped", "Failed dependency was executed");
      if (policy !== "fail-fast") assert(run.nodes.find((n) => n.name === "independent")?.status === "completed", "Independent branch did not finish");
      assert(Boolean(run.error), "Partial failure was hidden");
      await station.store.close();
    }));
  }

  await test("Broadcast cancellation fences children; timeout and version changes terminate workflows", () => isolated(async (database) => {
    const root = signal("root").input(z.object({})).timeout(1_000).run(async () => { await delay(80); });
    const dag = broadcast("cancel-dag").input(root).build();
    const timed = broadcast("timed-dag").input(root).timeout(1).build();
    const a = new BrowserStation({ database, broadcasts: [dag, timed] });
    const id = await a.triggerBroadcast(dag.name, {}); await a.broadcasts.advance();
    const draining = a.drain(); await delay(15); await a.broadcasts.cancel(id); await draining;
    assert((await a.broadcasts.list()).find((run) => run.id === id)?.status === "cancelled", "Cancel was overwritten");
    assert((await a.store.list()).every((run) => run.status === "cancelled"), "Child was not fenced");
    await a.triggerBroadcast(timed.name, {}); await delay(5); await a.broadcasts.advance();
    assert((await a.broadcasts.list()).find((run) => run.broadcastName === timed.name)?.status === "failed", "Timeout ignored");
    const old = await a.triggerBroadcast(dag.name, {});
    const b = new BrowserStation({ database, broadcasts: [dag], definitionVersion: "2" });
    await b.broadcasts.advance();
    assert((await b.broadcasts.list()).find((run) => run.id === old)?.status === "failed", "Version change ignored");
    await a.store.close(); await b.store.close();
  }));

  await test("Beacon ownership is exclusive; stop aborts its handler and executes cleanup", () => isolated(async (database) => {
    let starts = 0; let cleanups = 0;
    const def = beacon("client").manualStart().stopTimeout(200).run(async (ctx) => {
      starts++; ctx.ready(); ctx.onStop(() => { cleanups++; }); await ctx.untilStopped();
    });
    const a = new BrowserStation({ database, beacons: [def] });
    const b = new BrowserStation({ database, beacons: [def] });
    await a.beacons.start(def.name); await Promise.all([a.beacons.tick(), b.beacons.tick()]); await delay(10);
    assert(starts === 1, "Duplicate beacon owners");
    await a.beacons.stop(def.name); await b.beacons.tick();
    const record = (await a.beacons.list())[0];
    assert(record.status === "stopped" && record.desired === "stopped" && cleanups === 1, "Stop/cleanup failed");
    await a.beacons.suspend(); await b.beacons.suspend(); await a.store.close(); await b.store.close();
  }));

  await test("Beacon failure restarts with backoff, while never policy stays errored", () => isolated(async (database) => {
    const def = beacon("recover").manualStart().stopTimeout(100).backoff(60, { max: 120 }).run(async (ctx) => {
      ctx.ready(); if (ctx.incarnation === 1) throw new Error("disconnect"); await ctx.untilStopped();
    });
    const never = beacon("never").manualStart().stopTimeout(100).restart("never").run(() => { throw new Error("fatal"); });
    const station = new BrowserStation({ database, beacons: [def, never] });
    await station.beacons.start(def.name); await station.beacons.start(never.name);
    await pump(station, 300);
    const records = await station.beacons.list();
    assert(records.find((r) => r.id === "recover")?.incarnation === 2, "Failed beacon did not restart once");
    assert(records.find((r) => r.id === "never")?.status === "errored", "Never policy restarted");
    await station.beacons.suspend(); await station.store.close();
  }));

  await test("Beacon heartbeat stalls and startup hangs trigger supervision", () => isolated(async (database) => {
    const stalled = beacon("stalled").manualStart().heartbeat(20, { timeout: 60 }).stopTimeout(100).restart("never")
      .run(async (ctx) => { ctx.ready(); await ctx.untilStopped(); });
    const startup = beacon("startup").manualStart().startupTimeout(50).stopTimeout(100).restart("never")
      .run(async (ctx) => { await ctx.untilStopped(); });
    const station = new BrowserStation({ database, beacons: [stalled, startup] });
    await station.beacons.start(stalled.name); await station.beacons.start(startup.name); await pump(station, 200);
    const records = await station.beacons.list();
    assert(records.every((r) => r.status === "errored"), "Watchdogs did not fail unhealthy beacons");
    assert(records.some((r) => r.error?.includes("heartbeat")) && records.some((r) => r.error?.includes("startup")), "Missing watchdog reasons");
    await station.beacons.suspend(); await station.store.close();
  }));

  await test("Beacon slices suspend cleanly and resume desired state in a new incarnation", () => isolated(async (database) => {
    let ticks = 0;
    const def = beacon("poller").manualStart().stopTimeout(100).poll(25, (ctx) => { ticks++; ctx.heartbeat(); ctx.log("tick"); });
    const a = new BrowserStation({ database, beacons: [def] });
    await a.beacons.start(def.name); await a.beacons.runSlice(130);
    let record = (await a.beacons.list())[0];
    assert(ticks > 1 && record.status === "suspended" && record.desired === "running" && !record.token, "Slice did not suspend");
    await a.store.close();
    const b = new BrowserStation({ database, beacons: [def] });
    await b.beacons.runSlice(130); record = (await b.beacons.list())[0];
    assert(record.incarnation === 2 && record.status === "suspended", "Resume did not start a new incarnation");
    await b.beacons.stop(def.name); await b.beacons.runSlice(50);
    assert((await b.beacons.list())[0].incarnation === 2, "Stopped beacon resumed");
    await b.store.close();
  }));

  await test("Expired beacon leases recover, old logs are fenced, and instance caps are atomic", () => isolated(async (database) => {
    const def = beacon("tenant").onDemand().maxInstances(1).stopTimeout(100).run(async (ctx) => {
      ctx.ready(); while (!ctx.signal.aborted) { ctx.log("alive"); await sleepOrAbort(20, ctx.signal); }
    });
    const a = new BrowserStation({ database, beacons: [def], stationId: "old" });
    const b = new BrowserStation({ database, beacons: [def], stationId: "new" });
    const results = await Promise.allSettled([
      a.beacons.start(def.name, { instanceId: "one" }), b.beacons.start(def.name, { instanceId: "two" }),
    ]);
    assert(results.filter((r) => r.status === "fulfilled").length === 1, "Instance limit raced");
    await a.beacons.tick(); await delay(25);
    // Simulate a disappeared owner by expiring its lease; its queued context writes must lose ownership.
    await a.store.atomic<void>(["beacons"], "readwrite", (tx) => {
      const store = tx.objectStore("beacons"); const request = store.getAll();
      request.onsuccess = () => { const record = request.result[0]; record.leaseExpiresAt = 0; store.put(record); };
    });
    await b.beacons.tick(); await a.beacons.tick(); await delay(25);
    const record = (await b.beacons.list())[0];
    assert(record.incarnation === 2 && record.owner === "new", "Lease recovery did not transfer ownership");
    await b.beacons.suspend(); await a.beacons.suspend(); await a.store.close(); await b.store.close();
  }));

  await test("Uncooperative beacons become errored instead of being restarted in the same worker", () => isolated(async (database) => {
    let finish!: () => void;
    const def = beacon("ignores-stop").manualStart().stopTimeout(30).run(() => new Promise<void>((resolve) => { finish = resolve; }));
    const station = new BrowserStation({ database, beacons: [def] });
    await station.beacons.start(def.name); await station.beacons.tick(); await delay(5);
    await station.beacons.suspend();
    const record = (await station.beacons.list())[0];
    assert(record.status === "errored" && record.desired === "stopped", "Uncooperative handler was not contained");
    await station.beacons.start(def.name); await station.beacons.tick();
    assert((await station.beacons.list())[0].incarnation === 1, "Uncooperative handler duplicated");
    finish(); await delay(5); await station.store.close();
  }));
}
