import type { Run } from "station-signal/browser";

export interface Checkpoint {
  name: string;
  output?: string;
  completedAt: Date;
}

export interface BrowserRun extends Run {
  definitionVersion: string;
  checkpoints: Checkpoint[];
}

/** Small local queue. All ownership changes and checkpoints use one IDB transaction. */
export class IndexedDBStore {
  private connection?: Promise<IDBDatabase>;

  constructor(readonly name = "station-browser") {}

  private open(): Promise<IDBDatabase> {
    if (!this.connection) {
      this.connection = new Promise((resolve, reject) => {
        const request = indexedDB.open(this.name, 2);
        request.onupgradeneeded = () => {
          for (const name of ["runs", "broadcasts", "beacons"]) {
            if (!request.result.objectStoreNames.contains(name)) request.result.createObjectStore(name, { keyPath: "id" });
          }
        };
        request.onerror = () => { this.connection = undefined; reject(request.error); };
        request.onsuccess = () => {
          const db = request.result;
          db.onversionchange = () => { db.close(); this.connection = undefined; };
          resolve(db);
        };
      });
    }
    return this.connection;
  }

  private async transaction<T>(
    mode: IDBTransactionMode,
    operation: (store: IDBObjectStore, result: (value: T) => void) => void,
  ): Promise<T> {
    return this.atomic(["runs"], mode, (tx, result) => operation(tx.objectStore("runs"), result));
  }

  /** Callbacks must use IDB requests synchronously, never await external work. */
  async atomic<T>(
    names: string[], mode: IDBTransactionMode,
    operation: (tx: IDBTransaction, result: (value: T) => void) => void,
  ): Promise<T> {
    const db = await this.open();
    return new Promise<T>((resolve, reject) => {
      const tx = db.transaction(names, mode);
      let value: T;
      tx.oncomplete = () => resolve(value);
      tx.onabort = () => reject(tx.error ?? new Error("IndexedDB transaction aborted"));
      tx.onerror = () => reject(tx.error ?? new Error("IndexedDB transaction failed"));
      try { operation(tx, (result) => { value = result; }); }
      catch (error) { tx.abort(); reject(error); }
    });
  }

  async add(run: BrowserRun): Promise<void> {
    await this.transaction<void>("readwrite", (store) => { store.add(run); });
  }

  async list(): Promise<BrowserRun[]> {
    return this.transaction("readonly", (store, result) => {
      store.getAll().onsuccess = (event) => {
        const rows = (event.target as IDBRequest<BrowserRun[]>).result;
        result(rows.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime()));
      };
    });
  }

  async get(id: string): Promise<BrowserRun | undefined> {
    return this.transaction("readonly", (store, result) => {
      const request = store.get(id);
      request.onsuccess = () => result(request.result);
    });
  }

  async claim(names: string[], stationId: string): Promise<BrowserRun | undefined> {
    return this.transaction("readwrite", (store, result) => {
      const request = store.getAll();
      request.onsuccess = () => {
        const now = new Date();
        const runs: BrowserRun[] = request.result;
        runs.sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
        for (const run of runs) {
          if (!names.includes(run.signalName)) continue;
          if (run.status === "running" && run.leaseExpiresAt && run.leaseExpiresAt <= now) {
            run.error = "Worker interrupted; recovered after its lease expired";
            run.status = run.attempts >= run.maxAttempts ? "failed" : "pending";
            run.leaseToken = undefined;
            run.leaseExpiresAt = undefined;
            if (run.status === "failed") run.completedAt = now;
            store.put(run);
          }
          if (run.status !== "pending" || (run.nextRunAt && run.nextRunAt > now)) continue;
          run.status = "running";
          run.attempts++;
          run.stationId = stationId;
          run.leaseToken = crypto.randomUUID();
          run.claimedAt = run.startedAt = run.lastRunAt = now;
          // Fixed deadline: recovery does not depend on background timer heartbeats.
          run.leaseExpiresAt = new Date(now.getTime() + run.timeout + 1_000);
          store.put(run);
          result(run);
          return;
        }
        result(undefined);
      };
    });
  }

  private async ownedUpdate(id: string, token: string, update: (run: BrowserRun) => void): Promise<boolean> {
    return this.transaction("readwrite", (store, result) => {
      const request = store.get(id);
      request.onsuccess = () => {
        const run: BrowserRun | undefined = request.result;
        if (!run || run.status !== "running" || run.leaseToken !== token
          || !run.leaseExpiresAt || run.leaseExpiresAt <= new Date()) {
          result(false);
          return;
        }
        update(run);
        store.put(run);
        result(true);
      };
    });
  }

  checkpoint(id: string, token: string, checkpoint: Checkpoint): Promise<boolean> {
    return this.ownedUpdate(id, token, (run) => { run.checkpoints.push(checkpoint); });
  }

  finish(id: string, token: string, outcome: { output?: string; error?: string }): Promise<boolean> {
    return this.ownedUpdate(id, token, (run) => {
      const failed = outcome.error !== undefined;
      run.status = failed ? (run.attempts < run.maxAttempts ? "pending" : "failed") : "completed";
      run.error = outcome.error;
      run.output = outcome.output;
      run.leaseToken = undefined;
      run.leaseExpiresAt = undefined;
      if (run.status === "pending") run.nextRunAt = new Date(Date.now() + 250);
      else run.completedAt = new Date();
    });
  }

  async cancel(id: string): Promise<boolean> {
    return this.transaction("readwrite", (store, result) => {
      const request = store.get(id);
      request.onsuccess = () => {
        const run: BrowserRun | undefined = request.result;
        if (!run || !["pending", "running"].includes(run.status)) { result(false); return; }
        run.status = "cancelled";
        run.completedAt = new Date();
        run.leaseToken = undefined;
        run.leaseExpiresAt = undefined;
        store.put(run);
        result(true);
      };
    });
  }

  async close(): Promise<void> {
    if (this.connection) (await this.connection).close();
    this.connection = undefined;
  }
}
