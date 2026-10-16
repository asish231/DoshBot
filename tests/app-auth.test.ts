import { afterEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/server/app.js';
import { Store } from '../src/server/store.js';
import { WorkspaceStore } from '../src/server/workspace.js';
import { Platform } from '../src/server/platform.js';
import { Runner } from '../src/server/runner.js';
import { AuthStore } from '../src/server/auth.js';
import { AuthRateLimiter } from '../src/server/auth-rate-limit.js';
import type { Config } from '../src/server/research.js';

const stores: Array<{ close(): void }> = [];
const config: Config = { mode: 'sample', baseUrl: 'https://api.openai.com/v1' };
function fixture(options?: { ownerToken?: string; limiter?: boolean }) {
  const store = new Store(':memory:');
  const workspace = new WorkspaceStore(':memory:', 'opendots-owner');
  const auth = new AuthStore(':memory:', 'opendots-owner');
  const limiter = options?.limiter ? new AuthRateLimiter() : undefined;
  stores.push(store, workspace, auth);
  const runner = new Runner(store, config);
  const platform = new Platform(store, workspace, {
    baseUrl: config.baseUrl,
    voiceName: 'marin',
    slackUsers: [],
    runtimeUrl: '',
  });
  const app = createApp({
    store,
    runner,
    config,
    ownerToken: options?.ownerToken,
    platform,
    auth,
    authLimiter: limiter,
  });
  return { store, workspace, auth, app, limiter };
}
const json = (body: unknown) => ({
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
});
const authJson = (body: unknown, token: string) => ({
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${token}`,
  },
  body: JSON.stringify(body),
});
afterEach(() => stores.splice(0).forEach((store) => store.close()));

describe('account-based access', () => {
  it('locks the app to the setup screen until the first account exists', async () => {
    const { app } = fixture();
    // The status endpoint is public so the client can find the setup
    // screen; everything else is locked before the owner account exists.
    const status = (await (
      await app.request('/api/auth/status')
    ).json()) as { needsSetup: boolean; authRequired: boolean };
    expect(status.needsSetup).toBe(true);
    const blocked = await app.request('/api/state');
    expect(blocked.status).toBe(401);
    expect(((await blocked.json()) as { code: string }).code).toBe(
      'SETUP_REQUIRED',
    );
  });

  it('signs up the first account as owner and locks the app', async () => {
    const { app } = fixture();
    const signup = await app.request(
      '/api/auth/signup',
      json({ email: 'owner@example.com', password: 'password123' }),
    );
    expect(signup.status).toBe(200);
    const { user, token } = (await signup.json()) as {
      user: { id: string; role: string };
      token: string;
    };
    expect(user.id).toBe('opendots-owner');
    expect(user.role).toBe('owner');

    // Everything else now requires the session.
    expect((await app.request('/api/state')).status).toBe(401);
    const authed = await app.request('/api/state', {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(authed.status).toBe(200);
    const me = await app.request('/api/auth/me', {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(((await me.json()) as { user: { email: string } }).user.email).toBe(
      'owner@example.com',
    );
  });

  it('signs in and out with revoked sessions', async () => {
    const { app } = fixture();
    await app.request(
      '/api/auth/signup',
      json({ email: 'owner@example.com', password: 'password123' }),
    );
    const login = await app.request(
      '/api/auth/login',
      json({ email: 'owner@example.com', password: 'password123' }),
    );
    expect(login.status).toBe(200);
    const { token } = (await login.json()) as { token: string };
    expect(
      (
        await app.request('/api/state', {
          headers: { Authorization: `Bearer ${token}` },
        })
      ).status,
    ).toBe(200);
    await app.request('/api/auth/logout', authJson({}, token));
    expect(
      (
        await app.request('/api/state', {
          headers: { Authorization: `Bearer ${token}` },
        })
      ).status,
    ).toBe(401);
  });

  it('rejects bad credentials and wrong passwords', async () => {
    const { app } = fixture();
    await app.request(
      '/api/auth/signup',
      json({ email: 'owner@example.com', password: 'password123' }),
    );
    expect(
      (
        await app.request(
          '/api/auth/login',
          json({ email: 'owner@example.com', password: 'wrong-password' }),
        )
      ).status,
    ).toBe(401);
    expect(
      (
        await app.request(
          '/api/auth/signup',
          json({ email: 'owner@example.com', password: 'password456' }),
        )
      ).status,
    ).toBe(409);
  });

  it('scopes memories per user and keeps the owner separate from members', async () => {
    const { app, store } = fixture();
    // Bootstrap data belongs to the legacy owner identity.
    store.saveMemory('legacy owner memory', undefined, undefined, 'opendots-owner');
    const ownerSignup = (await (
      await app.request(
        '/api/auth/signup',
        json({ email: 'owner@example.com', password: 'password123' }),
      )
    ).json()) as { token: string };
    const memberSignup = (await (
      await app.request(
        '/api/auth/signup',
        json({
          email: 'member@example.com',
          password: 'password456',
          displayName: 'Member',
        }),
      )
    ).json()) as { token: string; user: { id: string } };

    await app.request(
      '/api/memories',
      authJson({ text: 'member private note' }, memberSignup.token),
    );
    await app.request(
      '/api/memories',
      authJson({ text: 'owner private note' }, ownerSignup.token),
    );

    const memberList = (await (
      await app.request('/api/memories', {
        headers: { Authorization: `Bearer ${memberSignup.token}` },
      })
    ).json()) as Array<{ text: string }>;
    expect(memberList.map((m) => m.text)).toEqual(['member private note']);

    const ownerList = (await (
      await app.request('/api/memories', {
        headers: { Authorization: `Bearer ${ownerSignup.token}` },
      })
    ).json()) as Array<{ text: string }>;
    // The owner adopted the legacy identity, so it sees both old and new.
    expect(ownerList.map((m) => m.text)).toEqual([
      'owner private note',
      'legacy owner memory',
    ]);
  });

  it('accepts OWNER_TOKEN as break-glass access to the owner account', async () => {
    const { app } = fixture({ ownerToken: 'break-glass-token-24-chars!' });
    // On token-protected deployments the bootstrap signup must prove
    // control of the token.
    const signup = await app.request(
      '/api/auth/signup',
      authJson(
        { email: 'owner@example.com', password: 'password123' },
        'break-glass-token-24-chars!',
      ),
    );
    expect(signup.status).toBe(200);
    const me = await app.request('/api/auth/me', {
      headers: { Authorization: 'Bearer break-glass-token-24-chars!' },
    });
    expect(me.status).toBe(200);
    expect(((await me.json()) as { user: { role: string } }).user.role).toBe(
      'owner',
    );
  });

  it('gates the API and the first signup behind OWNER_TOKEN until accounts exist', async () => {
    const { app } = fixture({ ownerToken: 'break-glass-token-24-chars!' });
    // Token gate applies in bootstrap mode too — an externally bound
    // deployment is not open before the first account.
    expect((await app.request('/api/state')).status).toBe(401);
    const status = (await (
      await app.request('/api/auth/status')
    ).json()) as { setupRequiresToken: boolean; needsSetup: boolean };
    expect(status.needsSetup).toBe(true);
    expect(status.setupRequiresToken).toBe(true);
    // Signup without the token is refused (no owner squatting).
    expect(
      (
        await app.request(
          '/api/auth/signup',
          json({ email: 'squatter@example.com', password: 'password123' }),
        )
      ).status,
    ).toBe(403);
    // With the token it succeeds and becomes the owner.
    const signup = await app.request(
      '/api/auth/signup',
      authJson(
        { email: 'owner@example.com', password: 'password123' },
        'break-glass-token-24-chars!',
      ),
    );
    expect(signup.status).toBe(200);
    expect(
      ((await signup.json()) as { user: { id: string } }).user.id,
    ).toBe('opendots-owner');
  });

  it('never locks out polling clients, only credential guessers', async () => {
    // Regression: a browser stuck on the load screen polls /state without
    // credentials; those polls must never feed the brute-force limiter,
    // or the client locks itself out before reaching a login form.
    const { app } = fixture({ limiter: true });
    for (let i = 0; i < 10; i++)
      expect((await app.request('/api/state')).status).toBe(401);
    // A first stale-token attempt counts once (the client drops dead
    // tokens after it) — and is still a plain 401, not a lockout.
    expect(
      (
        await app.request('/api/state', {
          headers: { Authorization: 'Bearer stale-old-token' },
        })
      ).status,
    ).toBe(401);
    // Repeated wrong-credential attempts still get blocked.
    for (let i = 0; i < 5; i++)
      await app.request('/api/state', {
        headers: { Authorization: `Bearer wrong-token-${i}` },
      });
    const blocked = await app.request('/api/state', {
      headers: { Authorization: 'Bearer wrong-token-6' },
    });
    expect(blocked.status).toBe(429);
    expect(Number(blocked.headers.get('retry-after'))).toBeGreaterThan(0);
  });

  it('counts wrong credentials but not signed-out polls toward lockout', async () => {
    const { app } = fixture({ limiter: true });
    await app.request(
      '/api/auth/signup',
      json({ email: 'owner@example.com', password: 'password123' }),
    );
    // A signed-out client polling without any credential: 401s, but no
    // limiter growth — an idle tab cannot lock the deployment out.
    for (let i = 0; i < 10; i++)
      expect((await app.request('/api/state')).status).toBe(401);
    // A wrong token still gets its clean 401 (not a 429) first.
    expect(
      (
        await app.request('/api/state', {
          headers: { Authorization: 'Bearer wrong-token' },
        })
      ).status,
    ).toBe(401);
    // Five wrong-token attempts → blocked.
    for (let i = 0; i < 5; i++)
      await app.request('/api/state', {
        headers: { Authorization: `Bearer wrong-token-${i}` },
      });
    const blocked = await app.request('/api/state', {
      headers: { Authorization: 'Bearer wrong-token-6' },
    });
    expect(blocked.status).toBe(429);
    expect(Number(blocked.headers.get('retry-after'))).toBeGreaterThan(0);
  });

  it('respects the allowSignups off switch for members', async () => {
    const { app, store } = fixture();
    await app.request(
      '/api/auth/signup',
      json({ email: 'owner@example.com', password: 'password123' }),
    );
    store.updateSettings({ allowSignups: false });
    expect(
      (
        await app.request(
          '/api/auth/signup',
          json({ email: 'member@example.com', password: 'password456' }),
        )
      ).status,
    ).toBe(403);
  });

  it('returns a clean 404 — not a service error — for another user’s thread', async () => {
    const { app, workspace } = fixture();
    await app.request(
      '/api/auth/signup',
      json({ email: 'owner@example.com', password: 'password123' }),
    );
    const owner = (await (
      await app.request(
        '/api/auth/login',
        json({ email: 'owner@example.com', password: 'password123' }),
      )
    ).json()) as { token: string };
    const member = (await (
      await app.request(
        '/api/auth/signup',
        json({ email: 'member@example.com', password: 'password456' }),
      )
    ).json()) as { token: string };
    // The owner's conversation, bound to the adopted bootstrap identity.
    const convId = 'owner-thread-1';
    workspace.bindThread(
      convId,
      workspace.dots()[0]!.id,
      'Owner chat',
      'opendots-owner',
    );

    // A member probing the owner's thread ids gets an indistinguishable
    // 404 — never a 5xx, never an existence leak.
    const probes: Array<[string, string, unknown]> = [
      [`/api/conversations/${convId}/session-memories`, 'GET', undefined],
      [`/api/conversations/${convId}/capture`, 'GET', undefined],
      [
        `/api/conversations/${convId}/edit`,
        'POST',
        { messageId: 'x', content: 'y' },
      ],
    ];
    for (const [path, method, body] of probes) {
      const res = await app.request(
        path,
        method === 'POST'
          ? authJson(body, member.token)
          : {
              method: 'GET',
              headers: { Authorization: `Bearer ${member.token}` },
            },
      );
      expect(res.status).toBe(404);
      expect(((await res.json()) as { error: string }).error).toBe(
        'Conversation not found.',
      );
    }
    // The owner still reaches their own thread.
    const own = await app.request(`/api/conversations/${convId}/session-memories`, {
      headers: { Authorization: `Bearer ${owner.token}` },
    });
    expect(own.status).toBe(200);
  });
});
