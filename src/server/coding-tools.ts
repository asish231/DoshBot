import { defineTool } from '@copilotkit/runtime/v2';
import { z } from 'zod';
import {
  existsSync,
  readFileSync,
  writeFileSync,
  statSync,
  readdirSync,
  mkdirSync,
} from 'node:fs';
import { resolve, isAbsolute, relative, join, dirname } from 'node:path';
import { exec } from 'node:child_process';
import { pruneToolOutput } from './computer-tools.js';
import type { WorkspaceStore } from './workspace.js';
import type { Store } from './store.js';

export interface CodingPermissions {
  bash?: 'auto' | 'ask' | 'deny';
  edits?: 'auto' | 'ask' | 'deny';
}

export interface CodingContext {
  threadId: string;
  workspace: WorkspaceStore;
  store: Store;
  permissions?: CodingPermissions;
}

// In-memory undo history for str_replace_editor
const undoHistory: Map<string, string[]> = new Map();

function getSafePath(workspaceRoot: string, targetPath: string): string {
  const cleanRoot = resolve(workspaceRoot);
  const full = isAbsolute(targetPath)
    ? resolve(targetPath)
    : resolve(cleanRoot, targetPath);
  const rel = relative(cleanRoot, full);
  if (rel.startsWith('..') || isAbsolute(rel)) {
    throw new Error(
      `Path escapes the connected workspace (${cleanRoot}): ${targetPath}. Use paths inside the connected folder.`,
    );
  }
  return full;
}

/** Bash commands that only read state; anything else (or with shell operators) counts as mutating. */
const READ_ONLY_BASH = [
  'ls',
  'cat',
  'head',
  'tail',
  'grep',
  'rg',
  'find',
  'wc',
  'du',
  'df',
  'pwd',
  'which',
  'whoami',
  'date',
  'echo',
  'env',
  'printenv',
  'file',
  'stat',
  'tree',
  'git status',
  'git diff',
  'git log',
  'git show',
  'git branch',
  'git remote',
  'git rev-parse',
  'git ls-files',
];

function isReadOnlyBashCommand(command: string): boolean {
  const trimmed = command.trim();
  if (/[;&|>><($`\\]/.test(trimmed)) return false;
  return READ_ONLY_BASH.some((safe) => {
    const prefix = `${safe} `;
    return trimmed === safe || trimmed.startsWith(prefix);
  });
}

const ASK_EDITS_MESSAGE =
  "File edits are set to 'Ask Confirmation' in workspace coding permissions. Present the exact edit to the user with ask_question; they can approve by switching edits to 'Auto' in Settings, then retry.";
const ASK_BASH_MESSAGE =
  "Mutating shell commands are blocked because bash is set to 'Ask Confirmation' in workspace coding permissions. Present the exact command to the user with ask_question; they can approve by switching bash to 'Auto' in Settings, then retry.";

function matchOffsets(content: string, search: string): number[] {
  const offsets: number[] = [];
  let offset = 0;
  while (true) {
    const match = content.indexOf(search, offset);
    if (match < 0) return offsets;
    offsets.push(match);
    offset = match + search.length;
  }
}

function lineNumbersAt(content: string, offsets: number[]): number[] {
  let line = 1;
  let cursor = 0;
  return offsets.map((offset) => {
    while (cursor < offset) {
      if (content[cursor] === '\n') line += 1;
      cursor += 1;
    }
    return line;
  });
}

/** OpenCode-edit parity: return the edited region with numbered context lines. */
function formatEditSnippet(
  filePath: string,
  content: string,
  focusCharOffset: number,
  focusCharLength = 0,
  contextLines = 6,
): string {
  const lines = content.split('\n');
  let cursor = 0;
  let focusLine = 1;
  for (let i = 0; i < lines.length; i++) {
    const next = cursor + lines[i]!.length + 1;
    if (focusCharOffset < next) {
      focusLine = i + 1;
      break;
    }
    cursor = next;
    focusLine = lines.length;
  }
  const start = Math.max(1, focusLine - contextLines);
  const focusEndLine = (() => {
    let c = cursor;
    let line = focusLine;
    const end = focusCharOffset + focusCharLength;
    while (c < end && line < lines.length) {
      c += lines[line - 1]!.length + 1;
      line += 1;
    }
    return Math.min(lines.length, line);
  })();
  const end = Math.min(
    lines.length,
    Math.max(focusEndLine, focusLine) + contextLines,
  );
  const numbered = lines
    .slice(start - 1, end)
    .map(
      (line, idx) =>
        `${start + idx === focusLine ? '>' : ' '}${String(start + idx).padStart(6, ' ')}  ${line}`,
    )
    .join('\n');
  return `Edited ${filePath} (lines ${start}-${end} of ${lines.length}, '>' marks the edit):\n${numbered}\n`;
}

function formatFileView(
  filePath: string,
  content: string,
  viewRange?: [number, number],
  maxOutputChars = 24000,
): string {
  const allLines = content.split('\n');
  let lines = allLines;
  let initialLine = 1;
  let finalLine = allLines.length;
  let prompt = `Here's the content of ${filePath} with line numbers (total ${allLines.length} lines)`;

  if (viewRange !== undefined && viewRange.length === 2) {
    const [start, end] = viewRange;
    if (Number.isInteger(start) && start >= 1 && start <= allLines.length) {
      initialLine = start;
    }
    if (Number.isInteger(end) && end >= initialLine && end <= allLines.length) {
      finalLine = end;
    }
    lines = allLines.slice(initialLine - 1, finalLine);
    prompt += ` with view_range=[${initialLine}, ${finalLine}]`;
  }

  const numbered = lines
    .map(
      (line, idx) => `${String(initialLine + idx).padStart(6, ' ')}  ${line}`,
    )
    .join('\n');

  const fullText = `${prompt}:\n${numbered}\n`;
  return fullText.length <= maxOutputChars
    ? fullText
    : fullText.slice(0, maxOutputChars) +
        '\n\n[<response clipped> Use view_range or grep to inspect remaining sections.]';
}

function listDirectory(dirPath: string, maxDepth = 2): string {
  const rows: string[] = [];

  function walk(current: string, depth: number) {
    try {
      const entries = readdirSync(current, { withFileTypes: true });
      for (const entry of entries) {
        if (
          entry.name.startsWith('.') ||
          entry.name === 'node_modules' ||
          entry.name === 'dist' ||
          entry.name === '__pycache__' ||
          entry.name === 'coverage'
        ) {
          continue;
        }
        const full = join(current, entry.name);
        const rel = relative(dirPath, full);
        if (entry.isDirectory()) {
          rows.push(`d\t${rel}`);
          if (depth < maxDepth) {
            walk(full, depth + 1);
          }
        } else if (entry.isFile()) {
          rows.push(`f\t${rel}`);
        }
      }
    } catch {
      /* unreadable or vanished entry; skip it */
    }
  }

  walk(dirPath, 1);
  rows.sort();
  return `Files and directories in ${dirPath} (up to 2 levels deep, excluding node_modules and hidden items):\n${rows.join('\n')}\n`;
}

/**
 * Creates DeepSeek Harness compatible coding tools:
 * 1. str_replace_editor (view, create, str_replace, insert, undo_edit)
 * 2. bash (execute command in local workspace with stdout, stderr, exitCode)
 * 3. search_files (pattern and content search)
 * 4. save_session_memory (thread-bound memory)
 * 5. save_global_memory (workspace-wide memory)
 */
export function codingTools(
  workspaceRoot: string,
  check: () => void,
  signal: AbortSignal,
  ctx?: CodingContext,
) {
  const editorTool = defineTool({
    name: 'str_replace_editor',
    description: `Custom editing tool for viewing, creating, and editing local files adapted from DeepSeek Harness.
Commands:
- view: Displays file content with line numbers (supports view_range: [start, end]). If path is a directory, lists directory tree.
- create: Creates a new file with file_text. Errors if file already exists.
- str_replace: Exact literal string replacement. old_str must match EXACTLY and uniquely in the file.
- insert: Inserts new_str after insert_line number (use 0 to prepend at start).
- undo_edit: Restores the file to its state prior to the most recent edit.`,
    parameters: z.object({
      command: z.enum(['view', 'create', 'str_replace', 'insert', 'undo_edit']),
      path: z
        .string()
        .describe('File or directory path (relative to workspace or absolute)'),
      file_text: z
        .string()
        .optional()
        .describe('Content to write when command is "create"'),
      old_str: z
        .string()
        .optional()
        .describe(
          'Exact unique string to replace when command is "str_replace"',
        ),
      new_str: z
        .string()
        .optional()
        .describe(
          'Replacement string for "str_replace" or text to insert for "insert"',
        ),
      insert_line: z
        .number()
        .int()
        .optional()
        .describe('Line number after which to insert (0 for start)'),
      view_range: z
        .array(z.number().int())
        .max(2)
        .optional()
        .describe('Line range [start, end] when command is "view"'),
    }),
    execute: async ({
      command,
      path: rawPath,
      file_text,
      old_str,
      new_str,
      insert_line,
      view_range,
    }) => {
      check();
      const target = getSafePath(workspaceRoot, rawPath);

      if (command === 'view') {
        if (!existsSync(target)) {
          throw new Error(`Path does not exist: ${rawPath}`);
        }
        const stat = statSync(target);
        if (stat.isDirectory()) {
          return listDirectory(target);
        }
        const content = readFileSync(target, 'utf-8');
        return formatFileView(
          rawPath,
          content,
          view_range as [number, number] | undefined,
        );
      }

      if (['create', 'str_replace', 'insert', 'undo_edit'].includes(command)) {
        if (ctx?.permissions?.edits === 'deny') {
          throw new Error(
            'File modifications are denied by workspace coding permissions.',
          );
        }
        if (ctx?.permissions?.edits === 'ask') {
          throw new Error(ASK_EDITS_MESSAGE);
        }
      }

      if (command === 'create') {
        if (file_text === undefined) {
          throw new Error('file_text is required for command "create"');
        }
        if (existsSync(target)) {
          throw new Error(
            `File already exists at: ${rawPath}. Cannot overwrite using "create". Use "str_replace" instead.`,
          );
        }
        mkdirSync(dirname(target), { recursive: true });
        writeFileSync(target, file_text, 'utf-8');
        return `New file created successfully at: ${rawPath}\n${formatFileView(rawPath, file_text).slice(0, 4000)}`;
      }

      if (command === 'str_replace') {
        if (!existsSync(target)) {
          throw new Error(`File does not exist: ${rawPath}`);
        }
        if (!old_str) {
          throw new Error('old_str is required for command "str_replace"');
        }
        const replacement = new_str ?? '';
        const currentContent = readFileSync(target, 'utf-8');
        const offsets = matchOffsets(currentContent, old_str);

        if (offsets.length === 0) {
          throw new Error(
            `No replacement was performed: old_str did not appear verbatim in ${rawPath}. Ensure exact whitespace and linebreaks match.`,
          );
        }
        if (offsets.length > 1) {
          const lines = lineNumbersAt(currentContent, offsets);
          throw new Error(
            `Ambiguous replacement: multiple occurrences of old_str found on lines [${lines.join(', ')}]. Include more surrounding context to make old_str unique.`,
          );
        }

        const offset = offsets[0];
        // Save undo
        const history = undoHistory.get(target) || [];
        history.push(currentContent);
        undoHistory.set(target, history);

        const updated =
          currentContent.slice(0, offset) +
          replacement +
          currentContent.slice(offset + old_str.length);
        writeFileSync(target, updated, 'utf-8');
        return `The file ${rawPath} has been edited successfully.\n${formatEditSnippet(rawPath, updated, offset, replacement.length)}`;
      }

      if (command === 'insert') {
        if (!existsSync(target)) {
          throw new Error(`File does not exist: ${rawPath}`);
        }
        if (insert_line === undefined) {
          throw new Error('insert_line is required for command "insert"');
        }
        if (new_str === undefined) {
          throw new Error('new_str is required for command "insert"');
        }

        const currentContent = readFileSync(target, 'utf-8');
        const lines = currentContent.split('\n');

        if (insert_line < 0 || insert_line > lines.length) {
          throw new Error(
            `Invalid insert_line: ${insert_line}. Must be between 0 and total lines (${lines.length}).`,
          );
        }

        // Save undo
        const history = undoHistory.get(target) || [];
        history.push(currentContent);
        undoHistory.set(target, history);

        const newLines = new_str.split('\n');
        const updatedLines = [
          ...lines.slice(0, insert_line),
          ...newLines,
          ...lines.slice(insert_line),
        ];
        const updatedContent = updatedLines.join('\n');
        writeFileSync(target, updatedContent, 'utf-8');
        const insertCharOffset =
          lines.slice(0, insert_line).join('\n').length +
          (insert_line > 0 ? 1 : 0);
        return `Inserted content successfully after line ${insert_line} in ${rawPath}.\n${formatEditSnippet(rawPath, updatedContent, insertCharOffset, new_str.length)}`;
      }

      if (command === 'undo_edit') {
        const history = undoHistory.get(target);
        if (!history || history.length === 0) {
          throw new Error(`No previous edits to undo for file: ${rawPath}`);
        }
        const previous = history.pop()!;
        writeFileSync(target, previous, 'utf-8');
        return `Successfully reverted ${rawPath} to previous version.`;
      }

      throw new Error(`Unknown command: ${command}`);
    },
  });

  const bashTool = defineTool({
    name: 'bash',
    description: `Execute a bash shell command in the local workspace directory.
Captures stdout, stderr, and exit code.
Use for building, running tests, inspecting git status, or running tools.
Output is pruned if overly long to conserve context window.`,
    parameters: z.object({
      command: z.string().describe('The bash command line to execute.'),
      description: z
        .string()
        .describe(
          'Clear, concise description of what this command does in active voice (5-10 words).',
        ),
      workdir: z
        .string()
        .optional()
        .describe(
          'Subdirectory relative to workspace. Defaults to workspace root.',
        ),
      timeoutMs: z
        .number()
        .int()
        .optional()
        .default(30000)
        .describe('Timeout in milliseconds (default 30s, max 120s).'),
    }),
    execute: async ({
      command,
      description: _desc,
      workdir,
      timeoutMs = 30000,
    }) => {
      check();
      if (ctx?.permissions?.bash === 'deny') {
        throw new Error(
          'Bash command execution is denied by workspace coding permissions.',
        );
      }
      if (ctx?.permissions?.bash === 'ask' && !isReadOnlyBashCommand(command)) {
        throw new Error(ASK_BASH_MESSAGE);
      }
      const cwd = workdir ? getSafePath(workspaceRoot, workdir) : workspaceRoot;
      const effectiveTimeout = Math.min(Math.max(timeoutMs, 1000), 120000);

      return new Promise<{
        exitCode: number;
        stdout: string;
        stderr: string;
        durationMs: number;
      }>((resolvePromise) => {
        const startTime = Date.now();
        const child = exec(
          command,
          {
            cwd,
            timeout: effectiveTimeout,
            maxBuffer: 4 * 1024 * 1024,
            env: { ...process.env, PAGER: 'cat', CI: 'true' },
          },
          (error, stdout, stderr) => {
            const durationMs = Date.now() - startTime;
            const exitCode =
              error && 'code' in error && typeof error.code === 'number'
                ? error.code
                : error
                  ? 1
                  : 0;
            const prunedStdout = pruneToolOutput(
              stdout,
              12000,
              6000,
              2000,
            ) as string;
            const prunedStderr = pruneToolOutput(
              stderr,
              6000,
              3000,
              1000,
            ) as string;

            resolvePromise({
              exitCode,
              stdout: prunedStdout,
              stderr: prunedStderr,
              durationMs,
            });
          },
        );

        signal.addEventListener('abort', () => {
          try {
            child.kill('SIGKILL');
          } catch {
            /* unreadable or vanished entry; skip it */
          }
        });
      });
    },
  });

  const searchTool = defineTool({
    name: 'search_files',
    description:
      'Search for files by name/glob pattern or search file contents for text in the workspace.',
    parameters: z.object({
      pattern: z
        .string()
        .describe('Filename pattern or substring (e.g. "*.ts" or "component")'),
      query: z
        .string()
        .optional()
        .describe('Optional text content to search for inside files'),
      maxResults: z.number().int().optional().default(30),
    }),
    execute: async ({ pattern, query, maxResults = 30 }) => {
      check();
      const results: Array<{ file: string; line?: number; match?: string }> =
        [];

      function searchDir(current: string) {
        if (results.length >= maxResults) return;
        try {
          const entries = readdirSync(current, { withFileTypes: true });
          for (const entry of entries) {
            if (results.length >= maxResults) return;
            if (
              entry.name.startsWith('.') ||
              entry.name === 'node_modules' ||
              entry.name === 'dist' ||
              entry.name === 'coverage'
            ) {
              continue;
            }
            const full = join(current, entry.name);
            const rel = relative(workspaceRoot, full);

            if (entry.isDirectory()) {
              searchDir(full);
            } else if (entry.isFile()) {
              const nameMatches =
                pattern === '*' ||
                rel.toLowerCase().includes(pattern.toLowerCase());
              if (!query) {
                if (nameMatches) {
                  results.push({ file: rel });
                }
              } else if (nameMatches || query) {
                try {
                  const content = readFileSync(full, 'utf-8');
                  const lines = content.split('\n');
                  for (let i = 0; i < lines.length; i++) {
                    if (lines[i].includes(query)) {
                      results.push({
                        file: rel,
                        line: i + 1,
                        match: lines[i].trim().slice(0, 160),
                      });
                      if (results.length >= maxResults) break;
                    }
                  }
                } catch {
                  /* unreadable or vanished entry; skip it */
                }
              }
            }
          }
        } catch {
          /* unreadable or vanished entry; skip it */
        }
      }

      searchDir(workspaceRoot);
      return { total: results.length, matches: results };
    },
  });

  const sessionMemoryTool = defineTool({
    name: 'save_session_memory',
    description:
      'Save a note, task state, or context item specifically for the current chat session. Does not pollute global workspace memory.',
    parameters: z.object({
      text: z
        .string()
        .min(1)
        .max(2000)
        .describe('Note or observation to remember for this conversation'),
      category: z
        .enum(['note', 'goal', 'context', 'todo', 'general'])
        .optional()
        .default('note'),
    }),
    execute: async ({ text, category = 'note' }) => {
      check();
      if (!ctx) return { error: 'Memory context unavailable' };
      const saved = ctx.workspace.saveSessionMemory(
        ctx.threadId,
        text,
        undefined,
        category,
      );
      return { success: true, saved };
    },
  });

  const globalMemoryTool = defineTool({
    name: 'save_global_memory',
    description:
      'Save a persistent preference, fact, or instruction across all sessions in this workspace.',
    parameters: z.object({
      text: z
        .string()
        .min(1)
        .max(2000)
        .describe('Workspace-wide fact, user preference, or permanent rule'),
      category: z
        .enum([
          'preference',
          'fact',
          'instruction',
          'project',
          'goal',
          'general',
        ])
        .optional()
        .default('general'),
    }),
    execute: async ({ text, category = 'general' }) => {
      check();
      if (!ctx) return { error: 'Memory context unavailable' };
      const saved = ctx.store.saveMemory(text, undefined, category);
      return { success: true, saved };
    },
  });

  // Open Interpreter parity: direct code execution (python3 / node) with stdout/stderr.
  // bash already covers shell, but this gives the agent a clean "run this snippet" primitive
  // like Open Interpreter's computer.interpreter — no shell quoting pitfalls.
  const interpreterTool = defineTool({
    name: 'code_interpreter',
    description: `Run a code snippet directly (Open Interpreter parity). Supports python3 and node/javascript. Use for calculations, data analysis, file transforms, quick verification scripts. Runs in the connected local workspace directory with a 30s default timeout.`,
    parameters: z.object({
      language: z
        .enum(['python', 'javascript', 'typescript'])
        .describe('Runtime to execute the code with.'),
      code: z
        .string()
        .min(1)
        .max(20000)
        .describe('Full source code to execute.'),
      description: z
        .string()
        .describe(
          'Clear, concise description of what this code does (5-10 words).',
        ),
      timeoutMs: z
        .number()
        .int()
        .optional()
        .default(30000)
        .describe('Timeout in ms (default 30s, max 120s).'),
    }),
    execute: async ({
      language,
      code,
      description: _desc,
      timeoutMs = 30000,
    }) => {
      check();
      if (ctx?.permissions?.bash === 'deny') {
        throw new Error(
          'Code execution is denied by workspace coding permissions.',
        );
      }
      if (ctx?.permissions?.bash === 'ask') {
        throw new Error(ASK_BASH_MESSAGE);
      }
      const { writeFileSync, unlinkSync } = await import('node:fs');
      const { tmpdir } = await import('node:os');
      const { join } = await import('node:path');
      const { randomUUID } = await import('node:crypto');
      const ext =
        language === 'python' ? 'py' : language === 'javascript' ? 'mjs' : 'ts';
      const tmpFile = join(tmpdir(), `doshbot-interp-${randomUUID()}.${ext}`);
      writeFileSync(tmpFile, code, 'utf-8');
      const runner =
        language === 'python'
          ? `python3 "${tmpFile}"`
          : language === 'javascript'
            ? `node "${tmpFile}"`
            : `npx -y tsx "${tmpFile}"`;
      const effectiveTimeout = Math.min(Math.max(timeoutMs, 1000), 120000);
      return new Promise<{
        exitCode: number;
        stdout: string;
        stderr: string;
        language: string;
      }>((resolvePromise) => {
        const start = Date.now();
        const child = exec(
          runner,
          {
            cwd: workspaceRoot,
            timeout: effectiveTimeout,
            maxBuffer: 4 * 1024 * 1024,
            env: { ...process.env, PAGER: 'cat', CI: 'true' },
          },
          (error, stdout, stderr) => {
            try {
              unlinkSync(tmpFile);
            } catch {
              /* temp file already removed */
            }
            const exitCode =
              error && 'code' in error && typeof error.code === 'number'
                ? error.code
                : error
                  ? 1
                  : 0;
            resolvePromise({
              exitCode,
              stdout: String(pruneToolOutput(stdout, 12000, 6000, 2000)),
              stderr: String(pruneToolOutput(stderr, 6000, 3000, 1000)),
              language,
            });
            void start;
          },
        );
        signal.addEventListener('abort', () => {
          try {
            child.kill('SIGKILL');
          } catch {
            /* process already exited */
          }
        });
      });
    },
  });

  return [
    editorTool,
    bashTool,
    searchTool,
    interpreterTool,
    sessionMemoryTool,
    globalMemoryTool,
  ];
}
