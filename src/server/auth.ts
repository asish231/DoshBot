import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import {
  createHash,
  randomBytes,
  randomUUID,
  scryptSync,
  timingSafeEqual,
} from 'node:crypto';

export interface AuthUser {
  id: string;
  email: string;
  displayName: string;
  role: 'owner' | 'member';
  createdAt: number;
}

interface SessionRow {
  id: string;
  userId: string;
  tokenHash: string;
  createdAt: number;
  expiresAt: number;
  revokedAt: number | null;
}

/** How long a signed-in session stays valid without re-authentication. */
export const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const MIN_PASSWORD_LENGTH = 8;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function hashPassword(password: string): string {
  const salt = randomBytes(16).toString('hex');
  const hash = scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${hash}`;
}

function verifyPassword(password: string, stored: string): boolean {
  const [salt, hash] = stored.split(':');
  if (!salt || !hash) return false;
  const candidate = scryptSync(password, salt, 64);
  const expected = Buffer.from(hash, 'hex');
  return (
    candidate.length === expected.length &&
    timingSafeEqual(candidate, expected)
  );
}

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

function toUser(row: {
  id: string;
  email: string;
  displayName: string;
  role: string;
  createdAt: number;
}): AuthUser {
  return {
    id: row.id,
    email: row.email,
    displayName: row.displayName,
    role: row.role === 'owner' ? 'owner' : 'member',
    createdAt: row.createdAt,
  };
}

/**
 * Accounts and sessions for multi-user access. Credentials are scrypt-hashed
 * with per-user salts; session tokens are random and only their SHA-256 is
 * stored, so a database leak does not leak usable sessions. The first
 * account created adopts `bootstrapOwnerId` so a pre-existing single-owner
 * deployment keeps its conversations and memories.
 */
export class AuthStore {
  private db: DatabaseSync;
  constructor(
    path: string,
    private bootstrapOwnerId = 'opendots-owner',
  ) {
    if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
    this.db = new DatabaseSync(path);
    this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;
      CREATE TABLE IF NOT EXISTS users (
        id TEXT PRIMARY KEY,
        email TEXT NOT NULL UNIQUE COLLATE NOCASE,
        displayName TEXT NOT NULL,
        passwordHash TEXT NOT NULL,
        role TEXT NOT NULL,
        createdAt INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS sessions (
        id TEXT PRIMARY KEY,
        userId TEXT NOT NULL,
        tokenHash TEXT NOT NULL UNIQUE,
        createdAt INTEGER NOT NULL,
        expiresAt INTEGER NOT NULL,
        revokedAt INTEGER,
        lastSeenAt INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(userId);`);
  }
  close() {
    this.db.close();
  }
  userCount(): number {
    const row = this.db.prepare('SELECT COUNT(*) AS n FROM users').get() as {
      n: number;
    };
    return row.n;
  }
  user(id: string): AuthUser | undefined {
    const row = this.db
      .prepare('SELECT * FROM users WHERE id=?')
      .get(id) as ReturnType<typeof toUser> | undefined;
    return row ? toUser(row) : undefined;
  }
  /** Creates the first account (owner, adopting existing data) or a member. */
  signup(
    email: string,
    password: string,
    displayName?: string,
  ): { user: AuthUser; token: string } {
    const normalizedEmail = email.trim().toLowerCase();
    if (!EMAIL_PATTERN.test(normalizedEmail))
      throw new AuthError('Enter a valid email address.');
    if (password.length < MIN_PASSWORD_LENGTH)
      throw new AuthError(
        `Passwords must be at least ${MIN_PASSWORD_LENGTH} characters.`,
      );
    if (this.userByEmail(normalizedEmail))
      throw new AuthError('An account with this email already exists.');
    const isFirst = this.userCount() === 0;
    // The first account adopts the bootstrap owner identity, inheriting
    // every pre-existing conversation, memory, and upload.
    const id = isFirst ? this.bootstrapOwnerId : randomUUID();
    const user: AuthUser = {
      id,
      email: normalizedEmail,
      displayName: (displayName?.trim() || normalizedEmail.split('@')[0]).slice(
        0,
        60,
      ),
      role: isFirst ? 'owner' : 'member',
      createdAt: Date.now(),
    };
    this.db
      .prepare(
        'INSERT INTO users (id, email, displayName, passwordHash, role, createdAt) VALUES (?, ?, ?, ?, ?, ?)',
      )
      .run(
        user.id,
        user.email,
        user.displayName,
        hashPassword(password),
        user.role,
        user.createdAt,
      );
    return { user, token: this.createSession(user.id) };
  }
  login(email: string, password: string): { user: AuthUser; token: string } {
    const normalizedEmail = email.trim().toLowerCase();
    const row = this.db
      .prepare('SELECT * FROM users WHERE email=?')
      .get(normalizedEmail) as
      | (ReturnType<typeof toUser> & { passwordHash: string })
      | undefined;
    if (!row || !verifyPassword(password, row.passwordHash))
      throw new AuthError('Incorrect email or password.');
    return { user: toUser(row), token: this.createSession(row.id) };
  }
  private createSession(userId: string, ttlMs = SESSION_TTL_MS): string {
    const token = randomBytes(32).toString('hex');
    const now = Date.now();
    // Keep the table bounded: expired sessions are worthless to anyone.
    this.db.prepare('DELETE FROM sessions WHERE expiresAt <= ?').run(now);
    this.db
      .prepare(
        'INSERT INTO sessions (id, userId, tokenHash, createdAt, expiresAt, lastSeenAt) VALUES (?, ?, ?, ?, ?, ?)',
      )
      .run(
        randomUUID(),
        userId,
        hashToken(token),
        now,
        now + ttlMs,
        now,
      );
    return token;
  }
  /**
   * Mints a short-lived internal session so a server-side turn (voice
   * compute, scheduled task, dot delegation) runs on the runtime under
   * the identity of the thread's owner — the same identity the browser
   * uses for that thread. Null when the owner has no account yet (the
   * caller falls back to the break-glass token).
   */
  mintInternalToken(userId: string, ttlMs = 10 * 60_000): string | null {
    if (!this.user(userId)) return null;
    return this.createSession(userId, ttlMs);
  }
  /** Resolves a session token to its user, or undefined when invalid. */
  validate(token: string): AuthUser | undefined {
    if (!token) return undefined;
    const row = this.db
      .prepare('SELECT * FROM sessions WHERE tokenHash=?')
      .get(hashToken(token)) as SessionRow | undefined;
    if (!row || row.revokedAt || row.expiresAt <= Date.now()) return undefined;
    this.db
      .prepare('UPDATE sessions SET lastSeenAt=? WHERE id=?')
      .run(Date.now(), row.id);
    return this.user(row.userId);
  }
  logout(token: string): void {
    if (!token) return;
    this.db
      .prepare('UPDATE sessions SET revokedAt=? WHERE tokenHash=?')
      .run(Date.now(), hashToken(token));
  }
  userByEmail(email: string): AuthUser | undefined {
    const row = this.db
      .prepare('SELECT * FROM users WHERE email=?')
      .get(email.trim().toLowerCase()) as
      | ReturnType<typeof toUser>
      | undefined;
    return row ? toUser(row) : undefined;
  }
  /**
   * The identity OWNER_TOKEN grants: the actual owner account once one
   * exists, otherwise a synthetic bootstrap owner so the static token
   * keeps working before the first signup.
   */
  breakGlassUser(): AuthUser {
    const row = this.db
      .prepare("SELECT * FROM users WHERE role='owner' ORDER BY createdAt LIMIT 1")
      .get() as ReturnType<typeof toUser> | undefined;
    if (row) return toUser(row);
    return {
      id: this.bootstrapOwnerId,
      email: 'owner@local',
      displayName: 'Owner',
      role: 'owner',
      createdAt: 0,
    };
  }
}

export class AuthError extends Error {}
