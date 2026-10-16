import { ComputerStore } from './computer-store.js';
import { Pages } from './pages.js';
import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { randomUUID } from 'node:crypto';
import { validateLearningSettings } from '../shared/learning.js';
import { fuzzyRank } from './fuzzy.js';
import type {
  CallReceipt,
  Conversation,
  Dot,
  SessionMemory,
  Space,
  TaskMemoryEntry,
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
      CREATE TABLE IF NOT EXISTS task_memory(id TEXT PRIMARY KEY, threadId TEXT NOT NULL, name TEXT NOT NULL, summary TEXT NOT NULL, content TEXT NOT NULL, kind TEXT NOT NULL, source TEXT, bytes INTEGER NOT NULL, createdAt INTEGER NOT NULL, updatedAt INTEGER NOT NULL);
      CREATE INDEX IF NOT EXISTS idx_task_memory_thread ON task_memory(threadId, updatedAt DESC);
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
  conversations(ownerId: string = this.ownerId): Conversation[] {
    return this.db
      .prepare(
        'SELECT * FROM thread_bindings WHERE ownerId=? ORDER BY createdAt DESC',
      )
      .all(ownerId) as unknown as Conversation[];
  }
  bindThread(
    id: string,
    dotId: string,
    title: string,
    ownerId: string = this.ownerId,
  ): Conversation {
    const dot = this.dot(dotId);
    if (!dot) throw new Error('Dot not found.');
    const value: Conversation = {
      id,
      dotId,
      ownerId,
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
        ownerId,
        title,
        value.createdAt,
        value.learningContainerId ?? null,
      );
    return value;
  }
  /**
   * Resolves a conversation. When `ownerId` is given (every HTTP-facing
   * path passes the signed-in user) the thread must belong to that owner —
   * another user's thread id reads as missing. Without `ownerId` the
   * lookup is server-internal (scheduled tasks, channels) and unrestricted.
   */
  requireThread(id: string, dotId?: string, ownerId?: string): Conversation {
    const thread = this.db
      .prepare('SELECT * FROM thread_bindings WHERE id=?')
      .get(id) as unknown as Conversation | undefined;
    if (
      !thread ||
      (dotId && thread.dotId !== dotId) ||
      (ownerId && thread.ownerId !== ownerId)
    )
      throw new Error('Conversation does not belong to this Dot and owner.');
    return thread;
  }
  updateThread(id: string, updates: { title?: string }, ownerId?: string): void {
    if (updates.title) {
      this.db
        .prepare('UPDATE thread_bindings SET title=? WHERE id=? AND ownerId=?')
        .run(updates.title, id, ownerId ?? this.ownerId);
    }
  }
  deleteThread(id: string, ownerId?: string): void {
    this.db
      .prepare('DELETE FROM thread_bindings WHERE id=? AND ownerId=?')
      .run(id, ownerId ?? this.ownerId);
    this.db.prepare('DELETE FROM local_thread_runs WHERE threadId=?').run(id);
    this.db.prepare('DELETE FROM calls WHERE threadId=?').run(id);
    this.db.prepare('DELETE FROM captures WHERE threadId=?').run(id);
    this.db.prepare('DELETE FROM task_threads WHERE threadId=?').run(id);
    this.db.prepare('DELETE FROM page_threads WHERE threadId=?').run(id);
    this.db.prepare('DELETE FROM page_reviews WHERE threadId=?').run(id);
    this.db.prepare('DELETE FROM session_memories WHERE threadId=?').run(id);
    this.db.prepare('DELETE FROM task_memory WHERE threadId=?').run(id);
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
  /**
   * Task memory — the conversation's working set. Each entry is like a file:
   * a name, a SMALL summary that enters context cheaply, and the FULL
   * extracted content (e.g. a PDF converted to raw markdown) retrieved only
   * when needed. Long-context material lives here instead of the prompt.
   */
  taskMemories(threadId: string): TaskMemoryEntry[] {
    return this.db
      .prepare('SELECT * FROM task_memory WHERE threadId=? ORDER BY createdAt')
      .all(threadId) as unknown as TaskMemoryEntry[];
  }
  taskMemory(id: string): TaskMemoryEntry | undefined {
    return this.db
      .prepare('SELECT * FROM task_memory WHERE id=?')
      .get(id) as unknown as TaskMemoryEntry | undefined;
  }
  saveTaskMemory(
    threadId: string,
    name: string,
    summary: string,
    content: string,
    kind: 'file' | 'image' | 'note' = 'note',
    source: string | null = null,
  ): TaskMemoryEntry {
    this.requireThread(threadId);
    const now = Date.now();
    // Upsert by (threadId, name): re-extracting a source file replaces its
    // old entry instead of piling up duplicates.
    const existing = this.db
      .prepare(
        'SELECT id FROM task_memory WHERE threadId=? AND name=? ORDER BY createdAt DESC LIMIT 1',
      )
      .get(threadId, name) as { id: string } | undefined;
    const id = existing?.id ?? randomUUID();
    this.db
      .prepare(
        `INSERT INTO task_memory (id, threadId, name, summary, content, kind, source, bytes, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET summary=excluded.summary, content=excluded.content, kind=excluded.kind, source=COALESCE(excluded.source, task_memory.source), bytes=excluded.bytes, updatedAt=excluded.updatedAt`,
      )
      .run(id, threadId, name, summary, content, kind, source, content.length, now, now);
    return this.taskMemory(id)!;
  }
  appendTaskMemory(
    threadId: string,
    name: string,
    content: string,
    summary?: string,
  ): TaskMemoryEntry | undefined {
    const entries = this.db
      .prepare('SELECT id FROM task_memory WHERE threadId=? AND name=? ORDER BY createdAt DESC LIMIT 1')
      .get(threadId, name) as { id: string } | undefined;
    if (!entries) return undefined;
    const now = Date.now();
    this.db
      .prepare(
        'UPDATE task_memory SET content=content || ?, bytes=bytes + ?, summary=COALESCE(?, summary), updatedAt=? WHERE id=?',
      )
      .run(`\n${content}`, content.length, summary ?? null, now, entries.id);
    return this.taskMemory(entries.id);
  }
  searchTaskMemory(
    threadId: string,
    query: string,
    limit = 8,
  ): Array<TaskMemoryEntry & { score: number; strength: number }> {
    return fuzzyRank(
      query,
      this.taskMemories(threadId).map((entry) => ({
        // The haystack: name + summary carry the most signal; the full
        // content joins so deep matches still surface.
        text: `${entry.name}\n${entry.summary}\n${entry.content}`,
        category: entry.kind,
        entry,
      })),
      limit,
    ).map((match) => ({
      ...(match.item.entry as TaskMemoryEntry),
      score: match.score,
      strength: match.strength,
    }));
  }
  deleteTaskMemory(id: string): boolean {
    return (
      this.db.prepare('DELETE FROM task_memory WHERE id=?').run(id).changes > 0
    );
  }
  clearTaskMemory(threadId: string): number {
    return Number(
      this.db
        .prepare('DELETE FROM task_memory WHERE threadId=?')
        .run(threadId).changes,
    );
  }
  clearThreadMessages(id: string): void {
    this.requireThread(id);
    this.db.prepare('DELETE FROM local_thread_runs WHERE threadId=?').run(id);
    this.db.prepare('DELETE FROM captures WHERE threadId=?').run(id);
  }
  /**
   * Forks a conversation: a new thread bound to the same Dot, carrying the
   * runs (optionally only up to a given message), session memories, and the
   * task-memory working set. The source conversation is untouched — forks
   * are the safe way to branch before experimenting or reverting.
   */
  forkThread(
    threadId: string,
    uptoMessageId?: string,
    title?: string,
    ownerId: string = this.ownerId,
  ): Conversation {
    const source = this.requireThread(threadId, undefined, ownerId);
    const newId = randomUUID();
    this.db
      .prepare(
        'INSERT INTO thread_bindings (id, dotId, ownerId, title, createdAt, learningContainerId) VALUES (?, ?, ?, ?, ?, ?)',
      )
      .run(
        newId,
        source.dotId,
        ownerId,
        title ?? `Fork of ${source.title}`.slice(0, 120),
        Date.now(),
        source.learningContainerId ?? null,
      );
    const runs = this.threadRuns(threadId);
    const capture = this.db
      .prepare('SELECT value FROM captures WHERE threadId=?')
      .get(threadId) as { value: string } | undefined;
    for (const run of runs) {
      let messages = run.messages;
      let withinRunCutoff = false;
      if (uptoMessageId) {
        try {
          const parsed = JSON.parse(run.messages) as Array<{ id?: string }>;
          const index = parsed.findIndex((m) => m.id === uptoMessageId);
          if (index !== -1) {
            // The run that holds the cutoff: keep up to and including it.
            messages = JSON.stringify(parsed.slice(0, index + 1));
            withinRunCutoff = true;
          }
          // Runs before the cutoff simply copy whole — no message inside,
          // no truncation needed.
        } catch {
          /* malformed run — copy as-is */
        }
      }
      this.saveThreadRun({
        id: randomUUID(),
        threadId: newId,
        agentId: run.agentId,
        parentRunId: run.parentRunId,
        events: run.events,
        messages,
        createdAt: run.createdAt,
      });
      if (withinRunCutoff) break;
    }
    if (capture)
      this.db
        .prepare('INSERT INTO captures (threadId, value) VALUES (?, ?)')
        .run(newId, capture.value);
    for (const memory of this.sessionMemories(threadId)) {
      this.db
        .prepare(
          "INSERT INTO session_memories (id, threadId, text, category, createdAt) VALUES (?, ?, ?, ?, ?)",
        )
        .run(randomUUID(), newId, memory.text, memory.category ?? null, memory.createdAt);
    }
    for (const entry of this.taskMemories(threadId)) {
      this.db
        .prepare(
          "INSERT INTO task_memory (id, threadId, name, summary, content, kind, source, bytes, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        )
        .run(
          randomUUID(),
          newId,
          entry.name,
          entry.summary,
          entry.content,
          entry.kind,
          entry.source ?? null,
          entry.bytes,
          entry.createdAt,
          entry.updatedAt,
        );
    }
    return this.requireThread(newId);
  }
  /**
   * Edits a message using edit-and-resend semantics: the original message
   * and everything after it are dropped from the thread, and the client
   * re-sends the corrected content as a fresh message. Rows are full
   * conversation snapshots, so EVERY row containing the target is
   * truncated — otherwise the tail would resurrect from earlier snapshots
   * on the next server restart. Returns the removed tail for undo.
   */
  editThreadMessage(
    threadId: string,
    messageId: string,
    _content: string,
  ): {
    edited: boolean;
    removed: Array<{ id: string; role: string; content: string }>;
  } {
    this.requireThread(threadId);
    // Validate BEFORE mutating: the target must exist and be a text message.
    const runs = this.threadRuns(threadId);
    let targetIsText = false;
    for (const run of runs) {
      try {
        const parsed = JSON.parse(run.messages) as Array<{
          id?: string;
          content?: string | Array<unknown>;
        }>;
        const target = parsed.find((m) => m.id === messageId);
        if (target) {
          if (typeof target.content !== 'string')
            throw new Error('Only text messages can be edited.');
          targetIsText = true;
          break;
        }
      } catch (error) {
        if (
          error instanceof Error &&
          error.message.includes('text messages')
        )
          throw error;
        /* malformed row — keep looking */
      }
    }
    if (!targetIsText) throw new Error('Message not found in this conversation.');
    // Edit-and-resend: drop the target + tail everywhere; the client re-sends
    // the corrected content as a fresh message.
    const removed = this.truncateSnapshotsAt(threadId, messageId, {
      keepTarget: false,
    });
    return { edited: true, removed };
  }
  /**
   * Reverts in place: keeps history up to and including the given message
   * and discards the rest. Because each run row is a full snapshot, the
   * tail is removed by truncating every row that contains the target —
   * later rows are not merely deleted, or the tail would reappear from
   * remaining snapshots after a restart. Returns the removed tail for undo.
   */
  revertThreadToMessage(
    threadId: string,
    messageId: string,
  ): Array<{ id: string; role: string; content: string }> {
    this.requireThread(threadId);
    return this.truncateSnapshotsAt(threadId, messageId, {
      keepTarget: true,
    });
  }
  /**
   * Restores a previously removed tail: appends the messages back after the
   * current state as a fresh snapshot row. Used by the undo affordance
   * after revert/edit.
   */
  restoreThreadMessages(
    threadId: string,
    tail: Array<{ id: string; role: string; content: string }>,
  ): { restored: number } {
    this.requireThread(threadId);
    const last = this.threadRuns(threadId).at(-1);
    const current = last
      ? (JSON.parse(last.messages) as Array<unknown>)
      : [];
    const snapshot = [...current, ...tail];
    this.saveThreadRun({
      id: randomUUID(),
      threadId,
      agentId: last?.agentId ?? 'chat',
      parentRunId: null,
      events: JSON.stringify([
        { type: 'RESTORE', timestamp: Date.now(), count: tail.length },
      ]),
      messages: JSON.stringify(snapshot),
      // The restored snapshot must sort after the current last row, or
      // the older truncation would remain the authoritative transcript.
      createdAt: Math.max(Date.now(), (last?.createdAt ?? 0) + 1),
    });
    return { restored: tail.length };
  }
  /**
   * Snapshot-aware truncation. For every run row that contains the target
   * message, the row is truncated — keeping up to the target (inclusive when
   * keepTarget) — so no snapshot anywhere still holds the removed tail.
   * Rows predating the target are untouched (they already end before it).
   * Returns the removed tail as it existed in the newest snapshot.
   */
  private truncateSnapshotsAt(
    threadId: string,
    messageId: string,
    options: { keepTarget: boolean },
  ): Array<{ id: string; role: string; content: string }> {
    const runs = this.threadRuns(threadId);
    let removedTail: Array<{ id: string; role: string; content: string }> = [];
    let found = false;
    for (const run of runs) {
      try {
        const parsed = JSON.parse(run.messages) as Array<{
          id?: string;
          role?: string;
          content?: string | Array<unknown>;
        }>;
        const index = parsed.findIndex((m) => m.id === messageId);
        if (index === -1) continue;
        found = true;
        const cutoff = options.keepTarget ? index + 1 : index;
        const tail = parsed.slice(cutoff) as Array<{
          id: string;
          role: string;
          content: string;
        }>;
        // The newest snapshot holds the authoritative tail for undo.
        if (tail.length >= removedTail.length) removedTail = tail;
        this.db
          .prepare(
            'UPDATE local_thread_runs SET messages=? WHERE id=? AND threadId=?',
          )
          .run(JSON.stringify(parsed.slice(0, cutoff)), run.id, threadId);
      } catch {
        /* malformed row — skip */
      }
    }
    if (!found) throw new Error('Message not found in this conversation.');
    return removedTail;
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
