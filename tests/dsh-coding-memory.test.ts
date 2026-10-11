import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Store } from '../src/server/store.js';
import { WorkspaceStore } from '../src/server/workspace.js';
import { codingTools } from '../src/server/coding-tools.js';
import { SLASH_COMMANDS } from '../src/client/SlashCommandsMenu.js';
import {
  askQuestionSchema,
  askQuestionTool,
} from '../src/shared/ask-question.js';

type EditorExecute = (args: {
  command: 'view' | 'create' | 'str_replace' | 'insert' | 'undo_edit';
  path: string;
  file_text?: string;
  old_str?: string;
  new_str?: string;
  insert_line?: number;
  view_range?: number[];
}) => Promise<string>;

type BashExecute = (args: {
  command: string;
  description: string;
  workdir?: string;
  timeoutMs?: number;
}) => Promise<{
  exitCode: number;
  stdout: string;
  stderr: string;
  durationMs: number;
}>;

type SearchExecute = (args: {
  pattern: string;
  query?: string;
  maxResults?: number;
}) => Promise<{
  total: number;
  matches: Array<{ file: string; line?: number; match?: string }>;
}>;

const resources: { store?: Store; ws?: WorkspaceStore; dir: string }[] = [];

function createFixture() {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-coding-mem-test-'));
  const storePath = join(dir, 'store.sqlite');
  const wsPath = join(dir, 'ws.sqlite');
  const store = new Store(storePath);
  const ws = new WorkspaceStore(wsPath, 'owner-test');
  resources.push({ store, ws, dir });
  return { store, ws, dir };
}

afterEach(() => {
  resources.splice(0).forEach(({ store, ws, dir }) => {
    store?.close();
    ws?.close();
    rmSync(dir, { recursive: true, force: true });
  });
});

describe('DeepSeek Harness Dual-Layer Memory (Global vs Per-Session)', () => {
  it('stores per-session memories bound strictly to their threadId', () => {
    const { ws, store } = createFixture();
    const space = ws.spaces()[0]!;
    const dot = ws.createDot(space.id, 'TestDot', 'Role', true, true);
    const threadA = ws.bindThread('thread-A', dot.id, 'Thread A');
    const threadB = ws.bindThread('thread-B', dot.id, 'Thread B');

    // Global memory persists in Store
    store.saveMemory(
      'User prefers dark mode and concise summaries',
      undefined,
      'preference',
    );

    // Session memory in Thread A
    ws.saveSessionMemory(
      threadA.id,
      'Task note for thread A: refactor auth logic',
      undefined,
      'todo',
    );
    // Session memory in Thread B
    ws.saveSessionMemory(
      threadB.id,
      'Temporary context for thread B: database migration script',
      undefined,
      'context',
    );

    // Verify isolation
    const threadAMems = ws.sessionMemories(threadA.id);
    expect(threadAMems).toHaveLength(1);
    expect(threadAMems[0]?.text).toContain('refactor auth logic');
    expect(threadAMems[0]?.category).toBe('todo');

    const threadBMems = ws.sessionMemories(threadB.id);
    expect(threadBMems).toHaveLength(1);
    expect(threadBMems[0]?.text).toContain('database migration script');

    // Global memories stay accessible everywhere
    const globalMems = store.memories();
    expect(globalMems).toHaveLength(1);
    expect(globalMems[0]?.text).toContain('User prefers dark mode');

    // Thread B does not see Thread A's session memories
    expect(
      ws
        .sessionMemories(threadB.id)
        .some((m) => m.text.includes('refactor auth logic')),
    ).toBe(false);
  });

  it('cascades deletion of session memories when thread is deleted', () => {
    const { ws } = createFixture();
    const space = ws.spaces()[0]!;
    const dot = ws.createDot(space.id, 'TestDot', 'Role', true, true);
    const thread = ws.bindThread('thread-to-delete', dot.id, 'Thread');

    ws.saveSessionMemory(thread.id, 'Scratchpad note 1', undefined, 'note');
    ws.saveSessionMemory(thread.id, 'Scratchpad note 2', undefined, 'note');
    expect(ws.sessionMemories(thread.id)).toHaveLength(2);

    ws.deleteThread(thread.id);
    expect(ws.sessionMemories(thread.id)).toHaveLength(0);
  });

  it('allows clearing session memories without deleting the thread', () => {
    const { ws } = createFixture();
    const space = ws.spaces()[0]!;
    const dot = ws.createDot(space.id, 'TestDot', 'Role', true, true);
    const thread = ws.bindThread('thread-clear', dot.id, 'Thread');

    ws.saveSessionMemory(thread.id, 'Temporary note', undefined, 'note');
    expect(ws.sessionMemories(thread.id)).toHaveLength(1);

    const clearedCount = ws.clearSessionMemories(thread.id);
    expect(clearedCount).toBe(1);
    expect(ws.sessionMemories(thread.id)).toHaveLength(0);
    expect(ws.requireThread(thread.id)).toBeTruthy();
  });
});

describe('DeepSeek Harness Native Coding Tools', () => {
  it('supports str_replace_editor create, view, str_replace, insert, and undo_edit', async () => {
    const { dir, ws, store } = createFixture();
    const space = ws.spaces()[0]!;
    const dot = ws.createDot(space.id, 'Dot', 'Coder', true, true);
    const thread = ws.bindThread('thread-coder', dot.id, 'Code Thread');

    const controller = new AbortController();
    const tools = codingTools(dir, () => {}, controller.signal, {
      threadId: thread.id,
      workspace: ws,
      store,
    });

    const editorTool = tools.find((t) => t.name === 'str_replace_editor')!;
    expect(editorTool).toBeTruthy();

    // 1. Create file
    const createRes = await (editorTool.execute as EditorExecute)({
      command: 'create',
      path: 'src/index.ts',
      file_text:
        'export function greet(name: string): string {\n  return `Hello, ${name}!`;\n}\n',
    });
    expect(createRes).toContain('New file created successfully');

    // 2. View file with line numbers
    const viewRes = await (editorTool.execute as EditorExecute)({
      command: 'view',
      path: 'src/index.ts',
    });
    expect(viewRes).toContain(
      "Here's the content of src/index.ts with line numbers",
    );
    expect(viewRes).toContain('1  export function greet');

    // 3. View directory
    const viewDirRes = await (editorTool.execute as EditorExecute)({
      command: 'view',
      path: 'src',
    });
    expect(viewDirRes).toContain('Files and directories in');
    expect(viewDirRes).toContain('index.ts');

    // 4. Exact str_replace
    const replaceRes = await (editorTool.execute as EditorExecute)({
      command: 'str_replace',
      path: 'src/index.ts',
      old_str: 'return `Hello, ${name}!`;',
      new_str: 'return `Greetings, ${name}!`;',
    });
    expect(replaceRes).toContain('edited successfully');

    const afterReplaceView = await (editorTool.execute as EditorExecute)({
      command: 'view',
      path: 'src/index.ts',
    });
    expect(afterReplaceView).toContain('Greetings, ${name}!');

    // 5. Insert line
    const insertRes = await (editorTool.execute as EditorExecute)({
      command: 'insert',
      path: 'src/index.ts',
      insert_line: 0,
      new_str: '// Generated by DoshBot Coding Agent',
    });
    expect(insertRes).toContain('Inserted content successfully');

    const afterInsertView = await (editorTool.execute as EditorExecute)({
      command: 'view',
      path: 'src/index.ts',
    });
    expect(afterInsertView).toContain('// Generated by DoshBot Coding Agent');

    // 6. Undo edit
    const undoRes = await (editorTool.execute as EditorExecute)({
      command: 'undo_edit',
      path: 'src/index.ts',
    });
    expect(undoRes).toContain('reverted');
  });

  it('supports bash command execution in workspace with exit codes and stdout', async () => {
    const { dir } = createFixture();
    const controller = new AbortController();
    const tools = codingTools(dir, () => {}, controller.signal);
    const bashTool = tools.find((t) => t.name === 'bash')!;
    expect(bashTool).toBeTruthy();

    const bashRes = await (bashTool.execute as BashExecute)({
      command: 'echo "DoshBot by SafarNow Native Coding Agent"',
      description: 'Echo system identification',
    });

    expect(bashRes.exitCode).toBe(0);
    expect(bashRes.stdout).toContain('DoshBot by SafarNow Native Coding Agent');
  });

  it('supports searching workspace files by name and content', async () => {
    const { dir } = createFixture();
    writeFileSync(
      join(dir, 'sample.txt'),
      'DoshBot is built with deep reasoning\nand fast inference.\n',
    );

    const controller = new AbortController();
    const tools = codingTools(dir, () => {}, controller.signal);
    const searchTool = tools.find((t) => t.name === 'search_files')!;
    expect(searchTool).toBeTruthy();

    const searchRes = await (searchTool.execute as SearchExecute)({
      pattern: 'sample.txt',
      query: 'deep reasoning',
    });

    expect(searchRes.total).toBe(1);
    expect(searchRes.matches[0]?.file).toBe('sample.txt');
    expect(searchRes.matches[0]?.match).toContain('deep reasoning');
  });

  it('includes /mcp, /code, and /subagents in slash commands with zero icons', () => {
    const commandNames = SLASH_COMMANDS.map((c) => c.command);
    expect(commandNames).toContain('/mcp');
    expect(commandNames).toContain('/code');
    expect(commandNames).toContain('/subagents');
    for (const cmd of SLASH_COMMANDS) {
      expect((cmd as { icon?: unknown }).icon).toBeUndefined();
    }
  });

  it('enforces DeepSeek Harness coding permissions to deny bash and edits when configured', async () => {
    const { dir, ws, store } = createFixture();
    const space = ws.spaces()[0]!;
    const dot = ws.createDot(space.id, 'Dot', 'Coder', true, true);
    const thread = ws.bindThread('thread-perms', dot.id, 'Perms Thread');

    const deniedTools = codingTools(
      dir,
      () => {},
      new AbortController().signal,
      {
        threadId: thread.id,
        workspace: ws,
        store,
        permissions: { bash: 'deny', edits: 'deny' },
      },
    );

    const bashTool = deniedTools.find((t) => t.name === 'bash')!;
    const editorTool = deniedTools.find(
      (t) => t.name === 'str_replace_editor',
    )!;

    await expect(
      (bashTool.execute as BashExecute)({
        command: 'ls',
        description: 'list files',
      }),
    ).rejects.toThrow(
      'Bash command execution is denied by workspace coding permissions.',
    );

    await expect(
      (editorTool.execute as EditorExecute)({
        command: 'create',
        path: 'test.txt',
        file_text: 'hello',
      }),
    ).rejects.toThrow(
      'File modifications are denied by workspace coding permissions.',
    );
  });
});

describe('OpenCode Integration and Free Models', () => {
  it('discovers OpenCode status and categorizes free models', async () => {
    const { getOpenCodeStatus } = await import('../src/server/opencode.js');
    const status = await getOpenCodeStatus();
    expect(status).toBeDefined();
    expect(typeof status.available).toBe('boolean');
    expect(Array.isArray(status.variants)).toBe(true);
    expect(status.variants).toContain('high');
    expect(status.variants).toContain('max');

    if (status.available) {
      expect(status.freeModels.length).toBeGreaterThan(0);
      for (const m of status.freeModels) {
        expect(m.isFree).toBe(true);
        expect(m.id).toContain('opencode/');
      }
    }
  }, 30_000);
});

describe('ask_question Human-In-The-Loop Capability', () => {
  it('validates correct question parameters and options', () => {
    const valid = askQuestionSchema.safeParse({
      question: 'Which database should we use for user sessions?',
      options: ['SQLite (local-first)', 'PostgreSQL', 'Redis'],
      is_multi_select: false,
      context: 'We are designing the storage engine architecture.',
    });
    expect(valid.success).toBe(true);
    if (valid.success) {
      expect(valid.data.options).toHaveLength(3);
      expect(valid.data.is_multi_select).toBe(false);
    }
  });

  it('rejects questions with fewer than 2 options or more than 6 options', () => {
    const tooFew = askQuestionSchema.safeParse({
      question: 'Should we proceed?',
      options: ['Yes'],
    });
    expect(tooFew.success).toBe(false);

    const tooMany = askQuestionSchema.safeParse({
      question: 'Pick a number',
      options: ['1', '2', '3', '4', '5', '6', '7'],
    });
    expect(tooMany.success).toBe(false);
  });

  it('provides a valid copilot tool specification for ask_question', () => {
    expect(askQuestionTool.name).toBe('ask_question');
    expect(typeof askQuestionTool.description).toBe('string');
    expect(askQuestionTool.parameters).toBeDefined();
    expect(askQuestionTool.parameters.properties?.question).toBeDefined();
    expect(askQuestionTool.parameters.properties?.options).toBeDefined();
  });
});
