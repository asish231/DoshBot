import { afterEach, describe, expect, it, vi } from 'vitest';
import { WsTicketStore } from '../src/server/ws-tickets.js';

afterEach(() => vi.useRealTimers());

describe('WsTicketStore', () => {
  it('issues tickets that validate exactly once', () => {
    const store = new WsTicketStore();
    const { ticket } = store.create();
    expect(ticket).toHaveLength(64); // 32 bytes as hex
    expect(store.consume(ticket)).not.toBeNull();
    expect(store.consume(ticket)).toBeNull(); // single use
  });

  it('rejects unknown tickets', () => {
    const store = new WsTicketStore();
    expect(store.consume('deadbeef')).toBeNull();
  });

  it('expires tickets after the TTL', () => {
    vi.useFakeTimers();
    const store = new WsTicketStore(60_000);
    const { ticket, expiresAt } = store.create();
    expect(expiresAt).toBeGreaterThan(Date.now());
    vi.advanceTimersByTime(60_001);
    expect(store.consume(ticket)).toBeNull();
  });

  it('a replayed expired ticket is refused even with clock skew', () => {
    const store = new WsTicketStore(1000);
    const { ticket } = store.create(undefined, 0);
    expect(store.consume(ticket, 1500)).toBeNull();
  });

  it('each ticket is unique', () => {
    const store = new WsTicketStore();
    const first = store.create().ticket;
    const second = store.create().ticket;
    expect(first).not.toBe(second);
  });

  it('carries the minting user through consume', () => {
    const store = new WsTicketStore();
    const { ticket } = store.create('user-42');
    const minted = store.consume(ticket);
    expect(minted?.userId).toBe('user-42');
  });
});
