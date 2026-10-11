import { ComputerStore } from './computer-store.js';
import { Pages } from './pages.js';
import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { randomUUID } from 'node:crypto';
import { validateLearningSettings } from '../shared/learning.js';
import type {
  CallReceipt,
  Conversation,
  Dot,
  SessionMemory,
  Space,
} from '../shared/types.js';
export class WorkspaceStore {
  private db: DatabaseSync;
  readonly pages: Pages;
  readonly computers: ComputerStore;
  constructor(
    path: string,
    readonly ownerId: string,
  ) {
    if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
    this.db = new DatabaseSync(path);
    this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;
      CREATE TABLE IF NOT EXISTS spaces(id TEXT PRIMARY KEY, name TEXT NOT NULL, description TEXT NOT NULL, createdAt INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS dots(id TEXT PRIMARY KEY, spaceId TEXT NOT NULL, name TEXT NOT NULL, instructions TEXT NOT NULL, researchAllowed INTEGER NOT NULL, memoryAllowed INTEGER NOT NULL, createdAt INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS thread_bindings(id TEXT PRIMARY KEY, dotId TEXT NOT NULL, ownerId TEXT NOT NULL, title TEXT NOT NULL, createdAt INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS task_threads(taskId TEXT PRIMARY KEY, threadId TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS calls(id TEXT PRIMARY KEY, threadId TEXT NOT NULL, startedAt INTEGER NOT NULL, endedAt INTEGER, status TEXT NOT NULL, transcript TEXT NOT NULL, error TEXT);
      CREATE TABLE IF NOT EXISTS captures(threadId TEXT PRIMARY KEY, value TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS local_thread_runs(id TEXT PRIMARY KEY, threadId TEXT NOT NULL, agentId TEXT NOT NULL, parentRunId TEXT, events TEXT NOT NULL, messages TEXT NOT NULL, createdAt INTEGER NOT NULL);
      CREATE INDEX IF NOT EXISTS idx_local_thread_runs_threadId ON local_thread_runs(threadId, createdAt ASC);
      CREATE TABLE IF NOT EXISTS session_memories(id TEXT PRIMARY KEY, threadId TEXT NOT NULL, text TEXT NOT NULL, category TEXT, createdAt INTEGER NOT NULL);
      CREATE INDEX IF NOT EXISTS idx_session_memories_threadId ON session_memories(threadId, createdAt DESC);
      CREATE TABLE IF NOT EXISTS usage_events(id INTEGER PRIMARY KEY AUTOINCREMENT, dotId TEXT NOT NULL, tokens INTEGER NOT NULL, createdAt INTEGER NOT NULL);
      CREATE INDEX IF NOT EXISTS idx_usage_events_dotId ON usage_events(dotId, createdAt DESC);
      CREATE TABLE IF NOT EXISTS telegram_threads(chatId INTEGER PRIMARY KEY, threadId TEXT NOT NULL);`);
    for (const [table, column, definition] of [
      ['dots', 'learningContainerId', 'TEXT'],
      ['dots', 'skillDeliveryEnabled', 'INTEGER NOT NULL DEFAULT 0'],
      ['dots', 'model', 'TEXT'],
      ['dots', 'reasoningEffort', 'TEXT'],
      ['dots', 'budgetTokens', 'INTEGER'],
      ['thread_bindings', 'learningContainerId', 'TEXT'],
    ]) {
      if (
        !this.db
          .prepare(`PRAGMA table_info(${table})`)
          .all()
          .some((field) => field.name === column)
      )
        this.db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
    }
    // Migrate only once: restarting must never restore a revoked grant.
    if (
      !this.db
        .prepare(
          "SELECT name FROM sqlite_master WHERE type='table' AND name='dot_spaces'",
        )
        .get()
    ) {
      this.db.exec(`BEGIN;
        CREATE TABLE dot_spaces(dotId TEXT NOT NULL, spaceId TEXT NOT NULL, PRIMARY KEY(dotId, spaceId));
        INSERT INTO dot_spaces SELECT id, spaceId FROM dots;
        COMMIT;`);
    }
    this.computers = new ComputerStore(this.db);
    this.pages = new Pages(this.db, (id) =>
      this.spaces().some((space) => space.id === id),
    );
    if (
      !this.db
        .prepare('PRAGMA table_info(calls)')
        .all()
        .some((column) => column.name === 'anchorMessageId')
    )
      this.db.exec('ALTER TABLE calls ADD COLUMN anchorMessageId TEXT');
    if (!this.spaces().length) {
      const space = this.createSpace(
        'Everyday',
        'A little space for your day.',
      );
      this.createDot(
        space.id,
        'Dot',
        'Be thoughtful, practical, and concise. Help the user think clearly and follow through.',
        true,
        true,
      );
    }
  }
  close() {
    this.db.close();
  }
  spaces(): Space[] {
    return this.db
      .prepare('SELECT * FROM spaces ORDER BY createdAt')
      .all() as unknown as Space[];
  }
  createSpace(name: string, description: string): Space {
    const space = {
      id: randomUUID(),
      name,
      description,
      createdAt: Date.now(),
    };
    this.db
      .prepare('INSERT INTO spaces VALUES (?, ?, ?, ?)')
      .run(space.id, name, description, space.createdAt);
    return space;
  }
  dots(): Dot[] {
    return this.db
      .prepare('SELECT * FROM dots ORDER BY createdAt')
      .all()
      .map((row) => ({
        ...row,
        spaceIds: this.db
          .prepare(
            'SELECT spaceId FROM dot_spaces WHERE dotId=? ORDER BY spaceId',
          )
          .all(String(row.id))
          .map((grant) => String(grant.spaceId)),
        researchAllowed: !!row.researchAllowed,
        memoryAllowed: !!row.memoryAllowed,
        skillDeliveryEnabled: !!row.skillDeliveryEnabled,
      })) as unknown as Dot[];
  }
  dot(id: string) {
    return this.dots().find((dot) => dot.id === id);
  }
  createDot(
    spaceId: string,
    name: string,
    instructions: string,
    researchAllowed: boolean,
    memoryAllowed: boolean,
    spaceIds: string[] = [spaceId],
    learningContainerId: string | null = null,
    skillDeliveryEnabled = false,
    model: string | null = null,
    reasoningEffort: string | null = null,
    budgetTokens: number | null = null,
  ): Dot {
    this.validateSpaceAccess(spaceId, spaceIds);
    validateLearningSettings(learningContainerId, skillDeliveryEnabled);
    const dot: Dot = {
      id: randomUUID(),
      spaceId,
      spaceIds: [...new Set(spaceIds)].sort(),
      name,
      instructions,
      researchAllowed,
      memoryAllowed,
      learningContainerId,
      skillDeliveryEnabled,
      model,
      reasoningEffort,
      budgetTokens,
      createdAt: Date.now(),
    };
    this.db.exec('BEGIN');
    try {
      this.db
        .prepare(
          'INSERT INTO dots (id, spaceId, name, instructions, researchAllowed, memoryAllowed, createdAt, learningContainerId, skillDeliveryEnabled, model, reasoningEffort, budgetTokens) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
        )
        .run(
          dot.id,
          spaceId,
          name,
          instructions,
          +researchAllowed,
          +memoryAllowed,
          dot.createdAt,
          learningContainerId,
          +skillDeliveryEnabled,
          model,
          reasoningEffort,
          budgetTokens,
        );
      for (const id of dot.spaceIds)
        this.db.prepare('INSERT INTO dot_spaces VALUES (?, ?)').run(dot.id, id);
      this.db.exec('COMMIT');
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
    return dot;
  }
  canAccessSpace(dotId: string, spaceId: string) {
    return !!this.db
      .prepare('SELECT 1 FROM dot_spaces WHERE dotId=? AND spaceId=?')
      .get(dotId, spaceId);
  }
  private validateSpaceAccess(defaultSpace: string, spaceIds: string[]) {
    if (
      !spaceIds.includes(defaultSpace) ||
      spaceIds.some((id) => !this.spaces().some((space) => space.id === id))
    )
      throw new Error('Space access must include a valid default destination.');
  }
  updateDot(
    id: string,
    patch: Pick<
      Dot,
      'name' | 'instructions' | 'researchAllowed' | 'memoryAllowed'
    > & {
      spaceId?: string;
      spaceIds?: string[];
      learningContainerId?: string | null;
      skillDeliveryEnabled?: boolean;
      model?: string | null;
      reasoningEffort?: string | null;
      budgetTokens?: number | null;
    },
  ): Dot {
    const current = this.dot(id);
    if (!current) throw new Error('Dot not found.');
    const defaultSpace = patch.spaceId ?? current.spaceId;
    const spaceIds = patch.spaceIds ?? current.spaceIds;
    this.validateSpaceAccess(defaultSpace, spaceIds);
    const learningContainerId =
      patch.learningContainerId === undefined
        ? (current.learningContainerId ?? null)
        : patch.learningContainerId;
    const skillDeliveryEnabled =
      patch.skillDeliveryEnabled ?? current.skillDeliveryEnabled ?? false;
    const model =
      patch.model === undefined ? (current.model ?? null) : patch.model;
    const reasoningEffort =
      patch.reasoningEffort === undefined
        ? (current.reasoningEffort ?? null)
        : patch.reasoningEffort;
    const budgetTokens =
      patch.budgetTokens === undefined
        ? (current.budgetTokens ?? null)
        : patch.budgetTokens === null || patch.budgetTokens <= 0
          ? null
          : Math.floor(patch.budgetTokens);
    validateLearningSettings(learningContainerId, skillDeliveryEnabled);
    this.db.exec('BEGIN');
    try {
      this.db
        .prepare(
          'UPDATE dots SET name=?, instructions=?, researchAllowed=?, memoryAllowed=?, learningContainerId=?, skillDeliveryEnabled=?, model=?, reasoningEffort=?, budgetTokens=? WHERE id=?',
        )
        .run(
          patch.name,
          patch.instructions,
          +patch.researchAllowed,
          +patch.memoryAllowed,
          learningContainerId,
          +skillDeliveryEnabled,
          model,
          reasoningEffort,
          budgetTokens,
          id,
        );
      this.db
        .prepare('UPDATE dots SET spaceId=? WHERE id=?')
        .run(defaultSpace, id);
      this.db.prepare('DELETE FROM dot_spaces WHERE dotId=?').run(id);
      for (const space of new Set(spaceIds))
        this.db.prepare('INSERT INTO dot_spaces VALUES (?, ?)').run(id, space);
      this.db.exec('COMMIT');
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
    return this.dot(id)!;
  }
  conversations(): Conversation[] {
    return this.db
      .prepare(
        'SELECT * FROM thread_bindings WHERE ownerId=? ORDER BY createdAt DESC',
      )
      .all(this.ownerId) as unknown as Conversation[];
  }
  bindThread(id: string, dotId: string, title: string): Conversation {
    const dot = this.dot(dotId);
    if (!dot) throw new Error('Dot not found.');
    const value: Conversation = {
      id,
      dotId,
      ownerId: this.ownerId,
      title,
      createdAt: Date.now(),
      learningContainerId: dot.learningContainerId ?? null,
    };
    this.db
      .prepare(
        'INSERT INTO thread_bindings (id, dotId, ownerId, title, createdAt, learningContainerId) VALUES (?, ?, ?, ?, ?, ?)',
      )
      .run(
        id,
        dotId,
        this.ownerId,
        title,
        value.createdAt,
        value.learningContainerId ?? null,
      );
    return value;
  }
  requireThread(id: string, dotId?: string): Conversation {
    const thread = this.conversations().find((thread) => thread.id === id);
    if (!thread || (dotId && thread.dotId !== dotId))
      throw new Error('Conversation does not belong to this Dot and owner.');
    return thread;
  }
  updateThread(id: string, updates: { title?: string }): void {
    if (updates.title) {
      this.db
        .prepare('UPDATE thread_bindings SET title=? WHERE id=? AND ownerId=?')
        .run(updates.title, id, this.ownerId);
    }
  }
  deleteThread(id: string): void {
    this.db
      .prepare('DELETE FROM thread_bindings WHERE id=? AND ownerId=?')
      .run(id, this.ownerId);
    this.db.prepare('DELETE FROM local_thread_runs WHERE threadId=?').run(id);
    this.db.prepare('DELETE FROM calls WHERE threadId=?').run(id);
    this.db.prepare('DELETE FROM captures WHERE threadId=?').run(id);
    this.db.prepare('DELETE FROM task_threads WHERE threadId=?').run(id);
    this.db.prepare('DELETE FROM page_threads WHERE threadId=?').run(id);
    this.db.prepare('DELETE FROM page_reviews WHERE threadId=?').run(id);
    this.db.prepare('DELETE FROM session_memories WHERE threadId=?').run(id);
    this.db.prepare('DELETE FROM telegram_threads WHERE threadId=?').run(id);
  }
  /** Estimated tokens spent by a Dot this calendar month (budget accounting). */
  recordUsage(dotId: string, tokens: number) {
    if (!Number.isFinite(tokens) || tokens <= 0) return;
    this.db
      .prepare(
        'INSERT INTO usage_events (dotId, tokens, createdAt) VALUES (?, ?, ?)',
      )
      .run(dotId, Math.ceil(tokens), Date.now());
  }
  monthlyUsage(dotId: string): number {
    const start = new Date();
    start.setUTCDate(1);
    start.setUTCHours(0, 0, 0, 0);
    const row = this.db
      .prepare(
        'SELECT SUM(tokens) AS total FROM usage_events WHERE dotId=? AND createdAt>=?',
      )
      .get(dotId, start.getTime()) as { total: number | null };
    return row.total ?? 0;
  }
  resetUsage(dotId: string) {
    this.db.prepare('DELETE FROM usage_events WHERE dotId=?').run(dotId);
  }
  /** Durable Telegram chat -> conversation binding (survives restarts). */
  telegramThread(chatId: number): string | undefined {
    const row = this.db
      .prepare('SELECT threadId FROM telegram_threads WHERE chatId=?')
      .get(chatId) as { threadId: string } | undefined;
    return row?.threadId;
  }
  bindTelegramThread(chatId: number, threadId: string) {
    this.db
      .prepare(
        'INSERT INTO telegram_threads (chatId, threadId) VALUES (?, ?) ON CONFLICT(chatId) DO UPDATE SET threadId=excluded.threadId',
      )
      .run(chatId, threadId);
  }
  sessionMemories(threadId: string, category?: string): SessionMemory[] {
    if (category) {
      return this.db
        .prepare(
          'SELECT * FROM session_memories WHERE threadId=? AND category=? ORDER BY createdAt DESC',
        )
        .all(threadId, category) as unknown as SessionMemory[];
    }
    return this.db
      .prepare(
        'SELECT * FROM session_memories WHERE threadId=? ORDER BY createdAt DESC',
      )
      .all(threadId) as unknown as SessionMemory[];
  }
  saveSessionMemory(
    threadId: string,
    text: string,
    id: string = randomUUID(),
    category: string = 'note',
  ): SessionMemory {
    this.requireThread(threadId);
    const now = Date.now();
    this.db
      .prepare(
        'INSERT INTO session_memories (id, threadId, text, category, createdAt) VALUES (?, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET text=excluded.text, category=COALESCE(excluded.category, session_memories.category)',
      )
      .run(id, threadId, text, category, now);
    return this.db
      .prepare('SELECT * FROM session_memories WHERE id=?')
      .get(id) as unknown as SessionMemory;
  }
  deleteSessionMemory(id: string): boolean {
    return (
      this.db.prepare('DELETE FROM session_memories WHERE id=?').run(id)
        .changes > 0
    );
  }
  clearSessionMemories(threadId: string): number {
    return Number(
      this.db
        .prepare('DELETE FROM session_memories WHERE threadId=?')
        .run(threadId).changes,
    );
  }
  clearThreadMessages(id: string): void {
    this.requireThread(id);
    this.db.prepare('DELETE FROM local_thread_runs WHERE threadId=?').run(id);
    this.db.prepare('DELETE FROM captures WHERE threadId=?').run(id);
  }
  compactThreadMessages(id: string): {
    originalRuns: number;
    compacted: boolean;
  } {
    this.requireThread(id);
    const runs = this.threadRuns(id);
    if (runs.length <= 1)
      return { originalRuns: runs.length, compacted: false };

    const allMessages: Array<{ role: string; content: string }> = [];
    for (const run of runs) {
      try {
        const msgs = JSON.parse(run.messages);
        if (Array.isArray(msgs)) {
          for (const m of msgs) {
            if (m.content && typeof m.content === 'string') {
              allMessages.push({
                role: m.role || 'user',
                content: m.content.slice(0, 400),
              });
            }
          }
        }
      } catch {
        /* malformed messages JSON — skip this run */
      }
    }

    const summaryText = allMessages
      .slice(-8)
      .map((m) => `• [${m.role}]: ${m.content}`)
      .join('\n');

    const compactCheckpoint = {
      id: randomUUID(),
      threadId: id,
      agentId: runs[0]?.agentId || 'chat',
      parentRunId: null,
      events: JSON.stringify([{ type: 'COMPACTION', timestamp: Date.now() }]),
      messages: JSON.stringify([
        {
          id: randomUUID(),
          role: 'assistant',
          content: `⚡ **Context Compacted** (DSH Engine)\n\nPrevious conversation summary (${allMessages.length} turns preserved):\n${summaryText}`,
          createdAt: new Date().toISOString(),
        },
      ]),
      createdAt: Date.now(),
    };

    this.db.prepare('DELETE FROM local_thread_runs WHERE threadId=?').run(id);
    this.saveThreadRun(compactCheckpoint);
    return { originalRuns: runs.length, compacted: true };
  }
  unbindTask(taskId: string): void {
    this.db.prepare('DELETE FROM task_threads WHERE taskId=?').run(taskId);
  }
  saveThreadRun(run: {
    id: string;
    threadId: string;
    agentId: string;
    parentRunId: string | null;
    events: string;
    messages: string;
    createdAt: number;
  }): void {
    this.db
      .prepare(
        `INSERT OR REPLACE INTO local_thread_runs (id, threadId, agentId, parentRunId, events, messages, createdAt)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        run.id,
        run.threadId,
        run.agentId,
        run.parentRunId,
        run.events,
        run.messages,
        run.createdAt,
      );
  }
  threadRuns(threadId?: string): Array<{
    id: string;
    threadId: string;
    agentId: string;
    parentRunId: string | null;
    events: string;
    messages: string;
    createdAt: number;
  }> {
    return this.db
      .prepare(
        `SELECT * FROM local_thread_runs ${threadId ? 'WHERE threadId=?' : ''} ORDER BY createdAt ASC`,
      )
      .all(...(threadId ? [threadId] : [])) as unknown as Array<{
      id: string;
      threadId: string;
      agentId: string;
      parentRunId: string | null;
      events: string;
      messages: string;
      createdAt: number;
    }>;
  }
  bindTask(taskId: string, threadId: string) {
    this.requireThread(threadId);
    this.db
      .prepare('INSERT INTO task_threads VALUES (?, ?)')
      .run(taskId, threadId);
  }
  taskThread(taskId: string): string | undefined {
    const row = this.db
      .prepare('SELECT threadId FROM task_threads WHERE taskId=?')
      .get(taskId);
    return typeof row?.threadId === 'string' ? row.threadId : undefined;
  }
  calls(threadId?: string): CallReceipt[] {
    if (threadId) this.requireThread(threadId);
    return this.db
      .prepare(
        `SELECT * FROM calls ${threadId ? 'WHERE threadId=?' : ''} ORDER BY startedAt DESC`,
      )
      .all(...(threadId ? [threadId] : [])) as unknown as CallReceipt[];
  }
  createCall(threadId: string): CallReceipt {
    this.requireThread(threadId);
    const call: CallReceipt = {
      id: randomUUID(),
      threadId,
      startedAt: Date.now(),
      endedAt: null,
      status: 'connecting',
      transcript: '',
      error: null,
    };
    this.db
      .prepare(
        'INSERT INTO calls(id, threadId, startedAt, endedAt, status, transcript, error) VALUES (?, ?, ?, NULL, ?, ?, NULL)',
      )
      .run(call.id, threadId, call.startedAt, call.status, '');
    return call;
  }
  call(id: string): CallReceipt {
    const call = this.calls().find((call) => call.id === id);
    if (!call) throw new Error('Call not found.');
    this.requireThread(call.threadId);
    return call;
  }
  setCall(
    id: string,
    status: CallReceipt['status'],
    transcript: string,
    error: string | null = null,
  ) {
    const call = this.call(id);
    if (call.endedAt) return call;
    this.db
      .prepare(
        'UPDATE calls SET status=?, transcript=?, error=?, endedAt=? WHERE id=?',
      )
      .run(
        status,
        transcript,
        error,
        status === 'ended' || status === 'failed' ? Date.now() : null,
        id,
      );
    return this.call(id);
  }
  saveLateTranscript(id: string, transcript: string) {
    this.call(id);
    return (
      this.db
        .prepare(
          "UPDATE calls SET transcript=? WHERE id=? AND transcript='' AND endedAt IS NOT NULL",
        )
        .run(transcript, id).changes > 0
    );
  }
  anchorCall(id: string, anchor: string | undefined) {
    this.call(id);
    this.db
      .prepare('UPDATE calls SET anchorMessageId=? WHERE id=?')
      .run(anchor ?? null, id);
  }
  setCallError(id: string, error: string | null) {
    this.call(id);
    this.db.prepare('UPDATE calls SET error=? WHERE id=?').run(error, id);
  }
  saveCapture(threadId: string, value: unknown) {
    this.requireThread(threadId);
    this.db
      .prepare(
        'INSERT INTO captures VALUES (?, ?) ON CONFLICT(threadId) DO UPDATE SET value=excluded.value',
      )
      .run(threadId, JSON.stringify(value));
  }
  capture(threadId: string): unknown {
    this.requireThread(threadId);
    const row = this.db
      .prepare('SELECT value FROM captures WHERE threadId=?')
      .get(threadId);
    return typeof row?.value === 'string' ? JSON.parse(row.value) : null;
  }
}
