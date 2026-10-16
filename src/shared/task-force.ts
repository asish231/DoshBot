/** Shared shapes for the long-horizon Task Force: DoshBot's autonomous
 *  genetic-evolution research swarm. A session is a mission with a time
 *  budget; generations of parallel specialist workers evolve toward the
 *  mission, every worker keeps its own cross-linked memory, and the final
 *  report lands back in the owning conversation as an artifact. */

export type TaskForceSessionStatus =
  'running' | 'paused' | 'completed' | 'failed' | 'cancelled';

export interface TaskForceConfig {
  /** Base workers per generation (grows toward maxWave). */
  waveSize: number;
  /** Hard ceiling on workers in a single generation. */
  maxWave: number;
  /** Hard ceiling on total workers in one session. */
  maxWorkers: number;
  /** How deep the recursive sub-agent tree may nest: a root swarm's workers
   *  spawn deep-dive sub-swarms, whose workers spawn deeper ones, to this
   *  level (root = depth 0). */
  maxDepth: number;
  /** Cap on child sessions a session may spawn. */
  maxSubSessions: number;
  /** Cap on deep-dive directives one worker may emit. */
  maxDirectivesPerWorker: number;
  /** Concrete questions the final report must answer. */
  deliverables: string[];
}

export interface TaskForceSession {
  id: string;
  parentSessionId: string | null;
  parentWorkerId: string | null;
  threadId: string;
  dotId: string;
  mission: string;
  status: TaskForceSessionStatus;
  hoursBudget: number;
  deadline: number;
  depth: number;
  createdAt: number;
  endedAt: number | null;
  generation: number;
  /** JSON-encoded TaskForceConfig. */
  config: string;
  summary: string | null;
  reportArtifactId: string | null;
  error: string | null;
}

export interface TaskForceWorker {
  id: string;
  sessionId: string;
  parentWorkerId: string | null;
  generation: number;
  perspective: string;
  status: 'running' | 'completed' | 'failed';
  fitness: number | null;
  createdAt: number;
  finishedAt: number | null;
  error: string | null;
}

export type TaskForceMemoryKind =
  'finding' | 'gen_summary' | 'report' | 'subsession';
export interface TaskForceMemory {
  id: string;
  sessionId: string;
  workerId: string | null;
  generation: number;
  kind: TaskForceMemoryKind;
  title: string;
  /** Working "shadow": what other agents see in context. */
  summary: string;
  /** Full raw content — never deleted, retrieved on demand. */
  content: string;
  createdAt: number;
}

/**
 * Parses the owner's "/tf [hours] mission" slash command (alias
 * /taskforce). Returns null when the text is not a task force command.
 * A leading number between 0.25 and 24 followed by a space is the hours
 * budget; a leading number outside that range is mission text (so
 * "/tf 1984 novel analysis" keeps its year). "/tf" with no mission
 * returns an empty mission so the composer can prompt for one.
 */
export function parseTaskForceSlash(text: string): {
  hours?: number;
  mission: string;
} | null {
  const trimmed = text.trim();
  const match = trimmed.match(/^\/(?:tf|taskforce)(?:\s+([\s\S]*))?$/i);
  if (!match) return null;
  const rest = (match[1] ?? '').trim();
  if (!rest) return { mission: '' };
  const hoursMatch = rest.match(/^(\d{1,2}(?:\.\d+)?)\s+([\s\S]+)$/);
  const candidate = hoursMatch ? Number(hoursMatch[1]) : undefined;
  const hours =
    candidate !== undefined && candidate >= 0.25 && candidate <= 24
      ? candidate
      : undefined;
  return {
    hours,
    mission: (hours !== undefined && hoursMatch ? hoursMatch[2] : rest).trim(),
  };
}
