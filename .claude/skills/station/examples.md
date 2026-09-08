# Station Examples

Complete, copy-pasteable examples for the Station background job framework.

> **For browser-local examples, read [browser.md](browser.md).** Use the
> explicit BrowserStation registry and worker hosts there; do not adapt Node
> runner constructors or station.config.ts into a browser bundle.
>
> **How to run the Node examples below: `station-kit`.** Signals, broadcasts, and beacons
> are just exported definitions in `signalsDir` / `broadcastsDir` /
> `beaconsDir` — a `station.config.ts` calling `defineConfig` plus
> `npx station` discovers and runs them, with the dashboard and v1 API included.
>
> ```ts
> // station.config.ts
> import { defineConfig } from "station-kit";
> import { SqliteAdapter } from "station-adapter-sqlite";
> import { BroadcastSqliteAdapter } from "station-adapter-sqlite/broadcast";
>
> export default defineConfig({
>   signalsDir: "./signals",
>   broadcastsDir: "./broadcasts",
>   beaconsDir: "./beacons",
>   adapter: new SqliteAdapter({ dbPath: "./jobs.db" }),
>   broadcastAdapter: new BroadcastSqliteAdapter({ dbPath: "./jobs.db" }),
> });
> ```
>
> Several examples below construct `SignalRunner` / `BroadcastRunner` /
> `BeaconRunner` by hand to show what a runner does and which options exist.
> That is the escape hatch, for embedding Station in a process you own, headless
> workers, and tests — **not** the shape to copy for a normal app. Prefer the
> config above and let station-kit wire the runners.

## Contents

1. [Basic Signal](#1-basic-signal----send-email)
2. [Signal with Output](#2-signal-with-output----image-processing)
3. [Multi-Step Signal](#3-multi-step-signal----order-processing)
4. [Recurring Signals](#4-recurring-signal----health-check)
5. [Recurring Signal with Input](#5-recurring-signal-with-input)
6. [Broadcast](#6-broadcast----ci-pipeline)
7. [Conditional Broadcast](#7-broadcast-with-conditional-nodes)
8. [ETL Pipeline](#8-etl-pipeline)
9. [Complete Runner Setup](#9-complete-runner-setup)
10. [Custom Subscriber](#10-custom-subscriber----slack-alerts)
11. [Remote Trigger](#11-remote-trigger-setup)
12. [Separate Processes](#12-shared-adapter-for-separate-processes)
13. [Dashboard Configuration](#13-station-dashboard-configuration)
14. [PostgreSQL](#14-postgresql-setup)
15. [Redis](#15-redis-setup)
16. [MySQL](#16-mysql-setup)
17. [Project Structure](#17-project-structure)
18. [Deployment](#18-deployment)
19. [Tauri](#19-tauri-v2-desktop-app)
20. [Dynamic Broadcasts](#20-dynamic-broadcasts-runtime-editable)
21. [Runtime Schedules](#21-schedules-runtime)
22. [Expressions](#22-expressions)
23. [Custom API Key Storage](#23-custom-api-key-storage)
24. [Beacons](#24-beacon----server-poller-client)
25. [Environment Variables](#25-environment-variables)
26. [Station Network](#26-station-network----headquarters-and-workers)
27. [Quick Reference](#quick-reference)

---

## 1. Basic Signal -- Send Email

A signal with typed input, timeout, retries, calling an external email API.

```ts
// signals/send-email.ts
import { signal, z } from "station-signal";

export const sendEmail = signal("send-email")
  .input(
    z.object({
      to: z.string(),
      subject: z.string(),
      body: z.string(),
    })
  )
  .timeout(15_000)
  .retries(2) // 3 total attempts (1 initial + 2 retries)
  .run(async (input) => {
    const response = await fetch("https://api.sendgrid.com/v3/mail/send", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.SENDGRID_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        personalizations: [{ to: [{ email: input.to }] }],
        from: { email: "noreply@myapp.com" },
        subject: input.subject,
        content: [{ type: "text/plain", value: input.body }],
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`SendGrid API error (${response.status}): ${error}`);
    }
  });
```

Trigger it:

```ts
// trigger.ts
import { sendEmail } from "./signals/send-email.js";

const runId = await sendEmail.trigger({
  to: "alice@example.com",
  subject: "Your order has shipped",
  body: "Tracking number: 1Z999AA10123456784",
});

console.log(`Queued email send: ${runId}`);
```

---

## 2. Signal with Output -- Image Processing

Signal that returns typed output using `.output()`.

```ts
// signals/resize-image.ts
import { signal, z } from "station-signal";

export const resizeImage = signal("resize-image")
  .input(
    z.object({
      sourceUrl: z.string().url(),
      width: z.number().int().positive(),
      height: z.number().int().positive(),
      format: z.enum(["webp", "png", "jpeg"]),
    })
  )
  .output(
    z.object({
      outputUrl: z.string().url(),
      fileSizeBytes: z.number(),
      width: z.number(),
      height: z.number(),
    })
  )
  .timeout(30_000)
  .retries(1)
  .run(async (input) => {
    const response = await fetch("https://images.mycdn.com/api/resize", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.IMAGE_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        source: input.sourceUrl,
        width: input.width,
        height: input.height,
        format: input.format,
      }),
    });

    if (!response.ok) {
      throw new Error(`Image API error: ${response.status}`);
    }

    const result = await response.json();
    return {
      outputUrl: result.url as string,
      fileSizeBytes: result.size as number,
      width: input.width,
      height: input.height,
    };
  });
```

---

## 3. Multi-Step Signal -- Order Processing

Pipeline with `.step()` chain and `.build()`.

```ts
// signals/process-order.ts
import { signal, z } from "station-signal";

export const processOrder = signal("process-order")
  .input(
    z.object({
      orderId: z.string(),
      customerId: z.string(),
      items: z.array(z.object({
        sku: z.string(),
        quantity: z.number().int().positive(),
        pricePerUnit: z.number().positive(),
      })),
    })
  )
  .timeout(60_000)
  .retries(1)
  .step("validate", async (input) => {
    if (input.items.length === 0) {
      throw new Error("Order must contain at least one item");
    }
    const total = input.items.reduce(
      (sum, item) => sum + item.quantity * item.pricePerUnit,
      0
    );
    return { ...input, total };
  })
  .step("reserve-inventory", async (prev) => {
    const response = await fetch("https://api.warehouse.internal/reserve", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        orderId: prev.orderId,
        items: prev.items.map((i) => ({ sku: i.sku, qty: i.quantity })),
      }),
    });
    if (!response.ok) {
      throw new Error(`Inventory reservation failed: ${response.status}`);
    }
    const { reservationId } = (await response.json()) as { reservationId: string };
    return { ...prev, reservationId };
  })
  .step("charge-payment", async (prev) => {
    const response = await fetch("https://api.stripe.com/v1/charges", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.STRIPE_SECRET_KEY}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({
        amount: String(Math.round(prev.total * 100)),
        currency: "usd",
        customer: prev.customerId,
        metadata: JSON.stringify({ orderId: prev.orderId }),
      }),
    });
    if (!response.ok) {
      throw new Error(`Payment failed: ${response.status}`);
    }
    const charge = (await response.json()) as { id: string };
    return { ...prev, chargeId: charge.id };
  })
  .step("send-confirmation", async (prev) => {
    await fetch("https://api.sendgrid.com/v3/mail/send", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.SENDGRID_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        personalizations: [{ to: [{ email: prev.customerId }] }],
        from: { email: "orders@myapp.com" },
        subject: `Order ${prev.orderId} confirmed`,
        content: [{
          type: "text/plain",
          value: `Your order for $${prev.total.toFixed(2)} has been confirmed. Charge ID: ${prev.chargeId}`,
        }],
      }),
    });
    return {
      orderId: prev.orderId,
      chargeId: prev.chargeId,
      reservationId: prev.reservationId,
      total: prev.total,
      status: "confirmed" as const,
    };
  })
  .build();
```

---

## 4. Recurring Signal -- Health Check

Signal with `.every()` and `.onComplete()` hook for alerting.

```ts
// signals/health-check.ts
import { signal, z } from "station-signal";

export const healthCheck = signal("health-check")
  .output(
    z.object({
      apiLatencyMs: z.number(),
      dbLatencyMs: z.number(),
      healthy: z.boolean(),
    })
  )
  .every("5m")
  .timeout(30_000)
  .run(async () => {
    const apiStart = Date.now();
    const apiRes = await fetch("https://api.myapp.com/health");
    const apiLatencyMs = Date.now() - apiStart;

    const dbStart = Date.now();
    const dbRes = await fetch("https://api.myapp.com/health/db");
    const dbLatencyMs = Date.now() - dbStart;

    const healthy = apiRes.ok && dbRes.ok;

    return { apiLatencyMs, dbLatencyMs, healthy };
  })
  .onComplete(async (output) => {
    if (!output.healthy) {
      await fetch(process.env.SLACK_WEBHOOK_URL!, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          text: `Health check FAILED -- API: ${output.apiLatencyMs}ms, DB: ${output.dbLatencyMs}ms`,
        }),
      });
    }
  });
```

---

## 5. Recurring Signal with Input

Using `.withInput()` to provide a default payload for recurring runs.

```ts
// signals/sync-inventory.ts
import { signal, z } from "station-signal";

export const syncInventory = signal("sync-inventory")
  .input(
    z.object({
      warehouseId: z.string(),
      region: z.enum(["us-east", "us-west", "eu-central"]),
    })
  )
  .every("6h")
  .withInput({ warehouseId: "WH-001", region: "us-east" })
  .timeout(120_000)
  .run(async (input) => {
    const response = await fetch(
      `https://api.warehouse.internal/sync/${input.warehouseId}?region=${input.region}`,
      { method: "POST" }
    );
    if (!response.ok) {
      throw new Error(`Inventory sync failed: ${response.status}`);
    }
    console.log(`Synced warehouse ${input.warehouseId} (${input.region})`);
  });
```

---

## 6. Broadcast -- CI Pipeline

Full DAG workflow. All signal files plus broadcast definition. Uses `.onFailure("fail-fast")`.

### Signal files

```ts
// signals/checkout.ts
import { signal, z } from "station-signal";

export const checkout = signal("checkout")
  .input(z.object({ repo: z.string(), branch: z.string(), commitSha: z.string() }))
  .output(z.object({ repo: z.string(), branch: z.string(), commitSha: z.string(), workdir: z.string() }))
  .timeout(30_000)
  .run(async (input) => {
    const response = await fetch("https://ci.internal/api/checkout", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    });
    if (!response.ok) throw new Error(`Checkout failed: ${response.status}`);
    const { workdir } = (await response.json()) as { workdir: string };
    return { ...input, workdir };
  });
```

```ts
// signals/lint.ts
import { signal, z } from "station-signal";

export const lint = signal("lint")
  .input(z.object({ repo: z.string(), branch: z.string(), commitSha: z.string(), workdir: z.string() }))
  .output(z.object({ passed: z.boolean(), errorCount: z.number() }))
  .timeout(60_000)
  .run(async (input) => {
    const response = await fetch("https://ci.internal/api/lint", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ workdir: input.workdir }),
    });
    if (!response.ok) throw new Error(`Lint failed: ${response.status}`);
    return (await response.json()) as { passed: boolean; errorCount: number };
  });
```

```ts
// signals/test-unit.ts
import { signal, z } from "station-signal";

export const testUnit = signal("test-unit")
  .input(z.object({ repo: z.string(), branch: z.string(), commitSha: z.string(), workdir: z.string() }))
  .output(z.object({ passed: z.boolean(), testCount: z.number(), failedCount: z.number() }))
  .timeout(120_000)
  .retries(2)
  .run(async (input) => {
    const response = await fetch("https://ci.internal/api/test-unit", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ workdir: input.workdir }),
    });
    if (!response.ok) throw new Error(`Unit tests failed: ${response.status}`);
    return (await response.json()) as { passed: boolean; testCount: number; failedCount: number };
  });
```

```ts
// signals/build-app.ts
import { signal, z } from "station-signal";

export const buildApp = signal("build-app")
  .input(z.object({ repo: z.string(), branch: z.string(), commitSha: z.string(), workdir: z.string() }))
  .output(z.object({ artifactUrl: z.string(), buildTimeMs: z.number() }))
  .timeout(180_000)
  .run(async (input) => {
    const start = Date.now();
    const response = await fetch("https://ci.internal/api/build", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ workdir: input.workdir }),
    });
    if (!response.ok) throw new Error(`Build failed: ${response.status}`);
    const { artifactUrl } = (await response.json()) as { artifactUrl: string };
    return { artifactUrl, buildTimeMs: Date.now() - start };
  });
```

```ts
// signals/deploy.ts
import { signal, z } from "station-signal";

export const deploy = signal("deploy")
  .input(z.object({ artifactUrl: z.string(), buildTimeMs: z.number() }))
  .output(z.object({ deploymentUrl: z.string(), environment: z.string() }))
  .timeout(120_000)
  .run(async (input) => {
    const response = await fetch("https://ci.internal/api/deploy", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ artifactUrl: input.artifactUrl }),
    });
    if (!response.ok) throw new Error(`Deploy failed: ${response.status}`);
    return (await response.json()) as { deploymentUrl: string; environment: string };
  });
```

### Broadcast definition

```ts
// broadcasts/ci-pipeline.ts
import { broadcast } from "station-broadcast";
import { checkout } from "../signals/checkout.js";
import { lint } from "../signals/lint.js";
import { testUnit } from "../signals/test-unit.js";
import { buildApp } from "../signals/build-app.js";
import { deploy } from "../signals/deploy.js";

// DAG:
//   checkout
//     |--> lint
//     |--> test-unit
//           |
//        build-app (waits for lint + test-unit)
//           |
//         deploy

export const ciPipeline = broadcast("ci-pipeline")
  .input(checkout)                     // root node: receives broadcast input
  .then(lint, testUnit)                // fan-out: both run in parallel after checkout
  .then(buildApp, {
    after: ["checkout", "lint", "test-unit"],
    map: (upstream) => upstream["checkout"], // pass checkout output as build input
  })
  .then(deploy)
  .onFailure("fail-fast")
  .timeout(300_000)
  .build();
```

### Trigger

```ts
// trigger.ts
import { ciPipeline } from "./broadcasts/ci-pipeline.js";

const runId = await ciPipeline.trigger({
  repo: "myorg/myapp",
  branch: "main",
  commitSha: "a1b2c3d4e5f6789012345678901234567890abcd",
});

console.log(`CI pipeline triggered: ${runId}`);
```

---

## 7. Broadcast with Conditional Nodes

Using `when` and `map` in `.then()` options.

```ts
// broadcasts/deploy-pipeline.ts
import { broadcast } from "station-broadcast";
import { buildApp } from "../signals/build-app.js";
import { runSmoke } from "../signals/run-smoke.js";
import { deployStaging } from "../signals/deploy-staging.js";
import { deployProd } from "../signals/deploy-prod.js";
import { notifyTeam } from "../signals/notify-team.js";

export const deployPipeline = broadcast("deploy-pipeline")
  .input(buildApp)
  .then(runSmoke)
  .then(deployStaging)
  .then(deployProd, {
    after: ["deploy-staging", "buildApp"],
    map: (upstream) => upstream["deploy-staging"],
    when: (upstream) => {
      // Only deploy to production if the original build was for the main branch
      const build = upstream["buildApp"] as { branch?: string } | undefined;
      return build?.branch === "main";
    },
  })
  .then(notifyTeam, {
    // Notify always runs -- uses staging output if prod was skipped
    after: ["deploy-prod", "deploy-staging"],
    map: (upstream) => upstream["deploy-prod"] ?? upstream["deploy-staging"],
  })
  .onFailure("skip-downstream")
  .build();
```

Key behavior:
- `when` receives upstream outputs keyed by node name. If it returns `false`, the node is skipped (status `"skipped"`, skipReason `"guard"`).
- Guard-skipped nodes do NOT propagate failure downstream. Downstream nodes see the skipped node and its output as `undefined`.
- `map` transforms the upstream outputs map into the signal's input.

---

## 8. ETL Pipeline

Recurring broadcast with `.every()`.

### Signal files

```ts
// signals/extract-users.ts
import { signal, z } from "station-signal";

export const extractUsers = signal("extract-users")
  .input(z.object({ since: z.string() }))
  .output(z.object({ users: z.array(z.object({ id: z.string(), email: z.string(), name: z.string() })), count: z.number() }))
  .timeout(60_000)
  .run(async (input) => {
    const response = await fetch(
      `https://api.source-system.internal/users?updated_since=${input.since}`,
      { headers: { Authorization: `Bearer ${process.env.SOURCE_API_KEY}` } }
    );
    if (!response.ok) throw new Error(`Extract failed: ${response.status}`);
    const users = (await response.json()) as Array<{ id: string; email: string; name: string }>;
    return { users, count: users.length };
  });
```

```ts
// signals/transform-users.ts
import { signal, z } from "station-signal";

export const transformUsers = signal("transform-users")
  .input(z.object({ users: z.array(z.object({ id: z.string(), email: z.string(), name: z.string() })), count: z.number() }))
  .output(z.object({ records: z.array(z.object({ externalId: z.string(), emailNormalized: z.string(), displayName: z.string() })), count: z.number() }))
  .timeout(30_000)
  .run(async (input) => {
    const records = input.users.map((u) => ({
      externalId: u.id,
      emailNormalized: u.email.toLowerCase().trim(),
      displayName: u.name,
    }));
    return { records, count: records.length };
  });
```

```ts
// signals/load-users.ts
import { signal, z } from "station-signal";

export const loadUsers = signal("load-users")
  .input(z.object({ records: z.array(z.object({ externalId: z.string(), emailNormalized: z.string(), displayName: z.string() })), count: z.number() }))
  .output(z.object({ inserted: z.number(), updated: z.number() }))
  .timeout(60_000)
  .retries(2)
  .run(async (input) => {
    const response = await fetch("https://api.data-warehouse.internal/bulk-upsert", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.WAREHOUSE_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ records: input.records }),
    });
    if (!response.ok) throw new Error(`Load failed: ${response.status}`);
    return (await response.json()) as { inserted: number; updated: number };
  });
```

### Broadcast definition

```ts
// broadcasts/etl-pipeline.ts
import { broadcast } from "station-broadcast";
import { extractUsers } from "../signals/extract-users.js";
import { transformUsers } from "../signals/transform-users.js";
import { loadUsers } from "../signals/load-users.js";

export const etlPipeline = broadcast("etl-pipeline")
  .input(extractUsers)
  .then(transformUsers)
  .then(loadUsers)
  .onFailure("fail-fast")
  .every("6h")
  .withInput({ since: new Date(Date.now() - 6 * 60 * 60 * 1000).toISOString() })
  .build();
```

---

## 9. Complete Runner Setup

Full `runner.ts` with `SignalRunner` + `BroadcastRunner`, `SqliteAdapter`, graceful shutdown.

```ts
// runner.ts
import path from "node:path";
import { SignalRunner, ConsoleSubscriber } from "station-signal";
import { BroadcastRunner, ConsoleBroadcastSubscriber } from "station-broadcast";
import { SqliteAdapter } from "station-adapter-sqlite";
import { BroadcastSqliteAdapter } from "station-adapter-sqlite/broadcast";

const DB_PATH = path.join(import.meta.dirname, "station.db");

// Both adapters share the same database file
const signalAdapter = new SqliteAdapter({ dbPath: DB_PATH });
const broadcastAdapter = new BroadcastSqliteAdapter({ dbPath: DB_PATH });

const signalRunner = new SignalRunner({
  signalsDir: path.join(import.meta.dirname, "signals"),
  adapter: signalAdapter,
  subscribers: [new ConsoleSubscriber()],
  maxConcurrent: 10,
  retryBackoffMs: 2000,
});

const broadcastRunner = new BroadcastRunner({
  signalRunner,
  broadcastsDir: path.join(import.meta.dirname, "broadcasts"),
  adapter: broadcastAdapter,
  subscribers: [new ConsoleBroadcastSubscriber()],
});

// Graceful shutdown: broadcast runner stops BEFORE signal runner
// because broadcast queries the DB during shutdown to cancel running nodes
async function shutdown() {
  console.log("Shutting down...");
  await broadcastRunner.stop({ graceful: true, timeoutMs: 15_000 });
  await signalRunner.stop({ graceful: true, timeoutMs: 15_000 });
  process.exit(0);
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

// Start both runners (non-blocking -- they run polling loops)
signalRunner.start();
broadcastRunner.start();
```

---

## 10. Custom Subscriber -- Slack Alerts

Implementing `SignalSubscriber` with selective hooks.

```ts
// subscribers/slack-alert.ts
import type { SignalSubscriber } from "station-signal";

export class SlackAlertSubscriber implements SignalSubscriber {
  private webhookUrl: string;

  constructor(webhookUrl: string) {
    this.webhookUrl = webhookUrl;
  }

  onRunFailed(event: { run: { id: string; signalName: string; attempts: number }; error?: string }): void {
    this.send(
      `:x: *Signal failed*: \`${event.run.signalName}\`\n` +
      `Run: \`${event.run.id}\`\n` +
      `Attempts: ${event.run.attempts}\n` +
      `Error: ${event.error ?? "Unknown"}`
    );
  }

  onRunTimeout(event: { run: { id: string; signalName: string; timeout: number } }): void {
    this.send(
      `:warning: *Signal timed out*: \`${event.run.signalName}\`\n` +
      `Run: \`${event.run.id}\`\n` +
      `Timeout: ${event.run.timeout}ms`
    );
  }

  onRunCompleted(event: { run: { id: string; signalName: string } }): void {
    this.send(
      `:white_check_mark: *Signal completed*: \`${event.run.signalName}\`\n` +
      `Run: \`${event.run.id}\``
    );
  }

  private send(text: string): void {
    fetch(this.webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text }),
    }).catch((err) => {
      console.error("Slack notification failed:", err);
    });
  }
}
```

Usage:

```ts
// runner.ts
import { SignalRunner } from "station-signal";
import { SqliteAdapter } from "station-adapter-sqlite";
import { SlackAlertSubscriber } from "./subscribers/slack-alert.js";

const runner = new SignalRunner({
  signalsDir: "./signals",
  adapter: new SqliteAdapter({ dbPath: "station.db" }),
  subscribers: [
    new SlackAlertSubscriber(process.env.SLACK_WEBHOOK_URL!),
  ],
});

await runner.start();
```

---

## 11. Remote Trigger Setup

Using `configure()` with `endpoint` and `apiKey` to trigger signals from a separate process.

```ts
// remote-trigger.ts
import { configure } from "station-signal";
import { sendEmail } from "./signals/send-email.js";

// Option A: explicit configure()
configure({
  endpoint: "https://station.myapp.com",
  apiKey: "sk_live_abc123def456",
});

// Option B: environment variables (auto-detected, no configure() needed)
// STATION_ENDPOINT=https://station.myapp.com
// STATION_API_KEY=sk_live_abc123def456

const runId = await sendEmail.trigger({
  to: "alice@example.com",
  subject: "Welcome aboard",
  body: "Your account is ready.",
});

console.log(`Triggered remotely: ${runId}`);
```

For broadcasts:

```ts
// remote-broadcast-trigger.ts
import { configure } from "station-signal";
import { ciPipeline } from "./broadcasts/ci-pipeline.js";

configure({
  endpoint: "https://station.myapp.com",
  apiKey: "sk_live_abc123def456",
});

const runId = await ciPipeline.trigger({
  repo: "myorg/myapp",
  branch: "main",
  commitSha: "a1b2c3d4e5f6789012345678901234567890abcd",
});

console.log(`CI pipeline triggered remotely: ${runId}`);
```

---

## 12. Shared Adapter for Separate Processes

When the trigger process and runner process share a SQLite database. The trigger writes directly to the same database instead of going through the HTTP API.

### Runner process

```ts
// runner.ts
import path from "node:path";
import { SignalRunner, ConsoleSubscriber } from "station-signal";
import { SqliteAdapter } from "station-adapter-sqlite";

const adapter = new SqliteAdapter({ dbPath: "/var/data/station.db" });

const runner = new SignalRunner({
  signalsDir: path.join(import.meta.dirname, "signals"),
  adapter,
  subscribers: [new ConsoleSubscriber()],
});

await runner.start();
```

### Trigger process

```ts
// trigger.ts
import { configure } from "station-signal";
import { SqliteAdapter } from "station-adapter-sqlite";
import { sendEmail } from "./signals/send-email.js";

// Point to the same database file the runner uses
configure({
  adapter: new SqliteAdapter({ dbPath: "/var/data/station.db" }),
});

const runId = await sendEmail.trigger({
  to: "alice@example.com",
  subject: "Shipped",
  body: "Your order has shipped.",
});

console.log(`Run queued: ${runId}`);
process.exit(0);
```

---

## 13. Station Dashboard Configuration

Complete `station.config.ts` with all options.

```ts
// station.config.ts
import { defineConfig } from "station-kit";
import { SqliteAdapter } from "station-adapter-sqlite";
import { BroadcastSqliteAdapter } from "station-adapter-sqlite/broadcast";

export default defineConfig({
  port: 4400,
  host: "localhost",

  // Signal and broadcast directories (auto-discovered)
  signalsDir: "./signals",
  broadcastsDir: "./broadcasts",

  // Adapters (both share the same database file)
  adapter: new SqliteAdapter({ dbPath: "./station.db" }),
  broadcastAdapter: new BroadcastSqliteAdapter({ dbPath: "./station.db" }),

  // Signal runner tuning
  runner: {
    pollIntervalMs: 1000,
    maxConcurrent: 5,
    maxAttempts: 1,
    retryBackoffMs: 1000,
  },

  // Broadcast runner tuning
  broadcastRunner: {
    pollIntervalMs: 1000,
  },

  // Set to false to run the dashboard API without processing jobs
  runRunners: true,

  // Open browser on start
  open: true,

  // Log level: "debug" | "info" | "warn" | "error"
  logLevel: "info",

  // Dashboard authentication (required for API key management)
  auth: {
    username: "admin",
    password: "change-me-in-production",
  },
});
```

Run with:

```sh
npx station
```

Deploy to production:

```sh
npx station deploy
# Bundle generated at .station/out/
# Ready for Docker, Railway, Fly.io, etc.
```

---

## 14. PostgreSQL Setup

Using `PostgresAdapter` with a shared `pg.Pool`.

```ts
// runner.ts
import path from "node:path";
import pg from "pg";
import { SignalRunner, ConsoleSubscriber } from "station-signal";
import { BroadcastRunner, ConsoleBroadcastSubscriber } from "station-broadcast";
import { PostgresAdapter } from "station-adapter-postgres";
import { BroadcastPostgresAdapter } from "station-adapter-postgres/broadcast";

const connectionString = process.env.DATABASE_URL ?? "postgresql://localhost:5432/station";

// Share a single connection pool across both adapters
const pool = new pg.Pool({ connectionString });

const signalAdapter = new PostgresAdapter({ pool });
const broadcastAdapter = new BroadcastPostgresAdapter({ pool });

const signalRunner = new SignalRunner({
  signalsDir: path.join(import.meta.dirname, "signals"),
  adapter: signalAdapter,
  subscribers: [new ConsoleSubscriber()],
});

const broadcastRunner = new BroadcastRunner({
  signalRunner,
  broadcastsDir: path.join(import.meta.dirname, "broadcasts"),
  adapter: broadcastAdapter,
  subscribers: [new ConsoleBroadcastSubscriber()],
});

async function shutdown() {
  await broadcastRunner.stop({ graceful: true, timeoutMs: 15_000 });
  await signalRunner.stop({ graceful: true, timeoutMs: 15_000 });
  await pool.end();
  process.exit(0);
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

signalRunner.start();
broadcastRunner.start();
```

Station config with PostgreSQL:

```ts
// station.config.ts
import { defineConfig } from "station-kit";
import pg from "pg";
import { PostgresAdapter } from "station-adapter-postgres";
import { BroadcastPostgresAdapter } from "station-adapter-postgres/broadcast";

const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL ?? "postgresql://localhost:5432/station",
});

export default defineConfig({
  port: 4400,
  signalsDir: "./signals",
  broadcastsDir: "./broadcasts",
  adapter: new PostgresAdapter({ pool }),
  broadcastAdapter: new BroadcastPostgresAdapter({ pool }),
  auth: {
    username: "admin",
    password: process.env.STATION_PASSWORD ?? "change-me",
  },
});
```

---

## 15. Redis Setup

Using `RedisAdapter` with a shared `ioredis` instance.

```ts
// runner.ts
import path from "node:path";
import Redis from "ioredis";
import { SignalRunner, ConsoleSubscriber } from "station-signal";
import { BroadcastRunner, ConsoleBroadcastSubscriber } from "station-broadcast";
import { RedisAdapter } from "station-adapter-redis";
import { BroadcastRedisAdapter } from "station-adapter-redis/broadcast";

const redisUrl = process.env.REDIS_URL ?? "redis://localhost:6379";

// Share a single Redis connection across both adapters
const redis = new Redis(redisUrl);

const signalAdapter = new RedisAdapter({ redis, prefix: "station" });
const broadcastAdapter = new BroadcastRedisAdapter({ redis, prefix: "station" });

const signalRunner = new SignalRunner({
  signalsDir: path.join(import.meta.dirname, "signals"),
  adapter: signalAdapter,
  subscribers: [new ConsoleSubscriber()],
});

const broadcastRunner = new BroadcastRunner({
  signalRunner,
  broadcastsDir: path.join(import.meta.dirname, "broadcasts"),
  adapter: broadcastAdapter,
  subscribers: [new ConsoleBroadcastSubscriber()],
});

async function shutdown() {
  await broadcastRunner.stop({ graceful: true, timeoutMs: 15_000 });
  await signalRunner.stop({ graceful: true, timeoutMs: 15_000 });
  await redis.quit();
  process.exit(0);
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

signalRunner.start();
broadcastRunner.start();
```

Station config with Redis:

```ts
// station.config.ts
import { defineConfig } from "station-kit";
import Redis from "ioredis";
import { RedisAdapter } from "station-adapter-redis";
import { BroadcastRedisAdapter } from "station-adapter-redis/broadcast";

const redis = new Redis(process.env.REDIS_URL ?? "redis://localhost:6379");

export default defineConfig({
  port: 4400,
  signalsDir: "./signals",
  broadcastsDir: "./broadcasts",
  adapter: new RedisAdapter({ redis }),
  broadcastAdapter: new BroadcastRedisAdapter({ redis }),
  auth: {
    username: "admin",
    password: process.env.STATION_PASSWORD ?? "change-me",
  },
});
```

---

## 16. MySQL Setup

Using `MysqlAdapter.create()` static factory. MySQL adapters are async -- use `await`.

```ts
// runner.ts
import path from "node:path";
import mysql from "mysql2/promise";
import { SignalRunner, ConsoleSubscriber } from "station-signal";
import { BroadcastRunner, ConsoleBroadcastSubscriber } from "station-broadcast";
import { MysqlAdapter } from "station-adapter-mysql";
import { BroadcastMysqlAdapter } from "station-adapter-mysql/broadcast";

const connectionString = process.env.DATABASE_URL ?? "mysql://root@localhost:3306/station";

// Share a single connection pool across both adapters
const pool = mysql.createPool(connectionString);

// MysqlAdapter uses a static factory (NOT new MysqlAdapter())
const signalAdapter = await MysqlAdapter.create({ pool });
const broadcastAdapter = await BroadcastMysqlAdapter.create({ pool });

const signalRunner = new SignalRunner({
  signalsDir: path.join(import.meta.dirname, "signals"),
  adapter: signalAdapter,
  subscribers: [new ConsoleSubscriber()],
});

const broadcastRunner = new BroadcastRunner({
  signalRunner,
  broadcastsDir: path.join(import.meta.dirname, "broadcasts"),
  adapter: broadcastAdapter,
  subscribers: [new ConsoleBroadcastSubscriber()],
});

async function shutdown() {
  await broadcastRunner.stop({ graceful: true, timeoutMs: 15_000 });
  await signalRunner.stop({ graceful: true, timeoutMs: 15_000 });
  await pool.end();
  process.exit(0);
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

signalRunner.start();
broadcastRunner.start();
```

Station config with MySQL:

```ts
// station.config.ts
import { defineConfig } from "station-kit";
import mysql from "mysql2/promise";
import { MysqlAdapter } from "station-adapter-mysql";
import { BroadcastMysqlAdapter } from "station-adapter-mysql/broadcast";

const pool = mysql.createPool(
  process.env.DATABASE_URL ?? "mysql://root@localhost:3306/station"
);

const signalAdapter = await MysqlAdapter.create({ pool });
const broadcastAdapter = await BroadcastMysqlAdapter.create({ pool });

export default defineConfig({
  port: 4400,
  signalsDir: "./signals",
  broadcastsDir: "./broadcasts",
  adapter: signalAdapter,
  broadcastAdapter,
  auth: {
    username: "admin",
    password: process.env.STATION_PASSWORD ?? "change-me",
  },
});
```

---

## 17. Project Structure

Recommended layout.

```
my-app/
  package.json
  tsconfig.json
  station.config.ts         # optional -- only needed for dashboard
  lib/                       # shared code (auto-bundled on deploy)
    db.ts
    schema.ts
  signals/
    send-email.ts
    resize-image.ts
    process-order.ts
    health-check.ts
  broadcasts/
    ci-pipeline.ts
    etl-pipeline.ts
  subscribers/
    slack-alert.ts
  runner.ts                  # entry point (or use `npx station`)
  trigger.ts                 # separate trigger script (optional)
```

### package.json

```json
{
  "name": "my-station-app",
  "type": "module",
  "scripts": {
    "start": "npx tsx runner.ts",
    "trigger": "npx tsx trigger.ts",
    "dashboard": "npx station",
    "deploy": "station deploy"
  },
  "dependencies": {
    "station-signal": "^1.0.0",
    "station-broadcast": "^1.0.0",
    "station-adapter-sqlite": "^1.0.0",
    "station-kit": "^1.0.0"
  },
  "devDependencies": {
    "tsx": "^4.0.0",
    "typescript": "^5.0.0"
  },
  "pnpm": {
    "onlyBuiltDependencies": ["better-sqlite3", "esbuild"]
  }
}
```

> **pnpm 10+**: The `onlyBuiltDependencies` field is required because pnpm 10 blocks native build scripts by default. Without it, `better-sqlite3` won't compile and you'll get "native binary hasn't been compiled" errors. After adding this field, run `pnpm install` again.

### tsconfig.json

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "Node16",
    "moduleResolution": "Node16",
    "outDir": "dist",
    "rootDir": ".",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true
  },
  "include": ["**/*.ts"],
  "exclude": ["node_modules", "dist"]
}
```

---

## 18. Deployment

### Generate a deploy bundle

```sh
npx station deploy
```

Output in `.station/out/` — ready to deploy anywhere.

### Deploy with Docker

```sh
npx station deploy
docker build -t my-app .station/out
docker run -p 4400:4400 \
  -e STATION_AUTH_USERNAME=admin \
  -e STATION_AUTH_PASSWORD=secret \
  my-app
```

### Shared code is bundled automatically

Signals and broadcasts can import shared local code. esbuild resolves all imports and extracts shared modules into chunks.

```ts
// lib/db.ts — shared database client
import { drizzle } from "drizzle-orm/better-sqlite3";
import Database from "better-sqlite3";
export const db = drizzle(new Database("app.db"));

// signals/process-order.ts — imports shared code
import { signal, z } from "station-signal";
import { db } from "../lib/db.js";
import { orders } from "../lib/schema.js";
import { eq } from "drizzle-orm";

export const processOrder = signal("process-order")
  .input(z.object({ orderId: z.string() }))
  .run(async (input) => {
    const order = db.select().from(orders).where(eq(orders.id, input.orderId)).get();
    // ... process order
  });
```

After `station deploy`:
```
.station/out/
  signals/process-order.js    # bundled JS
  chunk-XXXXX.js              # shared db.ts + schema.ts
  package.json                # drizzle-orm in dependencies
```

### Non-JS assets with deploy.include

For files that aren't imported (SQL migrations, email templates, static assets):

```ts
// station.config.ts
import { defineConfig } from "station-kit";

export default defineConfig({
  signalsDir: "./signals",
  deploy: {
    include: [
      "migrations/",
      "templates/",
    ],
  },
});
```

### Environment variables for deployment

Set these in your deployment platform (Docker, Railway, Fly.io, etc.):

```sh
STATION_AUTH_USERNAME=admin     # dashboard login
STATION_AUTH_PASSWORD=secret    # dashboard password
PORT=4400                      # server port
HOST=0.0.0.0                  # bind address
```

These override config file values at runtime. If `auth` is not in the config but both env vars are set, auth is enabled automatically.

---

## 19. Tauri v2 Desktop App

Running Station as a Tauri sidecar for desktop apps.

### Create the station instance

```ts
// src-tauri/station/index.ts
import { createTauriStation } from "station-tauri";

const station = await createTauriStation({
  dataDir: "/Users/me/.myapp",
  signalsDir: "./signals",
  port: 4400,
});

// createTauriStation returns an UNSTARTED instance — start() binds the port.
await station.start();

console.log(`Station ready on port ${station.port}`);
console.log(`API key: ${station.apiKey}`);

// Graceful shutdown
process.on("SIGINT", async () => {
  await station.stop();
  process.exit(0);
});
```

### Configure Tauri to spawn the sidecar

In `tauri.conf.json`:

```json
{
  "bundle": {
    "externalBin": ["binaries/station-sidecar"]
  }
}
```

### Spawn and read the ready event from Tauri frontend

```ts
// src/lib/station.ts
import { Command } from "@tauri-apps/plugin-shell";

interface StationReady {
  event: "ready";
  port: number;
  apiKey: string;
}

export async function startStation(dataDir: string): Promise<StationReady> {
  const command = Command.sidecar("binaries/station-sidecar", [], {
    env: {
      STATION_DATA_DIR: dataDir,
      STATION_PORT: "4400",
      STATION_SIGNALS_DIR: "./signals",
    },
  });

  return new Promise((resolve, reject) => {
    command.stdout.on("data", (line: string) => {
      try {
        const msg = JSON.parse(line) as StationReady;
        if (msg.event === "ready") resolve(msg);
      } catch {
        // ignore non-JSON lines
      }
    });

    command.on("error", reject);
    command.spawn();
  });
}
```

### Trigger signals from the frontend

```ts
// src/lib/trigger.ts
import { configure } from "station-signal";
import { sendEmail } from "./signals/send-email.js";

// Use the API key and port from the ready event
export function connectToStation(port: number, apiKey: string) {
  configure({
    endpoint: `http://localhost:${port}`,
    apiKey,
  });
}

// Then trigger signals as usual
const runId = await sendEmail.trigger({
  to: "user@example.com",
  subject: "Hello from desktop",
  body: "Sent via Tauri sidecar.",
});
```

### Environment variables

| Variable | Required | Description |
|----------|----------|-------------|
| `STATION_DATA_DIR` | Yes | Data directory for DB and key file |
| `STATION_PORT` | No | Server port (default: 4400) |
| `STATION_SIGNALS_DIR` | No | Signals directory |
| `STATION_BROADCASTS_DIR` | No | Broadcasts directory |

The API key is auto-provisioned on first run and saved to `{STATION_DATA_DIR}/.station-key`. Subsequent launches reuse the same key.

---

## 20. Dynamic Broadcasts (runtime-editable)

A dynamic broadcast is a `DynamicBroadcastSpec` persisted via the v1 API. The `input` and `when` fields are `ExprNode`s — see §22 for the expression language.

### 20.1 Create a dynamic broadcast (curl)

Assumes signals `score-order` and `notify-vip` are already loaded.

```sh
curl -X POST http://localhost:4400/api/v1/broadcast-definitions \
  -H "Authorization: Bearer $STATION_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "high-value-order",
    "failurePolicy": "skip-downstream",
    "timeout": 60000,
    "nodes": [
      {
        "name": "score",
        "signalName": "score-order",
        "dependsOn": []
      },
      {
        "name": "notify",
        "signalName": "notify-vip",
        "dependsOn": ["score"],
        "when": {
          "kind": "op",
          "op": ">",
          "args": [
            { "kind": "ref", "path": ["score", "score"] },
            { "kind": "lit", "value": 0.8 }
          ]
        },
        "input": {
          "kind": "obj",
          "entries": {
            "orderId": { "kind": "ref", "path": ["input", "orderId"] },
            "score":   { "kind": "ref", "path": ["score", "score"] }
          }
        }
      }
    ]
  }'
```

Response (201):

```json
{
  "data": {
    "name": "high-value-order",
    "version": 1,
    "failurePolicy": "skip-downstream",
    "timeout": 60000,
    "nodes": [...],
    "createdAt": "2026-05-02T12:00:00.000Z",
    "updatedAt": "2026-05-02T12:00:00.000Z",
    "createdBy": "key_abc123"
  }
}
```

### 20.2 Same thing in TypeScript

```ts
// scripts/upsert-broadcast.ts
const ENDPOINT = process.env.STATION_ENDPOINT ?? "http://localhost:4400";
const API_KEY = process.env.STATION_API_KEY!;

const spec = {
  name: "high-value-order",
  failurePolicy: "skip-downstream" as const,
  nodes: [
    { name: "score", signalName: "score-order", dependsOn: [] },
    {
      name: "notify",
      signalName: "notify-vip",
      dependsOn: ["score"],
      when: {
        kind: "op", op: ">", args: [
          { kind: "ref", path: ["score", "score"] },
          { kind: "lit", value: 0.8 },
        ],
      },
      input: {
        kind: "obj", entries: {
          orderId: { kind: "ref", path: ["input", "orderId"] },
          score:   { kind: "ref", path: ["score", "score"] },
        },
      },
    },
  ],
};

// 1. Validate first (read scope) — useful in CI / form submission
const validateRes = await fetch(`${ENDPOINT}/api/v1/broadcast-definitions/validate`, {
  method: "POST",
  headers: { Authorization: `Bearer ${API_KEY}`, "Content-Type": "application/json" },
  body: JSON.stringify(spec),
});
const validation = await validateRes.json();
if (!validation.data.ok) {
  console.error("Validation errors:", validation.data.errors);
  process.exit(1);
}

// 2. Save (admin scope)
const saveRes = await fetch(`${ENDPOINT}/api/v1/broadcast-definitions`, {
  method: "POST",
  headers: { Authorization: `Bearer ${API_KEY}`, "Content-Type": "application/json" },
  body: JSON.stringify(spec),
});
const { data } = await saveRes.json();
console.log(`Saved ${data.name} v${data.version}`);
```

### 20.3 Trigger a dynamic broadcast

```sh
curl -X POST http://localhost:4400/api/v1/trigger-dynamic-broadcast \
  -H "Authorization: Bearer $STATION_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{ "broadcastName": "high-value-order", "input": { "orderId": "ord_42" } }'
```

The response contains the broadcast run id; the runner snapshots the current spec into `BroadcastRun.definitionSnapshot` so subsequent edits don't touch this run.

### 20.4 Inspect version history & deep-link to a specific version

```sh
# Full history, newest first (includes soft-deleted versions)
curl -H "Authorization: Bearer $STATION_API_KEY" \
  http://localhost:4400/api/v1/broadcast-definitions/high-value-order/versions

# Pin to a specific version for replay / diff
curl -H "Authorization: Bearer $STATION_API_KEY" \
  http://localhost:4400/api/v1/broadcast-definitions/high-value-order/versions/3
```

### 20.5 Versioning gotcha

`DELETE /broadcast-definitions/:name` is a soft-delete. If you `POST` the same name again, it continues at the next version:

```
POST .../broadcast-definitions          → v1
POST .../broadcast-definitions          → v2
DELETE .../broadcast-definitions/foo    → v2 marked deletedAt
POST .../broadcast-definitions (foo)    → v3   (NOT v1)
```

Existing `BroadcastRun`s keep their snapshot — they advance against whichever spec was current when they were triggered.

---

## 21. Schedules (runtime)

`station-schedules` lets you create / edit / disable schedules at runtime, separately from `.every()` in code.

### 21.1 Wire the schedule adapter into station-kit

```ts
// station.config.ts
import { defineConfig } from "station-kit";
import { SqliteAdapter } from "station-adapter-sqlite";
import { BroadcastSqliteAdapter } from "station-adapter-sqlite/broadcast";
import { ScheduleSqliteAdapter } from "station-adapter-sqlite/schedules";

export default defineConfig({
  adapter: new SqliteAdapter({ dbPath: "./station.db" }),
  broadcastAdapter: new BroadcastSqliteAdapter({ dbPath: "./station.db" }),
  scheduleAdapter: new ScheduleSqliteAdapter({ dbPath: "./station.db" }),
  auth: { username: "admin", password: process.env.PW! },
});
```

station-kit constructs a `ScheduleReconciler` for each runner automatically. For Postgres / MySQL / Redis, swap the import path:

```ts
import { ScheduleRedisAdapter } from "station-adapter-redis/schedules";
```

### 21.2 Schedule a signal every 5 minutes

```sh
curl -X POST http://localhost:4400/api/v1/schedules \
  -H "Authorization: Bearer $STATION_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "kind": "signal",
    "target": "ping-monitor",
    "interval": "5m",
    "input": { "url": "https://api.example.com/health" },
    "enabled": true
  }'
```

Response (201):

```json
{
  "data": {
    "id": "sch_01H...",
    "kind": "signal",
    "target": "ping-monitor",
    "interval": "5m",
    "input": { "url": "https://api.example.com/health" },
    "enabled": true,
    "nextRunAt": "2026-05-02T12:05:00.000Z",
    "createdAt": "2026-05-02T12:00:00.000Z",
    "updatedAt": "2026-05-02T12:00:00.000Z",
    "createdBy": "key_abc123"
  }
}
```

### 21.3 Schedule a dynamic broadcast nightly

```sh
curl -X POST http://localhost:4400/api/v1/schedules \
  -H "Authorization: Bearer $STATION_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "kind": "broadcast-dynamic",
    "target": "high-value-order",
    "interval": "1d",
    "input": { "since": "yesterday" }
  }'
```

Use `"kind": "broadcast-static"` to schedule a file-defined broadcast.

### 21.4 Edit a schedule (PATCH)

```sh
# Slow it down + change input
curl -X PATCH http://localhost:4400/api/v1/schedules/sch_01H... \
  -H "Authorization: Bearer $STATION_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "interval": "15m",
    "input": { "url": "https://api.example.com/v2/health" }
  }'

# Pause without deleting
curl -X PATCH http://localhost:4400/api/v1/schedules/sch_01H... \
  -H "Authorization: Bearer $STATION_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{ "enabled": false }'
```

### 21.5 Preview next fire times

```sh
curl -X POST http://localhost:4400/api/v1/schedules/sch_01H.../preview \
  -H "Authorization: Bearer $STATION_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{ "count": 5 }'
# → { "data": { "fires": ["2026-05-02T12:15:00.000Z", ...] } }
```

Useful for confirming a CRON-like cadence before flipping `enabled = true`.

### 21.6 Multi-runner safety

If two Station processes share the schedule store, ensure your adapter implements `claimDue` (all four persistent adapters do). The in-memory `ScheduleMemoryAdapter` is single-process only — use it for tests, not production.

---

## 22. Expressions

The expression language used by `DynamicNodeSpec.input` and `.when`. Pure, deterministic, JSON-serializable.

### 22.1 Build an `input` mapping with `obj` / `ref` / `op`

Suppose `score-order` outputs `{ score: number, factors: string[] }` and we want `notify-vip`'s input to be `{ orderId, scaledScore }` where `scaledScore = score * 100`.

```ts
import type { ExprNode } from "station-expressions";

const inputMapping: ExprNode = {
  kind: "obj",
  entries: {
    orderId: { kind: "ref", path: ["input", "orderId"] },
    scaledScore: {
      kind: "op",
      op: "*",
      args: [
        { kind: "ref", path: ["score", "score"] },   // shorthand for upstream.score.score
        { kind: "lit", value: 100 },
      ],
    },
  },
};
```

Embedded in a node spec:

```ts
{
  name: "notify",
  signalName: "notify-vip",
  dependsOn: ["score"],
  input: inputMapping,
}
```

### 22.2 A `when` guard with comparison + logical ops

Run the node only for premium users with score above 0.8:

```ts
const guard: ExprNode = {
  kind: "op",
  op: "&&",
  args: [
    {
      kind: "op", op: ">", args: [
        { kind: "ref", path: ["score", "score"] },
        { kind: "lit", value: 0.8 },
      ],
    },
    {
      kind: "op", op: "==", args: [
        { kind: "ref", path: ["input", "user", "tier"] },
        { kind: "lit", value: "premium" },
      ],
    },
  ],
};
```

### 22.3 Author from string syntax via the parser

The same guard, written as a string and compiled to an AST:

```ts
import { parse, stringify } from "station-expressions";

const node = parse(`upstream.score.score > 0.8 && input.user.tier == "premium"`);
// → { kind: "op", op: "&&", args: [...] }

stringify(node);
// → '((upstream.score.score > 0.8) && (input.user.tier == "premium"))'
```

The parser is the canonical way to take user input from a UI / playground and persist it as AST. The AST is what's stored — `parse` is one-way at save time.

### 22.4 Validate before saving (server-side)

```ts
const res = await fetch(`${ENDPOINT}/api/v1/expressions/validate`, {
  method: "POST",
  headers: { Authorization: `Bearer ${API_KEY}`, "Content-Type": "application/json" },
  body: JSON.stringify({
    node,
    schemaContext: {
      inputSchema: {
        type: "object",
        properties: {
          orderId: { type: "string" },
          user: { type: "object", properties: { tier: { type: "string" } } },
        },
      },
      upstreamSchemas: {
        score: { type: "object", properties: { score: { type: "number" } } },
      },
      expectedSchema: { type: "boolean" },
    },
  }),
});
const { data } = await res.json();
// data: { ok: true, errors: [] }
```

### 22.5 Escape hatch

If your logic outgrows the expression language (async lookups, complex string templating, business rules), write a code-defined signal in TypeScript and wire it into the broadcast as a node — expressions just connect it to its upstream nodes' outputs. Don't try to bend `tmpl` into an unbounded language; the bounded surface is the point.

---

## 23. Custom API Key Storage

`KeyStore` accepts a pluggable `ApiKeyStorageAdapter`. The default is `FileKeyStorage` — a JSON file at `<dataDir>/station-keys.json`, no native deps (`SqliteKeyStorage` is opt-in and requires `better-sqlite3`). Implement the interface against any backend.

### 23.1 Skeleton: Postgres-backed key storage

This sketches the shape — wire it up to the `pg` client of your choice.

```ts
// auth/postgres-key-storage.ts
import type pg from "pg";
import type {
  ApiKey,
  ApiKeyPublic,
  ApiKeyStorageAdapter,
} from "station-kit/server";

export class PostgresKeyStorage implements ApiKeyStorageAdapter {
  constructor(private pool: pg.Pool, private table = "api_keys") {}

  async init(): Promise<void> {
    await this.pool.query(`
      CREATE TABLE IF NOT EXISTS ${this.table} (
        id          TEXT PRIMARY KEY,
        name        TEXT NOT NULL,
        key_hash    TEXT NOT NULL UNIQUE,
        key_prefix  TEXT NOT NULL,
        scopes      JSONB NOT NULL DEFAULT '[]'::jsonb,
        created_at  TIMESTAMPTZ NOT NULL,
        last_used   TIMESTAMPTZ,
        expires_at  TIMESTAMPTZ,
        revoked     BOOLEAN NOT NULL DEFAULT FALSE
      )
    `);
  }

  async insert(record: ApiKey): Promise<void> {
    await this.pool.query(
      `INSERT INTO ${this.table}
         (id, name, key_hash, key_prefix, scopes, created_at, last_used, expires_at, revoked)
       VALUES ($1, $2, $3, $4, $5::jsonb, $6, $7, $8, $9)`,
      [
        record.id, record.name, record.keyHash, record.keyPrefix,
        JSON.stringify(record.scopes),
        record.createdAt, record.lastUsed, record.expiresAt, record.revoked,
      ],
    );
  }

  async findByHash(keyHash: string): Promise<ApiKey | null> {
    const { rows } = await this.pool.query(
      `SELECT * FROM ${this.table} WHERE key_hash = $1`,
      [keyHash],
    );
    return rows[0] ? rowToApiKey(rows[0]) : null;
  }

  async list(): Promise<ApiKeyPublic[]> {
    const { rows } = await this.pool.query(
      `SELECT id, name, key_prefix, scopes, created_at, last_used, expires_at, revoked
         FROM ${this.table} ORDER BY created_at DESC`,
    );
    return rows.map((r) => ({
      id: r.id,
      name: r.name,
      keyPrefix: r.key_prefix,
      scopes: r.scopes,
      createdAt: r.created_at.toISOString(),
      lastUsed: r.last_used ? r.last_used.toISOString() : null,
      expiresAt: r.expires_at ? r.expires_at.toISOString() : null,
      revoked: r.revoked,
    }));
  }

  async touch(id: string, lastUsedIso: string): Promise<void> {
    await this.pool.query(
      `UPDATE ${this.table} SET last_used = $1 WHERE id = $2`,
      [lastUsedIso, id],
    );
  }

  async revoke(id: string): Promise<boolean> {
    const result = await this.pool.query(
      `UPDATE ${this.table} SET revoked = TRUE WHERE id = $1`,
      [id],
    );
    return (result.rowCount ?? 0) > 0;
  }

  async close(): Promise<void> {
    await this.pool.end();
  }
}

function rowToApiKey(r: Record<string, unknown>): ApiKey {
  return {
    id: r.id as string,
    name: r.name as string,
    keyHash: r.key_hash as string,
    keyPrefix: r.key_prefix as string,
    scopes: r.scopes as string[],
    createdAt: (r.created_at as Date).toISOString(),
    lastUsed: r.last_used ? (r.last_used as Date).toISOString() : null,
    expiresAt: r.expires_at ? (r.expires_at as Date).toISOString() : null,
    revoked: Boolean(r.revoked),
  };
}
```

### 23.2 Wire it into station-kit

```ts
// station.config.ts
import pg from "pg";
import { defineConfig } from "station-kit";
import { PostgresKeyStorage } from "./auth/postgres-key-storage.js";

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const keyStorage = new PostgresKeyStorage(pool);
await keyStorage.init();

export default defineConfig({
  // ... adapter / broadcastAdapter ...
  auth: {
    username: "admin",
    password: process.env.STATION_PW!,
    keyStorage,
  },
});
```

### 23.3 Calling KeyStore directly (now async)

If you instantiate a `KeyStore` outside the server (scripts, custom tooling), every method is async:

```ts
import { KeyStore, FileKeyStorage } from "station-kit/server";

const store = new KeyStore(new FileKeyStorage({ filePath: "./keys.json" }));
// String overload also works (defaults to FileKeyStorage; .db is silently
// rewritten to .json for backwards compat):
// const store = new KeyStore("./keys.json");
//
// For SQLite, install `better-sqlite3` separately and use:
// import { SqliteKeyStorage } from "station-kit/server";
// const store = new KeyStore(new SqliteKeyStorage({ dbPath: "./keys.db" }));

const { key, record } = await store.create("ci-deploy", ["trigger"]);
console.log("Issued", record.id, "→", key);  // "key" is shown only here

const verified = await store.verify(key);
console.log(verified?.name);                  // "ci-deploy"

await store.revoke(record.id);
await store.close();
```

---

## 24. Beacon -- Server, Poller, Client

Long-running, supervised processes. Each beacon runs in its own child process; the `BeaconRunner` keeps it alive per its restart policy.

```ts
// beacons/health-server.ts -- SERVER mode
import { beacon, z } from "station-beacon";
import { createServer } from "node:http";

export const healthServer = beacon("health-server")
  .config(z.object({ port: z.number().default(8099) }))
  .withConfig({ port: 8099 })
  .restart("always")               // a server should always be brought back up
  .backoff("1s", { max: "10s" })
  .run(async (ctx) => {
    let hits = 0;
    const server = createServer((_req, res) => {
      hits++;
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ ok: true, hits }));
    });
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(ctx.config.port, resolve);
    });
    ctx.log(`listening on :${ctx.config.port}`);
    ctx.ready();
    ctx.onStop(async () => { await new Promise<void>((r) => server.close(() => r())); });
    await ctx.untilStopped();
  });
```

```ts
// beacons/uptime-poller.ts -- POLLER mode (triggers a signal on failure)
import { beacon } from "station-beacon";
import { pageOncall } from "../signals/page-oncall.js";

export const uptimePoller = beacon("uptime-poller").poll("15s", async (ctx) => {
  try {
    const res = await fetch("http://localhost:8099/", { signal: ctx.signal });
    if (!res.ok) await pageOncall.trigger({ status: res.status });
  } catch (err) {
    if (ctx.signal.aborted) return;             // stopping -- ignore
    await pageOncall.trigger({ status: 0, error: (err as Error).message });
  }
});
```

```ts
// beacons/stream-client.ts -- CLIENT mode (reconnects with backoff + heartbeat)
import { beacon } from "station-beacon";

export const streamClient = beacon("stream-client")
  .restart("on-failure")
  .backoff("500ms", { factor: 2, max: "8s" })
  .heartbeat("10s")
  .run(async (ctx) => {
    const conn = await connect();                // throws on failure -> supervised reconnect
    ctx.ready();
    ctx.onStop(() => conn.close());
    for await (const msg of conn.stream({ signal: ctx.signal })) {
      ctx.heartbeat();
      await ingest.trigger(msg);
    }
  });
```

```ts
// runner.ts -- wire signals + beacons so beacons can trigger signals
import path from "node:path";
import { SignalRunner } from "station-signal";
import { SqliteAdapter } from "station-adapter-sqlite";
import { BeaconRunner, ConsoleBeaconSubscriber } from "station-beacon";

const signalRunner = new SignalRunner({
  signalsDir: path.join(import.meta.dirname, "signals"),
  adapter: new SqliteAdapter({ dbPath: "./jobs.db" }),   // persistent -> triggers cross the child boundary
});

const beaconRunner = new BeaconRunner({
  beaconsDir: path.join(import.meta.dirname, "beacons"),
  subscribers: [new ConsoleBeaconSubscriber()],
  signalRunner,
});

await signalRunner.start();
beaconRunner.start().catch(console.error);   // only settles when the supervisor stops
await beaconRunner.whenReady();              // discovery + instance hydration done

// Runtime control (e.g. from an API handler):
// await beaconRunner.stopBeacon("stream-client");
// await beaconRunner.startBeacon("stream-client", { config: { url: "wss://..." } });
// await beaconRunner.restartBeacon("stream-client");
// const inst = await beaconRunner.getInstance("stream-client");
```

**Notes:** invalid config or a missing beacon is a fatal error (goes to `errored`, never restart-looped, even under `restart("always")`). Triggering signals from a beacon requires a **persistent** signal adapter — the default in-memory adapter does not cross the child-process boundary. See `examples/15-beacon` for a runnable, dependency-light version (no signals).

### Many instances of one beacon

The three beacons above are single processes. A beacon can instead be a *template*: declare `.onDemand()` and nothing starts on discovery -- instances are created at runtime, each with its own config, and each supervised independently.

```ts
// beacons/queue-worker.ts -- ON-DEMAND mode (one per tenant / queue / stream)
import { beacon, z } from "station-beacon";

export const queueWorker = beacon("queue-worker")
  .config(z.object({ queue: z.string(), batchSize: z.number().default(10) }))
  .onDemand()                     // no instance seeded; created via API/runner
  .maxInstances(8)                // bound what an API caller can spawn
  .restart("on-failure")
  .run(async (ctx) => {
    ctx.log(`worker ${ctx.instanceId} draining ${ctx.config.queue}`);
    ctx.ready();
    while (!ctx.signal.aborted) {
      await drainBatch(ctx.config.queue, ctx.config.batchSize, { signal: ctx.signal });
    }
  });
```

```ts
// From code -- e.g. spin up a worker when a tenant is provisioned
const worker = await beaconRunner.createInstance("queue-worker", {
  id: `worker-${tenantId}`,                     // optional; generated when omitted
  label: tenant.name,
  config: { queue: tenantId, batchSize: 25 },   // validated against the config schema
});                                             // starts immediately (start: false to stage it)

await beaconRunner.listInstances({ beaconName: "queue-worker" });
await beaconRunner.updateInstance(worker.id, { config: { queue: tenantId, batchSize: 50 }, restart: true });
await beaconRunner.stopInstance(worker.id);
await beaconRunner.deleteInstance(worker.id);   // stops the process, then removes the record
```

```bash
# ...or over HTTP. The v1 API mirrors these under /api/v1 with scopes:
# create/start -> trigger, stop -> cancel, patch/delete -> admin.
curl -X POST localhost:4400/api/beacons/queue-worker/instances \
     -H 'content-type: application/json' \
     -d '{"id":"worker-acme","label":"acme","config":{"queue":"acme","batchSize":25}}'

curl localhost:4400/api/beacons/queue-worker/instances
curl -X POST   localhost:4400/api/beacons/queue-worker/instances/worker-acme/stop
curl -X DELETE localhost:4400/api/beacons/queue-worker/instances/worker-acme
curl -X POST  'localhost:4400/api/beacons/queue-worker/stop?all=true'
```

**Start modes:** `auto` (default -- one instance, seeded and started), `.manualStart()` (one instance, seeded but stopped), `.onDemand()` (none seeded). The definition-owned instance's id **is** the beacon name, so `startBeacon`/`stopBeacon` keep working and pre-existing single-instance state carries over. Runtime-created instances are persisted, so a supervisor restart resumes them; one whose definition has disappeared shows up as `errored` rather than vanishing. Only runtime-created instances can be deleted -- stop the definition-owned one instead.

---

## 25. Environment Variables

Require env vars for a signal, then define and change them from the dashboard while Station runs.

### 25.1 Require a var in signal code

```ts
// signals/charge.ts
import { signal, z } from "station-signal";

export const charge = signal("charge")
  .input(z.object({ amount: z.number() }))
  .env("STRIPE_API_KEY")   // required — the run fails fast if this is unset
  .run(async (input) => {
    const key = process.env.STRIPE_API_KEY!;   // injected at run time
    // ... call Stripe with `key` ...
    return { charged: input.amount };
  });
```

If `STRIPE_API_KEY` is defined in neither the env store nor the host process env, the run fails with:
`Missing required environment variable for "charge": STRIPE_API_KEY. Define it in the Station env store or the host environment.`

### 25.2 Configure durable env storage

```ts
// station.config.ts
import { defineConfig } from "station-kit";
import { EnvPostgresAdapter } from "station-adapter-postgres/env";

export default defineConfig({
  signalsDir: "./signals",
  // ... signal / broadcast adapters ...
  envStorage: new EnvPostgresAdapter({ connectionString: process.env.DATABASE_URL }),
});
```

Omit `envStorage` to use the default `FileEnvStorage` (`<dataDir>/station-env.json`).

### 25.3 Define / scope / rotate vars via the API

```bash
# Global var — injected into every signal and beacon (admin scope).
curl -X POST https://station.example.com/api/v1/env \
  -H "Authorization: Bearer sk_live_admin" -H "Content-Type: application/json" \
  -d '{"key":"STRIPE_API_KEY","value":"sk_live_…","secret":true}'

# Var scoped to a single signal — overrides a global of the same key for that signal only.
curl -X POST https://station.example.com/api/v1/env \
  -H "Authorization: Bearer sk_live_admin" -H "Content-Type: application/json" \
  -d '{"key":"DB_URL","value":"postgres://…","targets":[{"kind":"signal","name":"charge"}]}'

# Rotate a value (PATCH); secret values never come back on GET.
curl -X PATCH https://station.example.com/api/v1/env/<id> \
  -H "Authorization: Bearer sk_live_admin" -H "Content-Type: application/json" \
  -d '{"value":"sk_live_new"}'

# List (secret values redacted to null) — read scope.
curl https://station.example.com/api/v1/env -H "Authorization: Bearer sk_live_read"
```

Or use the dashboard **Environment** page: add a variable, toggle **Secret**, choose **Global** or **Specific targets**, and it flags any required-but-undefined vars per signal/beacon. Changes take effect on the next run — no restart of the Station process.

### 25.4 Programmatic store use (hand-rolled runner)

```ts
import { SignalRunner } from "station-signal";
import { EnvStore } from "station-env";
import { EnvSqliteAdapter } from "station-adapter-sqlite/env";

const envStore = new EnvStore(new EnvSqliteAdapter({ dbPath: "./jobs.db" }));
await envStore.create({ key: "API_TOKEN", value: "…", secret: true });

const runner = new SignalRunner({
  signalsDir: "./signals",
  adapter,
  envProvider: envStore,   // resolves + injects env, and backs `.env()` enforcement
});
```

---

## 26. Station Network -- Headquarters and Workers

Use a Station Network when multiple processes or machines must consume one job
queue, enforce fleet-wide limits, or provide single-owner beacon services. This
example uses PostgreSQL so every node can reach the same storage.

Define a constrained signal:

```ts
// signals/render.ts
import { signal, z } from "station-signal";

export const render = signal("render")
  .input(z.object({ assetId: z.string() }))
  .concurrency({ station: 2, network: 6 })
  .placement({ labels: { gpu: "true" } })
  .run(async ({ assetId }) => {
    return renderOnGpu(assetId);
  });
```

Configure the control plane:

```ts
// station.hq.config.ts
import { defineConfig } from "station-kit";
import { PostgresAdapter } from "station-adapter-postgres";
import { StationNetworkPostgresAdapter } from "station-adapter-postgres/network";
import { SchedulePostgresAdapter } from "station-adapter-postgres/schedules";

const connectionString = process.env.DATABASE_URL!;

export default defineConfig({
  role: "headquarters",
  port: 4400,
  host: "0.0.0.0",
  open: false,
  signalsDir: "./signals",
  adapter: new PostgresAdapter({ connectionString }),
  scheduleAdapter: new SchedulePostgresAdapter({ connectionString }),
  network: {
    id: "production",
    stationId: "hq-1",
    name: "Production Headquarters",
    adapter: new StationNetworkPostgresAdapter({ connectionString }),
  },
  auth: {
    username: process.env.STATION_AUTH_USERNAME!,
    password: process.env.STATION_AUTH_PASSWORD!,
  },
});
```

Headquarters loads signal definitions for catalog and validation, reconciles
schedules, and enqueues runs. It never claims signal jobs.

Configure workers from environment-provided identities and labels:

```ts
// station.worker.config.ts
import { defineConfig } from "station-kit";
import { PostgresAdapter } from "station-adapter-postgres";
import { StationNetworkPostgresAdapter } from "station-adapter-postgres/network";

const connectionString = process.env.DATABASE_URL!;

export default defineConfig({
  role: "station",
  host: "0.0.0.0",
  open: false,
  signalsDir: "./signals",
  adapter: new PostgresAdapter({ connectionString }),
  network: {
    id: "production",
    stationId: process.env.STATION_ID!,
    name: process.env.STATION_NAME,
    adapter: new StationNetworkPostgresAdapter({ connectionString }),
    labels: {
      region: process.env.REGION!,
      gpu: process.env.HAS_GPU!,
    },
    endpoint: process.env.STATION_ENDPOINT,
  },
  runner: { maxConcurrent: 12 },
});
```

Start one Headquarters and two uniquely identified workers:

```bash
npx station --config station.hq.config.ts --no-open

STATION_ID=worker-ke-1 STATION_NAME="Kenya 1" REGION=ke HAS_GPU=true \
  npx station --config station.worker.config.ts --port 4410 --no-open

STATION_ID=worker-ke-2 STATION_NAME="Kenya 2" REGION=ke HAS_GPU=true \
  npx station --config station.worker.config.ts --port 4420 --no-open
```

Use a scoped API key or authenticated session at Headquarters to enqueue work:

```bash
curl -X POST http://localhost:4400/api/v1/trigger \
  -H "Authorization: Bearer $STATION_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"signalName":"render","input":{"assetId":"asset-42"}}'

curl http://localhost:4400/api/v1/stations \
  -H "Authorization: Bearer $STATION_API_KEY"
```

Operational requirements:

- Use a stable and unique `stationId`; do not generate a new identity on every
  restart in production.
- Share the signal and network backends across all nodes. Share beacon state
  when using beacons and schedule state across Headquarters replicas.
- Use `PATCH /api/v1/stations/:id` with `{ "status": "draining" }` before
  maintenance. Draining blocks new claims but lets active work complete.
- Size `leaseDurationMs` above ordinary event-loop and network jitter. A dead
  station's work becomes recoverable after that lease, not instantly.
- Treat cron time as eligibility time. Assert a business-specific start-delay
  tolerance instead of promising hard real-time execution.
- Test with at least two worker processes and the production adapter before
  deployment. Assert single ownership, placement, station/network concurrency,
  schedule deduplication, expired-lease recovery, and graceful shutdown.

---

## 27. Browser-local signals, broadcasts, and beacons

Read [browser.md](browser.md) for a complete shared registry and page/worker
setup. Run `pnpm dev:browser` from a checkout containing `station-browser` to
try `examples/17-browser`. The example includes checkpoint recovery after worker
termination, a branching DAG, a poll beacon, and a client that restarts after a
simulated disconnect. Use `/tests.html` with other demo executors closed to check
real IndexedDB and worker behavior. These checks also run in isolated Chromium through `pnpm test`; install the
browser first with `pnpm test:browser:install`.

Browser execution is cooperative and depends on browser wake opportunities.
Service-worker beacons suspend between slices; closing a PWA does not preserve
a live polling loop. Manual definitions can receive required config at `start()`; auto-start
definitions without an existing instance need valid defaults.

---

## Quick Reference

| Concept | Syntax |
|---|---|
| Define a signal | `signal("name")` |
| Input schema | `.input(z.object({ ... }))` |
| Output schema | `.output(z.object({ ... }))` |
| Single handler | `.run(async (input) => { ... })` |
| Multi-step | `.step("name", fn).step("name", fn).build()` |
| Timeout | `.timeout(ms)` |
| Retries | `.retries(n)` (n retries = n+1 total attempts) |
| Per-station concurrency | `.concurrency(n)` or `.concurrency({ station: n })` |
| Fleet concurrency | `.concurrency({ station: n, network: m })` |
| Station placement | `.placement({ labels: { region: "ke" } })` |
| Recurring | `.every("5m")` (units: `s`, `m`, `h`, `d`) |
| Recurring input | `.withInput({ ... })` |
| On complete hook | `.onComplete(async (output, input) => { ... })` |
| Trigger | `mySignal.trigger({ ... })` |
| Define a broadcast | `broadcast("name").input(rootSignal)` |
| Fan-out | `.then(sigA, sigB)` |
| With options | `.then(sig, { as, after, map, when })` |
| Failure policy | `.onFailure("fail-fast" \| "skip-downstream" \| "continue")` |
| Build broadcast | `.build()` |
| Define a beacon | `beacon("name")` |
| Server/client body | `.run(async (ctx) => { ...; ctx.ready(); await ctx.untilStopped(); })` |
| Poller body | `.poll("30s", async (ctx) => { ... })` |
| Restart policy | `.restart("always" \| "on-failure" \| "never")` |
| Restart backoff | `.backoff("1s", { factor, max, resetAfter })` |
| Heartbeat/stall | `.heartbeat("10s")` + `ctx.heartbeat()` |
| Supervise beacons | `new BeaconRunner({ beaconsDir, signalRunner }).start()` |
| Control a beacon | `runner.startBeacon / stopBeacon / restartBeacon(name)` |

### Import paths

```ts
import { signal, z, SignalRunner, ConsoleSubscriber, configure } from "station-signal";
import { broadcast, BroadcastRunner, ConsoleBroadcastSubscriber } from "station-broadcast";
import { SqliteAdapter } from "station-adapter-sqlite";
import { BroadcastSqliteAdapter } from "station-adapter-sqlite/broadcast";
import { PostgresAdapter } from "station-adapter-postgres";
import { BroadcastPostgresAdapter } from "station-adapter-postgres/broadcast";
import { RedisAdapter } from "station-adapter-redis";
import { BroadcastRedisAdapter } from "station-adapter-redis/broadcast";
import { MysqlAdapter } from "station-adapter-mysql";
import { BroadcastMysqlAdapter } from "station-adapter-mysql/broadcast";
import { defineConfig } from "station-kit";
import { createTauriStation } from "station-tauri";

// Station Network
import { StationNetworkMemoryAdapter } from "station-network";
import { StationNetworkSqliteAdapter } from "station-adapter-sqlite/network";
import { StationNetworkPostgresAdapter } from "station-adapter-postgres/network";
import { StationNetworkMysqlAdapter } from "station-adapter-mysql/network"; // await .create(...)
import { StationNetworkRedisAdapter } from "station-adapter-redis/network";

// Runtime schedules
import { ScheduleReconciler, ScheduleMemoryAdapter } from "station-schedules";
import { ScheduleSqliteAdapter } from "station-adapter-sqlite/schedules";
import { SchedulePostgresAdapter } from "station-adapter-postgres/schedules";
import { ScheduleMysqlAdapter } from "station-adapter-mysql/schedules";
import { ScheduleRedisAdapter } from "station-adapter-redis/schedules";

// Expressions (used in DynamicNodeSpec.input / .when)
import { evaluate, validate, parse, stringify } from "station-expressions";
import type { ExprNode, SchemaField } from "station-expressions";

// Dynamic broadcast types
import type { DynamicBroadcastSpec, DynamicNodeSpec } from "station-broadcast";
import { validateDynamicSpec } from "station-broadcast";

// Custom API key storage
import {
  KeyStore,
  FileKeyStorage,        // default — JSON file, no native deps
  MemoryKeyStorage,      // tests / ephemeral
  SqliteKeyStorage,      // optional — requires `better-sqlite3` to be installed
  type ApiKeyStorageAdapter,
} from "station-kit/server";

// Custom run log storage
import {
  LogStore,
  FileLogStorage,        // default — append-only JSONL, single-process only
  MemoryLogStorage,      // tests / ephemeral
  type LogStorageAdapter,
  type LogEntry,
} from "station-kit/server";
```

### Shutdown order

Always stop broadcast runner before signal runner:

```ts
await broadcastRunner.stop({ graceful: true, timeoutMs: 15_000 });
await signalRunner.stop({ graceful: true, timeoutMs: 15_000 });
```
