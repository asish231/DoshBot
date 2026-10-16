/**
 * Sliding-window rate limiter for failed owner-token attempts. After
 * `max` failures within `windowMs`, the key is blocked until the oldest
 * failure ages past `blockMs`. In-memory and per-process — the app runs
 * as a single node, so that is the whole attack surface it needs to
 * cover. `now` is injectable for tests.
 */
export class AuthRateLimiter {
  private failures = new Map<string, number[]>();
  constructor(
    private max = 5,
    private windowMs = 60_000,
    private blockMs = 60_000,
  ) {}
  /** Records a failed attempt for the key. */
  record(key: string, now = Date.now()) {
    const withinWindow = (this.failures.get(key) ?? []).filter(
      (t) => now - t < this.windowMs,
    );
    withinWindow.push(now);
    this.failures.set(key, withinWindow);
  }
  /** Milliseconds the key must still wait before attempts are read again. */
  blockedFor(key: string, now = Date.now()): number {
    const withinWindow = (this.failures.get(key) ?? []).filter(
      (t) => now - t < this.windowMs,
    );
    if (withinWindow.length < this.max) return 0;
    const oldest = withinWindow[0]!;
    return Math.max(0, this.blockMs - (now - oldest));
  }
}
