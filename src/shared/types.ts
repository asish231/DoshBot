export type Status =
  'queued' | 'running' | 'paused' | 'completed' | 'failed' | 'cancelled';
export interface Settings {
  name: string;
  paused: boolean;
  researchAllowed: boolean;
  memoryAllowed: boolean;
  model?: string | null;
  reasoningEffort?: string | null;
  voiceProvider?: string | null;
  voiceModel?: string | null;
  voiceName?: string | null;
  /** JSON string: VoiceApiKey[] — ordered list, tried top-to-bottom.
   *  Values are redacted in API responses; entries carry the '__saved__' sentinel. */
  voiceApiKeys?: string | null;
  telegramBotToken?: string | null;
  telegramAllowedUsers?: string | null;
  /** JSON string: Connector[] — Local stdio and remote MCP servers.
   *  Per-connector tokens are redacted in API responses ('__saved__' sentinel). */
  connectors?: string | null;
  /** Active local coding directory path (defaults to process.cwd()) */
  codingDirectory?: string | null;
  /** Folder tools on/off. false = chat without local folder tools (no editor/bash/opencode). Defaults on. */
  codingEnabled?: boolean | null;
  /** JSON string: { bash: 'auto' | 'ask' | 'deny', edits: 'auto' | 'ask' | 'deny' } */
  codingPermissions?: string | null;
  /** Reasoning effort variant for OpenCode models ('minimal' | 'low' | 'medium' | 'high' | 'max') */
  opencodeVariant?: string | null;
  /** Presence metadata for redacted credentials (computed server-side, never stored). */
  secrets?: SettingsSecrets;
}
export interface SettingsSecrets {
  telegramBotToken: boolean;
  voiceApiKeys: number;
  connectors: number;
}
export interface Connector {
  id: string;
  name: string;
  type: 'local_stdio' | 'remote_sse' | 'remote_mcp' | 'openwork_cloud';
  url: string;
  command?: string;
  token?: string;
  enabled: boolean;
  description?: string;
  status?: 'connected' | 'disconnected' | 'idle' | 'error';
}
export type McpServerConfig = Connector;
export interface Task {
  id: string;
  prompt: string;
  status: Status;
  intervalSeconds: number | null;
  nextRunAt: number | null;
  createdAt: number;
  updatedAt: number;
  error: string | null;
  lease: string | null;
  leaseUntil: number | null;
}
export interface Source {
  title: string;
  url: string;
  excerpt: string;
}
export interface Result {
  text: string;
  sources: Source[];
  sample: boolean;
  screenshot?: string;
}
export interface Run {
  id: string;
  taskId: string;
  status: string;
  startedAt: number;
  finishedAt: number | null;
  result: Result | null;
  error: string | null;
}
export interface TaskEvent {
  id: number;
  taskId: string;
  runId: string | null;
  text: string;
  createdAt: number;
}
export type MemoryCategory =
  'preference' | 'fact' | 'instruction' | 'project' | 'goal' | 'general';
export interface Memory {
  id: string;
  text: string;
  category?: MemoryCategory | string | null;
  createdAt: number;
}
export interface SessionMemory {
  id: string;
  threadId: string;
  text: string;
  category?: MemoryCategory | string | null;
  createdAt: number;
}
/** A file uploaded by the owner: metadata here, bytes on the server's disk. */
export interface Upload {
  id: string;
  name: string;
  mime: string;
  size: number;
  threadId?: string | null;
  createdAt: number;
}
export interface Detail {
  task: Task;
  runs: Run[];
  events: TaskEvent[];
}
export interface State {
  settings: Settings;
  tasks: Task[];
  memories: Memory[];
  mode: 'sample' | 'live';
  configured: boolean;
}
export type Action = 'run' | 'pause' | 'cancel';
export interface Space {
  id: string;
  name: string;
  description: string;
  createdAt: number;
}
export interface Dot {
  id: string;
  /** Default destination for saved pages, not ownership. */
  spaceId: string;
  spaceIds: string[];
  name: string;
  instructions: string;
  researchAllowed: boolean;
  memoryAllowed: boolean;
  createdAt: number;
  learningContainerId?: string | null;
  skillDeliveryEnabled?: boolean;
  model?: string | null;
  reasoningEffort?: string | null;
  /** Monthly estimated-token hard stop for this Dot; null/0 = unlimited. */
  budgetTokens?: number | null;
}
export interface Conversation {
  id: string;
  dotId: string;
  ownerId: string;
  title: string;
  createdAt: number;
  /** Frozen at creation; null means this conversation does not participate. */
  learningContainerId?: string | null;
}
export interface CallReceipt {
  anchorMessageId?: string | null;
  id: string;
  threadId: string;
  startedAt: number;
  endedAt: number | null;
  status: 'connecting' | 'active' | 'ended' | 'failed';
  transcript: string;
  error: string | null;
}
export interface SetupStatus {
  intelligence: boolean;
  model: boolean;
  browser: boolean;
  voice: boolean;
  slack: string;
  missing: string[];
}
export interface WorkspaceState {
  spaces: Space[];
  dots: Dot[];
  conversations: Conversation[];
  setup: SetupStatus;
  calls: CallReceipt[];
}
