import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import type { SignalQueueAdapter } from "./index.js";
import type { Run, RunClaim } from "../types.js";

/**
 * Which distributed-safety guarantees an adapter actually provides.
 *
 * `SignalQueueAdapter` marks these methods optional so a small in-process
 * adapter stays easy to write. The cost is that omitting one is silent: the
 * adapter typechecks, passes a single-runner smoke test, and only misbehaves
 * once a second runner shares it. This turns that into something you can read.
 */
export interface AdapterCapabilities {
  /** `claimRun` — an atomic pending -> running transition. */
  readonly atomicClaim: boolean;
  /** `renewRunLease` — extend ownership while the work is still running. */
  readonly leaseRenewal: boolean;
  /** `updateClaimedRun` — writes fenced by the holder's lease token. */
  readonly fencedWrites: boolean;
  /** `requeueExpiredRuns` — recover work abandoned by a dead runner. */
  readonly crashRecovery: boolean;
  /** `cancelRun` — atomic cancellation of pending or running work. */
  readonly atomicCancel: boolean;
}

export function inspectAdapter(adapter: SignalQueueAdapter): AdapterCapabilities {
  return {
    atomicClaim: typeof adapter.claimRun === "function",
    leaseRenewal: typeof adapter.renewRunLease === "function",
    fencedWrites: typeof adapter.updateClaimedRun === "function",
    crashRecovery: typeof adapter.requeueExpiredRuns === "function",
    atomicCancel: typeof adapter.cancelRun === "function",
  };
}

/**
 * What breaks if more than one runner shares this adapter, worst first.
 * Empty means the adapter implements everything multi-station execution needs.
 */
export function multiStationRisks(
  capabilities: AdapterCapabilities,
): ReadonlyArray<string> {
  const risks: string[] = [];
  if (!capabilities.atomicClaim) {
    risks.push(
      "claimRun is missing: ownership falls back to a blind updateRun, so two " +
        "runners can read the same pending run and both dispatch it. Duplicate " +
        "execution, no error.",
    );
  }
  if (!capabilities.crashRecovery) {
    risks.push(
      "requeueExpiredRuns is missing: work abandoned by a crashed runner stays " +
        "'running' forever and is never retried.",
    );
  }
  if (!capabilities.leaseRenewal) {
    risks.push(
      "renewRunLease is missing: a live run cannot extend its lease, so any " +
        "recovery sweep may re-dispatch work that is still executing.",
    );
  }
  if (!capabilities.fencedWrites) {
    risks.push(
      "updateClaimedRun is missing: writes are unfenced, so a run that lost its " +
        "lease can still overwrite the state of the runner that now owns it.",
    );
  }
  return risks;
}

/** One-line summary for a log line or a health endpoint. */
export function describeAdapterSafety(adapter: SignalQueueAdapter): string {
  const risks = multiStationRisks(inspectAdapter(adapter));
  return risks.length === 0
    ? "safe for multi-station execution"
    : `single-runner only (${risks.length} unmet requirement${risks.length === 1 ? "" : "s"})`;
}

/* ------------------------------------------------------------------ */
/*  Conformance suite                                                  */
/* ------------------------------------------------------------------ */

export interface ConformanceOptions {
  /**
   * Build a fresh, empty adapter. Called once per case, so a case never sees
   * another's rows — which is what makes a failure mean what it says.
   */
  readonly createAdapter: () => Promise<SignalQueueAdapter> | SignalQueueAdapter;
  /** Name used in case titles. */
  readonly name?: string;
  /**
   * Skip the cases that only apply to adapters intended for more than one
   * runner. Leave it false: the point is to find out.
   */
  readonly singleRunnerOnly?: boolean;
}

export interface ConformanceCase {
  readonly name: string;
  /** True when the case only applies to multi-runner adapters. */
  readonly distributed: boolean;
  readonly run: () => Promise<void>;
}

function pendingRun(over: Partial<Run> = {}): Run {
  return {
    id: randomUUID(),
    signalName: "conformance",
    kind: "trigger",
    input: "{}",
    status: "pending",
    attempts: 0,
    maxAttempts: 3,
    timeout: 30_000,
    createdAt: new Date(),
    ...over,
  };
}

function claimFor(stationId: string, leaseMs = 1_000, at = new Date()): RunClaim {
  return {
    stationId,
    leaseToken: randomUUID(),
    claimedAt: at,
    leaseExpiresAt: new Date(at.getTime() + leaseMs),
  };
}

/**
 * The behaviours `SignalRunner` relies on, as runnable cases.
 *
 * Every adapter — shipped or hand-written — should pass this. Wire it into
 * your own test file:
 *
 * ```ts
 * import { test } from "node:test";
 * import { adapterConformanceCases } from "station-signal/conformance";
 *
 * for (const c of adapterConformanceCases({ createAdapter: () => new MyAdapter() })) {
 *   test(c.name, c.run);
 * }
 * ```
 *
 * The suite is deliberately test-runner agnostic: it returns cases rather than
 * registering them, so it works under node:test, vitest, or anything else.
 */
export function adapterConformanceCases(
  options: ConformanceOptions,
): ReadonlyArray<ConformanceCase> {
  const label = options.name ? `${options.name}: ` : "";
  const make = async () => options.createAdapter();

  const cases: ConformanceCase[] = [
    {
      name: `${label}stores a run and reads it back unchanged`,
      distributed: false,
      run: async () => {
        const adapter = await make();
        const run = pendingRun();
        await adapter.addRun(run);
        const stored = await adapter.getRun(run.id);
        assert.ok(stored, "getRun returned nothing for a run that was just added");
        assert.equal(stored.signalName, run.signalName);
        assert.equal(stored.status, "pending");
        assert.equal(stored.input, run.input);
      },
    },
    {
      name: `${label}getRunsDue returns due work and withholds future work`,
      distributed: false,
      run: async () => {
        const adapter = await make();
        const due = pendingRun();
        const later = pendingRun({ nextRunAt: new Date(Date.now() + 60_000) });
        await adapter.addRun(due);
        await adapter.addRun(later);
        const ids = (await adapter.getRunsDue(100)).map((run) => run.id);
        assert.ok(ids.includes(due.id), "a due run was not returned");
        assert.ok(!ids.includes(later.id), "a run scheduled in the future was returned");
      },
    },
    {
      name: `${label}getRunsDue honours its limit`,
      distributed: false,
      run: async () => {
        const adapter = await make();
        for (let index = 0; index < 5; index += 1) await adapter.addRun(pendingRun());
        assert.ok((await adapter.getRunsDue(2)).length <= 2, "limit was exceeded");
      },
    },
    {
      name: `${label}exactly one concurrent claim wins`,
      distributed: true,
      run: async () => {
        const adapter = await make();
        if (!adapter.claimRun) return;
        const run = pendingRun();
        await adapter.addRun(run);

        // The whole contract in one assertion: contending runners must not
        // both come away believing they own this run.
        const results = await Promise.all(
          ["a", "b", "c", "d"].map((id) => adapter.claimRun!(run.id, claimFor(`station-${id}`))),
        );
        const winners = results.filter(Boolean);
        assert.equal(winners.length, 1, `${winners.length} runners claimed the same run`);
        assert.equal((await adapter.getRun(run.id))?.status, "running");
        assert.equal((await adapter.getRun(run.id))?.attempts, 1, "attempts was not incremented once");
      },
    },
    {
      name: `${label}a claimed run cannot be claimed again`,
      distributed: true,
      run: async () => {
        const adapter = await make();
        if (!adapter.claimRun) return;
        const run = pendingRun();
        await adapter.addRun(run);
        assert.ok(await adapter.claimRun(run.id, claimFor("station-a")));
        assert.equal(
          await adapter.claimRun(run.id, claimFor("station-b")),
          null,
          "a second claim succeeded against a running run",
        );
      },
    },
    {
      name: `${label}only the lease holder may renew`,
      distributed: true,
      run: async () => {
        const adapter = await make();
        if (!adapter.claimRun || !adapter.renewRunLease) return;
        const run = pendingRun();
        await adapter.addRun(run);
        const claim = claimFor("station-a", 5_000);
        await adapter.claimRun(run.id, claim);
        const until = new Date(Date.now() + 10_000);
        assert.equal(
          await adapter.renewRunLease(run.id, claim.leaseToken, until),
          true,
          "the holder could not renew its own lease",
        );
        assert.equal(
          await adapter.renewRunLease(run.id, randomUUID(), until),
          false,
          "a non-holder renewed the lease",
        );
      },
    },
    {
      name: `${label}writes are fenced by the lease token`,
      distributed: true,
      run: async () => {
        const adapter = await make();
        if (!adapter.claimRun || !adapter.updateClaimedRun) return;
        const run = pendingRun();
        await adapter.addRun(run);
        const claim = claimFor("station-a", 5_000);
        await adapter.claimRun(run.id, claim);
        assert.equal(
          await adapter.updateClaimedRun(run.id, randomUUID(), { status: "completed" }),
          false,
          "a stale token completed a run it no longer owns",
        );
        assert.equal((await adapter.getRun(run.id))?.status, "running");
        assert.equal(
          await adapter.updateClaimedRun(run.id, claim.leaseToken, { status: "completed" }),
          true,
          "the holder could not write to its own run",
        );
      },
    },
    {
      name: `${label}expired work is recovered and live work is left alone`,
      distributed: true,
      run: async () => {
        const adapter = await make();
        if (!adapter.claimRun || !adapter.requeueExpiredRuns) return;

        const abandoned = pendingRun();
        const live = pendingRun();
        await adapter.addRun(abandoned);
        await adapter.addRun(live);
        // One lease already lapsed, one comfortably in the future.
        await adapter.claimRun(abandoned.id, claimFor("dead-station", 1_000, new Date(Date.now() - 60_000)));
        await adapter.claimRun(live.id, claimFor("live-station", 60_000));

        await adapter.requeueExpiredRuns(new Date());
        assert.notEqual(
          (await adapter.getRun(abandoned.id))?.status,
          "running",
          "an expired lease was not recovered",
        );
        assert.equal(
          (await adapter.getRun(live.id))?.status,
          "running",
          "a live lease was recovered out from under its holder",
        );
      },
    },
    {
      name: `${label}a recovered run can be claimed by another station`,
      distributed: true,
      run: async () => {
        const adapter = await make();
        if (!adapter.claimRun || !adapter.requeueExpiredRuns) return;
        const run = pendingRun();
        await adapter.addRun(run);
        await adapter.claimRun(run.id, claimFor("dead-station", 1_000, new Date(Date.now() - 60_000)));
        await adapter.requeueExpiredRuns(new Date());
        const retaken = await adapter.claimRun(run.id, claimFor("station-b"));
        assert.ok(retaken, "recovered work could not be re-claimed");
        assert.equal(retaken.stationId, "station-b");
        assert.equal(retaken.attempts, 2, "the retry did not count as a new attempt");
      },
    },
    {
      name: `${label}steps round-trip and are removed with their run`,
      distributed: false,
      run: async () => {
        const adapter = await make();
        const run = pendingRun();
        await adapter.addRun(run);
        const step = {
          id: randomUUID(),
          runId: run.id,
          name: "first",
          status: "pending" as const,
        };
        await adapter.addStep(step);
        await adapter.updateStep(step.id, { status: "completed" });
        const steps = await adapter.getSteps(run.id);
        assert.equal(steps.length, 1);
        assert.equal(steps[0]?.status, "completed");
        await adapter.removeSteps(run.id);
        assert.equal((await adapter.getSteps(run.id)).length, 0);
      },
    },
    {
      name: `${label}ping reports reachability`,
      distributed: false,
      run: async () => {
        const adapter = await make();
        assert.equal(await adapter.ping(), true, "ping failed against a live adapter");
      },
    },
  ];

  return options.singleRunnerOnly ? cases.filter((item) => !item.distributed) : cases;
}
