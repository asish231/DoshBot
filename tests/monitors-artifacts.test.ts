import { afterEach, describe, expect, it, vi } from 'vitest';
import { type RunAgentInput } from '@ag-ui/core';
import { lastValueFrom, toArray } from 'rxjs';
import { DotAgent } from '../src/server/dot-agent.js';
import { contentHash, MonitorService } from '../src/server/monitors.js';
import { Store } from '../src/server/store.js';
import { WorkspaceStore } from '../src/server/workspace.js';
import { completion } from './fixtures/model-stream.js';

const databases: Array<{ close(): void }> = [];
afterEach(() => {
  vi.restoreAllMocks();
  databases.splice(0).forEach((db) => db.close());
});

function fixture() {
  const store = new Store(':memory:');
  const workspace = new WorkspaceStore(':memory:', 'owner');
  databases.push(store, workspace);
  const dot = workspace.dots()[0];
  workspace.bindThread('thread', dot.id, 'TanStack');
  const agent = new DotAgent(
    store,
    workspace,
    {
      intelligenceKey: 'fixture',
      apiKey: 'fixture',
      model: 'custom-model',
      baseUrl: 'https://unused.invalid/v1',
      runtimeUrl: '',
      voiceName: 'marin',
      slackUsers: [],
    },
    dot.id,
  );
  const input: RunAgentInput = {
    threadId: 'thread',
    runId: 'run',
    state: {},
    context: [],
    messages: [{ id: 'user', role: 'user', content: 'Hi' }],
    tools: [],
    forwardedProps: {},
  };
  return { store, workspace, dot, agent, input };
}

describe('monitors: event-based site watching', () => {
  it('contentHash is deterministic and length-capped', () => {
    expect(contentHash('hello')).toBe(contentHash('hello'));
    expect(contentHash('hello')).not.toBe(contentHash('world'));
    expect(contentHash('a'.repeat(600_000))).toBe(
      contentHash('a'.repeat(700_000)),
    );
  });

  it('first check establishes a baseline and never fires', async () => {
    const f = fixture();
    const fetchImpl = vi.fn(async () =>
      new Response('<html>first</html>', { status: 200 }),
    ) as unknown as typeof fetch;
    const service = new MonitorService(f.store, f.workspace, fetchImpl);
    const monitor = f.store.createMonitor(
      'https://example.com',
      'thread',
      'Tell me what changed.',
      60,
    );
    f.store.monitorAction(monitor.id, 'start');
    await service.checkNow();

    const after = f.store.monitor(monitor.id)!;
    expect(after.lastHash).toBe(contentHash('<html>first</html>'));
    expect(f.store.tasks()).toHaveLength(0); // no task fired on the baseline
    expect(after.lastError ?? null).toBeNull();
  });

  it('a change fires one task bound to the monitor conversation', async () => {
    const f = fixture();
    let body = '<html>v1</html>';
    const fetchImpl = vi.fn(async () =>
      new Response(body, { status: 200 }),
    ) as unknown as typeof fetch;
    let clock = Date.now();
    const service = new MonitorService(
      f.store,
      f.workspace,
      fetchImpl,
      () => clock,
    );
    const monitor = f.store.createMonitor(
      'https://example.com',
      'thread',
      'Summarize the change.',
      60,
    );
    f.store.monitorAction(monitor.id, 'start');
    await service.checkNow(); // baseline
    expect(f.store.tasks()).toHaveLength(0);

    clock += 61_000; // interval elapses
    body = '<html>v2 — updated</html>';
    await service.checkNow(); // change fires
    const tasks = f.store.tasks();
    expect(tasks).toHaveLength(1);
    expect(tasks[0]!.prompt).toContain('Site monitor');
    expect(tasks[0]!.prompt).toContain('https://example.com');
    expect(f.workspace.taskThread(tasks[0]!.id)).toBe('thread');

    clock += 61_000; // unchanged now — no second task
    await service.checkNow();
    expect(f.store.tasks()).toHaveLength(1);
  });

  it('paused monitors never check, and errors are recorded, not thrown', async () => {
    const f = fixture();
    const fetchImpl = vi
      .fn(async () => new Response('nope', { status: 503 }))
      .mockRejectedValueOnce(new Error('network down')) as unknown as typeof fetch;
    const service = new MonitorService(f.store, f.workspace, fetchImpl);
    const monitor = f.store.createMonitor(
      'https://example.com',
      'thread',
      'Watch.',
      60,
    );
    await service.checkNow(); // still paused: nothing happens
    expect(fetchImpl).not.toHaveBeenCalled();

    f.store.monitorAction(monitor.id, 'start');
    await service.checkNow(); // fetch rejects
    const after = f.store.monitor(monitor.id)!;
    expect(after.lastError ?? '').not.toBe('');
    expect(f.store.tasks()).toHaveLength(0);

    expect(f.store.deleteMonitor(monitor.id)).toBe(true);
    expect(f.store.deleteMonitor(monitor.id)).toBe(false);
  });
});

describe('artifacts: generative UI docs and code', () => {
  it('saves, lists by thread, and deletes artifacts', () => {
    const f = fixture();
    const doc = f.store.saveArtifact(
      'Deployment plan',
      'markdown',
      '# Plan\n1. Ship it.',
      null,
      'thread',
    );
    const code = f.store.saveArtifact(
      'analyze.py',
      'code',
      'print("hi")',
      'python',
      'thread',
    );
    f.store.saveArtifact('other chat doc', 'text', 'x', null, 'other-thread');

    const threadArtifacts = f.store.artifacts('thread');
    expect(threadArtifacts).toHaveLength(2);
    expect(threadArtifacts.map((a) => a.id)).toEqual(
      expect.arrayContaining([doc.id, code.id]),
    );
    expect(f.store.artifacts()).toHaveLength(3);
    expect(f.store.artifact(code.id)!.language).toBe('python');

    expect(f.store.deleteArtifact(code.id)).toBe(true);
    expect(f.store.artifacts('thread')).toHaveLength(1);
    expect(f.store.deleteArtifact(code.id)).toBe(false);
  });

  it('agent exposes manage_monitor and create_artifact with prompt guidance', async () => {
    const f = fixture();
    const network = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(completion({ role: 'assistant', content: 'ok' }));
    await lastValueFrom(f.agent.run(f.input).pipe(toArray()));
    const request = JSON.parse(String(network.mock.calls[0][1]?.body));
    const names = (request.tools ?? []).map(
      (t: { function?: { name?: string } }) => t.function?.name,
    );
    expect(names).toContain('manage_monitor');
    expect(names).toContain('create_artifact');

    const system = JSON.stringify(request.messages ?? []);
    expect(system).toContain('EVENT MONITORS');
    expect(system).toContain('ARTIFACTS (GENERATIVE UI)');
  });
});
