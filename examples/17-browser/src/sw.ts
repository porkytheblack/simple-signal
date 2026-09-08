/// <reference lib="webworker" />
import { BrowserStation, configure } from "station-browser";
import { database, signals } from "./signals.js";
import { beacons, broadcasts } from "./workloads.js";

const sw = self as unknown as ServiceWorkerGlobalScope;
declare const __STATION_BUILD__: string;
const station = new BrowserStation({ database, signals, beacons, broadcasts, stationId: "service-worker" });
configure({ triggerAdapter: station });
const cacheName = `station-browser-demo-${__STATION_BUILD__}`;
const assets = ["./", "./index.html", "./style.css", "./app.js", "./worker.js"];
sw.addEventListener("install", (event) => {
  event.waitUntil(caches.open(cacheName).then((cache) => cache.addAll(assets)).then(() => sw.skipWaiting()));
});
sw.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    for (const name of await caches.keys()) {
      if (name.startsWith("station-browser-demo-") && name !== cacheName) await caches.delete(name);
    }
    await sw.clients.claim();
  })());
});
sw.addEventListener("fetch", (event) => {
  // This worker belongs to the standalone demo origin. Cache only the demo shell.
  const url = new URL(event.request.url);
  if (url.origin !== sw.location.origin || event.request.method !== "GET"
    || !["/", "/index.html", "/style.css", "/app.js", "/worker.js"].includes(url.pathname)) return;
  event.respondWith(fetch(event.request).catch(async () => {
    const cached = await (await caches.open(cacheName)).match(event.request);
    return cached ?? new Response("Open the demo once while online to cache it.", { status: 503 });
  }));
});
sw.addEventListener("message", (event) => {
  if (event.data?.type !== "station:drain") return;
  event.waitUntil(station.wake({ maxJobs: 12, budgetMs: 10_000, beaconSliceMs: 1_500 }).then(
    () => event.ports[0]?.postMessage({ ok: true }),
    (error) => event.ports[0]?.postMessage({ error: String(error) }),
  ));
});
// Background Sync is an enhancement. Page wake events work without this API.
sw.addEventListener("sync", ((event: ExtendableEvent & { tag: string }) => {
  if (event.tag === "station:drain") event.waitUntil(station.wake({ maxJobs: 12, budgetMs: 10_000, beaconSliceMs: 1_500 }));
}) as EventListener);
