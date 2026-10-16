import { DatabaseSync } from 'node:sqlite';
import { randomUUID } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import type {
  TaskForceConfig,
  TaskForceMemory,
  TaskForceMemoryKind,
  TaskForceSession,
  TaskForceSessionStatus,
  TaskForceWorker,
} from '../shared/task-force.js';

export const DEFAULT_TASK_FORCE_CONFIG: TaskForceConfig = {
  waveSize: 16,
  maxWave: 64,
  maxWorkers: 2000,
  maxDepth: 3,
  maxSubSessions: 12,
  maxDirectivesPerWorker: 2,
  deliverables: [],
};

export function parseTaskForceConfig(
  raw: string,
  overrides?: Partial<TaskForceConfig>,
): TaskForceConfig {
  let parsed: Partial<TaskForceConfig> = {};
  try {
    parsed = JSON.parse(raw) as Partial<TaskForceConfig>;
  } catch {
    /* malformed config JSON — defaults apply */
  }
  return { ...DEFAULT_TASK_FORCE_CONFIG, ...parsed, ...(overrides ?? {}) };
}

/**
 * Persistence for the long-horizon Task Force: sessions, their worker
 * populations, and the cross-linked per-agent memory graph. Own connection
 * to the shared SQLite database (WAL allows multiple handles), so the swarm
 * survives restarts and its memory outlives any single process.
 */
export class TaskForceStore {
  private db: DatabaseSync;
  constructor(database: string) {
    if (database !== ':memory:') mkdirSync(dirname(database), { recursive: true });
    this.db = new DatabaseSync(database);
    this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;
      CREATE TABLE IF NOT EXISTS tf_sessions (
        id TEXT PRIMARY KEY,
        parentSessionId TEXT,
        parentWorkerId TEXT,
        threadId TEXT NOT NULL,
        dotId TEXT NOT NULL,
        mission TEXT NOT NULL,
        status TEXT NOT NULL,
        hoursBudget REAL NOT NULL,
        deadline INTEGER NOT NULL,
        depth INTEGER NOT NULL DEFAULT 0,
        createdAt INTEGER NOT NULL,
        endedAt INTEGER,
        generation INTEGER NOT NULL DEFAULT 0,
        config TEXT NOT NULL,
        summary TEXT,
        reportArtifactId TEXT,
        error TEXT
      );
      CREATE INDEX IF NOT EXISTS tf_sessions_thread ON tf_sessions(threadId);
      CREATE TABLE IF NOT EXISTS tf_workers (
        id TEXT PRIMARY KEY,
        sessionId TEXT NOT NULL,
        parentWorkerId TEXT,
        generation INTEGER NOT NULL,
        perspective TEXT NOT NULL,
        status TEXT NOT NULL,
        fitness REAL,
        createdAt INTEGER NOT NULL,
        finishedAt INTEGER,
        error TEXT
      );
      CREATE INDEX IF NOT EXISTS tf_workers_session ON tf_workers(sessionId, generation);
      CREATE TABLE IF NOT EXISTS tf_memories (
        id TEXT PRIMARY KEY,
        sessionId TEXT NOT NULL,
        workerId TEXT,
        generation INTEGER NOT NULL,
        kind TEXT NOT NULL,
        title TEXT NOT NULL,
        summary TEXT NOT NULL,
        content TEXT NOT NULL,
        createdAt INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS tf_memories_session ON tf_memories(sessionId, kind);
      CREATE TABLE IF NOT EXISTS tf_links (
        fromId TEXT NOT NULL,
        toId TEXT NOT NULL,
        relation TEXT NOT NULL,
        createdAt INTEGER NOT NULL,
        PRIMARY KEY (fromId, toId)
      );`);
  }
  close() {
    this.db.close();
  }

  createSession(input: {
    threadId: string;
    dotId: string;
    mission: string;
    hoursBudget: number;
    deadline: number;
    config: TaskForceConfig;
    parentSessionId?: string | null;
    parentWorkerId?: string | null;
    depth?: number;
    status?: TaskForceSessionStatus;
  }): TaskForceSession {
    const id = randomUUID();
    this.db
      .prepare(
        `INSERT INTO tf_sessions (id, parentSessionId, parentWorkerId, threadId, dotId, mission, status, hoursBudget, deadline, depth, createdAt, endedAt, generation, config, summary, reportArtifactId, error)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, 0, ?, NULL, NULL, NULL)`,
      )
      .run(
        id,
        input.parentSessionId ?? null,
        input.parentWorkerId ?? null,
        input.threadId,
        input.dotId,
        input.mission,
        input.status ?? 'running',
        input.hoursBudget,
        input.deadline,
        input.depth ?? 0,
        Date.now(),
        JSON.stringify(input.config),
      );
    return this.session(id)!;
  }

  session(id: string): TaskForceSession | undefined {
    return this.db
      .prepare('SELECT * FROM tf_sessions WHERE id=?')
      .get(id) as unknown as TaskForceSession | undefined;
  }

  sessions(status?: TaskForceSessionStatus): TaskForceSession[] {
    return (
      status
        ? this.db
            .prepare('SELECT * FROM tf_sessions WHERE status=? ORDER BY createdAt')
            .all(status)
        : this.db
            .prepare('SELECT * FROM tf_sessions ORDER BY createdAt DESC')
            .all()
    ) as unknown as TaskForceSession[];
  }

  sessionsByThread(threadId: string): TaskForceSession[] {
    return this.db
      .prepare('SELECT * FROM tf_sessions WHERE threadId=? ORDER BY createdAt DESC')
      .all(threadId) as unknown as TaskForceSession[];
  }

  subSessions(parentId: string): TaskForceSession[] {
    return this.db
      .prepare(
        'SELECT * FROM tf_sessions WHERE parentSessionId=? ORDER BY createdAt',
      )
      .all(parentId) as unknown as TaskForceSession[];
  }

  updateSession(
    id: string,
    patch: Partial<{
      status: TaskForceSessionStatus;
      generation: number;
      summary: string | null;
      reportArtifactId: string | null;
      error: string | null;
      endedAt: number | null;
      deadline: number;
    }>,
  ): TaskForceSession | undefined {
    const current = this.session(id);
    if (!current) return undefined;
    this.db
      .prepare(
        `UPDATE tf_sessions SET
          status=?, generation=?, summary=?, reportArtifactId=?, error=?, endedAt=?, deadline=?
         WHERE id=?`,
      )
      .run(
        patch.status ?? current.status,
        patch.generation ?? current.generation,
        patch.summary ?? current.summary,
        patch.reportArtifactId ?? current.reportArtifactId,
        patch.error !== undefined ? patch.error : current.error,
        patch.endedAt !== undefined ? patch.endedAt : current.endedAt,
        patch.deadline !== undefined ? patch.deadline : current.deadline,
        id,
      );
    return this.session(id);
  }

  createWorker(input: {
    sessionId: string;
    generation: number;
    perspective: string;
    parentWorkerId?: string | null;
  }): TaskForceWorker {
    const id = randomUUID();
    this.db
      .prepare(
        `INSERT INTO tf_workers (id, sessionId, parentWorkerId, generation, perspective, status, fitness, createdAt, finishedAt, error)
         VALUES (?, ?, ?, ?, ?, 'running', NULL, ?, NULL, NULL)`,
      )
      .run(
        id,
        input.sessionId,
        input.parentWorkerId ?? null,
        input.generation,
        input.perspective,
        Date.now(),
      );
    return this.worker(id)!;
  }

  worker(id: string): TaskForceWorker | undefined {
    return this.db
      .prepare('SELECT * FROM tf_workers WHERE id=?')
      .get(id) as unknown as TaskForceWorker | undefined;
  }

  workers(sessionId: string, generation?: number): TaskForceWorker[] {
    return (
      generation !== undefined
        ? this.db
            .prepare(
              'SELECT * FROM tf_workers WHERE sessionId=? AND generation=? ORDER BY createdAt',
            )
            .all(sessionId, generation)
        : this.db
            .prepare(
              'SELECT * FROM tf_workers WHERE sessionId=? ORDER BY createdAt',
            )
            .all(sessionId)
    ) as unknown as TaskForceWorker[];
  }

  workerCount(sessionId: string): number {
    return (
      this.db
        .prepare('SELECT COUNT(*) AS n FROM tf_workers WHERE sessionId=?')
        .get(sessionId) as { n: number }
    ).n;
  }

  finishWorker(
    id: string,
    outcome:
      | { finding: string; fitness: number }
      | { error: string },
  ): void {
    if ('error' in outcome) {
      this.db
        .prepare(
          "UPDATE tf_workers SET status='failed', error=?, finishedAt=? WHERE id=?",
        )
        .run(outcome.error, Date.now(), id);
      return;
    }
    // Findings live in the memory graph; the worker row keeps the fitness.
    this.db
      .prepare(
        "UPDATE tf_workers SET status='completed', fitness=?, finishedAt=? WHERE id=?",
      )
      .run(outcome.fitness, Date.now(), id);
  }

  saveMemory(input: {
    sessionId: string;
    workerId?: string | null;
    generation: number;
    kind: TaskForceMemoryKind;
    title: string;
    summary: string;
    content: string;
  }): TaskForceMemory {
    const id = randomUUID();
    this.db
      .prepare(
        `INSERT INTO tf_memories (id, sessionId, workerId, generation, kind, title, summary, content, createdAt)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        id,
        input.sessionId,
        input.workerId ?? null,
        input.generation,
        input.kind,
        input.title,
        input.summary,
        input.content,
        Date.now(),
      );
    return this.memory(id)!;
  }

  memory(id: string): TaskForceMemory | undefined {
    return this.db
      .prepare('SELECT * FROM tf_memories WHERE id=?')
      .get(id) as unknown as TaskForceMemory | undefined;
  }

  memoryByWorker(workerId: string): TaskForceMemory | undefined {
    return this.db
      .prepare(
        "SELECT * FROM tf_memories WHERE workerId=? AND kind='finding' LIMIT 1",
      )
      .get(workerId) as unknown as TaskForceMemory | undefined;
  }

  memories(
    sessionId?: string,
    kind?: TaskForceMemoryKind,
  ): TaskForceMemory[] {
    const clauses: string[] = [];
    const params: (string | number)[] = [];
    if (sessionId) {
      clauses.push('sessionId=?');
      params.push(sessionId);
    }
    if (kind) {
      clauses.push('kind=?');
      params.push(kind);
    }
    const where = clauses.length ? ` WHERE ${clauses.join(' AND ')}` : '';
    return this.db
      .prepare(
        `SELECT * FROM tf_memories${where} ORDER BY createdAt DESC, rowid DESC`,
      )
      .all(...params) as unknown as TaskForceMemory[];
  }

  link(fromId: string, toId: string, relation: string): void {
    if (fromId === toId) return;
    if (!this.memory(fromId) || !this.memory(toId)) return;
    this.db
      .prepare(
        `INSERT INTO tf_links (fromId, toId, relation, createdAt) VALUES (?, ?, ?, ?)
         ON CONFLICT(fromId, toId) DO UPDATE SET relation=excluded.relation`,
      )
      .run(fromId, toId, relation, Date.now());
  }

  /** Neural traversal: edges in both directions, so recall can walk the
   *  graph up (ancestors), down (descendants), and sideways (siblings). */
  linksOf(id: string): Array<{
    otherId: string;
    relation: string;
  }> {
    const rows = this.db
      .prepare(
        `SELECT toId AS otherId, relation FROM tf_links WHERE fromId=?
         UNION
         SELECT fromId AS otherId, relation FROM tf_links WHERE toId=?`,
      )
      .all(id, id) as Array<{ otherId: string; relation: string }>;
    return rows;
  }

  /** Keyword search over the memory graph: title hits weigh most, then the
   *  working summary, then the full content. */
  searchMemories(
    terms: string[],
    options: { sessionId?: string; limit?: number } = {},
  ): Array<TaskForceMemory & { score: number }> {
    const limit = options.limit ?? 8;
    if (terms.length === 0) return [];
    const pool = this.memories(options.sessionId);
    const scored: Array<TaskForceMemory & { score: number }> = [];
    for (const memory of pool) {
      const title = memory.title.toLowerCase();
      const summary = memory.summary.toLowerCase();
      const content = memory.content.toLowerCase();
      let score = 0;
      for (const term of terms) {
        if (title.includes(term)) score += 3;
        if (summary.includes(term)) score += 2;
        if (content.includes(term)) score += 1;
      }
      if (score > 0) scored.push({ ...memory, score });
    }
    scored.sort((a, b) => b.score - a.score);
    return scored.slice(0, limit);
  }
}
