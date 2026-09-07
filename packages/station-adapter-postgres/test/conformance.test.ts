import { test } from "node:test";
import { adapterConformanceCases } from "station-signal";
import { PostgresAdapter } from "../src/index.js";

/**
 * The reference implementation, held to the same contract as any hand-written
 * adapter. Needs a real database — set STATION_TEST_DATABASE_URL to run it.
 *
 * Skipping without one is deliberate: a conformance suite that quietly passes
 * against nothing is worse than no suite, so the skip reason says exactly what
 * did not run.
 */
const connectionString = process.env.STATION_TEST_DATABASE_URL;

if (!connectionString) {
  test("postgres adapter conformance", { skip: "set STATION_TEST_DATABASE_URL to run" }, () => {});
} else {
  let sequence = 0;
  for (const conformanceCase of adapterConformanceCases({
    name: "PostgresAdapter",
    // A table per case, so one case's rows can never explain another's result.
    createAdapter: () => {
      sequence += 1;
      return new PostgresAdapter({
        connectionString,
        tableName: `conformance_runs_${process.pid}_${sequence}`,
      });
    },
  })) {
    test(conformanceCase.name, conformanceCase.run);
  }
}
