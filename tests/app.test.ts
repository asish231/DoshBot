import { afterEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/server/app.js';
import { Store } from '../src/server/store.js';
import { Runner } from '../src/server/runner.js';
import { AuthRateLimiter } from '../src/server/auth-rate-limit.js';
import { WsTicketStore } from '../src/server/ws-tickets.js';
import type { Config } from '../src/server/research.js';
const stores: Store[] = [];
const config: Config = { mode: 'sample', baseUrl: 'https://api.openai.com/v1' };
function fixture(token?: string) {
  const store = new Store(':memory:');
  stores.push(store);
  const runner = new Runner(store, config);
  return {
    store,
    runner,
    app: createApp({ store, runner, config, ownerToken: token }),
  };
}
const json = (body: unknown) => ({
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
});
afterEach(() => stores.splice(0).forEach((store) => store.close()));
describe('API boundaries', () => {
  it('requires owner token for state and mutations when configured', async () => {
    const { app } = fixture('private-token');
    expect((await app.request('/api/state')).status).toBe(401);
    expect(
      (
        await app.request('/api/state', {
          headers: { Authorization: 'Bearer private-token' },
        })
      ).status,
    ).toBe(200);
  });
  it('rate-limits repeated failed token attempts and advertises Retry-After', async () => {
    const limiter = new AuthRateLimiter(3, 60_000, 60_000);
    const store = new Store(':memory:');
    stores.push(store);
    const app = createApp({
      store,
      runner: new Runner(store, config),
      config,
      ownerToken: 'private-token',
      authLimiter: limiter,
    });
    // Failures up to the threshold are ordinary 401s.
    for (let i = 0; i < 3; i++)
      expect(
        (await app.request('/api/state', { headers: { Authorization: 'Bearer wrong' } }))
          .status,
      ).toBe(401);
    // The next attempt is blocked before the token is even compared.
    const blocked = await app.request('/api/state', {
      headers: { Authorization: 'Bearer private-token' },
    });
    expect(blocked.status).toBe(429);
    expect(Number(blocked.headers.get('retry-after'))).toBeGreaterThan(0);
  });
  it('issues single-use voice WebSocket tickets only to the owner', async () => {
    const wsTickets = new WsTicketStore();
    const store = new Store(':memory:');
    stores.push(store);
    const app = createApp({
      store,
      runner: new Runner(store, config),
      config,
      ownerToken: 'private-token',
      wsTickets,
    });
    // Unauthenticated requests cannot mint tickets.
    expect((await app.request('/api/voice/ws-ticket', json({}))).status).toBe(
      401,
    );
    const res = await app.request('/api/voice/ws-ticket', {
      ...json({}),
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer private-token',
      },
    });
    expect(res.status).toBe(200);
    const { ticket } = (await res.json()) as { ticket: string };
    expect(ticket).toHaveLength(64);
    expect(wsTickets.consume(ticket)).not.toBeNull();
    expect(wsTickets.consume(ticket)).toBeNull();
  });
  it('blocks browser cross-origin requests and form posts', async () => {
    const { app } = fixture();
    expect(
      (
        await app.request('/api/tasks', {
          ...json({ prompt: 'test' }),
          headers: {
            'Content-Type': 'application/json',
            Origin: 'https://evil.example',
          },
        })
      ).status,
    ).toBe(403);
    expect(
      (
        await app.request('/api/tasks', {
          method: 'POST',
          body: 'prompt=hello',
        })
      ).status,
    ).toBe(415);
  });
  it('validates inputs and enforces research permissions on the server', async () => {
    const { app, store } = fixture();
    expect(
      (await app.request('/api/tasks', json({ prompt: 'x' }))).status,
    ).toBe(400);
    expect(
      (
        await app.request(
          '/api/tasks',
          json({ prompt: 'Research', intervalSeconds: 1 }),
        )
      ).status,
    ).toBe(400);
    store.updateSettings({ researchAllowed: false });
    expect(
      (await app.request('/api/tasks', json({ prompt: 'Research' }))).status,
    ).toBe(403);
    expect(store.claim()).toBeNull();
  });
  it('runs a sample job from the durable queue and retains its result', async () => {
    const { app, store, runner } = fixture();
    const response = await app.request(
      '/api/tasks',
      json({ prompt: 'Plan a quiet weekend' }),
    );
    expect(response.status).toBe(201);
    await runner.tick();
    const task = store.tasks()[0];
    expect(task.status).toBe('completed');
    expect(store.detail(task.id)?.runs[0].result?.sample).toBe(true);
  });
  it('persists memory edits and deletes', async () => {
    const { app, store } = fixture();
    await app.request('/api/memories', json({ text: 'Prefer short briefs' }));
    const memory = store.memories()[0];
    const updated = await app.request(`/api/memories/${memory.id}`, {
      ...json({ text: 'Prefer deep briefs' }),
      method: 'PUT',
    });
    expect(updated.status).toBe(200);
    expect(store.memories()[0].text).toBe('Prefer deep briefs');
    await app.request(`/api/memories/${memory.id}`, {
      ...json({}),
      method: 'DELETE',
    });
    expect(store.memories()).toHaveLength(0);
  });
});
it('rejects DNS-rebinding Host even with a matching hostile Origin', async () => {
  const { app } = fixture();
  const response = await app.request('http://attacker.example/api/tasks', {
    ...json({ prompt: 'Sneaky task' }),
    headers: {
      'Content-Type': 'application/json',
      Origin: 'http://attacker.example',
      'Sec-Fetch-Site': 'same-origin',
    },
  });
  expect(response.status).toBe(403);
});
