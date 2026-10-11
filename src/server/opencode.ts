import { exec, execFile, spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';

const execAsync = promisify(exec);
const execFileAsync = promisify(execFile);

export interface OpenCodeModelMeta {
  id: string;
  name: string;
  provider: string;
  isFree: boolean;
  contextLimit?: number;
  description?: string;
}

export interface OpenCodeStatus {
  available: boolean;
  binaryPath?: string;
  version?: string;
  freeModels: OpenCodeModelMeta[];
  allModels: OpenCodeModelMeta[];
  variants: string[];
  lastChecked: number;
}

let cachedStatus: OpenCodeStatus | null = null;
let lastCheckTime = 0;
const CACHE_TTL_MS = 120_000; // 2 minutes

/**
 * Finds the OpenCode binary path on the host system.
 */
export async function findOpenCodeBinary(): Promise<string | null> {
  const commonPaths = [
    '/opt/homebrew/bin/opencode',
    '/usr/local/bin/opencode',
    join(homedir(), '.local/bin/opencode'),
    join(homedir(), '.opencode/bin/opencode'),
  ];

  for (const p of commonPaths) {
    if (existsSync(p)) {
      return p;
    }
  }

  try {
    const { stdout } = await execAsync('which opencode');
    const bin = stdout.trim();
    if (bin && existsSync(bin)) {
      return bin;
    }
  } catch {
    // not in path
  }

  return null;
}

/**
 * Inspects and returns OpenCode integration status, free models, and variants.
 */
export async function getOpenCodeStatus(
  forceRefresh = false,
): Promise<OpenCodeStatus> {
  const now = Date.now();
  if (!forceRefresh && cachedStatus && now - lastCheckTime < CACHE_TTL_MS) {
    return cachedStatus;
  }

  const binaryPath = await findOpenCodeBinary();
  if (!binaryPath) {
    cachedStatus = {
      available: false,
      freeModels: [],
      allModels: [],
      variants: ['default', 'minimal', 'low', 'medium', 'high', 'max'],
      lastChecked: now,
    };
    lastCheckTime = now;
    return cachedStatus;
  }

  let version: string;
  try {
    const { stdout } = await execFileAsync(binaryPath, ['--version']);
    version = stdout.trim();
  } catch {
    version = 'installed';
  }

  const freeModels: OpenCodeModelMeta[] = [];
  const allModels: OpenCodeModelMeta[] = [];

  // Default known OpenCode free models as fallback
  const defaultFreeIds = [
    'opencode/fledge-alpha-free',
    'opencode/ling-3.1-flash-free',
    'opencode/ling-3.0-flash-fin-free',
    'opencode/longcat-2.5-preview-free',
    'opencode/mimo-v2.6-flash-free',
    'opencode/mimo-v2.5-free',
    'opencode/muse-spark-1.3-contributor-free',
    'opencode/muse-spark-1.2-contributor-free',
    'opencode/nemotron-3.5-lightning-free',
    'opencode/nemotron-3-ultra-free',
    'opencode/space-bunny-free',
    'opencode/big-pickle',
    'opencode/jev-1.13-free',
  ];

  try {
    const { stdout } = await execFileAsync(
      binaryPath,
      ['models', '--verbose'],
      {
        timeout: 10000,
        maxBuffer: 10 * 1024 * 1024,
      },
    );

    // Parse models list
    const lines = stdout.split('\n');
    let currentId = '';
    let jsonBuffer = '';

    const processEntry = (id: string, jsonStr: string) => {
      try {
        const meta = JSON.parse(jsonStr);
        const isFree =
          id.endsWith('-free') ||
          id === 'big-pickle' ||
          (meta.cost && meta.cost.input === 0 && meta.cost.output === 0);
        const item: OpenCodeModelMeta = {
          id: id.startsWith('opencode/') ? id : `opencode/${id}`,
          name: meta.name || id,
          provider: meta.providerID || 'OpenCode',
          isFree: Boolean(isFree),
          contextLimit: meta.limit?.context,
          description: isFree ? 'OpenCode Free Tier' : undefined,
        };
        allModels.push(item);
        if (isFree) {
          freeModels.push(item);
        }
      } catch {
        const isFree = id.endsWith('-free') || id === 'big-pickle';
        const item: OpenCodeModelMeta = {
          id: id.startsWith('opencode/') ? id : `opencode/${id}`,
          name: id,
          provider: 'OpenCode',
          isFree,
        };
        allModels.push(item);
        if (isFree) freeModels.push(item);
      }
    };

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]!;
      if (
        line.startsWith('opencode/') ||
        (line.startsWith('{') && !currentId)
      ) {
        if (currentId && jsonBuffer.trim()) {
          processEntry(currentId, jsonBuffer);
        }
        currentId = line.trim();
        jsonBuffer = '';
      } else if (currentId) {
        jsonBuffer += line + '\n';
      }
    }
    if (currentId && jsonBuffer.trim()) {
      processEntry(currentId, jsonBuffer);
    }
  } catch {
    // If verbose parsing fails, use standard `opencode models`
    try {
      const { stdout } = await execFileAsync(binaryPath, ['models'], {
        timeout: 8000,
      });
      const modelLines = stdout
        .split('\n')
        .map((l) => l.trim())
        .filter(Boolean);
      for (const m of modelLines) {
        const isFree =
          m.endsWith('-free') ||
          m.includes('free') ||
          m === 'opencode/big-pickle';
        const item: OpenCodeModelMeta = {
          id: m,
          name: m.replace(/^opencode\//, ''),
          provider: 'OpenCode',
          isFree,
        };
        allModels.push(item);
        if (isFree) freeModels.push(item);
      }
    } catch {
      // Fall back to default free list
      for (const id of defaultFreeIds) {
        const item: OpenCodeModelMeta = {
          id,
          name: id.replace('opencode/', ''),
          provider: 'OpenCode',
          isFree: true,
          description: 'OpenCode Free Model',
        };
        freeModels.push(item);
        allModels.push(item);
      }
    }
  }

  // Ensure default free models are present if none were populated
  if (freeModels.length === 0) {
    for (const id of defaultFreeIds) {
      freeModels.push({
        id,
        name: id.replace('opencode/', ''),
        provider: 'OpenCode',
        isFree: true,
        description: 'OpenCode Free Model',
      });
    }
  }

  cachedStatus = {
    available: true,
    binaryPath,
    version,
    freeModels,
    allModels,
    variants: ['default', 'minimal', 'low', 'medium', 'high', 'max'],
    lastChecked: now,
  };
  lastCheckTime = now;
  return cachedStatus;
}

export interface OpenCodeRunOptions {
  message: string;
  model?: string;
  variant?: string;
  workdir?: string;
  timeoutMs?: number;
  /** Workspace file paths to attach via `opencode run --file` (repeatable). */
  files?: string[];
}

export interface OpenCodeRunResult {
  text: string;
  tokens?: {
    total: number;
    input: number;
    output: number;
  };
  cost?: number;
  error?: string;
}

/**
 * Executes a prompt using OpenCode CLI in headless JSON mode.
 */
export async function runOpenCode(
  options: OpenCodeRunOptions,
): Promise<OpenCodeRunResult> {
  const binaryPath = await findOpenCodeBinary();
  if (!binaryPath) {
    throw new Error('OpenCode binary is not installed on this system.');
  }

  const args: string[] = ['run', options.message, '--format', 'json'];
  if (options.model) {
    args.push('-m', options.model);
  }
  if (options.variant && options.variant !== 'default') {
    args.push('--variant', options.variant);
  }
  for (const f of options.files ?? []) {
    if (f.trim()) args.push('--file', f);
  }
  if (options.workdir) {
    args.push('--dir', options.workdir);
  }

  try {
    // NOTE: stdin must be ignored, not piped. `opencode run` reads piped stdin
    // as extra message input, so a default-piped stdin hangs forever.
    const { stdout, stderr } = await new Promise<{
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
            `OpenCode run timed out after ${options.timeoutMs || 60_000}ms.`,
          ),
        );
      }, options.timeoutMs || 60_000);
      child.stdout.on('data', (chunk) => {
        stdout += String(chunk);
        if (stdout.length > 20 * 1024 * 1024) {
          stdout = stdout.slice(-20 * 1024 * 1024);
        }
      });
      child.stderr.on('data', (chunk) => {
        stderr += String(chunk);
        if (stderr.length > 4 * 1024 * 1024) {
          stderr = stderr.slice(-4 * 1024 * 1024);
        }
      });
      child.on('error', (err) => {
        clearTimeout(timer);
        rejectPromise(err);
      });
      child.on('close', (code) => {
        clearTimeout(timer);
        if (code !== 0 && !stdout.trim()) {
          rejectPromise(
            new Error(
              `OpenCode exited with code ${code}: ${stderr.trim().slice(0, 500)}`,
            ),
          );
          return;
        }
        resolvePromise({ stdout, stderr });
      });
    });

    let fullText = '';
    let tokens: { total: number; input: number; output: number } | undefined;
    let cost: number | undefined;

    const lines = stdout.split('\n');
    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        const event = JSON.parse(line);
        if (event.type === 'text' && event.part?.text) {
          fullText += event.part.text;
        } else if (event.type === 'step_finish' && event.part?.tokens) {
          tokens = event.part.tokens;
          cost = event.part.cost;
        }
      } catch {
        // non-json line
      }
    }

    if (!fullText.trim() && stderr.trim()) {
      fullText = stderr.trim();
    }

    return {
      text: fullText.trim() || 'No response returned from OpenCode.',
      tokens,
      cost,
    };
  } catch (err) {
    return {
      text: '',
      error: err instanceof Error ? err.message : String(err),
    };
  }
}
