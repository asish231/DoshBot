import { createHash } from 'node:crypto';
import type { Store } from './store.js';
import type { WorkspaceStore } from './workspace.js';
import type { Monitor } from '../shared/types.js';

/**
 * Event-based site monitoring.
 *
 * A scheduled task runs whether or not anything changed; a monitor runs only
 * when something did. Each monitor fetches its URL on its own interval, hashes
 * the response, and the first time the hash differs from the previous check it
 * enqueues a task in the bound conversation — which the existing Runner picks
 * up and executes as a normal Dot turn ("the site changed, here is what to
 * do"). The Dot's own prompt, not this file, decides what happens next.
 *
 * The first check establishes a baseline and never fires, so creating a
 * monitor does not immediately duplicate the page it is watching.
 */

const CHECK_INTERVAL_MS = 30_000;
const FETCH_TIMEOUT_MS = 20_000;
const HASH_BODY_LIMIT = 512 * 1024;

/** Deterministic content signature; ignores byte noise beyond the limit. */
export function contentHash(text: string): string {
  return createHash('sha256').update(text.slice(0, HASH_BODY_LIMIT)).digest('hex');
}

export class MonitorService {
  private timer?: ReturnType<typeof setInterval>;
  private checking = false;
  constructor(
    private readonly store: Store,
    private readonly workspace: WorkspaceStore,
    private readonly fetchImpl: typeof fetch = fetch,
    /** Injectable clock so tests can advance time between checks. */
    private readonly now: () => number = Date.now,
  ) {}

  start() {
    if (!this.timer) {
      this.timer = setInterval(() => void this.tick(), CHECK_INTERVAL_MS);
      void this.tick();
    }
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
  }

  /** Runs one pass immediately — used by tests and manual triggers. */
  async checkNow() {
    await this.tick();
  }

  private async tick() {
    if (this.checking) return;
    this.checking = true;
    try {
      for (const monitor of this.store.monitors()) {
        if (monitor.status !== 'active') continue;
        const due =
          (monitor.lastCheckedAt ?? 0) === 0 ||
          this.now() - (monitor.lastCheckedAt ?? 0) >=
            monitor.intervalSeconds * 1000;
        if (due) await this.check(monitor);
      }
    } finally {
      this.checking = false;
    }
  }

  private async check(monitor: Monitor): Promise<void> {
    try {
      const response = await this.fetchImpl(monitor.url, {
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
        redirect: 'follow',
      });
      if (!response.ok) {
        this.store.recordMonitorCheck(
          monitor.id,
          null,
          `HTTP ${response.status}`,
        );
        return;
      }
      const body = await response.text();
      const hash = contentHash(body);
      const changed =
        monitor.lastHash !== null && monitor.lastHash !== undefined && monitor.lastHash !== hash;
      this.store.recordMonitorCheck(monitor.id, hash, null);
      if (!changed) return;
      // The event fired: enqueue a turn in the monitor's conversation. The
      // Runner executes it like any scheduled task, with the Dot's tools.
      const task = this.store.createTask(
        `Site monitor — ${monitor.url} changed since the last check (monitor id ${monitor.id}). ${monitor.prompt}`,
        null,
      );
      this.workspace.bindTask(task.id, monitor.threadId);
    } catch (error) {
      this.store.recordMonitorCheck(
        monitor.id,
        null,
        error instanceof Error ? error.message.slice(0, 300) : 'Fetch failed.',
      );
    }
  }
}
