import { afterEach, describe, expect, it, vi } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { AuthStore, AuthError } from '../src/server/auth.js';

const stores: AuthStore[] = [];
afterEach(() => stores.splice(0).forEach((store) => store.close()));

function fixture(bootstrapOwnerId = 'opendots-owner') {
  const store = new AuthStore(':memory:', bootstrapOwnerId);
  stores.push(store);
  return store;
}

describe('AuthStore', () => {
  it('makes the first account the owner and adopts the bootstrap id', () => {
    const store = fixture();
    const { user, token } = store.signup('Owner@Example.com', 'password123');
    // Existing single-owner data (threads bound to 'opendots-owner')
    // carries over because the first account adopts that identity.
    expect(user.id).toBe('opendots-owner');
    expect(user.role).toBe('owner');
    expect(user.email).toBe('owner@example.com');
    expect(store.validate(token)?.id).toBe(user.id);
  });

  it('creates later accounts as members with fresh identities', () => {
    const store = fixture();
    store.signup('owner@example.com', 'password123');
    const member = store.signup('member@example.com', 'password456');
    expect(member.user.role).toBe('member');
    expect(member.user.id).not.toBe('opendots-owner');
    expect(member.user.displayName).toBe('member');
  });

  it('rejects duplicate emails (case-insensitive)', () => {
    const store = fixture();
    store.signup('owner@example.com', 'password123');
    expect(() => store.signup('OWNER@example.com', 'password456')).toThrow(
      AuthError,
    );
  });

  it('enforces the password policy and email shape', () => {
    const store = fixture();
    expect(() => store.signup('a@b.co', 'short')).toThrow(/8/);
    expect(() => store.signup('not-an-email', 'password123')).toThrow(
      /email/i,
    );
  });

  it('login checks credentials and tolerates email case', () => {
    const store = fixture();
    store.signup('owner@example.com', 'password123');
    const { user, token } = store.login('OWNER@EXAMPLE.com', 'password123');
    expect(user.role).toBe('owner');
    expect(store.validate(token)?.email).toBe('owner@example.com');
    expect(() => store.login('owner@example.com', 'wrongpass')).toThrow(
      AuthError,
    );
    expect(() => store.login('ghost@example.com', 'password123')).toThrow(
      AuthError,
    );
  });

  it('logout revokes the session', () => {
    const store = fixture();
    const { token } = store.signup('owner@example.com', 'password123');
    expect(store.validate(token)).toBeDefined();
    store.logout(token);
    expect(store.validate(token)).toBeUndefined();
    // Double logout is safe.
    store.logout(token);
  });

  it('rejects garbage tokens without throwing', () => {
    const store = fixture();
    expect(store.validate('')).toBeUndefined();
    expect(store.validate('nonsense')).toBeUndefined();
  });

  it('mints short-lived internal tokens for a thread owner, not for unknown users', () => {
    const store = fixture();
    const { user } = store.signup('owner@example.com', 'password123');
    const member = store.signup('member@example.com', 'password456');
    // Internal token resolves to the right identity…
    const token = store.mintInternalToken(member.user.id);
    expect(token).not.toBeNull();
    expect(store.validate(token!)?.id).toBe(member.user.id);
    expect(store.validate(token!)?.role).toBe('member');
    // …even for the adopted bootstrap owner…
    const ownerToken = store.mintInternalToken(user.id);
    expect(store.validate(ownerToken!)?.id).toBe('opendots-owner');
    // …but never for an identity without an account.
    expect(store.mintInternalToken('user-without-account')).toBeNull();
  });

  it('expires internal tokens after their short TTL', () => {
    vi.useFakeTimers();
    const store = fixture();
    const { user } = store.signup('owner@example.com', 'password123');
    const token = store.mintInternalToken(user.id, 60_000);
    expect(store.validate(token!)).toBeDefined();
    vi.advanceTimersByTime(60_001);
    expect(store.validate(token!)).toBeUndefined();
    vi.useRealTimers();
  });

  it('sweeps expired sessions so internal turns do not grow the table forever', () => {
    vi.useFakeTimers();
    const path = `${process.env.TEMP_DIR ?? '/tmp'}/auth-sweep-test-${Date.now()}.sqlite`;
    const store = new AuthStore(path);
    stores.push(store);
    const { user } = store.signup('owner@example.com', 'password123');
    for (let i = 0; i < 20; i++) store.mintInternalToken(user.id, 60_000);
    vi.advanceTimersByTime(120_000);
    // The next mint sweeps the 20 dead sessions before inserting its own.
    store.mintInternalToken(user.id);
    const db = new DatabaseSync(path);
    try {
      const count = db
        .prepare('SELECT COUNT(*) AS n FROM sessions')
        .get() as { n: number };
      // The 20 dead internal sessions are gone; what remains is the
      // signup session (30-day TTL) plus the fresh mint.
      expect(count.n).toBe(2);
    } finally {
      db.close();
    }
    vi.useRealTimers();
  });

  it('stores salted password hashes, never raw credentials', () => {
    const path = `${process.env.TEMP_DIR ?? '/tmp'}/auth-hash-test-${Date.now()}.sqlite`;
    const store = new AuthStore(path);
    stores.push(store);
    const { token } = store.signup('owner@example.com', 'password123');
    const db = new DatabaseSync(path);
    try {
      const user = db
        .prepare('SELECT * FROM users')
        .get() as { passwordHash: string };
      const session = db
        .prepare('SELECT * FROM sessions')
        .get() as { tokenHash: string };
      // Password: scrypt salt+hash, never the password itself.
      expect(user.passwordHash).toMatch(/^[0-9a-f]{32}:[0-9a-f]{128}$/);
      expect(user.passwordHash).not.toContain('password123');
      // Session: only the SHA-256 of the raw token is stored.
      expect(session.tokenHash).toHaveLength(64);
      expect(session.tokenHash).not.toBe(token);
    } finally {
      db.close();
    }
  });
});
