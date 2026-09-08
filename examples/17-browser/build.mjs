import { build } from "esbuild";
import { mkdir, copyFile, readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
await mkdir(new URL("./dist/", import.meta.url), { recursive: true });
const common = {
  absWorkingDir: new URL(".", import.meta.url).pathname,
  bundle: true, platform: "browser", format: "esm", target: "es2022",
  outdir: "dist", sourcemap: true,
};
await build({ ...common, entryPoints: ["src/app.ts", "src/worker.ts", "src/tests.ts"] });
for (const file of ["index.html", "style.css", "tests.html"]) {
  await copyFile(new URL(`./${file}`, import.meta.url), new URL(`./dist/${file}`, import.meta.url));
}
// Change the service worker whenever its cached shell changes, including CSS/HTML.
const hash = createHash("sha256");
for (const file of ["app.js", "worker.js", "index.html", "style.css"]) hash.update(await readFile(new URL(`./dist/${file}`, import.meta.url)));
await build({ ...common, entryPoints: ["src/sw.ts"], define: { __STATION_BUILD__: JSON.stringify(hash.digest("hex").slice(0, 16)) } });
