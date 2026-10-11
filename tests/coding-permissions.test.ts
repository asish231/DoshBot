import { describe, expect, it } from 'vitest';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { codingTools } from '../src/server/coding-tools.js';
import { Store } from '../src/server/store.js';
import { WorkspaceStore } from '../src/server/workspace.js';

type Execute = (args: Record<string, unknown>) => Promise<unknown>;

function makeTools(permissions: { bash: string; edits: string }) {
  const root = mkdtempSync(join(tmpdir(), 'doshbot-ask-'));
  const store = new Store(':memory:');
  const workspace = new WorkspaceStore(':memory:', 'owner');
  const tools = codingTools(root, () => {}, new AbortController().signal, {
    threadId: 't',
    workspace,
    store,
    permissions: permissions as never,
  });
  const byName = (name: string) => {
    const tool = tools.find((t) => t.name === name);
    if (!tool) throw new Error(`missing tool ${name}`);
    return tool.execute as unknown as Execute;
  };
  return { root, store, workspace, byName };
}

describe('coding workspace path containment', () => {
  it('blocks file views that escape the connected folder', async () => {
    const { byName } = makeTools({ bash: 'auto', edits: 'auto' });
    await expect(
      byName('str_replace_editor')({
        command: 'view',
        path: '../../../../../etc/hostname',
      }),
    ).rejects.toThrow(/escapes the connected workspace/);
  });

  it('blocks writes outside the workspace even with absolute paths', async () => {
    const { byName } = makeTools({ bash: 'auto', edits: 'auto' });
    await expect(
      byName('str_replace_editor')({
        command: 'create',
        path: join(tmpdir(), 'escape-test.txt'),
        file_text: 'nope',
      }),
    ).rejects.toThrow(/escapes the connected workspace/);
  });

  it('allows paths inside the workspace', async () => {
    const { root, byName } = makeTools({ bash: 'auto', edits: 'auto' });
    writeFileSync(join(root, 'ok.txt'), 'hello');
    const result = (await byName('str_replace_editor')({
      command: 'view',
      path: 'ok.txt',
    })) as string;
    expect(result).toContain('hello');
  });
});

describe("'ask' coding permission enforcement", () => {
  it('blocks file edits while ask mode is on', async () => {
    const { byName } = makeTools({ bash: 'auto', edits: 'ask' });
    await expect(
      byName('str_replace_editor')({
        command: 'create',
        path: 'test.txt',
        file_text: 'hello',
      }),
    ).rejects.toThrow(/Ask Confirmation/);
  });

  it('still allows read-only file views in ask mode', async () => {
    const { root, byName } = makeTools({ bash: 'auto', edits: 'ask' });
    writeFileSync(join(root, 'readme.md'), '# docs');
    const result = (await byName('str_replace_editor')({
      command: 'view',
      path: 'readme.md',
    })) as string;
    expect(result).toContain('# docs');
  });

  it('allows read-only bash but blocks mutating bash in ask mode', async () => {
    const { byName } = makeTools({ bash: 'ask', edits: 'auto' });
    const listing = (await byName('bash')({
      command: 'ls',
      description: 'list files',
    })) as { exitCode: number };
    expect(listing.exitCode).toBe(0);
    await expect(
      byName('bash')({ command: 'rm -rf /', description: 'destructive' }),
    ).rejects.toThrow(/Ask Confirmation/);
    await expect(
      byName('bash')({
        command: 'echo hi > file.txt',
        description: 'write a file',
      }),
    ).rejects.toThrow(/Ask Confirmation/);
  });

  it('blocks the code interpreter in ask mode', async () => {
    const { byName } = makeTools({ bash: 'ask', edits: 'auto' });
    await expect(
      byName('code_interpreter')({
        language: 'javascript',
        code: 'console.log(1)',
        description: 'print one',
      }),
    ).rejects.toThrow(/Ask Confirmation/);
  });
});
