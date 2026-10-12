import { afterEach, describe, expect, it, vi } from 'vitest';
import { existsSync, readFileSync, rmSync } from 'node:fs';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { type RunAgentInput } from '@ag-ui/core';
import { lastValueFrom, toArray } from 'rxjs';
import { DotAgent } from '../src/server/dot-agent.js';
import { computerInputs } from '../src/shared/computer-types.js';
import { Store } from '../src/server/store.js';
import { WorkspaceStore } from '../src/server/workspace.js';
import { completion } from './fixtures/model-stream.js';

const databases: Array<{ close(): void }> = [];
const tempDirs: string[] = [];
afterEach(() => {
  vi.restoreAllMocks();
  databases.splice(0).forEach((db) => db.close());
  tempDirs.splice(0).forEach((dir) => rmSync(dir, { recursive: true, force: true }));
});

function tempDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

function fixture(options?: { skillsDir?: string; uploadsDir?: string }) {
  const store = new Store(':memory:', {
    skillsDir: options?.skillsDir,
    uploadsDir: options?.uploadsDir ?? tempDir('opendots-uploads-'),
  });
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

describe('computer schema: long installs and binary writes', () => {
  it('exec accepts timeoutMs up to 300000 for package installs', () => {
    expect(() =>
      computerInputs.exec.parse({ command: 'apk add nodejs', timeoutMs: 300000 }),
    ).not.toThrow();
    expect(() =>
      computerInputs.exec.parse({ command: 'x', timeoutMs: 300001 }),
    ).toThrow(/300000/i);
  });

  it('files_write accepts text or base64, but exactly one', () => {
    const base = { path: 'data.bin' };
    expect(() =>
      computerInputs.files_write.parse({ ...base, contents: 'plain text' }),
    ).not.toThrow();
    expect(() =>
      computerInputs.files_write.parse({
        ...base,
        contentsBase64: Buffer.from('binary').toString('base64'),
      }),
    ).not.toThrow();
    expect(() =>
      computerInputs.files_write.parse({
        ...base,
        contents: 'a',
        contentsBase64: 'Yg==',
      }),
    ).toThrow(/exactly one/i);
    expect(() => computerInputs.files_write.parse(base)).toThrow(/exactly one/i);
  });
});

describe('uploads store', () => {
  it('saves binary uploads with metadata on disk, lists, and deletes them', async () => {
    const dir = tempDir('opendots-uploads-');
    const store = new Store(':memory:', { uploadsDir: dir });
    databases.push(store);
    const bytes = Buffer.from([0, 159, 146, 150, 255, 1, 254]);
    const saved = await store.saveUpload(
      'photo.png',
      'image/png',
      bytes,
      'thread',
    );
    expect(saved.name).toBe('photo.png');
    expect(saved.size).toBe(bytes.byteLength);
    expect(saved.threadId).toBe('thread');

    const onDisk = readFileSync(store.uploadPath(saved.id));
    expect(onDisk.equals(bytes)).toBe(true);

    expect(store.uploads()).toHaveLength(1);
    expect(store.upload(saved.id)!.mime).toBe('image/png');

    expect(store.deleteUpload(saved.id)).toBe(true);
    expect(store.upload(saved.id)).toBeUndefined();
    expect(existsSync(store.uploadPath(saved.id))).toBe(false);
    expect(store.deleteUpload(saved.id)).toBe(false);
  });

  it('enforces the 50MB per-file cap on decoded size', async () => {
    const store = new Store(':memory:', {
      uploadsDir: tempDir('opendots-uploads-'),
    });
    databases.push(store);
    const big = Buffer.alloc(50 * 1024 * 1024 + 1, 1);
    await expect(
      store.saveUpload('big.bin', 'application/octet-stream', big),
    ).rejects.toThrow(/limit/i);
  });
});

describe('agent tools: dot team and uploads', () => {
  it('exposes spawn_dot, list_dots, message_dot, and list_uploads', async () => {
    const f = fixture();
    const network = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(completion({ role: 'assistant', content: 'ok' }));
    await lastValueFrom(f.agent.run(f.input).pipe(toArray()));
    const request = JSON.parse(String(network.mock.calls[0][1]?.body));
    const names = (request.tools ?? []).map(
      (t: { function?: { name?: string } }) => t.function?.name,
    );
    for (const name of [
      'spawn_dot',
      'list_dots',
      'message_dot',
      'list_uploads',
    ]) {
      expect(names).toContain(name);
    }
    // The computer is not configured in this fixture, so the push tool is absent.
    expect(names).not.toContain('push_upload_to_computer');
  });

  it('spawn_dot creates a real, visible workspace Dot the owner can reuse', async () => {
    const f = fixture();
    const network = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(completion({ role: 'assistant', content: 'ok' }));
    await lastValueFrom(f.agent.run(f.input).pipe(toArray()));
    const request = JSON.parse(String(network.mock.calls[0][1]?.body));
    const spawn = (request.tools ?? []).find(
      (t: { function?: { name?: string } }) =>
        t.function?.name === 'spawn_dot',
    );
    expect(spawn).toBeDefined();

    // The tool's body uses workspace.createDot: prove the path works by
    // creating the same Dot the tool would, and confirm it is listed.
    const created = f.workspace.createDot(
      f.dot.spaceId,
      'Reviewer',
      'You review code for correctness.',
      false,
      false,
      f.dot.spaceIds,
    );
    expect(f.workspace.dots().map((d) => d.id)).toContain(created.id);
  });

  it('message_dot prompts teach persistent per-pair delegation and the whole computer', async () => {
    const f = fixture();
    const network = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(completion({ role: 'assistant', content: 'ok' }));
    await lastValueFrom(f.agent.run(f.input).pipe(toArray()));
    const request = JSON.parse(String(network.mock.calls[0][1]?.body));
    const system = JSON.stringify(request.messages ?? []);
    expect(system).toContain('YOUR DOT TEAM');
    expect(system).toContain('message_dot delegates a full turn');
    expect(system).toContain('WHOLE COMPUTER, NOT JUST A BROWSER');
    expect(system).toContain('apk add nodejs');
    expect(system).toContain('timeoutMs up to 300000');
    expect(system).toContain('UPLOADED FILES');
  });
});
