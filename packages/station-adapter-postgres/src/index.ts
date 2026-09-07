import { randomUUID } from "node:crypto";
import pg from "pg";
export type { Pool as PgPool } from "pg";
import type { SerializableAdapter, AdapterManifest, Run, RunClaim, RunDueFilter, RunPatch, RunRunningFilter, RunStatus, Step, StepPatch, ListRunsOptions, ListAllRunsOptions } from "station-signal";
import { registerAdapter } from "station-signal";

const MODULE_URL = import.meta.url;

import { validateTableName, createColumnMapper, rowToObject } from "./shared.js";

const { toColumn, toField } = createColumnMapper({
  signalName: "signal_name",
  maxAttempts: "max_attempts",
  nextRunAt: "next_run_at",
  lastRunAt: "last_run_at",
  startedAt: "started_at",
  completedAt: "completed_at",
  createdAt: "created_at",
  stationId: "station_id",
  leaseToken: "lease_token",
  leaseExpiresAt: "lease_expires_at",
  claimedAt: "claimed_at",
  scheduleId: "schedule_id",
  scheduledFor: "scheduled_for",
  idempotencyKey: "idempotency_key",
});
const DATE_FIELDS = new Set(["nextRunAt", "lastRunAt", "startedAt", "completedAt", "createdAt", "leaseExpiresAt", "claimedAt", "scheduledFor"]);

const { toColumn: toStepColumn, toField: toStepField } = createColumnMapper({
  runId: "run_id",
  startedAt: "started_at",
  completedAt: "completed_at",
});
const STEP_DATE_FIELDS = new Set(["startedAt", "completedAt"]);

function rowToRun(row: Record<string, unknown>): Run {
  return rowToObject<Run>(row, toField, DATE_FIELDS);
}
function rowToStep(row: Record<string, unknown>): Step {
  return rowToObject<Step>(row, toStepField, STEP_DATE_FIELDS);
}

export interface PostgresAdapterOptions {
  /** PostgreSQL connection string. Ignored if `pool` is provided. */
  connectionString?: string;
  /** An existing pg.Pool instance to reuse (e.g. shared with the broadcast adapter). */
  pool?: pg.Pool;
  /** Table name (alphanumeric and underscores only). Defaults to `"runs"`. */
  tableName?: string;
}

export class PostgresAdapter implements SerializableAdapter {
  private pool: pg.Pool;
  private ownsPool: boolean;
  private tableName: string;
  private stepsTable: string;
  private options: PostgresAdapterOptions;
  private initialized: Promise<void>;

  constructor(options: PostgresAdapterOptions = {}) {
    this.options = options;
    this.tableName = validateTableName(options.tableName ?? "runs");
    this.stepsTable = validateTableName(`${this.tableName}_steps`);

    if (options.pool) {
      this.pool = options.pool;
      this.ownsPool = false;
    } else {
      this.pool = new pg.Pool({
        connectionString: options.connectionString,
      });
      this.ownsPool = true;
    }

    this.initialized = this.ensureSchema();
  }

  private async ensureSchema(): Promise<void> {
    await this.pool.query(`
      CREATE TABLE IF NOT EXISTS ${this.tableName} (
        id            TEXT PRIMARY KEY,
        signal_name   TEXT NOT NULL,
        kind          TEXT NOT NULL,
        input         TEXT NOT NULL,
        status        TEXT NOT NULL DEFAULT 'pending',
        attempts      INTEGER NOT NULL DEFAULT 0,
        max_attempts  INTEGER NOT NULL DEFAULT 1,
        timeout       INTEGER NOT NULL,
        interval      TEXT,
        next_run_at   TIMESTAMPTZ,
        last_run_at   TIMESTAMPTZ,
        started_at    TIMESTAMPTZ,
        completed_at  TIMESTAMPTZ,
        created_at    TIMESTAMPTZ NOT NULL,
        output        TEXT,
        error         TEXT,
        station_id    TEXT,
        lease_token   TEXT,
        lease_expires_at TIMESTAMPTZ,
        claimed_at    TIMESTAMPTZ,
        schedule_id   TEXT,
        scheduled_for TIMESTAMPTZ,
        idempotency_key TEXT
      )
    `);

    await this.pool.query(`ALTER TABLE ${this.tableName} ADD COLUMN IF NOT EXISTS station_id TEXT`);
    await this.pool.query(`ALTER TABLE ${this.tableName} ADD COLUMN IF NOT EXISTS lease_token TEXT`);
    await this.pool.query(`ALTER TABLE ${this.tableName} ADD COLUMN IF NOT EXISTS lease_expires_at TIMESTAMPTZ`);
    await this.pool.query(`ALTER TABLE ${this.tableName} ADD COLUMN IF NOT EXISTS claimed_at TIMESTAMPTZ`);
    await this.pool.query(`ALTER TABLE ${this.tableName} ADD COLUMN IF NOT EXISTS schedule_id TEXT`);
    await this.pool.query(`ALTER TABLE ${this.tableName} ADD COLUMN IF NOT EXISTS scheduled_for TIMESTAMPTZ`);
    await this.pool.query(`ALTER TABLE ${this.tableName} ADD COLUMN IF NOT EXISTS idempotency_key TEXT`);

    await this.pool.query(`
      CREATE INDEX IF NOT EXISTS idx_${this.tableName}_status_next
        ON ${this.tableName} (status, next_run_at)
    `);

    await this.pool.query(`
      CREATE INDEX IF NOT EXISTS idx_${this.tableName}_status_running
        ON ${this.tableName} (status) WHERE status = 'running'
    `);

    await this.pool.query(`
      CREATE INDEX IF NOT EXISTS idx_${this.tableName}_signal_name
        ON ${this.tableName} (signal_name)
    `);
    await this.pool.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS idx_${this.tableName}_idempotency_key
        ON ${this.tableName} (idempotency_key) WHERE idempotency_key IS NOT NULL
    `);

    await this.pool.query(`
      CREATE TABLE IF NOT EXISTS ${this.stepsTable} (
        id            TEXT PRIMARY KEY,
        run_id        TEXT NOT NULL REFERENCES ${this.tableName}(id) ON DELETE CASCADE,
        name          TEXT NOT NULL,
        status        TEXT NOT NULL DEFAULT 'pending',
        input         TEXT,
        output        TEXT,
        error         TEXT,
        started_at    TIMESTAMPTZ,
        completed_at  TIMESTAMPTZ
      )
    `);

    await this.pool.query(`
      CREATE INDEX IF NOT EXISTS idx_${this.stepsTable}_run_id
        ON ${this.stepsTable} (run_id)
    `);
  }

  private async ready(): Promise<void> {
    await this.initialized;
  }

  toManifest(): AdapterManifest {
    const manifestOptions: Record<string, unknown> = {};
    if (this.options.connectionString !== undefined) {
      manifestOptions.connectionString = this.options.connectionString;
    }
    if (this.options.tableName !== undefined) {
      manifestOptions.tableName = this.options.tableName;
    }
    return {
      name: "postgres",
      options: manifestOptions,
      moduleUrl: MODULE_URL,
    };
  }

  async addRun(run: Run): Promise<void> {
    await this.ready();
    await this.pool.query(
      `INSERT INTO ${this.tableName}
        (id, signal_name, kind, input, status, attempts, max_attempts,
         timeout, interval, next_run_at, last_run_at, started_at,
         completed_at, created_at, output, error, station_id, lease_token,
         lease_expires_at, claimed_at, schedule_id, scheduled_for, idempotency_key)
       VALUES
        ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16,
         $17, $18, $19, $20, $21, $22, $23)`,
      [
        run.id,
        run.signalName,
        run.kind,
        run.input,
        run.status,
        run.attempts,
        run.maxAttempts,
        run.timeout,
        run.interval ?? null,
        run.nextRunAt ?? null,
        run.lastRunAt ?? null,
        run.startedAt ?? null,
        run.completedAt ?? null,
        run.createdAt,
        run.output ?? null,
        run.error ?? null,
        run.stationId ?? null,
        run.leaseToken ?? null,
        run.leaseExpiresAt ?? null,
        run.claimedAt ?? null,
        run.scheduleId ?? null,
        run.scheduledFor ?? null,
        run.idempotencyKey ?? null,
      ],
    );
  }

  async removeRun(id: string): Promise<void> {
    await this.ready();
    await this.pool.query(
      `DELETE FROM ${this.tableName} WHERE id = $1`,
      [id],
    );
  }

  async getRunsDue(limit?: number, filter?: RunDueFilter): Promise<Run[]> {
    await this.ready();
    const now = new Date();
    const values: unknown[] = [now];
    let sql =
      `SELECT * FROM ${this.tableName}
       WHERE status = 'pending'
         AND (next_run_at IS NULL OR next_run_at <= $1)`;
    // Narrowing here rather than in the runner is the whole point: without it
    // every station reads the same head of the queue and throws away whatever
    // belongs to a differently-labelled peer.
    if (filter?.signalNames) {
      if (filter.signalNames.length === 0) return [];
      values.push([...filter.signalNames]);
      sql += ` AND signal_name = ANY($${values.length}::text[])`;
    }
    sql += " ORDER BY created_at ASC";
    if (limit !== undefined && limit >= 0) {
      values.push(limit);
      sql += ` LIMIT $${values.length}`;
    }
    const result = await this.pool.query(sql, values);
    return result.rows.map(rowToRun);
  }

  async getRunsRunning(filter?: RunRunningFilter): Promise<Run[]> {
    await this.ready();
    const values: unknown[] = [];
    let sql = `SELECT * FROM ${this.tableName} WHERE status = 'running'`;
    // The timeout sweep only ever acts on its own station's runs, so an
    // unfiltered scan grows with the fleet for no reason.
    if (filter?.stationId !== undefined) {
      values.push(filter.stationId);
      sql += ` AND station_id = $${values.length}`;
    }
    if (filter?.limit !== undefined && filter.limit >= 0) {
      values.push(filter.limit);
      sql += ` LIMIT $${values.length}`;
    }
    const result = await this.pool.query(sql, values);
    return result.rows.map(rowToRun);
  }

  async getRun(id: string): Promise<Run | null> {
    await this.ready();
    const result = await this.pool.query(
      `SELECT * FROM ${this.tableName} WHERE id = $1`,
      [id],
    );
    return result.rows.length > 0 ? rowToRun(result.rows[0]) : null;
  }

  /** Allowed RunPatch keys (whitelist to prevent injection via unexpected keys). */
  private static readonly RUN_PATCH_KEYS = new Set([
    "input", "output", "error", "status", "attempts", "maxAttempts",
    "timeout", "interval", "nextRunAt", "lastRunAt", "startedAt", "completedAt",
    "stationId", "leaseToken", "leaseExpiresAt", "claimedAt", "scheduleId",
    "scheduledFor", "idempotencyKey",
  ]);

  async updateRun(id: string, patch: RunPatch): Promise<void> {
    await this.ready();
    const setClauses: string[] = [];
    const values: unknown[] = [];
    let paramIndex = 1;

    for (const [key, value] of Object.entries(patch)) {
      if (!PostgresAdapter.RUN_PATCH_KEYS.has(key)) continue;
      const col = toColumn(key);
      setClauses.push(`${col} = $${paramIndex}`);
      if (value === undefined) {
        values.push(null);
      } else {
        values.push(value);
      }
      paramIndex++;
    }

    if (setClauses.length === 0) return;

    values.push(id);
    await this.pool.query(
      `UPDATE ${this.tableName} SET ${setClauses.join(", ")} WHERE id = $${paramIndex}`,
      values,
    );
  }

  async claimRun(id: string, claim: RunClaim): Promise<Run | null> {
    await this.ready();
    const result = await this.pool.query(
      `UPDATE ${this.tableName}
       SET status = 'running', station_id = $2, lease_token = $3,
           lease_expires_at = $4, claimed_at = $5, started_at = $5,
           last_run_at = $5, attempts = attempts + 1
       WHERE id = $1 AND status = 'pending'
         AND (next_run_at IS NULL OR next_run_at <= $5)
       RETURNING *`,
      [id, claim.stationId, claim.leaseToken, claim.leaseExpiresAt, claim.claimedAt],
    );
    return result.rows.length > 0 ? rowToRun(result.rows[0]) : null;
  }

  async cancelRun(id: string, completedAt: Date): Promise<boolean> {
    await this.ready();
    const result = await this.pool.query(
      `UPDATE ${this.tableName}
       SET status='cancelled', completed_at=$2, lease_token=NULL, lease_expires_at=NULL, claimed_at=NULL
       WHERE id=$1 AND status IN ('pending','running')`,
      [id, completedAt],
    );
    return result.rowCount === 1;
  }

  async renewRunLease(id: string, leaseToken: string, leaseExpiresAt: Date, now = new Date()): Promise<boolean> {
    await this.ready();
    const result = await this.pool.query(
      `UPDATE ${this.tableName} SET lease_expires_at = $3
       WHERE id = $1 AND status = 'running' AND lease_token = $2 AND lease_expires_at > $4`,
      [id, leaseToken, leaseExpiresAt, now],
    );
    return result.rowCount === 1;
  }

  async updateClaimedRun(id: string, leaseToken: string, patch: RunPatch): Promise<boolean> {
    await this.ready();
    const setClauses: string[] = [];
    const values: unknown[] = [];
    for (const [key, value] of Object.entries(patch)) {
      if (!PostgresAdapter.RUN_PATCH_KEYS.has(key)) continue;
      values.push(value === undefined ? null : value);
      setClauses.push(`${toColumn(key)} = $${values.length}`);
    }
    if (setClauses.length === 0) return false;
    values.push(id, leaseToken);
    const result = await this.pool.query(
      `UPDATE ${this.tableName} SET ${setClauses.join(", ")}
       WHERE id = $${values.length - 1} AND status = 'running' AND lease_token = $${values.length}`,
      values,
    );
    return result.rowCount === 1;
  }

  async requeueExpiredRuns(now: Date): Promise<number> {
    await this.ready();
    const failed = await this.pool.query(
      `UPDATE ${this.tableName}
       SET status = 'failed', completed_at = $1,
           error = 'Station lease expired and all attempts were exhausted',
           lease_token = NULL, lease_expires_at = NULL
       WHERE status = 'running' AND lease_expires_at <= $1 AND attempts >= max_attempts`,
      [now],
    );
    const pending = await this.pool.query(
      `UPDATE ${this.tableName}
       SET status = 'pending', started_at = NULL, last_run_at = $1,
           error = 'Station lease expired; run recovered for retry',
           station_id = NULL, lease_token = NULL, lease_expires_at = NULL, claimed_at = NULL
       WHERE status = 'running' AND lease_expires_at <= $1 AND attempts < max_attempts`,
      [now],
    );
    return (failed.rowCount ?? 0) + (pending.rowCount ?? 0);
  }

  async listRuns(signalName: string, options?: ListRunsOptions): Promise<Run[]> {
    await this.ready();
    const values: unknown[] = [signalName];
    let sql = `SELECT * FROM ${this.tableName} WHERE signal_name = $1`;

    if (options?.statuses && options.statuses.length > 0) {
      values.push(options.statuses);
      sql += ` AND status = ANY($${values.length})`;
    }

    sql += ` ORDER BY created_at DESC`;

    if (options?.limit !== undefined && options.limit >= 0) {
      values.push(options.limit);
      sql += ` LIMIT $${values.length}`;
    }
    if (options?.offset !== undefined && options.offset >= 0) {
      values.push(options.offset);
      sql += ` OFFSET $${values.length}`;
    }

    const result = await this.pool.query(sql, values);
    return result.rows.map(rowToRun);
  }

  async listAllRuns(options?: ListAllRunsOptions): Promise<Run[]> {
    await this.ready();
    const values: unknown[] = [];
    let sql = `SELECT * FROM ${this.tableName}`;
    const conditions: string[] = [];

    if (options?.signalName !== undefined) {
      values.push(options.signalName);
      conditions.push(`signal_name = $${values.length}`);
    }
    if (options?.statuses && options.statuses.length > 0) {
      values.push(options.statuses);
      conditions.push(`status = ANY($${values.length})`);
    }
    if (conditions.length > 0) {
      sql += ` WHERE ${conditions.join(" AND ")}`;
    }

    sql += ` ORDER BY created_at DESC`;

    if (options?.limit !== undefined && options.limit >= 0) {
      values.push(options.limit);
      sql += ` LIMIT $${values.length}`;
    }
    if (options?.offset !== undefined && options.offset >= 0) {
      values.push(options.offset);
      sql += ` OFFSET $${values.length}`;
    }

    const result = await this.pool.query(sql, values);
    return result.rows.map(rowToRun);
  }

  async countRunsByStatus(options?: { signalName?: string }): Promise<Partial<Record<RunStatus, number>>> {
    await this.ready();
    const values: unknown[] = [];
    let sql = `SELECT status, COUNT(*) AS count FROM ${this.tableName}`;
    if (options?.signalName !== undefined) {
      values.push(options.signalName);
      sql += ` WHERE signal_name = $${values.length}`;
    }
    sql += ` GROUP BY status`;

    const result = await this.pool.query(sql, values);
    const counts: Partial<Record<RunStatus, number>> = {};
    for (const row of result.rows) {
      counts[row.status as RunStatus] = Number(row.count);
    }
    return counts;
  }

  async hasRunWithStatus(signalName: string, statuses: RunStatus[]): Promise<boolean> {
    await this.ready();
    if (statuses.length === 0) return false;
    const placeholders = statuses.map((_, i) => `$${i + 2}`).join(", ");
    const result = await this.pool.query(
      `SELECT 1 FROM ${this.tableName} WHERE signal_name = $1 AND status IN (${placeholders}) LIMIT 1`,
      [signalName, ...statuses],
    );
    return result.rows.length > 0;
  }

  async purgeRuns(olderThan: Date, statuses: RunStatus[]): Promise<number> {
    await this.ready();
    if (statuses.length === 0) return 0;
    const placeholders = statuses.map((_, i) => `$${i + 1}`).join(", ");
    const cutoffIndex = statuses.length + 1;
    const result = await this.pool.query(
      `DELETE FROM ${this.tableName} WHERE status IN (${placeholders}) AND completed_at IS NOT NULL AND completed_at < $${cutoffIndex}`,
      [...statuses, olderThan],
    );
    return result.rowCount ?? 0;
  }

  async addStep(step: Step): Promise<void> {
    await this.ready();
    await this.pool.query(
      `INSERT INTO ${this.stepsTable}
        (id, run_id, name, status, input, output, error, started_at, completed_at)
       VALUES
        ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [
        step.id,
        step.runId,
        step.name,
        step.status,
        step.input ?? null,
        step.output ?? null,
        step.error ?? null,
        step.startedAt ?? null,
        step.completedAt ?? null,
      ],
    );
  }

  /** Allowed StepPatch keys. */
  private static readonly STEP_PATCH_KEYS = new Set([
    "status", "input", "output", "error", "startedAt", "completedAt",
  ]);

  async updateStep(id: string, patch: StepPatch): Promise<void> {
    await this.ready();
    const setClauses: string[] = [];
    const values: unknown[] = [];
    let paramIndex = 1;

    for (const [key, value] of Object.entries(patch)) {
      if (!PostgresAdapter.STEP_PATCH_KEYS.has(key)) continue;
      const col = toStepColumn(key);
      setClauses.push(`${col} = $${paramIndex}`);
      if (value === undefined) {
        values.push(null);
      } else {
        values.push(value);
      }
      paramIndex++;
    }

    if (setClauses.length === 0) return;

    values.push(id);
    await this.pool.query(
      `UPDATE ${this.stepsTable} SET ${setClauses.join(", ")} WHERE id = $${paramIndex}`,
      values,
    );
  }

  async getSteps(runId: string): Promise<Step[]> {
    await this.ready();
    const result = await this.pool.query(
      `SELECT * FROM ${this.stepsTable} WHERE run_id = $1`,
      [runId],
    );
    return result.rows.map(rowToStep);
  }

  async removeSteps(runId: string): Promise<void> {
    await this.ready();
    await this.pool.query(
      `DELETE FROM ${this.stepsTable} WHERE run_id = $1`,
      [runId],
    );
  }

  async ping(): Promise<boolean> {
    try {
      await this.pool.query("SELECT 1");
      return true;
    } catch {
      return false;
    }
  }

  generateId(): string {
    return randomUUID();
  }

  async close(): Promise<void> {
    if (this.ownsPool) {
      await this.pool.end();
    }
  }
}

// Register in the adapter factory for cross-process reconstruction
registerAdapter("postgres", (options: Record<string, unknown>) => new PostgresAdapter(options as PostgresAdapterOptions));

export { BroadcastPostgresAdapter, type BroadcastPostgresAdapterOptions } from "./broadcast.js";
