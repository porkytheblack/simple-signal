import { BrowserStation, configure, type BrowserRun, type BrowserBroadcastRun, type BrowserBeaconInstance } from "station-browser";
import { database, signals, report, retryDemo } from "./signals.js";
import { beacons, broadcasts, analysis, pulse, recovering } from "./workloads.js";

const station = new BrowserStation({ database, signals, beacons, broadcasts });
configure({ triggerAdapter: station });
const element = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const notice = element("notice");
const mode = element<HTMLSelectElement>("mode");
let worker: Worker | undefined;
let paused = false;
let registration: ServiceWorkerRegistration | undefined;
let rendering = false;

function reportError(error: unknown) { notice.textContent = error instanceof Error ? error.message : String(error); }
function startWorker() {
  if (worker || paused || mode.value !== "worker") return;
  worker = new Worker(new URL("./worker.js", import.meta.url), { type: "module" });
  worker.onmessage = (event) => { if (event.data.error) reportError(event.data.error); };
  worker.onerror = (event) => reportError(event.message);
}
function wake() {
  if (paused) return;
  if (mode.value === "worker") { startWorker(); worker?.postMessage({ type: "station:drain" }); }
  else registration?.active?.postMessage({ type: "station:drain" });
}
async function enqueue(kind: "report" | "retry") {
  try {
    if (kind === "report") await report.trigger({ text: element<HTMLTextAreaElement>("text").value });
    else await retryDemo.trigger({});
    notice.textContent = paused ? "Saved on this device. Resume to process the queue." : "Queued. You can reload this page while it runs.";
    // Register only when the user has chosen service-worker execution.
    const sync = (registration as ServiceWorkerRegistration & { sync?: { register(tag: string): Promise<void> } } | undefined)?.sync;
    if (!paused && mode.value === "service") await sync?.register("station:drain").catch(() => {});
    wake();
    await render();
  } catch (error) { reportError(error); }
}
element("queue").onclick = () => { void enqueue("report"); };
element("retry").onclick = () => { void enqueue("retry"); };
element("broadcast").onclick = () => {
  void analysis.trigger({ text: element<HTMLTextAreaElement>("text").value, failBranch: element<HTMLInputElement>("fail-branch").checked })
    .then(() => { notice.textContent = "Broadcast queued. Watch the two branches run together, then join."; wake(); return render(); }).catch(reportError);
};
function startBeacon(name: string) {
  void station.beacons.start(name).then(() => {
    notice.textContent = "Beacon requested. It stays desired-running across reloads; service workers supervise it in short slices.";
    wake(); return render();
  }).catch(reportError);
}
element("beacon-start").onclick = () => startBeacon(pulse.name);
element("beacon-crash").onclick = () => startBeacon(recovering.name);
element("reload").onclick = () => location.reload();
element("pause").onclick = () => {
  paused = !paused;
  if (paused) { worker?.terminate(); worker = undefined; }
  else wake();
  element("pause").textContent = paused ? "Resume execution" : "Interrupt worker";
  notice.textContent = paused
    ? "Web Worker stopped. Saved steps remain; unfinished work can retry after its lease expires."
    : "Execution resumed. Interrupted jobs recover when their leases expire.";
};
mode.onchange = () => {
  worker?.terminate(); worker = undefined; paused = false;
  element<HTMLButtonElement>("pause").disabled = mode.value === "service";
  element("pause").textContent = "Interrupt worker";
  notice.textContent = mode.value === "service"
    ? "The service worker processes short batches on wake events. Closed-page execution depends on the browser."
    : "Jobs run in a separate Web Worker. Reload or interrupt it to test recovery.";
  wake();
};

function describe(run: BrowserRun): HTMLElement {
  const row = document.createElement("article");
  row.className = "run";
  const top = document.createElement("div"); top.className = "run-top";
  const title = document.createElement("strong"); title.textContent = run.signalName;
  const badge = document.createElement("span"); badge.className = `status ${run.status}`; badge.textContent = run.status;
  top.append(title, badge);
  const meta = document.createElement("p"); meta.className = "meta";
  meta.textContent = `${run.id.slice(0, 8)} · attempt ${run.attempts}/${run.maxAttempts} · ${run.stationId ?? "waiting for a worker"}`;
  const progress = document.createElement("div"); progress.className = "checkpoints";
  for (const step of signals.find((signal) => signal.name === run.signalName)?.steps ?? []) {
    const saved = run.checkpoints.some((checkpoint) => checkpoint.name === step.name);
    const chip = document.createElement("span"); chip.className = saved ? "saved" : "";
    chip.textContent = `${saved ? "✓" : "○"} ${step.name}`; progress.append(chip);
  }
  row.append(top, meta, progress);
  if (run.output) {
    const output = document.createElement("pre"); output.textContent = JSON.stringify(JSON.parse(run.output), null, 2); row.append(output);
  }
  if (run.error) { const error = document.createElement("p"); error.className = "run-error"; error.textContent = run.error; row.append(error); }
  if (run.status === "running" || run.status === "pending") {
    const cancel = document.createElement("button"); cancel.className = "cancel"; cancel.textContent = "Cancel run";
    cancel.dataset.action = `cancel-${run.id}`;
    cancel.onclick = () => { void station.store.cancel(run.id).then(render).catch(reportError); }; row.append(cancel);
  }
  return row;
}
function tag(name: string, text: string, className = ""): HTMLElement {
  const node = document.createElement(name); node.textContent = text; node.className = className; return node;
}
function describeBroadcast(run: BrowserBroadcastRun): HTMLElement {
  const card = tag("article", "", "workflow-card");
  const heading = tag("div", "", "run-top"); heading.append(tag("strong", run.broadcastName), tag("span", run.status, `status ${run.status}`));
  card.append(tag("p", "BROADCAST / FAN-OUT → JOIN → GUARD", "eyebrow"), heading);
  const graph = tag("div", "", "dag");
  const depths = new Map<string, number>();
  for (const node of run.nodes) depths.set(node.name, Math.max(-1, ...node.dependsOn.map((name) => depths.get(name) ?? -1)) + 1);
  for (let depth = 0; depth <= Math.max(...depths.values()); depth++) {
    const tier = tag("div", "", "dag-tier");
    for (const node of run.nodes.filter((node) => depths.get(node.name) === depth)) {
      const cell = tag("div", "", `dag-node ${node.status}`);
      cell.append(tag("strong", node.name), tag("span", `${node.status}${node.skipReason ? ` · ${node.skipReason}` : ""}`)); tier.append(cell);
    }
    if (depth > 0) graph.append(tag("div", "↓", "dag-arrow"));
    graph.append(tier);
  }
  card.append(graph);
  if (run.error) card.append(tag("p", run.error, "run-error"));
  const output = [...run.nodes].reverse().find((node) => node.status === "completed" && node.output)?.output;
  if (run.status === "completed" && output) card.append(tag("pre", JSON.stringify(JSON.parse(output), null, 2)));
  if (["running", "pending"].includes(run.status)) {
    const cancel = tag("button", "Cancel broadcast", "cancel");
    cancel.dataset.action = `broadcast-${run.id}`;
    cancel.onclick = () => { void station.broadcasts.cancel(run.id).then(render).catch(reportError); }; card.append(cancel);
  }
  return card;
}
function describeBeacon(instance: BrowserBeaconInstance): HTMLElement {
  const card = tag("article", "", "beacon-card");
  const expired = instance.token && (instance.leaseExpiresAt ?? 0) <= Date.now();
  const status = expired ? instance.desired === "running" ? "suspended" : "stopped" : instance.status;
  const heading = tag("div", "", "run-top"); heading.append(tag("strong", instance.beaconName), tag("span", status, `status ${status}`));
  card.append(tag("p", "BEACON / SUPERVISED LIFECYCLE", "eyebrow"), heading,
    tag("p", `incarnation ${instance.incarnation} · desired ${instance.desired} · ${instance.owner ?? "not started"}`, "meta"));
  if (instance.heartbeatAt) card.append(tag("p", `Last heartbeat ${Math.max(0, Math.round((Date.now() - instance.heartbeatAt) / 1_000))}s ago`, "hint"));
  if (status === "suspended" && instance.desired === "running") card.append(tag("p", "Waiting for the next execution opportunity. Desired state is saved.", "hint"));
  if (instance.error) card.append(tag("p", instance.error, "run-error"));
  if (instance.logs.length) card.append(tag("pre", instance.logs.slice(-3).map((entry) => entry.message).join("\n"), "beacon-log"));
  if (instance.desired === "running") {
    const stop = tag("button", "Stop beacon", "cancel");
    stop.dataset.action = `stop-${instance.id}`;
    stop.onclick = () => { void station.beacons.stop(instance.id).then(() => { wake(); return render(); }).catch(reportError); }; card.append(stop);
  }
  return card;
}
async function render() {
  if (rendering) return;
  rendering = true;
  try {
    const focusedAction = (document.activeElement as HTMLElement | null)?.dataset.action;
    const runs = await station.store.list();
    const [workflowRuns, instances] = await Promise.all([station.broadcasts.list(), station.beacons.list()]);
    element("broadcasts").replaceChildren(...workflowRuns.slice(0, 5).map(describeBroadcast));
    element("beacons").replaceChildren(...instances.filter((instance) => instance.incarnation > 0 || instance.desired === "running").map(describeBeacon));
    element("empty").hidden = runs.length > 0;
    element("runs").replaceChildren(...runs.map(describe));
    if (focusedAction) document.querySelector<HTMLElement>(`[data-action="${CSS.escape(focusedAction)}"]`)?.focus({ preventScroll: true });
    element("total").textContent = String(runs.length);
    element("completed").textContent = String(runs.filter((run) => run.status === "completed").length);
    element("checkpoints").textContent = String(runs.reduce((count, run) => count + run.checkpoints.length, 0));
    element("connection").textContent = navigator.onLine ? "Device online" : "Offline · queue stays local";
  } catch (error) { reportError(error); }
  finally { rendering = false; }
}
startWorker();
void render();
setInterval(() => { void render(); wake(); }, 700);
if ("serviceWorker" in navigator) {
  void navigator.serviceWorker.register("./sw.js", { type: "module" }).then(async () => {
    registration = await navigator.serviceWorker.ready;
    element("sw-status").textContent = "Service worker ready · offline shell cached";
    (mode.querySelector('option[value="service"]') as HTMLOptionElement).disabled = false;
  }).catch(reportError);
} else element("sw-status").textContent = "Service workers unavailable; use localhost or HTTPS";
