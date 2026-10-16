import { afterEach, describe, expect, it, vi } from 'vitest';
import { AuthRateLimiter } from '../src/server/auth-rate-limit.js';

afterEach(() => vi.useRealTimers());

describe('AuthRateLimiter', () => {
  it('allows attempts until the failure threshold is reached', () => {
    const limiter = new AuthRateLimiter(3, 60_000, 60_000);
    const now = Date.now();
    limiter.record('a', now);
    limiter.record('a', now + 100);
    expect(limiter.blockedFor('a', now + 200)).toBe(0);
    limiter.record('a', now + 300);
    expect(limiter.blockedFor('a', now + 400)).toBeGreaterThan(0);
  });

  it('blocks other keys independently', () => {
    const limiter = new AuthRateLimiter(2, 60_000, 60_000);
    const now = Date.now();
    limiter.record('a', now);
    limiter.record('a', now + 1);
    expect(limiter.blockedFor('a', now + 2)).toBeGreaterThan(0);
    expect(limiter.blockedFor('b', now + 2)).toBe(0);
  });

  it('unblocks once the block window passes', () => {
    vi.useFakeTimers();
    const limiter = new AuthRateLimiter(2, 60_000, 30_000);
    limiter.record('a');
    limiter.record('a');
    expect(limiter.blockedFor('a')).toBeGreaterThan(0);
    vi.advanceTimersByTime(31_000);
    expect(limiter.blockedFor('a')).toBe(0);
  });

  it('old failures fall out of the sliding window', () => {
    vi.useFakeTimers();
    const limiter = new AuthRateLimiter(2, 10_000, 30_000);
    limiter.record('a');
    vi.advanceTimersByTime(11_000);
    limiter.record('a');
    // Only one failure is inside the window — not blocked.
    expect(limiter.blockedFor('a')).toBe(0);
  });

  it('reports the remaining wait time in milliseconds', () => {
    vi.useFakeTimers();
    const limiter = new AuthRateLimiter(1, 60_000, 30_000);
    limiter.record('a');
    vi.advanceTimersByTime(10_000);
    const wait = limiter.blockedFor('a');
    expect(wait).toBeGreaterThan(19_000);
    expect(wait).toBeLessThanOrEqual(20_100);
  });
});
