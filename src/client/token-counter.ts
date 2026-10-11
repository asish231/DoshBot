export interface TokenUsageEstimate {
  estimatedTokens: number;
  maxTokens: number;
  percentage: number;
  formatted: string;
  maxFormatted: string;
  status: 'normal' | 'warning' | 'critical';
  inputTokens: number;
  outputTokens: number;
  inputFormatted: string;
  outputFormatted: string;
  messageCount: number;
}

export interface SessionTokenStats {
  threadId: string;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  messageCount: number;
  lastUpdated: number;
}

export function getModelContextWindow(modelName?: string): number {
  if (!modelName) return 128_000;
  const m = modelName.toLowerCase();
  if (m.includes('gemini-2.5-pro') || m.includes('gemini-1.5-pro'))
    return 2_000_000;
  if (m.includes('gemini')) return 1_000_000;
  if (
    m.includes('claude-3-7') ||
    m.includes('claude-3-5') ||
    m.includes('kimi')
  )
    return 200_000;
  if (
    m.includes('deepseek') ||
    m.includes('gpt-4o') ||
    m.includes('qwen') ||
    m.includes('o3') ||
    m.includes('o1')
  )
    return 128_000;
  return 128_000;
}

export function formatTokenNumber(tokens: number): string {
  if (tokens >= 1_000_000) {
    return `${(tokens / 1_000_000).toFixed(1)}M`;
  }
  if (tokens >= 1_000) {
    return `${(tokens / 1_000).toFixed(1)}k`;
  }
  return tokens.toLocaleString();
}

export function estimateMessageTokens(
  messages: Array<{ role?: string; content?: unknown; toolCalls?: unknown[] }>,
): number {
  let totalChars = 0;
  for (const msg of messages) {
    if (typeof msg.content === 'string') {
      totalChars += msg.content.length;
    } else if (Array.isArray(msg.content)) {
      totalChars += JSON.stringify(msg.content).length;
    }
    if (msg.toolCalls && Array.isArray(msg.toolCalls)) {
      totalChars += JSON.stringify(msg.toolCalls).length;
    }
    // Overhead per message envelope
    totalChars += 20;
  }
  // Rough rule of thumb: ~3.8 characters per token for typical code + natural language
  return Math.ceil(totalChars / 3.8);
}

function charsToTokens(chars: number): number {
  return Math.ceil(chars / 3.8);
}

export function estimateDirectionalTokens(
  messages: Array<{ role?: string; content?: unknown; toolCalls?: unknown[] }>,
): { inputTokens: number; outputTokens: number } {
  let inputChars = 0;
  let outputChars = 0;
  for (const msg of messages) {
    let chars = 20;
    if (typeof msg.content === 'string') chars += msg.content.length;
    else if (Array.isArray(msg.content))
      chars += JSON.stringify(msg.content).length;
    if (msg.toolCalls && Array.isArray(msg.toolCalls))
      chars += JSON.stringify(msg.toolCalls).length;
    if (msg.role === 'assistant') outputChars += chars;
    else inputChars += chars;
  }
  return {
    inputTokens: charsToTokens(inputChars),
    outputTokens: charsToTokens(outputChars),
  };
}

export function calculateTokenUsage(
  messages: Array<{ role?: string; content?: unknown; toolCalls?: unknown[] }>,
  modelName?: string,
  extraSystemChars = 2500,
): TokenUsageEstimate {
  const messageTokens = estimateMessageTokens(messages);
  const systemTokens = Math.ceil(extraSystemChars / 3.8);
  const estimatedTokens = messageTokens + systemTokens;
  const maxTokens = getModelContextWindow(modelName);
  const percentage = Math.min(
    100,
    Math.round((estimatedTokens / maxTokens) * 100),
  );

  let status: 'normal' | 'warning' | 'critical' = 'normal';
  if (percentage >= 85) status = 'critical';
  else if (percentage >= 65) status = 'warning';

  const { inputTokens, outputTokens } = estimateDirectionalTokens(messages);
  const sysInput = Math.ceil(systemTokens / 2);
  const adjustedInput = inputTokens + sysInput;
  const adjustedOutput = outputTokens + (systemTokens - sysInput);

  return {
    estimatedTokens,
    maxTokens,
    percentage,
    formatted: formatTokenNumber(estimatedTokens),
    maxFormatted: formatTokenNumber(maxTokens),
    status,
    inputTokens: adjustedInput,
    outputTokens: adjustedOutput,
    inputFormatted: formatTokenNumber(adjustedInput),
    outputFormatted: formatTokenNumber(adjustedOutput),
    messageCount: messages.length,
  };
}

const SESSION_STATS_KEY = 'doshbot-session-tokens-v1';

export function loadSessionTokenStats(): Record<string, SessionTokenStats> {
  try {
    const raw = localStorage.getItem(SESSION_STATS_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return typeof parsed === 'object' && parsed !== null ? parsed : {};
  } catch {
    return {};
  }
}

export function recordSessionTokenStats(
  threadId: string,
  usage: TokenUsageEstimate,
): void {
  try {
    const all = loadSessionTokenStats();
    all[threadId] = {
      threadId,
      inputTokens: usage.inputTokens,
      outputTokens: usage.outputTokens,
      totalTokens: usage.estimatedTokens,
      messageCount: usage.messageCount,
      lastUpdated: Date.now(),
    };
    localStorage.setItem(SESSION_STATS_KEY, JSON.stringify(all));
  } catch {
    // localStorage unavailable or quota exceeded; session stats are best-effort
  }
}
