export type Status =
  'queued' | 'running' | 'paused' | 'completed' | 'failed' | 'cancelled';
export interface Settings {
  name: string;
  paused: boolean;
  researchAllowed: boolean;
  memoryAllowed: boolean;
  model?: string | null;
  reasoningEffort?: string | null;
  /** OpenAI-compatible custom/local endpoint base URL (e.g. a local
   *  provider at http://127.0.0.1:11434/v1). Overrides OPENAI_BASE_URL. */
  customBaseUrl?: string | null;
  /** API key for the custom endpoint. Stored secret; redacted in API responses. */
  customApiKey?: string | null;
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
  /** Local coding directory path. Blank (null) by default = pure chat with
   *  no local file/shell tools; coding tools fall back to process.cwd(). */
  codingDirectory?: string | null;
  /** Folder tools on/off. false = chat without local folder tools (no editor/bash/opencode). Defaults on. */
  codingEnabled?: boolean | null;
  /** JSON string: { bash: 'auto' | 'ask' | 'deny', edits: 'auto' | 'ask' | 'deny' } */
  codingPermissions?: string | null;
  /** Reasoning effort variant for OpenCode models ('minimal' | 'low' | 'medium' | 'high' | 'max') */
  opencodeVariant?: string | null;
  /** Task force: max time budget per session in hours (tier lever, 1-24). */
  taskForceMaxHours?: number | null;
  /** Task force: hard cap on workers per session. */
  taskForceMaxWorkers?: number | null;
  /** Task force: simultaneous model calls across all sessions. */
  taskForceConcurrency?: number | null;
  /** Whether new accounts may sign up (owner can disable once the team exists). */
  allowSignups?: boolean | null;
  /** CopilotKit computer sandbox environment (e.g. 'alpine' for Apple Silicon). */
  computerEnvironment?: string | null;
  /** Telephony voice provider (twilio/telegram/whatsapp); the voice adapter used. */
  voiceTelephonyProvider?: string | null;
  whatsappPhoneNumberId?: string | null;
  whatsappAccessToken?: string | null;
  whatsappVerifyToken?: string | null;
  twilioAccountSid?: string | null;
  twilioAuthToken?: string | null;
  twilioPhoneNumber?: string | null;
  /** Presence metadata for redacted credentials (computed server-side, never stored). */
  secrets?: SettingsSecrets;
}
export interface SettingsSecrets {
  telegramBotToken: boolean;
  customApiKey: boolean;
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
  /** Owning account; null on rows created before accounts existed. */
  ownerId?: string | null;
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
/** Event-based site watcher: fetches a URL on an interval and fires a task in
 *  the bound conversation when the content hash changes. */
export interface Monitor {
  id: string;
  url: string;
  threadId: string;
  prompt: string;
  intervalSeconds: number;
  status: 'paused' | 'active';
  lastHash?: string | null;
  lastCheckedAt?: number | null;
  lastError?: string | null;
  createdAt: number;
  updatedAt: number;
}
/** A doc or code panel the Dot created, rendered live in the chat UI. */
export interface Artifact {
  id: string;
  threadId?: string | null;
  title: string;
  kind: 'markdown' | 'code' | 'text';
  language?: string | null;
  content: string;
  createdAt: number;
}
/**
 * One entry in a conversation's task memory — the working set for long
 * context material. `summary` is the cheap line the Dot sees in context;
 * `content` holds the full extracted data (e.g. a PDF as raw markdown)
 * and is read on demand.
 */
export interface TaskMemoryEntry {
  id: string;
  threadId: string;
  name: string;
  summary: string;
  content: string;
  kind: 'file' | 'image' | 'note';
  source?: string | null;
  bytes: number;
  createdAt: number;
  updatedAt: number;
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
