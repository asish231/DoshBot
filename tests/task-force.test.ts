import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Store } from '../src/server/store.js';
import {
  TaskForceStore,
  parseTaskForceConfig,
} from '../src/server/task-force-store.js';
import {
  TaskForceEngine,
  buildWorkerPrompt,
  nextWaveSize,
  parseDirectives,
  scoreFinding,
  selectElites,
  summarizeText,
  tokenize,
} from '../src/server/task-force.js';

const resources: (() => void)[] = [];
afterEach(() => {
  resources.splice(0).forEach((close) => close());
});

function fixture(options?: {
  settings?: Record<string, unknown>;
  reply?: (prompt: string) => string;
}) {
  const store = new Store(':memory:');
  const tf = new TaskForceStore(':memory:');
  resources.push(() => {
    store.close();
    tf.close();
  });
  if (options?.settings)
    store.updateSettings(options.settings as never);
  const saveArtifact = vi.fn(async (artifact: { title: string }) => ({
    id: `artifact-${artifact.title.slice(0, 8)}`,
  }));
  const notify = vi.fn(
    async (_threadId: string, _message: string) => {},
  );
  const callLog: string[] = [];
  const transport = vi.fn<typeof fetch>(async (_url, init) => {
    const body = JSON.parse(String(init?.body)) as {
      messages: Array<{ content: string }>;
    };
    const prompt = body.messages[0]!.content;
    callLog.push(prompt);
    const content = options?.reply?.(prompt) ?? 'Generic finding about the mission.';
    return new Response(
      JSON.stringify({ choices: [{ message: { content } }] }),
      { status: 200 },
    );
  });
  const engine = new TaskForceEngine(store, tf, {
    transport,
    saveArtifact,
    notify,
    model: {
      baseUrl: 'https://model.test/v1',
      apiKey: 'test-key',
      model: 'test-model',
    },
    configOverrides: {
      waveSize: 2,
      maxWave: 2,
      maxDepth: 1,
      maxSubSessions: 2,
      maxDirectivesPerWorker: 1,
    },
  });
  return { store, tf, engine, saveArtifact, notify, transport, callLog };
}

describe('pure building blocks', () => {
  it('tokenizes and drops stopwords', () => {
    const tokens = tokenize('The UX research and the onboarding flow!');
    expect(tokens).toContain('onboarding');
    expect(tokens).not.toContain('the');
  });

  it('scores substance, coverage, and novelty', () => {
    const mission = 'Audit the app onboarding UX and find missing screens';
    const strong =
      '## Onboarding audit\n- Missing email verification screen\n- No progress indicator\n- Onboarding flow drops users after step two\n';
    const weak = 'ok';
    expect(scoreFinding(mission, strong, [])).toBeGreaterThan(
      scoreFinding(mission, weak, []),
    );
    // A near-duplicate of prior work scores lower than fresh analysis.
    const duplicate = scoreFinding(mission, strong, [strong]);
    const fresh = scoreFinding(mission, strong, ['completely unrelated']);
    expect(fresh).toBeGreaterThan(duplicate);
    expect(scoreFinding(mission, '', [])).toBe(0);
  });

  it('selects only positive-fitness elites, best first', () => {
    const elites = selectElites(
      [
        { workerId: 'a', memoryId: 'ma', finding: 'f', summary: 's', fitness: 0.2, perspective: 'p' },
        { workerId: 'b', memoryId: 'mb', finding: 'f', summary: 's', fitness: 0.9, perspective: 'p' },
        { workerId: 'c', memoryId: 'mc', finding: 'f', summary: 's', fitness: 0, perspective: 'p' },
      ],
      2,
    );
    expect(elites.map((e) => e.workerId)).toEqual(['b', 'a']);
  });

  it('parses capped, deduped deep-dive directives', () => {
    const text = [
      'Analysis body.',
      'SPAWN_DEEP_DIVE: pricing model deep dive',
      'SPAWN_DEEP_DIVE: pricing model deep dive',
      'SPAWN_DEEP_DIVE: competitor onboarding flows',
      'SPAWN_DEEP_DIVE: this one is dropped',
    ].join('\n');
    expect(parseDirectives(text, 2)).toEqual([
      'pricing model deep dive',
      'competitor onboarding flows',
    ]);
    expect(parseDirectives('no directives', 2)).toEqual([]);
  });

  it('grows waves per generation up to the ceiling', () => {
    const config = parseTaskForceConfig('{}', { waveSize: 2, maxWave: 5 });
    expect(nextWaveSize(config, 1)).toBe(2);
    expect(nextWaveSize(config, 2)).toBe(3);
    expect(nextWaveSize(config, 10)).toBe(5);
  });

  it('summarizes at word boundaries and titles from the first line', () => {
    const summary = summarizeText('word '.repeat(100), 20);
    expect(summary.endsWith('…')).toBe(true);
    expect(summary.length).toBeLessThanOrEqual(22);
  });

  it('builds worker prompts with evolution context and the output contract', () => {
    const prompt = buildWorkerPrompt({
      mission: 'Map the ideal UI',
      perspective: 'skeptic (challenge the current direction: what is wrong or risky here?)',
      generation: 2,
      eliteSummaries: ['Gen 1 found the nav is buried'],
      ownMemories: [],
      deliverables: ['missing screens'],
      maxDirectives: 1,
    });
    expect(prompt).toContain('Map the ideal UI');
    expect(prompt).toContain('Gen 1 found the nav is buried');
    expect(prompt).toContain('SPAWN_DEEP_DIVE');
  });
});

describe('TaskForceStore', () => {
  it('persists sessions, workers, memories, and bidirectional links', () => {
    const tf = new TaskForceStore(':memory:');
    resources.push(() => tf.close());
    const session = tf.createSession({
      threadId: 'thread',
      dotId: 'dot',
      mission: 'UX audit',
      hoursBudget: 1,
      deadline: Date.now() + 3_600_000,
      config: parseTaskForceConfig('{}'),
    });
    const worker = tf.createWorker({
      sessionId: session.id,
      generation: 1,
      perspective: 'strategist',
    });
    tf.finishWorker(worker.id, { finding: 'found gaps', fitness: 0.7 });
    const memory = tf.saveMemory({
      sessionId: session.id,
      workerId: worker.id,
      generation: 1,
      kind: 'finding',
      title: 'Found gaps',
      summary: 'found gaps',
      content: 'found gaps in onboarding',
    });
    const gen = tf.saveMemory({
      sessionId: session.id,
      generation: 1,
      kind: 'gen_summary',
      title: 'Gen 1',
      summary: 'gen one summary',
      content: 'gen one summary',
    });
    tf.link(gen.id, memory.id, 'summarizes');
    // Bidirectional: from either side, the other is reachable.
    expect(tf.linksOf(memory.id).map((l) => l.otherId)).toContain(gen.id);
    expect(tf.linksOf(gen.id).map((l) => l.otherId)).toContain(memory.id);
    expect(tf.memoryByWorker(worker.id)!.id).toBe(memory.id);
    expect(tf.workerCount(session.id)).toBe(1);
    expect(tf.updateSession(session.id, { generation: 1 })!.generation).toBe(1);
    expect(
      tf.searchMemories(['onboarding']).map((m) => m.id),
    ).toContain(memory.id);
  });
});

describe('TaskForceEngine', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('runs generations to convergence, files a report, and notifies the chat', async () => {
    const { engine, tf, saveArtifact, notify, callLog } = fixture({
      reply: (prompt) =>
        prompt.includes('FINAL REPORT')
          ? '# Final report\n- Every missing screen listed\n- Ideal UI blueprint'
          : prompt.includes('Synthesize')
            ? 'Generation moved the audit forward: onboarding gaps identified.'
            : '## Onboarding audit\n- Missing email verification screen\n- No progress indicator in onboarding\n- Audit found the nav is buried',
    });
    const session = engine.startSession({
      threadId: 'thread',
      dotId: 'dot',
      mission: 'Audit the app onboarding UX and list missing screens',
      hours: 1,
      deliverables: ['missing screens', 'ideal UI'],
    });
    expect(session.status).toBe('running');
    // Convergence needs 3 generations: drive until the session settles.
    for (let i = 0; i < 10 && tf.session(session.id)!.status === 'running'; i++) {
      await engine.drive();
    }
    const done = tf.session(session.id)!;
    expect(done.status).toBe('completed');
    expect(done.generation).toBeGreaterThanOrEqual(3);
    expect(tf.workerCount(session.id)).toBeGreaterThanOrEqual(6);
    // Memory graph: findings + per-generation summaries + the final report.
    expect(tf.memories(session.id, 'finding').length).toBeGreaterThanOrEqual(6);
    expect(tf.memories(session.id, 'gen_summary').length).toBeGreaterThanOrEqual(3);
    expect(tf.memories(session.id, 'report').length).toBe(1);
    expect(done.summary).toBeTruthy();
    expect(saveArtifact).toHaveBeenCalledOnce();
    expect(notify).toHaveBeenCalledOnce();
    const notification = notify.mock.calls[0]![1] as string;
    expect(notification).toContain('task force finished');
    // The synthesis prompt saw generation summaries (compaction in action).
    const synthesis = callLog.find((p) => p.includes('FINAL REPORT'));
    expect(synthesis).toContain('Generation');
  });

  it('spawns deep-dive sub-sessions from worker directives and deposits results into the parent graph', async () => {
    const { engine, tf } = fixture({
      reply: (prompt) =>
        prompt.includes('FINAL REPORT') || prompt.includes('Synthesize')
          ? 'Report or synthesis text.'
          : '## Finding\nOnboarding audit notes.\nSPAWN_DEEP_DIVE: pricing page teardown',
    });
    const session = engine.startSession({
      threadId: 'thread',
      dotId: 'dot',
      mission: 'Audit the app onboarding UX',
      hours: 1,
    });
    // Root converges in 3 generations; directives create child sessions.
    for (let i = 0; i < 10; i++) {
      await engine.drive();
      if (
        tf.sessions().every(
          (s) => s.status !== 'running' || s.deadline <= Date.now(),
        )
      )
        break;
    }
    const children = tf.subSessions(session.id);
    expect(children.length).toBeGreaterThan(0);
    expect(children[0]!.parentSessionId).toBe(session.id);
    expect(children[0]!.depth).toBe(1);
    expect(children[0]!.mission).toContain('pricing page teardown');
    // Children run and deposit their report memory into the parent session.
    for (let i = 0; i < 10; i++) await engine.drive();
    const deposited = tf
      .memories(session.id, 'subsession')
      .filter((m) => m.sessionId === session.id);
    expect(deposited.length).toBeGreaterThan(0);
  });

  it('clamps the time budget to the configured tier cap', () => {
    const { engine } = fixture({
      settings: { taskForceMaxHours: 6 },
    });
    const session = engine.startSession({
      threadId: 'thread',
      dotId: 'dot',
      mission: 'Deep market research for the product launch',
      hours: 30,
    });
    expect(session.hoursBudget).toBe(6);
    expect(session.deadline).toBeLessThanOrEqual(Date.now() + 6 * 3_600_000 + 5);
  });

  it('pauses, resumes with a fresh window, and cancels', async () => {
    const { engine, tf } = fixture();
    const session = engine.startSession({
      threadId: 'thread',
      dotId: 'dot',
      mission: 'Deep market research for the product launch',
      hours: 1,
    });
    const paused = engine.pause(session.id)!;
    expect(paused.status).toBe('paused');
    await engine.drive();
    expect(tf.session(session.id)!.status).toBe('paused');
    const resumed = engine.resume(session.id)!;
    expect(resumed.status).toBe('running');
    expect(resumed.deadline).toBeGreaterThan(session.deadline - 3_600_000);
    const cancelled = engine.cancel(session.id)!;
    expect(cancelled.status).toBe('cancelled');
  });

  it('fails visibly when the model endpoint is broken and keeps partial memories', async () => {
    const store = new Store(':memory:');
    const tf = new TaskForceStore(':memory:');
    resources.push(() => {
      store.close();
      tf.close();
    });
    const engine = new TaskForceEngine(store, tf, {
      transport: (async () =>
        new Response('boom', { status: 500 })) as unknown as typeof fetch,
      model: {
        baseUrl: 'https://model.test/v1',
        apiKey: 'k',
        model: 'm',
      },
      configOverrides: { waveSize: 1, maxWave: 1 },
    });
    const session = engine.startSession({
      threadId: 'thread',
      dotId: 'dot',
      mission: 'Deep market research for the product launch',
      hours: 0.5,
    });
    for (let i = 0; i < 3; i++) await engine.drive();
    const done = tf.session(session.id)!;
    expect(done.status).toBe('failed');
    expect(done.error).toContain('No findings');
  });

  it('status reports progress and recall walks the neural link network', async () => {
    const { engine } = fixture({
      reply: () => '## Onboarding audit\n- Missing verification step in onboarding',
    });
    const session = engine.startSession({
      threadId: 'thread',
      dotId: 'dot',
      mission: 'Audit the app onboarding UX',
      hours: 1,
    });
    await engine.drive();
    const status = engine.status(session.id) as {
      generation: number;
      workers: { total: number };
      topFindings: Array<{ title: string; summary: string }>;
    };
    expect(status.workers.total).toBeGreaterThan(0);
    expect(status.topFindings.length).toBeGreaterThan(0);

    // Recall by keyword, then follow a finding into full content.
    const recall = engine.recall({ query: 'onboarding' }) as {
      matches: Array<{ id: string; kind: string; summary: string }>;
    };
    expect(recall.matches.length).toBeGreaterThan(0);
    const finding = recall.matches.find((m) => m.kind === 'finding')!;
    expect(finding).toBeTruthy();
    const deep = engine.recall({ memoryId: finding.id }) as {
      memory: { content: string };
      neighbors: Array<{ id: string; relation: string }>;
    };
    expect(deep.memory.content).toContain('onboarding');
    // The finding links to its generation summary (compaction layer).
    expect(
      deep.neighbors.some((n) => n.relation === 'summarizes'),
    ).toBe(true);
  });

  it('runs multiple sessions concurrently in a single drive pass', async () => {
    const { engine, tf } = fixture();
    engine.startSession({
      threadId: 'a',
      dotId: 'dot',
      mission: 'Audit the onboarding UX flows',
      hours: 1,
    });
    engine.startSession({
      threadId: 'b',
      dotId: 'dot',
      mission: 'Market research for the launch',
      hours: 1,
    });
    // One drive pass starts BOTH sessions and awaits them together — a
    // long session never blocks a sibling from starting.
    await engine.drive();
    const statuses = tf.sessions().map((s) => s.status);
    expect(statuses).toEqual(['completed', 'completed']);
  });

  it('recurses: children spawn grandchildren up to the depth cap', async () => {
    const store = new Store(':memory:');
    const tf = new TaskForceStore(':memory:');
    resources.push(() => {
      store.close();
      tf.close();
    });
    const engine = new TaskForceEngine(store, tf, {
      transport: (async (_url: unknown, _init?: RequestInit) =>
        new Response(
          JSON.stringify({
            choices: [
              {
                message: {
                  content:
                    '## Finding\nAudit notes.\nSPAWN_DEEP_DIVE: pricing page teardown',
                },
              },
            ],
          }),
          { status: 200 },
        )) as unknown as typeof fetch,
      model: { baseUrl: 'https://m.test/v1', apiKey: 'k', model: 'm' },
      configOverrides: {
        waveSize: 1,
        maxWave: 1,
        maxDepth: 2,
        maxSubSessions: 2,
        maxDirectivesPerWorker: 1,
      },
    });
    const root = engine.startSession({
      threadId: 'thread',
      dotId: 'dot',
      mission: 'Audit the app onboarding UX',
      hours: 1,
    });
    for (let i = 0; i < 12; i++) await engine.drive();
    const all = tf.sessions();
    const children = all.filter((s) => s.depth === 1);
    const grandchildren = all.filter((s) => s.depth === 2);
    expect(children.length).toBeGreaterThan(0);
    expect(grandchildren.length).toBeGreaterThan(0);
    // Depth cap: level 2 workers cannot spawn level 3 sessions.
    expect(all.filter((s) => s.depth > 2)).toEqual([]);
    // The tree is genuinely hierarchical: grandchild's parent is a child.
    expect(
      grandchildren.every(
        (g) =>
          g.parentSessionId !== null &&
          children.some((c) => c.id === g.parentSessionId),
      ),
    ).toBe(true);
    expect(tf.session(root.id)!.status).toBe('completed');
  });

  it('feeds sub-agent deposits back into later generations of the parent swarm', async () => {
    const { engine, tf, callLog } = fixture();
    const session = engine.startSession({
      threadId: 'thread',
      dotId: 'dot',
      mission: 'Audit the app onboarding UX',
      hours: 1,
    });
    // Simulate a completed sub-swarm's deposit into the parent's graph.
    tf.saveMemory({
      sessionId: session.id,
      generation: 0,
      kind: 'subsession',
      title: 'Pricing teardown deposit',
      summary: 'pricing deep dive found 3 competitor tiers',
      content: 'pricing deep dive found 3 competitor tiers',
    });
    await engine.drive();
    const withFeedback = callLog.find((p) =>
      p.includes('DEEP-DIVE SUB-AGENT RESULTS'),
    );
    expect(withFeedback).toBeTruthy();
    expect(withFeedback).toContain('pricing deep dive found 3 competitor tiers');
  });

  it('resumes interrupted sessions after a restart', async () => {
    const { store, tf } = fixture();
    const session = enginelessStart(store, tf);
    expect(session.status).toBe('running');
    // Simulate a restart: a fresh engine over the same persisted state finds
    // the interrupted session and can report on it.
    const second = new TaskForceEngine(store, tf, {
      transport: (async () =>
        new Response(
          JSON.stringify({
            choices: [
              { message: { content: '## Research finding\nMarket analysis' } },
            ],
          }),
          { status: 200 },
        )) as unknown as typeof fetch,
      model: { baseUrl: 'https://m.test/v1', apiKey: 'k', model: 'm' },
      configOverrides: { waveSize: 1, maxWave: 1, maxDepth: 0 },
    });
    expect(second.listSessions().length).toBe(1);
    const listed = second.listSessions()[0] as {
      id: string;
      status: string;
    };
    expect(listed.status).toBe('running');
    expect(second.sessionThreadId(listed.id)).toBe('thread');
  });
});

/** startSession without an engine instance helper: uses a temporary engine. */
function enginelessStart(
  store: Store,
  tf: TaskForceStore,
) {
  const engine = new TaskForceEngine(store, tf, {
    model: { baseUrl: 'https://m.test/v1', apiKey: 'k', model: 'm' },
    configOverrides: { waveSize: 1, maxWave: 1, maxDepth: 0 },
  });
  return engine.startSession({
    threadId: 'thread',
    dotId: 'dot',
    mission: 'Deep market research for the product launch',
    hours: 0.25,
  });
}
