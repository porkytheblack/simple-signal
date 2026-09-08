import { MemoryAdapter } from "./adapters/memory.js";
import type { SignalQueueAdapter } from "./adapters/index.js";
import type { TriggerAdapter } from "./adapters/trigger.js";
import { HttpTriggerAdapter } from "./adapters/http-trigger.js";

let _adapter: SignalQueueAdapter = new MemoryAdapter();
let _triggerAdapter: TriggerAdapter | null = null;
let _configured = false;
let _warnedUnconfigured = false;

export interface ConfigureOptions {
  /** Local adapter for in-process signal storage. */
  adapter?: SignalQueueAdapter;
  /** Remote Station server endpoint (e.g. "https://station.example.com"). */
  endpoint?: string;
  /** API key for authenticating with the remote Station server. */
  apiKey?: string;
  /** Custom trigger adapter (advanced — overrides endpoint/apiKey). */
  triggerAdapter?: TriggerAdapter;
}

export function configure(options: ConfigureOptions): void {
  if (_configured) {
    console.warn(
      "[station-signal] configure() called multiple times. The previous configuration will be replaced.",
    );
  }

  if (options.adapter) {
    _adapter = options.adapter;
  }

  if (options.triggerAdapter) {
    _triggerAdapter = options.triggerAdapter;
  } else if (options.endpoint) {
    _triggerAdapter = new HttpTriggerAdapter({
      endpoint: options.endpoint,
      apiKey: options.apiKey,
    });
  }

  _configured = true;
}

/** Auto-configure from environment variables on first access. */
function autoConfigureFromEnv(): void {
  if (_configured) return;
  if (typeof process === "undefined") return;
  const endpoint = process.env.STATION_ENDPOINT;
  const apiKey = process.env.STATION_API_KEY;
  if (endpoint) {
    configure({ endpoint, apiKey });
  }
}

export function getAdapter(): SignalQueueAdapter {
  autoConfigureFromEnv();
  if (!_configured && !_warnedUnconfigured) {
    _warnedUnconfigured = true;
    console.warn(
      "[station-signal] No adapter configured — using default MemoryAdapter. " +
      "Call configure({ adapter }) or pass an adapter to SignalRunner for persistent storage.",
    );
  }
  return _adapter;
}

export function getTriggerAdapter(): TriggerAdapter | null {
  autoConfigureFromEnv();
  return _triggerAdapter;
}

/** Returns true if configure() has been called. */
export function isConfigured(): boolean {
  return _configured;
}

const _wakeListeners = new Set<() => void>();

/**
 * Register a callback invoked whenever a run is enqueued locally (in-process).
 * Runners use this to wake from idle back-off immediately instead of waiting
 * for the next poll. Returns an unsubscribe function.
 */
export function onLocalEnqueue(listener: () => void): () => void {
  _wakeListeners.add(listener);
  return () => _wakeListeners.delete(listener);
}

/** Notify runners in this process that a run was just enqueued. */
export function notifyLocalEnqueue(): void {
  for (const listener of _wakeListeners) {
    try {
      listener();
    } catch {
      // Wake listeners must never break the trigger path.
    }
  }
}
