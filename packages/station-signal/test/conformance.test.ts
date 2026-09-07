import assert from "node:assert/strict";
import { test } from "node:test";
import {
  MemoryAdapter,
  adapterConformanceCases,
  describeAdapterSafety,
  inspectAdapter,
  multiStationRisks,
  type SignalQueueAdapter,
} from "../src/index.js";

// The shipped in-process adapter is the reference: it must pass every case,
// including the distributed ones, or the suite is describing nothing.
for (const conformanceCase of adapterConformanceCases({
  createAdapter: () => new MemoryAdapter(),
  name: "MemoryAdapter",
})) {
  test(conformanceCase.name, conformanceCase.run);
}

/** A plausible hand-written adapter: the required methods, none of the optional ones. */
function minimalAdapter(): SignalQueueAdapter {
  const base = new MemoryAdapter();
  const stripped = Object.create(base) as Record<string, unknown>;
  for (const method of ["claimRun", "renewRunLease", "updateClaimedRun", "requeueExpiredRuns", "cancelRun"]) {
    stripped[method] = undefined;
  }
  return stripped as unknown as SignalQueueAdapter;
}

test("an adapter missing the optional half is reported, not silently accepted", () => {
  const capabilities = inspectAdapter(minimalAdapter());
  assert.deepEqual(capabilities, {
    atomicClaim: false,
    leaseRenewal: false,
    fencedWrites: false,
    crashRecovery: false,
    atomicCancel: false,
  });

  const risks = multiStationRisks(capabilities);
  assert.equal(risks.length, 4);
  // Duplicate execution is the one that costs money, so it leads.
  assert.match(risks[0] ?? "", /claimRun is missing/);
  assert.match(risks[0] ?? "", /both dispatch it/);
  assert.equal(describeAdapterSafety(minimalAdapter()), "single-runner only (4 unmet requirements)");
});

test("a complete adapter reports no multi-station risk", () => {
  assert.deepEqual(multiStationRisks(inspectAdapter(new MemoryAdapter())), []);
  assert.equal(describeAdapterSafety(new MemoryAdapter()), "safe for multi-station execution");
});

test("the distributed cases are skippable for a deliberately single-runner adapter", () => {
  const all = adapterConformanceCases({ createAdapter: () => new MemoryAdapter() });
  const single = adapterConformanceCases({
    createAdapter: () => new MemoryAdapter(),
    singleRunnerOnly: true,
  });
  assert.ok(single.length < all.length);
  assert.ok(single.every((item) => !item.distributed));
});

test("query filters narrow results and stay optional", async () => {
  const adapter = new MemoryAdapter();
  const base = {
    kind: "trigger" as const,
    input: "{}",
    status: "pending" as const,
    attempts: 0,
    maxAttempts: 1,
    timeout: 1_000,
    createdAt: new Date(),
  };
  await adapter.addRun({ ...base, id: "a", signalName: "wanted" });
  await adapter.addRun({ ...base, id: "b", signalName: "other" });

  // Unfiltered stays the old behaviour, so an adapter that ignores the hint
  // and a runner that does not pass one both keep working.
  assert.equal((await adapter.getRunsDue(10)).length, 2);
  const narrowed = await adapter.getRunsDue(10, { signalNames: ["wanted"] });
  assert.deepEqual(narrowed.map((run) => run.id), ["a"]);
  assert.deepEqual(await adapter.getRunsDue(10, { signalNames: [] }), []);
});

test("running runs can be narrowed to one station", async () => {
  const adapter = new MemoryAdapter();
  const base = {
    kind: "trigger" as const,
    input: "{}",
    status: "pending" as const,
    attempts: 0,
    maxAttempts: 1,
    timeout: 1_000,
    createdAt: new Date(),
  };
  await adapter.addRun({ ...base, id: "mine", signalName: "work" });
  await adapter.addRun({ ...base, id: "theirs", signalName: "work" });
  const at = new Date();
  await adapter.claimRun!("mine", {
    stationId: "station-a",
    leaseToken: "t1",
    claimedAt: at,
    leaseExpiresAt: new Date(at.getTime() + 60_000),
  });
  await adapter.claimRun!("theirs", {
    stationId: "station-b",
    leaseToken: "t2",
    claimedAt: at,
    leaseExpiresAt: new Date(at.getTime() + 60_000),
  });

  assert.equal((await adapter.getRunsRunning()).length, 2);
  const mine = await adapter.getRunsRunning({ stationId: "station-a" });
  assert.deepEqual(mine.map((run) => run.id), ["mine"]);
  assert.equal((await adapter.getRunsRunning({ limit: 1 })).length, 1);
});
