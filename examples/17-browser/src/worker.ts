import { BrowserStation, configure } from "station-browser";
import { database, signals } from "./signals.js";
import { beacons, broadcasts } from "./workloads.js";

const station = new BrowserStation({ database, signals, beacons, broadcasts, stationId: "web-worker" });
configure({ triggerAdapter: station });
async function tick() {
  try { await station.drain(); }
  catch (error) { postMessage({ error: String(error) }); }
  setTimeout(tick, 300);
}
void tick();
setInterval(() => { void station.beacons.tick().catch((error) => postMessage({ error: String(error) })); }, 100);
self.addEventListener("message", () => { void station.drain().catch((error) => postMessage({ error: String(error) })); });
