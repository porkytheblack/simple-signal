import { test } from "node:test";
import assert from "node:assert/strict";
import {
  ScheduleMemoryAdapter,
  ScheduleReconciler,
  type Schedule,
} from "../src/index.js";

function parseInterval(s: string): number {
  const m = /^(\d+)(s|m|h)$/.exec(s);
  if (!m) throw new Error(`bad interval ${s}`);
  const ms = { s: 1000, m: 60_000, h: 3_600_000 }[m[2] as "s" | "m" | "h"];
  return Number(m[1]) * ms;
}

function due(over: Partial<Schedule> = {}): Schedule {
  const now = new Date();
  return {
    id: over.id ?? "s1",
    kind: "signal",
    target: "ping",
    interval: "5m",
    enabled: true,
    nextRunAt: new Date(now.getTime() - 1000), // already due
    createdAt: now,
    updatedAt: now,
    ...over,
  };
}

test("late polling preserves the planned occurrence without firing early or accumulating drift", async (t) => {
  const now = Date.UTC(2026, 8, 8, 12);
  t.mock.timers.enable({ apis: ["Date"], now });
  const adapter = new ScheduleMemoryAdapter();
  const scheduledFor = new Date(now + 250);
  await adapter.add(due({ interval: "1h", nextRunAt: scheduledFor }));
  const fired: Date[] = [];
  const reconciler = new ScheduleReconciler({
    adapter, kinds: ["signal"], parseInterval,
    triggerFn: async (_schedule, occurrence) => { fired.push(occurrence); return "late-run"; },
  });

  await reconciler.tick();
  assert.equal(fired.length, 0, "A future occurrence must not be eligible");
  t.mock.timers.setTime(scheduledFor.getTime() + 1_020);
  await reconciler.tick();
  assert.deepEqual(fired, [scheduledFor], "Late polling must retain the original occurrence");
  const updated = await adapter.get("s1");
  assert.equal(updated?.lastRunId, "late-run");
  assert.equal(updated?.lastRunStatus, "triggered");
  assert.equal(updated?.nextRunAt.getTime(), scheduledFor.getTime() + 3_600_000);
  await reconciler.tick();
  assert.equal(fired.length, 1, "The same occurrence must not fire twice");
});

test("tick fires one schedule and records lastRunId / status / nextRunAt", async () => {
  const adapter = new ScheduleMemoryAdapter();
  await adapter.add(due());

  const fired: Schedule[] = [];
  const reconciler = new ScheduleReconciler({
    adapter,
    kinds: ["signal"],
    parseInterval,
    triggerFn: async (s) => {
      fired.push(s);
      return "run-abc";
    },
  });

  await reconciler.tick();
  assert.equal(fired.length, 1);

  const updated = await adapter.get("s1");
  assert.equal(updated?.lastRunStatus, "triggered");
  assert.equal(updated?.lastRunId, "run-abc");
  assert.ok(updated!.nextRunAt.getTime() > Date.now());
});

test("tick skips schedules of other kinds", async () => {
  const adapter = new ScheduleMemoryAdapter();
  await adapter.add(due({ id: "sig", kind: "signal" }));
  await adapter.add(due({ id: "bdyn", kind: "broadcast-dynamic" }));

  const fired: string[] = [];
  const reconciler = new ScheduleReconciler({
    adapter,
    kinds: ["signal"],
    parseInterval,
    triggerFn: async (s) => {
      fired.push(s.id);
      return "x";
    },
  });
  await reconciler.tick();
  assert.deepEqual(fired, ["sig"]);
});

test("triggerFn errors are recorded as lastRunStatus = errored, schedule still advances", async () => {
  const adapter = new ScheduleMemoryAdapter();
  await adapter.add(due());

  const errors: Error[] = [];
  const reconciler = new ScheduleReconciler({
    adapter,
    kinds: ["signal"],
    parseInterval,
    triggerFn: async () => {
      throw new Error("boom");
    },
    onError: (err) => errors.push(err),
  });
  await reconciler.tick();
  assert.equal(errors.length, 1);

  const updated = await adapter.get("s1");
  assert.equal(updated?.lastRunStatus, "errored");
  assert.ok(updated!.nextRunAt.getTime() > Date.now());
});

test("two reconcilers can't both fire the same schedule (claimDue gating)", async () => {
  const adapter = new ScheduleMemoryAdapter();
  await adapter.add(due());

  let aFired = 0;
  let bFired = 0;
  const a = new ScheduleReconciler({
    adapter,
    kinds: ["signal"],
    parseInterval,
    triggerFn: async () => {
      aFired++;
      return "a";
    },
  });
  const b = new ScheduleReconciler({
    adapter,
    kinds: ["signal"],
    parseInterval,
    triggerFn: async () => {
      bFired++;
      return "b";
    },
  });
  // Concurrent ticks against the same store
  await Promise.all([a.tick(), b.tick()]);
  // One should win; total must be exactly 1
  assert.equal(aFired + bFired, 1);
});

test("hasPendingOrRunning records skipped:overlap when set", async () => {
  const adapter = new ScheduleMemoryAdapter();
  await adapter.add(due());

  let triggered = 0;
  const reconciler = new ScheduleReconciler({
    adapter,
    kinds: ["signal"],
    parseInterval,
    hasPendingOrRunning: async () => true,
    triggerFn: async () => {
      triggered++;
      return "x";
    },
  });
  await reconciler.tick();
  assert.equal(triggered, 0);
  const updated = await adapter.get("s1");
  assert.equal(updated?.lastRunStatus, "skipped:overlap");
  assert.ok(updated!.nextRunAt.getTime() > Date.now());
});

test("disabled schedules are not fired", async () => {
  const adapter = new ScheduleMemoryAdapter();
  await adapter.add(due({ enabled: false }));

  let fired = 0;
  const reconciler = new ScheduleReconciler({
    adapter,
    kinds: ["signal"],
    parseInterval,
    triggerFn: async () => {
      fired++;
      return "x";
    },
  });
  await reconciler.tick();
  assert.equal(fired, 0);
});

test("future-dated schedules are not fired", async () => {
  const adapter = new ScheduleMemoryAdapter();
  await adapter.add({
    ...due(),
    nextRunAt: new Date(Date.now() + 60_000),
  });

  let fired = 0;
  const reconciler = new ScheduleReconciler({
    adapter,
    kinds: ["signal"],
    parseInterval,
    triggerFn: async () => {
      fired++;
      return "x";
    },
  });
  await reconciler.tick();
  assert.equal(fired, 0);
});
