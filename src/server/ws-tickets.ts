import { randomBytes } from 'node:crypto';

/**
 * Single-use, short-lived tickets for authorizing the voice WebSocket
 * upgrade. The long-lived owner token or session never appears in a URL
 * (where it would leak into server logs and browser history): the client
 * exchanges its credentials for a one-time ticket over an authenticated
 * POST, then presents that ticket as a query param. Each ticket dies on
 * first use and after its TTL regardless, and it carries the user id of
 * the minter so the upgrade can enforce per-user thread ownership.
 */
export class WsTicketStore {
  private tickets = new Map<string, { expiresAt: number; userId?: string }>();
  constructor(private ttlMs = 60_000) {}
  /** Issues a fresh single-use ticket with its expiry, bound to a user. */
  create(userId?: string, now = Date.now()): { ticket: string; expiresAt: number } {
    // Opportunistic sweep: expired tickets never accumulate.
    this.sweep(now);
    const ticket = randomBytes(32).toString('hex');
    const expiresAt = now + this.ttlMs;
    this.tickets.set(ticket, { expiresAt, userId });
    return { ticket, expiresAt };
  }
  /**
   * Burns the ticket if it exists and is unexpired. Returns the user it
   * was minted for (undefined when minted anonymously), or null when the
   * ticket is invalid, used, or expired.
   */
  consume(ticket: string, now = Date.now()): { userId?: string } | null {
    const entry = this.tickets.get(ticket);
    this.tickets.delete(ticket);
    if (!entry || entry.expiresAt <= now) return null;
    return { userId: entry.userId };
  }
  private sweep(now: number) {
    for (const [ticket, entry] of this.tickets)
      if (entry.expiresAt <= now) this.tickets.delete(ticket);
  }
}
