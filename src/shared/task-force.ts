/** Shared shapes for the long-horizon Task Force: DoshBot's autonomous
 *  genetic-evolution research swarm. A session is a mission with a time
 *  budget; generations of parallel specialist workers evolve toward the
 *  mission, every worker keeps its own cross-linked memory, and the final
 *  report lands back in the owning conversation as an artifact. */

export type TaskForceSessionStatus =
  | 'running'
  | 'paused'
  | 'completed'
  | 'failed'
  | 'cancelled';

export interface TaskForceConfig {
  /** Base workers per generation (grows toward maxWave). */
  waveSize: number;
  /** Hard ceiling on workers in a single generation. */
  maxWave: number;
  /** Hard ceiling on total workers in one session. */
  maxWorkers: number;
  /** How deep sub-sessions may nest (root = depth 0). */
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
  | 'finding'
  | 'gen_summary'
  | 'report'
  | 'subsession';

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
