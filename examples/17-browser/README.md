# Browser Station lab

A standalone local demo of `station-browser`. The Node process only serves
static files; job execution and storage happen in the browser.

```sh
# From the repository root
pnpm install
pnpm dev:browser
```

Open http://127.0.0.1:4317.

1. Queue a local report and watch the three steps complete.
2. Queue another report. Once one step is saved, interrupt the worker and resume.
   The run retries after its seven-second lease expires, reusing saved steps.
3. Reload during execution to exercise the same recovery path.
4. Try a temporary failure to see a checkpoint survive retries.
5. Select **Service worker**, queue a report, and check the executor shown on it.
6. Run text analysis to see two concurrent branches, a join, and a guard. Use a
   short text to skip the highlight, or simulate a failing branch to see failure propagation.
7. Start the pulse or recovering-client beacon. Watch the heartbeat and
   incarnation. The recovering client deliberately fails in its first incarnation.
8. Interrupt the Web Worker and resume to recover the DAG and desired-running
   beacons. In service-worker mode, beacons run short slices and suspend between wakes.

The delays in these sample handlers make interruption and checkpoints visible.
They are demonstration workloads, not performance benchmarks.

After building dependencies, run `pnpm test:browser:install` once, then
`pnpm --filter example-17-browser test` for isolated headless Chromium checks.
These checks are also part of `pnpm test` and the release preflight.

Use the **Run browser checks** link for the real IndexedDB and worker test suite.
Close other demo tabs while running it; the integration checks share the demo
queue. Stop any manually started demo beacons first. The app caches its shell for offline reloads after the service worker is
ready. This requires localhost or HTTPS and a browser with module service-worker
support. Background Sync is detected at runtime and is optional.

After editing package source, rerun `pnpm dev:browser` to rebuild the dependencies.
The static server has no hot reload. In development, reload the page after the
updated service worker activates; production would need a coordinated asset and
handler version rollout. If an old tab shows a database-version error during
an upgrade, reload it to load the current runtime. Only this demo's older shell
caches are removed; queue data is preserved.

See [the runtime README](../../packages/station-browser/README.md) for the API,
recovery contract, and prototype limitations.
