import { describe, expect, it } from 'vitest';
import { buildCodexArgs } from '../src/server/codex.js';

describe('buildCodexArgs', () => {
  it('builds a minimal non-interactive run with workspace autonomy', () => {
    expect(buildCodexArgs({ message: 'fix it' }, '/tmp/out.md')).toEqual([
      'exec',
      '--skip-git-repo-check',
      '--approve-for-me',
      '-o',
      '/tmp/out.md',
      'fix it',
    ]);
  });

  it('scopes the run to the workspace directory', () => {
    const args = buildCodexArgs(
      { message: 'fix it', workdir: '/Users/you/proj' },
      '/tmp/out.md',
    );
    expect(args.slice(0, 3)).toEqual(['exec', '-C', '/Users/you/proj']);
  });

  it('passes through model and local OSS provider selection', () => {
    const args = buildCodexArgs(
      { message: 'fix it', model: 'gpt-5', localProvider: 'ollama' },
      '/tmp/out.md',
    );
    expect(args).toContain('gpt-5');
    expect(args).toEqual(
      expect.arrayContaining(['--oss', '--local-provider', 'ollama']),
    );
  });

  it('omits auto-approval in read-only sandboxes', () => {
    const args = buildCodexArgs(
      { message: 'review this', sandbox: 'read-only' },
      '/tmp/out.md',
    );
    expect(args).toEqual(
      expect.arrayContaining(['-s', 'read-only']),
    );
    expect(args).not.toContain('--approve-for-me');
  });
});
