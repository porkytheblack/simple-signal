import { chromium } from "playwright";
import { once } from "node:events";
import { createDemoServer } from "./serve.mjs";

// Build first so pnpm test never exercises a stale browser bundle.
await import("./build.mjs");
const server = createDemoServer();
let browser;
try {
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  browser = await chromium.launch({ headless: true });
  // A fresh context and ephemeral origin isolate storage and service workers
  // from the user's running lab and from earlier test executions.
  const context = await browser.newContext();
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (error) => errors.push(String(error)));
  await page.goto(`http://127.0.0.1:${server.address().port}/tests.html`);
  try {
    await page.waitForFunction(() => document.body.dataset.testStatus, undefined, { timeout: 120_000 });
  } finally {
    console.log(await page.locator("#results").innerText());
  }
  const status = await page.locator("body").getAttribute("data-test-status");
  if (status !== "passed" || errors.length) throw new Error(errors.join("\n") || "Browser checks failed");
} finally {
  await browser?.close();
  server.closeAllConnections();
  await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
}
