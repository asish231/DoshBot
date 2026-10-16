import { afterEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/server/app.js';
import { Store } from '../src/server/store.js';
import { WorkspaceStore } from '../src/server/workspace.js';
import { Platform } from '../src/server/platform.js';
import { Runner } from '../src/server/runner.js';
import {
  TaskForceEngine,
  setTaskForceEngine,
} from '../src/server/task-force.js';
import { TaskForceStore } from '../src/server/task-force-store.js';
import type { Config } from '../src/server/research.js';

const closers: Array<() => void> = [];
const config: Config = { mode: 'sample', baseUrl: 'https://api.openai.com/v1' };
afterEach(() => {
  setTaskForceEngine(undefined);
  closers.splice(0).forEach((close) => close());
});

function fixture() {
  const store = new Store(':memory:');
  const workspace = new WorkspaceStore(':memory:', 'opendots-owner');
  const tf = new TaskForceStore(':memory:');
  closers.push(() => {
    store.close();
    workspace.close();
    tf.close();
  });
  const engine = new TaskForceEngine(store, tf, {
    model: { baseUrl: 'https://m.test/v1', apiKey: 'k', model: 'm' },
    configOverrides: { waveSize: 1, maxWave: 1, maxDepth: 0 },
  });
  const platform = new Platform(store, workspace, {
    baseUrl: config.baseUrl,
    voiceName: 'marin',
    slackUsers: [],
    runtimeUrl: '',
  });
  const app = createApp({
    store,
    runner: new Runner(store, config),
    config,
    platform,
  });
  return { store, workspace, tf, engine, app };
}

const json = (body: unknown = {}, method = 'POST') => ({
  method,
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
});

describe('task force REST surface', () => {
  it('reports 503 while the engine is not running', async () => {
    setTaskForceEngine(undefined);
    const { app } = fixture();
    expect((await app.request('/api/task-force')).status).toBe(503);
    expect((await app.request('/api/task-force/any')).status).toBe(503);
    expect(
      (await app.request('/api/task-force/any/pause', json())).status,
    ).toBe(503);
  });

  it('lists sessions and returns per-session detail with worker counts', async () => {
    const { workspace, engine, app } = fixture();
    setTaskForceEngine(engine);
    const thread = workspace.bindThread(
      'thread-tf',
      workspace.dots()[0].id,
      'TF chat',
    );
    const session = engine.startSession({
      threadId: thread.id,
      dotId: thread.dotId,
      mission: 'Audit the onboarding UX of the whole app',
      hours: 2,
    });
    const list = (await (
      await app.request('/api/task-force')
    ).json()) as Array<{
      id: string;
      mission: string;
      status: string;
      threadId: string;
    }>;
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({
      id: session.id,
      threadId: thread.id,
      status: 'running',
    });
    expect(list[0].mission).toContain('onboarding');

    const detail = (await (
      await app.request(`/api/task-force/${session.id}`)
    ).json()) as {
      sessionId: string;
      workers: { total: number; running: number };
      hoursBudget: number;
      remainingMs: number;
    };
    expect(detail.sessionId).toBe(session.id);
    expect(detail.workers).toEqual({
      total: 0,
      completed: 0,
      failed: 0,
      running: 0,
    });
    expect(detail.hoursBudget).toBe(2);
    expect(detail.remainingMs).toBeGreaterThan(0);
  });

  it('rejects unknown sessions and unknown actions', async () => {
    const { engine, app } = fixture();
    setTaskForceEngine(engine);
    expect((await app.request('/api/task-force/missing')).status).toBe(404);
    expect(
      (await app.request('/api/task-force/missing/pause', json())).status,
    ).toBe(404);
    const session = engine.startSession({
      threadId: 'thread-x',
      dotId: 'dot-x',
      mission: 'Mission without a bound thread surface',
      hours: 1,
    });
    expect(
      (await app.request(`/api/task-force/${session.id}/explode`, json()))
        .status,
    ).toBe(400);
  });

  it('pauses, resumes, and cancels a session', async () => {
    const { workspace, engine, app } = fixture();
    setTaskForceEngine(engine);
    const thread = workspace.bindThread(
      'thread-lifecycle',
      workspace.dots()[0].id,
      'Lifecycle chat',
    );
    const session = engine.startSession({
      threadId: thread.id,
      dotId: thread.dotId,
      mission: 'Market research lifecycle test',
      hours: 1,
    });
    const paused = (await (
      await app.request(`/api/task-force/${session.id}/pause`, json())
    ).json()) as { status: string };
    expect(paused.status).toBe('paused');
    const resumed = (await (
      await app.request(`/api/task-force/${session.id}/resume`, json())
    ).json()) as { status: string };
    expect(resumed.status).toBe('running');
    const cancelled = (await (
      await app.request(`/api/task-force/${session.id}/cancel`, json())
    ).json()) as { status: string };
    expect(cancelled.status).toBe('cancelled');
  });

  it('enforces conversation ownership on detail and actions', async () => {
    const { workspace, engine, app } = fixture();
    setTaskForceEngine(engine);
    const thread = workspace.bindThread(
      'thread-owned',
      workspace.dots()[0].id,
      'Owned chat',
    );
    const session = engine.startSession({
      threadId: thread.id,
      dotId: thread.dotId,
      mission: 'Owned mission detail and action check',
      hours: 1,
    });
    // The bound thread is owned by the bootstrap owner in open mode.
    expect((await app.request(`/api/task-force/${session.id}`)).status).toBe(
      200,
    );
    // A session whose thread was never bound (or is foreign) is refused.
    const foreign = engine.startSession({
      threadId: 'thread-foreign',
      dotId: thread.dotId,
      mission: 'Foreign mission that must not be readable',
      hours: 1,
    });
    expect((await app.request(`/api/task-force/${foreign.id}`)).status).toBe(
      404,
    );
    expect(
      (await app.request(`/api/task-force/${foreign.id}/pause`, json())).status,
    ).toBe(404);
  });

  it('patches task force tier settings with range validation', async () => {
    const { store, app } = fixture();
    const ok = await app.request(
      '/api/settings',
      json(
        {
          taskForceMaxHours: 8,
          taskForceMaxWorkers: 5000,
          taskForceConcurrency: 24,
        },
        'PATCH',
      ),
    );
    expect(ok.status).toBe(200);
    expect(store.settings()).toMatchObject({
      taskForceMaxHours: 8,
      taskForceMaxWorkers: 5000,
      taskForceConcurrency: 24,
    });
    // Out-of-range values are rejected before anything is stored.
    expect(
      (
        await app.request(
          '/api/settings',
          json({ taskForceMaxHours: 30 }, 'PATCH'),
        )
      ).status,
    ).toBe(400);
    expect(
      (
        await app.request(
          '/api/settings',
          json({ taskForceConcurrency: 200 }, 'PATCH'),
        )
      ).status,
    ).toBe(400);
    expect(
      (
        await app.request(
          '/api/settings',
          json({ taskForceMaxWorkers: 2 }, 'PATCH'),
        )
      ).status,
    ).toBe(400);
  });
});
