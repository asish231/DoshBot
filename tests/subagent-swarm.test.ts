import { afterEach, expect, it, vi } from 'vitest';
import { type RunAgentInput } from '@ag-ui/core';
import { lastValueFrom, toArray } from 'rxjs';
import { DotAgent } from '../src/server/dot-agent.js';
import { completion } from './fixtures/model-stream.js';
import { Store } from '../src/server/store.js';
import { WorkspaceStore } from '../src/server/workspace.js';

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

it('run_subagents is uncapped in practice and the prompt teaches auto-escalation', async () => {
  const f = fixture();
  const network = vi
    .spyOn(globalThis, 'fetch')
    .mockResolvedValueOnce(completion({ role: 'assistant', content: 'ok' }));
  await lastValueFrom(f.agent.run(f.input).pipe(toArray()));
  const request = JSON.parse(String(network.mock.calls[0][1]?.body));
  const swarm = (request.tools ?? []).find(
    (t: { function?: { name?: string } }) =>
      t.function?.name === 'run_subagents',
  );
  expect(swarm).toBeDefined();
  const schema = swarm.function.parameters as {
    properties: { agents: { maxItems?: number; minItems?: number } };
  };
  // 200 is only a runaway-argument guard, not a practical limit.
  expect(schema.properties.agents.maxItems).toBe(200);
  expect(schema.properties.agents.minItems).toBe(1);

  const system = JSON.stringify(request.messages ?? []);
  for (const command of [
    '/goal',
    '/code',
    '/plan',
    '/init',
    '/review',
    '/undo',
    '/subagents',
    '/memory',
    '/model',
    '/tasks',
    '/new',
    '/schedule',
    '/search',
    '/browse',
  ]) {
    expect(system).toContain(command);
  }
  // Anti-refusal discipline: the Dot must check tools before claiming absence.
  expect(system).toContain('Never say tools are unavailable');
  // Autonomous scaling: big tasks trigger the swarm without being asked.
  expect(system).toContain('AUTONOMOUS SCALING');
  expect(system).toContain('automatically fan out a run_subagents swarm');
  // Swarm size is the agent's decision.
  expect(system).toContain('swarm size is your decision');
});
