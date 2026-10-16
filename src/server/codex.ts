import { execFile, spawn } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

export interface CodexStatus {
  available: boolean;
  binaryPath?: string;
  version?: string;
  lastChecked: number;
}

let cachedStatus: CodexStatus | null = null;
let lastCheckTime = 0;
const CACHE_TTL_MS = 120_000; // 2 minutes

/** Finds the Codex CLI binary on the host system. */
export async function findCodexBinary(): Promise<string | null> {
  const commonPaths = [
    '/opt/homebrew/bin/codex',
    '/usr/local/bin/codex',
    join(homedir(), '.local/bin/codex'),
  ];

  for (const p of commonPaths) {
    if (existsSync(p)) {
      return p;
    }
  }

  try {
    const { stdout } = await execFileAsync('which', ['codex']);
    const bin = stdout.trim().split('\n')[0]?.trim() ?? '';
    if (bin && existsSync(bin)) {
      return bin;
    }
  } catch {
    // not in path
  }

  return null;
}

/** Inspects and returns Codex CLI availability for the Settings UI. */
export async function getCodexStatus(
  forceRefresh = false,
): Promise<CodexStatus> {
  const now = Date.now();
  if (!forceRefresh && cachedStatus && now - lastCheckTime < CACHE_TTL_MS) {
    return cachedStatus;
  }

  const binaryPath = await findCodexBinary();
  if (!binaryPath) {
    cachedStatus = { available: false, lastChecked: now };
    lastCheckTime = now;
    return cachedStatus;
  }

  let version: string | undefined;
  try {
    const { stdout } = await execFileAsync(binaryPath, ['--version'], {
      timeout: 8000,
    });
    version = stdout.trim().split('\n')[0]?.trim() || 'installed';
  } catch {
    version = 'installed';
  }

  cachedStatus = { available: true, binaryPath, version, lastChecked: now };
  lastCheckTime = now;
  return cachedStatus;
}

export interface CodexRunOptions {
  message: string;
  model?: string;
  /** Local OSS provider served on this machine (Ollama / LM Studio). */
  localProvider?: 'ollama' | 'lmstudio';
  /** Codex sandbox for model-run shell commands. Defaults to workspace-write. */
  sandbox?: 'read-only' | 'workspace-write';
  workdir?: string;
  timeoutMs?: number;
}

export interface CodexRunResult {
  text: string;
  error?: string;
}

/**
 * Builds the `codex exec` argv for a non-interactive run. Pure (no I/O) so
 * the agent wiring stays testable without the CLI installed.
 */
export function buildCodexArgs(
  options: Pick<
    CodexRunOptions,
    'message' | 'model' | 'localProvider' | 'sandbox' | 'workdir'
  >,
  outFile: string,
): string[] {
  const args: string[] = ['exec'];
  const workdir = (options.workdir || '').trim();
  if (workdir) {
    args.push('-C', workdir);
  }
  // Outside a repo (or in one the owner did not pick) the CLI refuses to
  // start; the workspace root is explicit via -C so skipping the repo
  // check is the local-agent equivalent of opencode's --dir.
  args.push('--skip-git-repo-check');
  const sandbox = options.sandbox || 'workspace-write';
  if (sandbox === 'workspace-write') {
    // Automation pattern: approvals route through automatic review instead
    // of an interactive prompt (there is no TTY to approve in). This flag
    // implies the workspace-write sandbox and cannot combine with -s.
    args.push('--approve-for-me');
  } else {
    args.push('-s', sandbox);
  }
  if (options.model?.trim()) {
    args.push('-m', options.model.trim());
  }
  if (options.localProvider) {
    args.push('--oss', '--local-provider', options.localProvider);
  }
  args.push('-o', outFile);
  args.push(options.message);
  return args;
}

/**
 * Executes a prompt with the local Codex CLI and returns its final message.
 * The last message is captured via --output-last-message so JSONL parsing
 * (which varies across CLI versions) is never required.
 */
export async function runCodex(
  options: CodexRunOptions,
): Promise<CodexRunResult> {
  const binaryPath = await findCodexBinary();
  if (!binaryPath) {
    return {
      text: '',
      error: 'Codex CLI is not installed on this system.',
    };
  }
  if (!options.message.trim()) {
    return { text: '', error: 'A task message is required.' };
  }

  const dir = mkdtempSync(join(tmpdir(), 'opendots-codex-'));
  const outFile = join(dir, 'last-message.md');
  const args = buildCodexArgs(options, outFile);

  try {
    const { stdout } = await new Promise<{
      stdout: string;
      stderr: string;
    }>((resolvePromise, rejectPromise) => {
      const child = spawn(binaryPath, args, {
        cwd: options.workdir || process.cwd(),
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      let stdout = '';
      let stderr = '';
      const timer = setTimeout(() => {
        try {
          child.kill('SIGKILL');
        } catch {
          /* child already exited */
        }
        rejectPromise(
          new Error(
            `Codex run timed out after ${options.timeoutMs || 300_000}ms.`,
          ),
        );
      }, options.timeoutMs || 300_000);
      child.stdout.on('data', (chunk) => {
        stdout += String(chunk);
        if (stdout.length > 4 * 1024 * 1024) {
          stdout = stdout.slice(-4 * 1024 * 1024);
        }
      });
      child.stderr.on('data', (chunk) => {
        stderr += String(chunk);
        if (stderr.length > 1 * 1024 * 1024) {
          stderr = stderr.slice(-1 * 1024 * 1024);
        }
      });
      child.on('error', (err) => {
        clearTimeout(timer);
        rejectPromise(err);
      });
      child.on('close', (code) => {
        clearTimeout(timer);
        if (code !== 0 && !existsSync(outFile) && !stdout.trim()) {
          rejectPromise(
            new Error(
              `Codex exited with code ${code}: ${stderr.trim().slice(0, 500) || 'no output'}`,
            ),
          );
          return;
        }
        resolvePromise({ stdout, stderr });
      });
    });

    let text = '';
    try {
      if (existsSync(outFile)) text = readFileSync(outFile, 'utf-8').trim();
    } catch {
      /* fall back to stdout below */
    }
    if (!text) text = stdout.trim();

    return {
      text: text || 'No response returned from Codex.',
    };
  } catch (error) {
    return {
      text: '',
      error: error instanceof Error ? error.message : String(error),
    };
  } finally {
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {
      /* temp cleanup is best-effort */
    }
  }
}
