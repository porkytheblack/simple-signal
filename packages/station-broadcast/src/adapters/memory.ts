import { randomUUID } from "#broadcast-crypto";
import type { BroadcastQueueAdapter, ListBroadcastRunsOptions } from "./index.js";
import type {
  BroadcastRun,
  BroadcastRunPatch,
  BroadcastRunStatus,
  BroadcastNodeRun,
  BroadcastNodeRunPatch,
  DynamicBroadcastSpec,
} from "../types.js";

/** Keys that must never be copied from a patch onto a record. */
const FORBIDDEN_PATCH_KEYS = new Set(["__proto__", "constructor", "prototype"]);

/** Number of definition versions retained per broadcast name. */
const MAX_DEFINITION_VERSIONS = 20;

export class BroadcastMemoryAdapter implements BroadcastQueueAdapter {
  private runs = new Map<string, BroadcastRun>();
  private nodeRuns = new Map<string, BroadcastNodeRun>();
  /** Index: broadcast run id -> node run ids (avoids scanning all node runs). */
  private nodeRunIdsByBroadcast = new Map<string, Set<string>>();
  /** name -> version -> spec (latest MAX_DEFINITION_VERSIONS retained). */
  private definitions = new Map<string, Map<number, DynamicBroadcastSpec>>();
  private maxRuns: number;

  constructor(options?: { maxRuns?: number }) {
    this.maxRuns = options?.maxRuns ?? 10_000;
  }

  async addBroadcastRun(run: BroadcastRun): Promise<void> {
    this.runs.set(run.id, run);
    if (this.runs.size > this.maxRuns) {
      this.evictCompleted();
    }
  }

  private evictCompleted(): void {
    const terminal: string[] = [];
    for (const [id, run] of this.runs) {
      if (run.status === "completed" || run.status === "failed" || run.status === "cancelled") {
        terminal.push(id);
      }
    }
    // Sort oldest first by completedAt
    terminal.sort((a, b) => {
      const ra = this.runs.get(a)!;
      const rb = this.runs.get(b)!;
      return (ra.completedAt?.getTime() ?? 0) - (rb.completedAt?.getTime() ?? 0);
    });
    // Evict oldest 10%
    const evictCount = Math.max(1, Math.floor(terminal.length * 0.1));
    for (let i = 0; i < evictCount && i < terminal.length; i++) {
      const id = terminal[i];
      this.runs.delete(id);
      this.removeNodeRunsForBroadcast(id);
    }
  }

  private removeNodeRunsForBroadcast(broadcastRunId: string): void {
    const ids = this.nodeRunIdsByBroadcast.get(broadcastRunId);
    if (!ids) return;
    for (const nrId of ids) {
      this.nodeRuns.delete(nrId);
    }
    this.nodeRunIdsByBroadcast.delete(broadcastRunId);
  }

  async getBroadcastRun(id: string): Promise<BroadcastRun | null> {
    return this.runs.get(id) ?? null;
  }

  async updateBroadcastRun(id: string, patch: BroadcastRunPatch): Promise<void> {
    const run = this.runs.get(id);
    if (run) {
      const rec = run as unknown as Record<string, unknown>;
      for (const [key, value] of Object.entries(patch)) {
        if (FORBIDDEN_PATCH_KEYS.has(key)) continue;
        if (value === undefined) {
          delete rec[key];
        } else {
          rec[key] = value;
        }
      }
    }
  }

  async getBroadcastRunsDue(limit?: number): Promise<BroadcastRun[]> {
    const now = new Date();
    const due = Array.from(this.runs.values())
      .filter((run) => {
        if (run.status !== "pending") return false;
        if (!run.nextRunAt) return true;
        return run.nextRunAt <= now;
      })
      .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
    return limit !== undefined && limit >= 0 ? due.slice(0, limit) : due;
  }

  async getBroadcastRunsRunning(): Promise<BroadcastRun[]> {
    return Array.from(this.runs.values()).filter(
      (run) => run.status === "running",
    );
  }

  async listBroadcastRuns(broadcastName: string, options?: ListBroadcastRunsOptions): Promise<BroadcastRun[]> {
    let rows = Array.from(this.runs.values()).filter(
      (run) => run.broadcastName === broadcastName,
    );
    if (!options) return rows;
    if (options.statuses && options.statuses.length > 0) {
      const set = new Set(options.statuses);
      rows = rows.filter((run) => set.has(run.status));
    }
    rows = rows.slice().sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
    const offset = options.offset ?? 0;
    if (offset > 0) rows = rows.slice(offset);
    if (options.limit !== undefined && options.limit >= 0) rows = rows.slice(0, options.limit);
    return rows;
  }

  async hasBroadcastRunWithStatus(broadcastName: string, statuses: BroadcastRunStatus[]): Promise<boolean> {
    const statusSet = new Set(statuses);
    for (const run of this.runs.values()) {
      if (run.broadcastName === broadcastName && statusSet.has(run.status)) return true;
    }
    return false;
  }

  async purgeBroadcastRuns(olderThan: Date, statuses: BroadcastRunStatus[]): Promise<number> {
    const statusSet = new Set(statuses);
    // M4: Collect IDs first, then delete — avoids mutating Map during iteration
    const toPurge: string[] = [];
    for (const [id, run] of this.runs) {
      if (statusSet.has(run.status) && run.completedAt && run.completedAt < olderThan) {
        toPurge.push(id);
      }
    }
    for (const id of toPurge) {
      this.runs.delete(id);
      this.removeNodeRunsForBroadcast(id);
    }
    return toPurge.length;
  }

  async addNodeRun(nodeRun: BroadcastNodeRun): Promise<void> {
    this.nodeRuns.set(nodeRun.id, nodeRun);
    let ids = this.nodeRunIdsByBroadcast.get(nodeRun.broadcastRunId);
    if (!ids) {
      ids = new Set();
      this.nodeRunIdsByBroadcast.set(nodeRun.broadcastRunId, ids);
    }
    ids.add(nodeRun.id);
  }

  async getNodeRun(id: string): Promise<BroadcastNodeRun | null> {
    return this.nodeRuns.get(id) ?? null;
  }

  async updateNodeRun(id: string, patch: BroadcastNodeRunPatch): Promise<void> {
    const nodeRun = this.nodeRuns.get(id);
    if (nodeRun) {
      const rec = nodeRun as unknown as Record<string, unknown>;
      for (const [key, value] of Object.entries(patch)) {
        if (FORBIDDEN_PATCH_KEYS.has(key)) continue;
        if (value === undefined) {
          delete rec[key];
        } else {
          rec[key] = value;
        }
      }
    }
  }

  async getNodeRuns(broadcastRunId: string): Promise<BroadcastNodeRun[]> {
    const ids = this.nodeRunIdsByBroadcast.get(broadcastRunId);
    if (!ids) return [];
    const out: BroadcastNodeRun[] = [];
    for (const id of ids) {
      const nr = this.nodeRuns.get(id);
      if (nr) out.push(nr);
    }
    return out;
  }

  // ─── Dynamic broadcast definitions ───────────────────────────────

  async saveDefinition(spec: DynamicBroadcastSpec): Promise<DynamicBroadcastSpec> {
    let versions = this.definitions.get(spec.name);
    if (!versions) {
      versions = new Map();
      this.definitions.set(spec.name, versions);
    }
    const latestVersion = Math.max(0, ...Array.from(versions.keys()));
    const next: DynamicBroadcastSpec = {
      ...spec,
      version: latestVersion + 1,
      createdAt: spec.createdAt ?? new Date(),
      updatedAt: new Date(),
      deletedAt: undefined,
    };
    versions.set(next.version, next);
    // Cap retained history: keep the latest MAX_DEFINITION_VERSIONS versions.
    // Never delete the current/latest version.
    if (versions.size > MAX_DEFINITION_VERSIONS) {
      const sorted = Array.from(versions.keys()).sort((a, b) => a - b);
      const excess = sorted.slice(0, versions.size - MAX_DEFINITION_VERSIONS);
      for (const v of excess) {
        if (v !== next.version) versions.delete(v);
      }
    }
    return next;
  }

  async getDefinition(name: string, version?: number): Promise<DynamicBroadcastSpec | null> {
    const versions = this.definitions.get(name);
    if (!versions || versions.size === 0) return null;
    if (version !== undefined) return versions.get(version) ?? null;
    const latest = Math.max(...versions.keys());
    return versions.get(latest) ?? null;
  }

  async listDefinitions(): Promise<DynamicBroadcastSpec[]> {
    const out: DynamicBroadcastSpec[] = [];
    for (const versions of this.definitions.values()) {
      if (versions.size === 0) continue;
      const latest = Math.max(...versions.keys());
      const spec = versions.get(latest)!;
      if (spec.deletedAt) continue;
      out.push(spec);
    }
    return out.sort((a, b) => a.name.localeCompare(b.name));
  }

  async listDefinitionVersions(name: string): Promise<DynamicBroadcastSpec[]> {
    const versions = this.definitions.get(name);
    if (!versions) return [];
    return Array.from(versions.values()).sort((a, b) => b.version - a.version);
  }

  async deleteDefinition(name: string): Promise<boolean> {
    const versions = this.definitions.get(name);
    if (!versions || versions.size === 0) return false;
    const latest = Math.max(...versions.keys());
    const spec = versions.get(latest)!;
    if (spec.deletedAt) return false;
    versions.set(latest, { ...spec, deletedAt: new Date() });
    return true;
  }

  generateId(): string {
    return randomUUID();
  }

  async ping(): Promise<boolean> {
    return true;
  }

  async close(): Promise<void> {
    // No resources to release; the adapter may be shared in process.
  }
}
