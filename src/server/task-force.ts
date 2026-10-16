import type { Store } from './store.js';
import {
  TaskForceStore,
  parseTaskForceConfig,
} from './task-force-store.js';
import type {
  TaskForceConfig,
  TaskForceMemory,
  TaskForceSession,
} from '../shared/task-force.js';

/* ────────────────────────────────────────────────────────────────────────
 * Pure building blocks — deterministic, so evolution is testable.
 * ──────────────────────────────────────────────────────────────────────── */

const STOPWORDS = new Set(
  'the and for are but not you all can her was one our out day get has him his how man new now old see two way who its did that this with they from have what when where which will your about into than then them there these those been because want should could would their more very much some such only also just over under again each other most make made need needs must may might shall does doing done being between both down during before after above below off further once here why'.split(
    ' ',
  ),
);

export function tokenize(text: string): string[] {
  const matches = text.toLowerCase().match(/[a-z0-9][a-z0-9'-]*/g) ?? [];
  return matches.filter((t) => t.length > 2 && !STOPWORDS.has(t));
}

function tokenSet(text: string): Set<string> {
  return new Set(tokenize(text));
}

function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let shared = 0;
  for (const t of a) if (b.has(t)) shared++;
  return shared / (a.size + b.size - shared);
}

/**
 * Fitness for genetic selection: mission coverage, substance, structure,
 * and novelty against what the population already found.
 */
export function scoreFinding(
  mission: string,
  finding: string,
  priorFindings: string[],
): number {
  const findingTokens = tokenize(finding);
  if (findingTokens.length === 0) return 0;
  const findingSet = new Set(findingTokens);
  const missionSet = tokenSet(mission);
  let covered = 0;
  for (const t of missionSet) if (findingSet.has(t)) covered++;
  const coverage = missionSet.size ? covered / missionSet.size : 0;
  const lengthScore = Math.min(1, findingTokens.length / 600);
  const structure = Math.min(
    1,
    ((finding.match(/\n[-*•]|\n#{1,3} |\n\d+[.)]/g) ?? []).length +
      (finding.match(/^#{1,3} /gm) ?? []).length) /
      10,
  );
  let overlap = 0;
  for (const prior of priorFindings)
    overlap = Math.max(overlap, jaccard(findingSet, tokenSet(prior)));
  const novelty = 1 - overlap;
  return (
    Math.round(
      (0.35 * coverage + 0.2 * lengthScore + 0.15 * structure + 0.3 * novelty) *
        1000,
    ) / 1000
  );
}

export interface Elite {
  workerId: string;
  memoryId: string;
  finding: string;
  summary: string;
  fitness: number;
  perspective: string;
}

export function selectElites(
  candidates: Elite[],
  count = 3,
): Elite[] {
  return [...candidates]
    .sort((a, b) => b.fitness - a.fitness)
    .filter((c) => c.fitness > 0)
    .slice(0, count);
}

/** Workers may nominate dedicated deep dives; capped per worker. */
export function parseDirectives(text: string, max: number): string[] {
  const found: string[] = [];
  const seen = new Set<string>();
  const pattern = /^ *SPAWN_DEEP_DIVE: *(.+)$/gim;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(text)) !== null) {
    const topic = match[1]!.trim().slice(0, 300);
    const key = topic.toLowerCase();
    if (topic.length > 4 && !seen.has(key)) {
      seen.add(key);
      found.push(topic);
    }
    if (found.length >= max) break;
  }
  return found;
}

/** Population growth per generation, capped by the wave ceiling. */
export function nextWaveSize(config: TaskForceConfig, generation: number): number {
  const grown = Math.round(config.waveSize * Math.pow(1.5, Math.max(0, generation - 1)));
  return Math.max(1, Math.min(config.maxWave, grown));
}

export function summarizeText(text: string, max = 240): string {
  const clean = text.replace(/\s+/g, ' ').trim();
  if (clean.length <= max) return clean;
  const cut = clean.slice(0, max);
  const boundary = cut.lastIndexOf(' ');
  return `${(boundary > max * 0.6 ? cut.slice(0, boundary) : cut).trim()}…`;
}

export function titleFrom(text: string): string {
  const firstLine =
    text
      .split('\n')
      .map((l) => l.replace(/^#{1,6}\s*[-*•]?\s*/, '').replace(/^[-*•]\s*/, '').trim())
      .find((l) => l.length > 0) ?? 'Finding';
  return firstLine.slice(0, 80);
}

const PERSPECTIVES = [
  'strategist',
  'skeptic',
  'pragmatist',
  'researcher',
  'designer',
  'analyst',
  'synthesizer',
  'critic',
  'scout',
  'architect',
];

const MUTATIONS = [
  '',
  ' (go broader: cover adjacent areas the others miss)',
  ' (go deeper: pick the highest-stakes sub-topic and dissect it)',
  ' (challenge the current direction: what is wrong or risky here?)',
  ' (ground it: concrete examples, numbers, and references)',
  ' (future-proof: where is this heading in 2-3 years?)',
];

export function buildWorkerPrompt(input: {
  mission: string;
  perspective: string;
  generation: number;
  eliteSummaries: string[];
  ownMemories: string[];
  /** Summaries deposited by sub-swarms this session's workers spawned. */
  subResults?: string[];
  deliverables: string[];
  maxDirectives: number;
}): string {
  return [
    `You are an autonomous specialist worker in a long-horizon research task force. Your role: ${input.perspective}. Generation ${input.generation}.`,
    `MISSION (from the owner, via the coordinating Dot): ${input.mission}`,
    input.deliverables.length
      ? `The final report must answer: ${input.deliverables.join('; ')}`
      : '',
    input.eliteSummaries.length
      ? `EVOLUTION CONTEXT — best findings from earlier generations (summaries):\n- ${input.eliteSummaries.join('\n- ')}`
      : 'No prior generations: you are the founding population. Set the direction.',
    input.ownMemories.length
      ? `YOUR INHERITED MEMORY (from your parent worker):\n- ${input.ownMemories.join('\n- ')}`
      : '',
    input.subResults?.length
      ? `DEEP-DIVE SUB-AGENT RESULTS (from sub-swarms spawned by this mission's earlier workers — build on them, do not repeat them):\n- ${input.subResults.join('\n- ')}`
      : '',
    'Produce your single best contribution to the mission: dense, self-contained analysis or research notes (roughly 300-1200 words), with short markdown headings and bullets.',
    'Stay inside the mission\'s scope. State assumptions in one line. Do not ask questions and do not refuse — reason from the mission context and your expertise.',
    `You may spawn your own sub-agents: end with up to ${input.maxDirectives} lines of "SPAWN_DEEP_DIVE: <precise sub-topic>" for sub-topics that deserve a dedicated recursive swarm of their own. Those sub-agents can in turn spawn their own. Use this power for genuine depth, not for routine work.`,
  ]
    .filter(Boolean)
    .join('\n\n');
}

/** Global worker throttle shared by every session; the limit is read live
 *  from settings so the owner can retune a running swarm. */
class Semaphore {
  private active = 0;
  private waiters: Array<() => void> = [];
  constructor(private limit: () => number) {}
  async acquire(): Promise<void> {
    if (this.active >= this.limit()) {
      await new Promise<void>((resolve) => this.waiters.push(resolve));
    }
    this.active++;
  }
  release() {
    this.active = Math.max(0, this.active - 1);
    this.waiters.shift()?.();
  }
}

/* ────────────────────────────────────────────────────────────────────────
 * Engine
 * ──────────────────────────────────────────────────────────────────────── */

export interface TaskForceModelConfig {
  baseUrl: string;
  apiKey: string;
  model: string;
}

export interface TaskForceEngineOptions {
  transport?: typeof fetch;
  now?: () => number;
  /** Artifact sandbox: where generated reports are persisted. */
  saveArtifact?: (artifact: {
    title: string;
    kind: 'markdown' | 'code' | 'text';
    content: string;
    language?: string | null;
    threadId?: string | null;
  }) => Promise<{ id: string }>;
  /** Completion notification into the owning conversation. */
  notify?: (threadId: string, message: string) => Promise<void>;
  /** .env-level model fallback; Settings overrides win. */
  model?: TaskForceModelConfig;
  /** Per-session config overrides (tests use tiny waves). */
  configOverrides?: Partial<TaskForceConfig>;
  pollMs?: number;
}

interface StartSessionInput {
  threadId: string;
  dotId: string;
  mission: string;
  hours?: number;
  deliverables?: string[];
  parentSessionId?: string | null;
  parentWorkerId?: string | null;
  depth?: number;
  deadlineOverride?: number;
}

export class TaskForceEngine {
  private active = new Set<string>();
  private controllers = new Map<string, AbortController>();
  private semaphore: Semaphore;
  private timer?: ReturnType<typeof setInterval>;
  private lastTopFitness = new Map<string, number>();

  constructor(
    private store: Pick<Store, 'settings'>,
    private tf: TaskForceStore,
    private options: TaskForceEngineOptions = {},
  ) {
    this.semaphore = new Semaphore(
      () =>
        Math.min(
          64,
          Math.max(1, this.store.settings().taskForceConcurrency ?? 12),
        ),
    );
  }

  private now(): number {
    return this.options.now?.() ?? Date.now();
  }

  start() {
    if (!this.timer) {
      this.timer = setInterval(
        () => void this.drive().catch(() => {}),
        this.options.pollMs ?? 2000,
      );
    }
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
    for (const controller of this.controllers.values())
      controller.abort(new Error('Task force stopped.'));
  }

  /** One pass over due sessions — the poll body, and the test lever.
   *  Every waiting session starts CONCURRENTLY (a parent's children run
   *  alongside it); this call awaits only the sessions it started, so a
   *  long-running session never blocks later passes from starting peers. */
  async drive(): Promise<void> {
    if (this.store.settings().paused) return;
    const started: Array<Promise<void>> = [];
    for (const session of this.tf.sessions('running')) {
      if (this.active.has(session.id)) continue;
      if (this.store.settings().paused) break;
      this.active.add(session.id);
      started.push(
        this.runSession(session.id).finally(() =>
          this.active.delete(session.id),
        ),
      );
    }
    await Promise.all(started);
  }

  private maxHours(): number {
    const settings = this.store.settings();
    return Math.min(24, Math.max(1, settings.taskForceMaxHours ?? 24));
  }

  private maxWorkers(): number {
    const settings = this.store.settings();
    return Math.max(
      16,
      Math.min(100_000, settings.taskForceMaxWorkers ?? 2000),
    );
  }

  startSession(input: StartSessionInput): TaskForceSession {
    const cap = this.maxHours();
    const requested = input.hours ?? 6;
    const hours = Math.min(cap, Math.max(0.25, requested));
    const deadline =
      input.deadlineOverride ?? this.now() + hours * 3_600_000;
    const base = parseTaskForceConfig(
      JSON.stringify({
        ...this.sessionConfigDefaults(),
        ...(this.options.configOverrides ?? {}),
      }),
    );
    const config: TaskForceConfig = input.parentSessionId
      ? {
          ...base,
          waveSize: Math.max(4, Math.floor(base.waveSize / 2)),
          maxWave: Math.max(4, Math.floor(base.maxWave / 2)),
          deliverables: input.deliverables ?? [],
        }
      : { ...base, deliverables: input.deliverables ?? [] };
    const session = this.tf.createSession({
      threadId: input.threadId,
      dotId: input.dotId,
      mission: input.mission.trim(),
      hoursBudget: hours,
      deadline,
      config,
      parentSessionId: input.parentSessionId ?? null,
      parentWorkerId: input.parentWorkerId ?? null,
      depth: input.depth ?? 0,
    });
    return session;
  }

  private sessionConfigDefaults(): TaskForceConfig {
    return {
      waveSize: 16,
      maxWave: 64,
      maxWorkers: this.maxWorkers(),
      // Recursive sub-agent tree: root swarm → workers spawn deep-dive
      // sub-swarms → their workers spawn deeper ones, to this depth.
      maxDepth: 6,
      maxSubSessions: 16,
      maxDirectivesPerWorker: 2,
      deliverables: [],
    };
  }

  pause(id: string): TaskForceSession | undefined {
    return this.tf.updateSession(id, { status: 'paused' });
  }

  resume(id: string): TaskForceSession | undefined {
    const session = this.tf.session(id);
    if (!session) return undefined;
    if (session.status !== 'paused') return session;
    // A paused session keeps its budget: resume grants a fresh window of
    // the originally granted hours (or the remainder, whichever is longer).
    const remaining = session.deadline - this.now();
    const fresh = this.now() + session.hoursBudget * 3_600_000;
    const deadline = Math.max(remaining, fresh);
    return this.tf.updateSession(id, {
      status: 'running',
      error: null,
      deadline,
    });
  }

  cancel(id: string): TaskForceSession | undefined {
    const controller = this.controllers.get(id);
    controller?.abort(new Error('Task force session cancelled.'));
    return this.tf.updateSession(id, {
      status: 'cancelled',
      endedAt: this.now(),
    });
  }

  /* ── session lifecycle ─────────────────────────────────────────── */

  private async runSession(sessionId: string): Promise<void> {
    let session = this.tf.session(sessionId);
    if (!session || session.status !== 'running') return;
    const controller = new AbortController();
    // drive() pre-marks the session active; the set add here is idempotent.
    this.active.add(sessionId);
    this.controllers.set(sessionId, controller);
    try {
      for (;;) {
        session = this.tf.session(sessionId)!;
        if (session.status !== 'running') break;
        if (this.store.settings().paused) break;
        if (this.now() >= session.deadline) {
          await this.finalize(sessionId, 'time budget reached');
          break;
        }
        const config = parseTaskForceConfig(session.config, {
          maxWorkers: Math.min(
            parseTaskForceConfig(session.config).maxWorkers,
            this.maxWorkers(),
          ),
          ...(this.options.configOverrides ?? {}),
        });
        if (this.tf.workerCount(sessionId) >= config.maxWorkers) {
          await this.finalize(sessionId, 'worker budget reached');
          break;
        }
        const converged = await this.runGeneration(session, config, controller.signal);
        if (converged) {
          await this.finalize(sessionId, 'converged');
          break;
        }
      }
    } catch (error) {
      const reason = error instanceof Error ? error.message : 'Engine failure.';
      this.tf.updateSession(sessionId, {
        status: 'failed',
        endedAt: this.now(),
        error: reason,
      });
    } finally {
      this.active.delete(sessionId);
      this.controllers.delete(sessionId);
      this.lastTopFitness.delete(sessionId);
    }
  }

  private async runGeneration(
    session: TaskForceSession,
    config: TaskForceConfig,
    signal: AbortSignal,
  ): Promise<boolean> {
    const generation = session.generation + 1;
    const waveSize = nextWaveSize(config, generation);
    const elites = this.elitesOf(session);
    // Feedback loop: deposits from this session's sub-swarms (its workers'
    // spawned sub-agents) ride into every prompt of the new generation, so
    // the parent evolves WITH its children's results, not beside them.
    const subDeposits = this.tf
      .memories(session.id, 'subsession')
      .slice(0, 3)
      .map((m) => m.summary);
    const wave = Array.from({ length: waveSize }, (_, i) =>
      this.tf.createWorker({
        sessionId: session.id,
        generation,
        perspective:
          PERSPECTIVES[(generation + i) % PERSPECTIVES.length]! +
          MUTATIONS[i % MUTATIONS.length]!,
        parentWorkerId: elites[i % Math.max(1, elites.length)]?.workerId ?? null,
      }),
    );
    await Promise.all(
      wave.map((worker, i) =>
        (async () => {
          await this.semaphore.acquire();
          try {
            if (signal.aborted) throw new Error('Session stopped.');
            const parent = elites[i % Math.max(1, elites.length)];
            const prompt = buildWorkerPrompt({
              mission: session.mission,
              perspective: worker.perspective,
              generation,
              eliteSummaries: elites.map((e) => e.summary).slice(0, 5),
              ownMemories: parent ? [`${parent.perspective}: ${parent.summary}`] : [],
              subResults: subDeposits,
              deliverables: config.deliverables,
              maxDirectives: config.maxDirectivesPerWorker,
            });
            const finding = await this.callModel(prompt, signal, 6000);
            const fitness = scoreFinding(
              session.mission,
              finding,
              elites.map((e) => e.finding),
            );
            this.tf.finishWorker(worker.id, { finding, fitness });
            const memory = this.tf.saveMemory({
              sessionId: session.id,
              workerId: worker.id,
              generation,
              kind: 'finding',
              title: titleFrom(finding),
              summary: summarizeText(finding),
              content: finding,
            });
            if (parent) this.tf.link(memory.id, parent.memoryId, 'evolved_from');
          } catch (error) {
            this.tf.finishWorker(worker.id, {
              error:
                error instanceof Error ? error.message : 'Worker failed.',
            });
          } finally {
            this.semaphore.release();
          }
        })(),
      ),
    );
    if (signal.aborted) return false;

    // Neural linking: connect this wave's memories that overlap in substance.
    const waveMemories = wave
      .map((w) => this.tf.memoryByWorker(w.id))
      .filter((m): m is TaskForceMemory => !!m);
    for (let i = 0; i < waveMemories.length; i++) {
      let linked = 0;
      for (let j = 0; j < waveMemories.length && linked < 3; j++) {
        if (i === j) continue;
        if (
          jaccard(
            tokenSet(waveMemories[i]!.summary),
            tokenSet(waveMemories[j]!.summary),
          ) > 0.3
        ) {
          this.tf.link(waveMemories[i]!.id, waveMemories[j]!.id, 'related');
          linked++;
        }
      }
    }

    const newElites = this.elitesOf(session, generation);
    // Generation cluster summary: the compaction layer. Full findings stay
    // in the graph; only the summary rides into future prompts.
    if (newElites.length > 0) {
      try {
        const synthesis = await this.callModel(
          `Synthesize this generation's progress on the mission in at most 200 words. Mission: ${session.mission}\nTop findings (summaries):\n- ${newElites
            .map((e) => e.summary)
            .join('\n- ')}\nOutput only the synthesis paragraph.`,
          signal,
          1200,
        );
        const genMemory = this.tf.saveMemory({
          sessionId: session.id,
          generation,
          kind: 'gen_summary',
          title: `Generation ${generation} synthesis`,
          summary: summarizeText(synthesis, 400),
          content: synthesis,
        });
        for (const elite of newElites)
          this.tf.link(genMemory.id, elite.memoryId, 'summarizes');
      } catch {
        /* summary is best-effort; the wave itself already persisted */
      }
    }

    this.tf.updateSession(session.id, { generation });

    // Genetic evolution: spawn deep-dive sub-sessions from worker directives.
    if (session.depth < config.maxDepth) {
      const existing = this.tf.subSessions(session.id).length;
      let spawned = 0;
      outer: for (const worker of this.tf.workers(session.id, generation)) {
        if (worker.status !== 'completed') continue;
        const memory = this.tf.memoryByWorker(worker.id);
        if (!memory) continue;
        for (const topic of parseDirectives(
          memory.content,
          config.maxDirectivesPerWorker,
        )) {
          if (existing + spawned >= config.maxSubSessions) break outer;
          const remaining = session.deadline - this.now();
          if (remaining <= 5 * 60_000) break outer;
          const share = Math.max(
            15 * 60_000,
            Math.floor(remaining / 4),
          );
          const childDeadline = Math.min(
            session.deadline,
            this.now() + share,
          );
          this.startSession({
            threadId: session.threadId,
            dotId: session.dotId,
            mission: `Deep dive for a parent research mission: ${topic}`,
            hours: (childDeadline - this.now()) / 3_600_000,
            deliverables: [],
            parentSessionId: session.id,
            parentWorkerId: worker.id,
            depth: session.depth + 1,
            deadlineOverride: childDeadline,
          });
          spawned++;
        }
      }
    }

    // Convergence: plateau in top fitness across generations ends early.
    const top = newElites[0]?.fitness ?? 0;
    const previous = this.lastTopFitness.get(session.id) ?? top;
    this.lastTopFitness.set(session.id, top);
    const converged = generation >= 3 && Math.abs(top - previous) < 0.01;
    return converged;
  }

  /** Top performers of a generation, rebuilt from persistence so a swarm
   *  resumes with its evolution history intact after a restart. */
  private elitesOf(
    session: TaskForceSession,
    generation?: number,
  ): Elite[] {
    const gen =
      generation ??
      (session.generation > 0 ? session.generation : 0);
    if (gen === 0) return [];
    const workers = this.tf
      .workers(session.id, gen)
      .filter((w) => w.status === 'completed' && (w.fitness ?? 0) > 0)
      .sort((a, b) => (b.fitness ?? 0) - (a.fitness ?? 0));
    const elites: Elite[] = [];
    for (const worker of workers) {
      const memory = this.tf.memoryByWorker(worker.id);
      if (!memory) continue;
      elites.push({
        workerId: worker.id,
        memoryId: memory.id,
        finding: memory.content,
        summary: memory.summary,
        fitness: worker.fitness ?? 0,
        perspective: worker.perspective,
      });
      if (elites.length >= 3) break;
    }
    return elites;
  }

  /* ── model access ──────────────────────────────────────────────── */

  private modelConfig(): TaskForceModelConfig {
    const settings = this.store.settings();
    const base = (
      settings.customBaseUrl ||
      this.options.model?.baseUrl ||
      ''
    ).replace(/\/+$/, '');
    return {
      baseUrl: base,
      apiKey: settings.customApiKey || this.options.model?.apiKey || '',
      model: settings.model || this.options.model?.model || '',
    };
  }

  private async callModel(
    prompt: string,
    signal: AbortSignal,
    maxTokens: number,
  ): Promise<string> {
    const { baseUrl, apiKey, model } = this.modelConfig();
    if (!baseUrl || !apiKey || !model)
      throw new Error(
        'No model endpoint configured for the task force (set one in Settings or .env).',
      );
    const transport = this.options.transport ?? fetch;
    const response = await transport(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        messages: [{ role: 'user', content: prompt }],
        max_tokens: maxTokens,
        temperature: 0.7,
      }),
      signal: AbortSignal.any([signal, AbortSignal.timeout(120_000)]),
    });
    if (!response.ok)
      throw new Error(`Model endpoint returned HTTP ${response.status}.`);
    const body = (await response.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    const content = body.choices?.[0]?.message?.content?.trim() ?? '';
    if (!content) throw new Error('Model endpoint returned no content.');
    return content;
  }

  /* ── completion ────────────────────────────────────────────────── */

  private async finalize(sessionId: string, reason: string): Promise<void> {
    const session = this.tf.session(sessionId)!;
    const config = parseTaskForceConfig(session.config);
    const genSummaries = this.tf
      .memories(sessionId, 'gen_summary')
      .slice(0, 12)
      .map((m) => m.summary);
    const elites = this.elitesOf(session);
    if (genSummaries.length === 0 && elites.length === 0) {
      this.tf.updateSession(sessionId, {
        status: 'failed',
        endedAt: this.now(),
        error: 'No findings were produced — check the model endpoint.',
      });
      return;
    }
    const subs = this.tf.subSessions(sessionId);
    const subLines = subs
      .filter((s) => s.summary)
      .map((s) => `- ${s.mission.slice(0, 120)}: ${s.summary!.slice(0, 300)}`);
    // Recursive sessions run concurrently; some sub-agents may still be
    // working. Their deposits land in the memory graph for recall later.
    const pendingSubs = subs.filter(
      (s) => s.status === 'running' || s.status === 'paused',
    );
    let report: string;
    try {
      report = await this.callModel(
        [
          `You are the synthesis stage of a long-horizon research task force. Write the FINAL REPORT for the owner as markdown.`,
          `MISSION: ${session.mission}`,
          config.deliverables.length
            ? `REQUIRED ANSWERS: ${config.deliverables.join('; ')}`
            : '',
          genSummaries.length
            ? `GENERATION SYNTHESES:\n- ${genSummaries.join('\n- ')}`
            : '',
          elites.length
            ? `BEST RAW FINDINGS:\n${elites
                .map((e) => e.finding.slice(0, 4000))
                .join('\n\n---\n\n')}`
            : '',
          subLines.length
            ? `DEEP-DIVE SUB-AGENT RESULTS (recursive sub-swarms):\n${subLines.join('\n')}`
            : '',
          pendingSubs.length
            ? `SUB-AGENTS STILL WORKING (acknowledge as in-flight, do not fabricate their results): ${pendingSubs
                .map((s) => s.mission.slice(0, 120))
                .join('; ')}`
            : '',
          'Structure: executive summary, then findings by priority, then concrete recommendations (what to do, what to fix, what to add), then open questions. Be specific and cite the swarm\'s findings.',
        ]
          .filter(Boolean)
          .join('\n\n'),
        new AbortController().signal,
        8000,
      );
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Synthesis failed.';
      // The swarm's findings survive even if synthesis could not run.
      const fallback = [
        `# Task force report (raw) — ${session.mission.slice(0, 120)}`,
        ...genSummaries.map((s, i) => `## Generation ${i + 1}\n${s}`),
        ...elites.map((e) => `## ${e.perspective}\n${e.finding.slice(0, 4000)}`),
      ].join('\n\n');
      this.tf.updateSession(sessionId, {
        status: 'completed',
        endedAt: this.now(),
        summary: summarizeText(`Synthesis failed (${message}); raw findings delivered. ${fallback}`, 400),
        error: `Synthesis failed: ${message}`,
      });
      await this.persistReport(sessionId, session, fallback);
      return;
    }
    const reportMemory = this.tf.saveMemory({
      sessionId,
      generation: session.generation,
      kind: 'report',
      title: `Final report — ${session.mission.slice(0, 80)}`,
      summary: summarizeText(report, 400),
      content: report,
    });
    for (const summary of this.tf.memories(sessionId, 'gen_summary').slice(0, 12))
      this.tf.link(reportMemory.id, summary.id, 'synthesizes');
    for (const elite of this.elitesOf(session))
      this.tf.link(reportMemory.id, elite.memoryId, 'synthesizes');
    this.tf.updateSession(sessionId, {
      status: 'completed',
      endedAt: this.now(),
      summary: summarizeText(report, 400),
    });
    await this.persistReport(sessionId, session, report);

    // Child sessions deposit their result into the parent's memory graph.
    if (session.parentSessionId) {
      const parent = this.tf.session(session.parentSessionId);
      if (parent) {
        const deposited = this.tf.saveMemory({
          sessionId: parent.id,
          generation: parent.generation,
          kind: 'subsession',
          title: `Deep dive — ${session.mission.slice(0, 80)}`,
          summary: summarizeText(report, 400),
          content: report,
        });
        const parentWorkerMemory = session.parentWorkerId
          ? this.tf.memoryByWorker(session.parentWorkerId)
          : undefined;
        if (parentWorkerMemory)
          this.tf.link(deposited.id, parentWorkerMemory.id, 'subsession');
      }
    } else if (this.options.notify) {
      const workers = this.tf.workerCount(sessionId);
      const pending = pendingSubs.length;
      try {
        await this.options.notify(
          session.threadId,
          `Your long-horizon task force finished (${reason}): ${session.generation} generations, ${workers} specialist workers, ${this.tf.subSessions(sessionId).length} recursive deep-dive sub-missions${pending ? `, ${pending} still finishing (their results will land in the swarm's memory — ask me to recall them later)` : ''}. Present the report below to the owner, and mention the full report is saved as an artifact in this chat.\n\n${report.slice(0, 6000)}`,
        );
      } catch (error) {
        this.tf.updateSession(sessionId, {
          error: `Report saved, but chat notification failed: ${
            error instanceof Error ? error.message : 'unknown error'
          }`,
        });
      }
    }
  }

  private async persistReport(
    sessionId: string,
    session: TaskForceSession,
    report: string,
  ): Promise<void> {
    if (!this.options.saveArtifact) return;
    try {
      const artifact = await this.options.saveArtifact({
        title: `Task force report — ${session.mission.slice(0, 120)}`,
        kind: 'markdown',
        content: report,
        threadId: session.threadId,
      });
      this.tf.updateSession(sessionId, { reportArtifactId: artifact.id });
    } catch {
      /* artifact persistence is best-effort; the report memory remains */
    }
  }

  /* ── introspection ─────────────────────────────────────────────── */

  /** Compact session list for the REST surface. */
  listSessions(): Array<Record<string, unknown>> {
    return this.tf.sessions().map((s) => ({
      id: s.id,
      threadId: s.threadId,
      parentSessionId: s.parentSessionId,
      mission: s.mission.slice(0, 200),
      status: s.status,
      depth: s.depth,
      generation: s.generation,
      hoursBudget: s.hoursBudget,
      workers: this.tf.workerCount(s.id),
      createdAt: s.createdAt,
      endedAt: s.endedAt,
      summary: s.summary,
      reportArtifactId: s.reportArtifactId,
      error: s.error,
    }));
  }

  /** Owning conversation of a session — for route-level ownership checks. */
  sessionThreadId(sessionId: string): string | undefined {
    return this.tf.session(sessionId)?.threadId;
  }

  status(sessionId?: string, threadId?: string): Record<string, unknown> {
    let session = sessionId ? this.tf.session(sessionId) : undefined;
    if (!session && threadId)
      session = this.tf.sessionsByThread(threadId)[0];
    if (!session)
      throw new Error(
        sessionId
          ? 'No task force session with that id.'
          : 'No task force session exists for this conversation yet.',
      );
    const workers = this.tf.workers(session.id);
    const counts = {
      total: workers.length,
      completed: workers.filter((w) => w.status === 'completed').length,
      failed: workers.filter((w) => w.status === 'failed').length,
      running: workers.filter((w) => w.status === 'running').length,
    };
    const topFindings = this.tf
      .memories(session.id, 'finding')
      .map((m) => ({
        memory: m,
        worker: workers.find((w) => w.id === m.workerId),
      }))
      .filter((x) => x.worker?.status === 'completed')
      .sort((a, b) => (b.worker!.fitness ?? 0) - (a.worker!.fitness ?? 0))
      .slice(0, 8)
      .map((x) => ({
        id: x.memory.id,
        title: x.memory.title,
        summary: x.memory.summary,
        fitness: x.worker!.fitness,
        generation: x.memory.generation,
      }));
    return {
      sessionId: session.id,
      mission: session.mission,
      status: session.status,
      depth: session.depth,
      parentSessionId: session.parentSessionId,
      generation: session.generation,
      hoursBudget: session.hoursBudget,
      remainingMs: Math.max(0, session.deadline - this.now()),
      workers: counts,
      topFindings,
      genSummaries: this.tf
        .memories(session.id, 'gen_summary')
        .slice(0, 3)
        .map((m) => ({ title: m.title, summary: m.summary })),
      subSessions: this.tf.subSessions(session.id).map((s) => ({
        id: s.id,
        mission: s.mission,
        status: s.status,
        summary: s.summary,
      })),
      summary: session.summary,
      reportArtifactId: session.reportArtifactId,
      error: session.error,
    };
  }

  recall(input: {
    query?: string;
    memoryId?: string;
    sessionId?: string;
    depth?: number;
  }): Record<string, unknown> {
    if (input.memoryId) {
      const memory = this.tf.memory(input.memoryId);
      if (!memory) throw new Error('No task-force memory with that id.');
      const neighbors = this.tf.linksOf(memory.id).map((link) => {
        const other = this.tf.memory(link.otherId);
        return {
          id: link.otherId,
          relation: link.relation,
          kind: other?.kind,
          title: other?.title,
          summary: other?.summary,
          content: other?.content.slice(0, 2000),
        };
      });
      return {
        memory: {
          id: memory.id,
          kind: memory.kind,
          title: memory.title,
          summary: memory.summary,
          content: memory.content,
          sessionId: memory.sessionId,
        },
        neighbors,
      };
    }
    if (!input.query?.trim())
      throw new Error('Provide a query, or a memoryId to read one memory.');
    const terms = tokenize(input.query);
    const matches = this.tf
      .searchMemories(terms, { sessionId: input.sessionId, limit: 8 })
      .map((m) => ({
        id: m.id,
        kind: m.kind,
        title: m.title,
        summary: m.summary,
        score: m.score,
        sessionId: m.sessionId,
      }));
    // Neural expansion: walk links from the matches, summaries only — the
    // deep network is reachable without dragging full content into context.
    const depth = Math.min(5, Math.max(1, input.depth ?? 2));
    const seen = new Set(matches.map((m) => m.id));
    let frontier = matches.map((m) => m.id);
    const network: Array<{
      id: string;
      from: string;
      relation: string;
      depth: number;
      kind: string;
      title: string;
      summary: string;
    }> = [];
    for (let d = 1; d <= depth; d++) {
      const next: string[] = [];
      for (const id of frontier) {
        for (const link of this.tf.linksOf(id)) {
          if (seen.has(link.otherId)) continue;
          seen.add(link.otherId);
          const other = this.tf.memory(link.otherId);
          if (!other) continue;
          network.push({
            id: other.id,
            from: id,
            relation: link.relation,
            depth: d,
            kind: other.kind,
            title: other.title,
            summary: other.summary,
          });
          next.push(other.id);
        }
      }
      frontier = next;
    }
    return {
      matches,
      network,
      hint: 'Pass memoryId to read full content plus its direct neighbors. Summaries are shown; full content is never deleted.',
    };
  }
}

/* Module-level singleton so DotAgent tools (which are built per-run inside
 * the CopilotKit agent factory) can reach the engine without constructor
 * plumbing through Platform. The server sets it at boot; tests may set a
 * stub. Absent engine = the tool explains the server is not running it. */
let engine: TaskForceEngine | undefined;
export function setTaskForceEngine(instance: TaskForceEngine | undefined) {
  engine = instance;
}
export function getTaskForceEngine(): TaskForceEngine | undefined {
  return engine;
}
