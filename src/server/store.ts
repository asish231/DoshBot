import { DatabaseSync } from 'node:sqlite';
import { randomUUID } from 'node:crypto';
import { mkdirSync, rmSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import type {
  Action,
  Artifact,
  Detail,
  Memory,
  Monitor,
  Result,
  Run,
  Settings,
  Task,
  TaskEvent,
  Upload,
} from '../shared/types.js';
import { SkillsStore } from './skills-store.js';
import { fuzzyRank } from './fuzzy.js';

export type Claim = Task & { lease: string };
const defaults: Settings = {
  name: 'Dot',
  paused: false,
  researchAllowed: true,
  memoryAllowed: true,
  codingDirectory: null,
  codingPermissions: JSON.stringify({ bash: 'auto', edits: 'auto' }),
  opencodeVariant: 'high',
};
/** Most bytes one uploaded file may occupy on disk. */
export const MAX_UPLOAD_BYTES = 50 * 1024 * 1024;
export class Store {
  private db: DatabaseSync;
  /** Skill library; null only when skills storage is intentionally disabled. */
  readonly skills: SkillsStore | null;
  /** Directory holding uploaded file blobs. */
  private readonly uploadsDir: string;
  /** Identity owning rows created before accounts existed. */
  private readonly bootstrapOwnerId: string;
  constructor(
    path: string,
    options?: {
      skillsDir?: string;
      uploadsDir?: string;
      ownerId?: string;
    },
  ) {
    if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
    this.db = new DatabaseSync(path);
    this.skills = options?.skillsDir
      ? new SkillsStore(options.skillsDir)
      : null;
    this.uploadsDir = options?.uploadsDir ?? join(dirname(path), 'uploads');
    this.bootstrapOwnerId = options?.ownerId ?? 'opendots-owner';
    mkdirSync(this.uploadsDir, { recursive: true });
    this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;
      CREATE TABLE IF NOT EXISTS settings (id INTEGER PRIMARY KEY CHECK(id=1), value TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS tasks (id TEXT PRIMARY KEY, prompt TEXT NOT NULL, status TEXT NOT NULL, intervalSeconds INTEGER, nextRunAt INTEGER, createdAt INTEGER NOT NULL, updatedAt INTEGER NOT NULL, error TEXT, lease TEXT, leaseUntil INTEGER);
      CREATE TABLE IF NOT EXISTS runs (id TEXT PRIMARY KEY, taskId TEXT NOT NULL, status TEXT NOT NULL, startedAt INTEGER NOT NULL, finishedAt INTEGER, result TEXT, error TEXT);
      CREATE TABLE IF NOT EXISTS events (id INTEGER PRIMARY KEY AUTOINCREMENT, taskId TEXT NOT NULL, runId TEXT, text TEXT NOT NULL, createdAt INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS memories (id TEXT PRIMARY KEY, text TEXT NOT NULL, createdAt INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS memory_links (fromId TEXT NOT NULL, toId TEXT NOT NULL, relation TEXT NOT NULL, createdAt INTEGER NOT NULL, PRIMARY KEY (fromId, toId));
      CREATE TABLE IF NOT EXISTS uploads (id TEXT PRIMARY KEY, name TEXT NOT NULL, mime TEXT NOT NULL, size INTEGER NOT NULL, threadId TEXT, createdAt INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS monitors (id TEXT PRIMARY KEY, url TEXT NOT NULL, threadId TEXT NOT NULL, prompt TEXT NOT NULL, intervalSeconds INTEGER NOT NULL, status TEXT NOT NULL, lastHash TEXT, lastCheckedAt INTEGER, lastError TEXT, createdAt INTEGER NOT NULL, updatedAt INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS artifacts (id TEXT PRIMARY KEY, threadId TEXT, title TEXT NOT NULL, kind TEXT NOT NULL, language TEXT, content TEXT NOT NULL, createdAt INTEGER NOT NULL);
      CREATE INDEX IF NOT EXISTS tasks_due ON tasks(status, nextRunAt);
      CREATE INDEX IF NOT EXISTS runs_task ON runs(taskId, startedAt);
      CREATE INDEX IF NOT EXISTS events_task ON events(taskId, id);`);
    if (
      !this.db
        .prepare('PRAGMA table_info(memories)')
        .all()
        .some((col: { name?: string }) => col.name === 'category')
    ) {
      this.db.exec('ALTER TABLE memories ADD COLUMN category TEXT');
    }
    // Per-user ownership: existing rows belong to the bootstrap owner.
    if (
      !this.db
        .prepare('PRAGMA table_info(memories)')
        .all()
        .some((col: { name?: string }) => col.name === 'ownerId')
    ) {
      this.db.exec('ALTER TABLE memories ADD COLUMN ownerId TEXT');
      this.db
        .prepare('UPDATE memories SET ownerId=? WHERE ownerId IS NULL')
        .run(this.bootstrapOwnerId);
    }
    if (
      !this.db
        .prepare('PRAGMA table_info(tasks)')
        .all()
        .some((col: { name?: string }) => col.name === 'ownerId')
    ) {
      this.db.exec('ALTER TABLE tasks ADD COLUMN ownerId TEXT');
      this.db
        .prepare('UPDATE tasks SET ownerId=? WHERE ownerId IS NULL')
        .run(this.bootstrapOwnerId);
    }
    this.db
      .prepare('INSERT OR IGNORE INTO settings VALUES (1, ?)')
      .run(JSON.stringify(defaults));
  }
  close() {
    this.db.close();
  }
  private transaction<T>(fn: () => T): T {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const value = fn();
      this.db.exec('COMMIT');
      return value;
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
  }
  settings(): Settings {
    const row = this.db
      .prepare('SELECT value FROM settings WHERE id=1')
      .get() as { value: string };
    return JSON.parse(row.value) as Settings;
  }
  updateSettings(patch: Partial<Settings>): Settings {
    return this.transaction(() => {
      const previous = this.settings();
      const settings = { ...previous, ...patch };
      this.db
        .prepare('UPDATE settings SET value=? WHERE id=1')
        .run(JSON.stringify(settings));
      if (
        (!previous.paused && settings.paused) ||
        (previous.researchAllowed && !settings.researchAllowed) ||
        (previous.memoryAllowed && !settings.memoryAllowed)
      ) {
        const running = this.tasks().filter((t) => t.status === 'running');
        for (const task of running) {
          this.invalidate(
            task,
            'queued',
            'Run stopped because settings changed.',
          );
        }
      }
      return settings;
    });
  }
  tasks(ownerId?: string): Task[] {
    return (
      ownerId
        ? this.db
            .prepare('SELECT * FROM tasks WHERE ownerId=? ORDER BY createdAt DESC')
            .all(ownerId)
        : this.db
            .prepare('SELECT * FROM tasks ORDER BY createdAt DESC')
            .all()
    ) as unknown as Task[];
  }
  task(id: string): Task | undefined {
    return this.db
      .prepare('SELECT * FROM tasks WHERE id=?')
      .get(id) as unknown as Task | undefined;
  }
  createTask(
    prompt: string,
    intervalSeconds: number | null = null,
    ownerId: string = this.bootstrapOwnerId,
  ): Task {
    const now = Date.now();
    const id = randomUUID();
    this.db
      .prepare(
        "INSERT INTO tasks VALUES (?, ?, 'queued', ?, NULL, ?, ?, NULL, NULL, NULL, ?)",
      )
      .run(id, prompt, intervalSeconds, now, now, ownerId);
    this.event(id, null, 'Task added to the research queue.');
    return this.task(id)!;
  }
  detail(id: string): Detail | undefined {
    const task = this.task(id);
    if (!task) return undefined;
    const rows = this.db
      .prepare(
        'SELECT * FROM runs WHERE taskId=? ORDER BY startedAt DESC, rowid DESC',
      )
      .all(id) as unknown as (Omit<Run, 'result'> & {
      result: string | null;
    })[];
    return {
      task,
      runs: rows.map((row) => ({
        ...row,
        result: row.result ? (JSON.parse(row.result) as Result) : null,
      })),
      events: this.db
        .prepare('SELECT * FROM events WHERE taskId=? ORDER BY id')
        .all(id) as unknown as TaskEvent[],
    };
  }
  event(taskId: string, runId: string | null, text: string) {
    this.db
      .prepare(
        'INSERT INTO events (taskId, runId, text, createdAt) VALUES (?, ?, ?, ?)',
      )
      .run(taskId, runId, text, Date.now());
  }
  private invalidate(task: Task, status: string, reason: string) {
    const now = Date.now();
    if (task.lease)
      this.db
        .prepare(
          "UPDATE runs SET status='interrupted', finishedAt=?, error=? WHERE id=? AND status='running'",
        )
        .run(now, reason, task.lease);
    this.db
      .prepare(
        'UPDATE tasks SET status=?, lease=NULL, leaseUntil=NULL, updatedAt=? WHERE id=?',
      )
      .run(status, now, task.id);
    this.event(task.id, task.lease, reason);
  }
  action(id: string, action: Action): Task | undefined {
    return this.transaction(() => {
      const task = this.task(id);
      if (!task) return undefined;
      if (action === 'run' && task.status === 'running') return task;
      const status =
        action === 'run'
          ? 'queued'
          : action === 'pause'
            ? 'paused'
            : 'cancelled';
      this.invalidate(
        task,
        status,
        action === 'run' ? 'Task queued for a new run.' : `Task ${status}.`,
      );
      this.db
        .prepare('UPDATE tasks SET error=NULL, nextRunAt=NULL WHERE id=?')
        .run(id);
      return this.task(id);
    });
  }
  schedule(id: string, intervalSeconds: number | null): Task | undefined {
    const task = this.task(id);
    if (!task) return undefined;
    const next =
      intervalSeconds && task.status === 'completed'
        ? Date.now() + intervalSeconds * 1000
        : null;
    this.db
      .prepare(
        'UPDATE tasks SET intervalSeconds=?, nextRunAt=?, updatedAt=? WHERE id=?',
      )
      .run(intervalSeconds, next, Date.now(), id);
    this.event(
      id,
      null,
      intervalSeconds
        ? `Repeats every ${intervalSeconds / 60} minutes after a successful run.`
        : 'Repeat schedule removed.',
    );
    return this.task(id);
  }
  deleteTask(id: string): boolean {
    return this.transaction(() => {
      const task = this.task(id);
      if (!task) return false;
      this.db.prepare('DELETE FROM events WHERE taskId=?').run(id);
      this.db.prepare('DELETE FROM runs WHERE taskId=?').run(id);
      this.db.prepare('DELETE FROM tasks WHERE id=?').run(id);
      return true;
    });
  }
  claim(now = Date.now()): Claim | null {
    return this.transaction(() => {
      const settings = this.settings();
      if (settings.paused || !settings.researchAllowed) return null;
      const expired = this.db
        .prepare("SELECT * FROM tasks WHERE status='running' AND leaseUntil<=?")
        .all(now) as unknown as Task[];
      for (const task of expired)
        this.invalidate(
          task,
          'queued',
          'Previous worker lease expired; safely retrying.',
        );
      const task = this.db
        .prepare(
          "SELECT * FROM tasks WHERE status='queued' OR (status='completed' AND nextRunAt IS NOT NULL AND nextRunAt<=?) ORDER BY createdAt LIMIT 1",
        )
        .get(now) as unknown as Task | undefined;
      if (!task) return null;
      const lease = randomUUID();
      this.db
        .prepare(
          "UPDATE tasks SET status='running', lease=?, leaseUntil=?, nextRunAt=NULL, error=NULL, updatedAt=? WHERE id=?",
        )
        .run(lease, now + 180_000, now, task.id);
      this.db
        .prepare(
          "INSERT INTO runs VALUES (?, ?, 'running', ?, NULL, NULL, NULL)",
        )
        .run(lease, task.id, now);
      this.event(task.id, lease, 'Research worker started.');
      return { ...this.task(task.id)!, lease };
    });
  }
  owns(claim: Claim): boolean {
    const task = this.task(claim.id);
    return task?.status === 'running' && task.lease === claim.lease;
  }
  finish(claim: Claim, result: Result, now = Date.now()): boolean {
    return this.transaction(() => {
      if (!this.owns(claim)) return false;
      const task = this.task(claim.id)!;
      this.db
        .prepare(
          "UPDATE runs SET status='completed', finishedAt=?, result=? WHERE id=?",
        )
        .run(now, JSON.stringify(result), claim.lease);
      this.db
        .prepare(
          "UPDATE tasks SET status='completed', lease=NULL, leaseUntil=NULL, updatedAt=?, nextRunAt=? WHERE id=?",
        )
        .run(
          now,
          task.intervalSeconds ? now + task.intervalSeconds * 1000 : null,
          claim.id,
        );
      this.event(
        claim.id,
        claim.lease,
        result.sample
          ? 'Fictional sample brief ready.'
          : 'Research brief ready.',
      );
      return true;
    });
  }
  release(claim: Claim, reason: string) {
    this.transaction(() => {
      if (this.owns(claim)) this.invalidate(claim, 'queued', reason);
    });
  }
  fail(claim: Claim, error: string) {
    this.transaction(() => {
      if (!this.owns(claim)) return;
      const now = Date.now();
      this.db
        .prepare(
          "UPDATE runs SET status='failed', finishedAt=?, error=? WHERE id=?",
        )
        .run(now, error, claim.lease);
      this.db
        .prepare(
          "UPDATE tasks SET status='failed', lease=NULL, leaseUntil=NULL, error=?, updatedAt=? WHERE id=?",
        )
        .run(error, now, claim.id);
      this.event(claim.id, claim.lease, error);
    });
  }
  memories(category?: string, ownerId?: string): Memory[] {
    const ownerClause = ownerId ? ' AND ownerId=?' : '';
    if (category) {
      return this.db
        .prepare(
          `SELECT * FROM memories WHERE category=?${ownerClause} ORDER BY createdAt DESC`,
        )
        .all(
          ...(ownerId ? [category, ownerId] : [category]),
        ) as unknown as Memory[];
    }
    return this.db
      .prepare(
        `SELECT * FROM memories WHERE 1=1${ownerClause} ORDER BY createdAt DESC`,
      )
      .all(...(ownerId ? [ownerId] : [])) as unknown as Memory[];
  }
  saveMemory(
    text: string,
    id: string = randomUUID(),
    category?: string,
    ownerId: string = this.bootstrapOwnerId,
  ): Memory {
    this.db
      .prepare(
        'INSERT INTO memories (id, text, category, createdAt, ownerId) VALUES (?, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET text=excluded.text, category=COALESCE(excluded.category, memories.category)',
      )
      .run(id, text, category || 'general', Date.now(), ownerId);
    return this.db
      .prepare('SELECT * FROM memories WHERE id=?')
      .get(id) as unknown as Memory;
  }
  deleteMemory(id: string): boolean {
    return this.transaction(() => {
      const deleted =
        this.db.prepare('DELETE FROM memories WHERE id=?').run(id).changes > 0;
      if (deleted) {
        // Cascade: a node leaving the graph takes its edges with it.
        this.db
          .prepare('DELETE FROM memory_links WHERE fromId=? OR toId=?')
          .run(id, id);
      }
      return deleted;
    });
  }
  linkMemories(fromId: string, toId: string, relation = 'relates_to') {
    if (fromId === toId) throw new Error('Cannot link a memory to itself.');
    const ids = this.db
      .prepare('SELECT id FROM memories WHERE id IN (?, ?)')
      .all(fromId, toId) as Array<{ id: string }>;
    if (ids.length < 2)
      throw new Error('Both memories must exist before linking.');
    const now = Date.now();
    this.db
      .prepare(
        'INSERT INTO memory_links (fromId, toId, relation, createdAt) VALUES (?, ?, ?, ?) ON CONFLICT(fromId, toId) DO UPDATE SET relation=excluded.relation',
      )
      .run(fromId, toId, relation || 'relates_to', now);
    return this.memoryLinks(fromId);
  }
  unlinkMemories(fromId: string, toId: string): boolean {
    return (
      this.db
        .prepare('DELETE FROM memory_links WHERE fromId=? AND toId=?')
        .run(fromId, toId).changes > 0
    );
  }
  memoryLinks(id: string): Array<{ toId: string; relation: string }> {
    return this.db
      .prepare('SELECT toId, relation FROM memory_links WHERE fromId=? ORDER BY createdAt')
      .all(id) as Array<{ toId: string; relation: string }>;
  }
  /** Graph view: category segments with their memories and all edges. */
  memoryGraph(ownerId?: string): {
    segments: Array<{ category: string; count: number; memoryIds: string[] }>;
    edges: Array<{ fromId: string; toId: string; relation: string }>;
    total: number;
  } {
    // Oldest-first: segments appear in the order memories were created,
    // independent of same-millisecond timestamp ties.
    const memories = (
      ownerId
        ? this.db
            .prepare(
              'SELECT * FROM memories WHERE ownerId=? ORDER BY createdAt ASC, rowid ASC',
            )
            .all(ownerId)
        : this.db
            .prepare(
              'SELECT * FROM memories ORDER BY createdAt ASC, rowid ASC',
            )
            .all()
    ) as unknown as Memory[];
    const byCategory = new Map<string, string[]>();
    for (const memory of memories) {
      const category = memory.category || 'general';
      byCategory.set(category, [...(byCategory.get(category) ?? []), memory.id]);
    }
    const visible = new Set(memories.map((memory) => memory.id));
    const edges = (
      this.db
        .prepare('SELECT fromId, toId, relation FROM memory_links ORDER BY createdAt')
        .all() as Array<{ fromId: string; toId: string; relation: string }>
    ).filter((edge) => visible.has(edge.fromId) && visible.has(edge.toId));
    return {
      segments: [...byCategory.entries()]
        .map(([category, memoryIds]) => ({
          category,
          count: memoryIds.length,
          memoryIds,
        }))
        .sort((a, b) => b.count - a.count),
      edges,
      total: memories.length,
    };
  }
  /** Fuzzy search over global memories, strongest matches first. */
  searchMemories(query: string, limit = 10, ownerId?: string) {
    return fuzzyRank(
      query,
      this.memories(undefined, ownerId).map((memory) => ({
        id: memory.id,
        text: memory.text,
        category: memory.category ?? null,
        createdAt: memory.createdAt,
      })),
      limit,
    ).map((match) => ({
      ...match.item,
      score: match.score,
      strength: match.strength,
      links: this.memoryLinks(match.item.id),
    }));
  }
  /** Uploaded files: metadata here, bytes on disk under uploadsDir/<id>. */
  uploads(): Upload[] {
    return this.db
      .prepare('SELECT * FROM uploads ORDER BY createdAt DESC')
      .all() as unknown as Upload[];
  }
  upload(id: string): Upload | undefined {
    return this.db
      .prepare('SELECT * FROM uploads WHERE id=?')
      .get(id) as unknown as Upload | undefined;
  }
  uploadPath(id: string): string {
    return join(this.uploadsDir, id);
  }
  async saveUpload(
    name: string,
    mime: string,
    bytes: Buffer | Uint8Array,
    threadId: string | null = null,
  ): Promise<Upload> {
    const size = bytes.byteLength;
    if (size > MAX_UPLOAD_BYTES)
      throw new Error(
        `That file is ${size} bytes; the limit is ${MAX_UPLOAD_BYTES}.`,
      );
    const id = randomUUID();
    const file = join(this.uploadsDir, id);
    await writeFile(file, bytes);
    this.db
      .prepare(
        'INSERT INTO uploads (id, name, mime, size, threadId, createdAt) VALUES (?, ?, ?, ?, ?, ?)',
      )
      .run(id, name, mime, size, threadId, Date.now());
    return this.upload(id)!;
  }
  deleteUpload(id: string): boolean {
    const existed = this.upload(id) !== undefined;
    if (!existed) return false;
    this.db.prepare('DELETE FROM uploads WHERE id=?').run(id);
    rmSync(join(this.uploadsDir, id), { force: true });
    return true;
  }
  /** Site monitors: event-based triggers that watch a URL and fire a turn in
   *  the bound conversation when its content changes. */
  createMonitor(
    url: string,
    threadId: string,
    prompt: string,
    intervalSeconds: number,
  ): Monitor {
    const id = randomUUID();
    const now = Date.now();
    this.db
      .prepare(
        "INSERT INTO monitors (id, url, threadId, prompt, intervalSeconds, status, lastHash, lastCheckedAt, lastError, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?, 'paused', NULL, NULL, NULL, ?, ?)",
      )
      .run(id, url, threadId, prompt, intervalSeconds, now, now);
    return this.monitor(id)!;
  }
  monitors(): Monitor[] {
    return this.db
      .prepare('SELECT * FROM monitors ORDER BY createdAt DESC')
      .all() as unknown as Monitor[];
  }
  monitor(id: string): Monitor | undefined {
    return this.db
      .prepare('SELECT * FROM monitors WHERE id=?')
      .get(id) as unknown as Monitor | undefined;
  }
  monitorAction(id: string, action: 'start' | 'pause'): Monitor | undefined {
    this.db
      .prepare(
        "UPDATE monitors SET status=?, updatedAt=? WHERE id=?",
      )
      .run(action === 'start' ? 'active' : 'paused', Date.now(), id);
    return this.monitor(id);
  }
  recordMonitorCheck(
    id: string,
    hash: string | null,
    error: string | null,
  ): void {
    this.db
      .prepare(
        'UPDATE monitors SET lastHash=COALESCE(?, lastHash), lastCheckedAt=?, lastError=?, updatedAt=? WHERE id=?',
      )
      .run(hash, Date.now(), error, Date.now(), id);
  }
  deleteMonitor(id: string): boolean {
    return this.db.prepare('DELETE FROM monitors WHERE id=?').run(id).changes > 0;
  }
  /** In-chat artifacts: docs and code the Dot creates that render live in the
   *  chat's artifact panel — no local folder involved. */
  saveArtifact(
    title: string,
    kind: 'markdown' | 'code' | 'text',
    content: string,
    language: string | null,
    threadId: string | null,
  ): Artifact {
    const id = randomUUID();
    this.db
      .prepare(
        'INSERT INTO artifacts (id, threadId, title, kind, language, content, createdAt) VALUES (?, ?, ?, ?, ?, ?, ?)',
      )
      .run(id, threadId, title, kind, language, content, Date.now());
    return this.artifact(id)!;
  }
  artifacts(threadId?: string): Artifact[] {
    return threadId
      ? (this.db
          .prepare(
            'SELECT * FROM artifacts WHERE threadId=? ORDER BY createdAt DESC',
          )
          .all(threadId) as unknown as Artifact[])
      : (this.db
          .prepare('SELECT * FROM artifacts ORDER BY createdAt DESC')
          .all() as unknown as Artifact[]);
  }
  artifact(id: string): Artifact | undefined {
    return this.db
      .prepare('SELECT * FROM artifacts WHERE id=?')
      .get(id) as unknown as Artifact | undefined;
  }
  deleteArtifact(id: string): boolean {
    return (
      this.db.prepare('DELETE FROM artifacts WHERE id=?').run(id).changes > 0
    );
  }
}
