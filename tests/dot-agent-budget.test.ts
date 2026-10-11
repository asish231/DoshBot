import { afterEach, expect, it, vi } from 'vitest';
import { EventType, type RunAgentInput } from '@ag-ui/core';
import { lastValueFrom, toArray } from 'rxjs';
import { DotAgent } from '../src/server/dot-agent.js';
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
  workspace.bindThread('thread', dot.id, 'Budgeted');
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
    messages: [{ id: 'user', role: 'user', content: 'Hello' }],
    tools: [],
    forwardedProps: {},
  };
  return { store, workspace, dot, agent, input };
}

it('hard-stops a Dot that has exhausted its monthly budget', async () => {
  const f = fixture();
  f.workspace.updateDot(f.dot.id, {
    name: f.dot.name,
    instructions: f.dot.instructions,
    researchAllowed: f.dot.researchAllowed,
    memoryAllowed: f.dot.memoryAllowed,
    budgetTokens: 1000,
  });
  f.workspace.recordUsage(f.dot.id, 1500);
  const events = await lastValueFrom(f.agent.run(f.input).pipe(toArray()));
  const failure = events.find((event) => event.type === EventType.RUN_ERROR);
  expect(failure).toBeDefined();
  expect((failure as { message?: string }).message).toContain(
    'reached its monthly budget',
  );
});

it('runs when the budget has room left', async () => {
  const f = fixture();
  f.workspace.updateDot(f.dot.id, {
    name: f.dot.name,
    instructions: f.dot.instructions,
    researchAllowed: f.dot.researchAllowed,
    memoryAllowed: f.dot.memoryAllowed,
    budgetTokens: 1_000_000,
  });
  f.workspace.recordUsage(f.dot.id, 500);
  // The fixture provider is unreachable, so the run ends in a connection
  // error — proof it got past the budget gate, which would have produced a
  // RUN_ERROR "reached its monthly budget" event instead.
  const events = await lastValueFrom(
    f.agent.run(f.input).pipe(toArray()),
  ).catch((error) => {
    expect(String(error?.message ?? error)).not.toContain(
      'reached its monthly budget',
    );
    return [] as { type: string }[];
  });
  const failure = events.find((event) => event.type === EventType.RUN_ERROR);
  expect((failure as { message?: string })?.message ?? '').not.toContain(
    'reached its monthly budget',
  );
});
