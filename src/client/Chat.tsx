import { PageReviewCard } from './PageReviewCard';
import { pageReviewSchema, pageReviewTool } from '../shared/page-review';
import { AskQuestionCard } from './AskQuestionCard';
import { askQuestionSchema, askQuestionTool } from '../shared/ask-question';
import { CompactToolCard, getToolMeta } from './CompactToolCard';
import { computerToolResult } from './ComputerToolCard';
import { contextualMessage, type PageContext } from './page-context';
import { api } from './api';
import type { Page } from '../server/pages';
import {
  useEffect,
  useRef,
  useState,
  type ClipboardEvent as ReactClipboardEvent,
  type DragEvent as ReactDragEvent,
} from 'react';
import {
  CopilotChatToolCallsView,
  useRenderTool,
  useHumanInTheLoop,
  useAgent,
  useCopilotKit,
} from '@copilotkit/react-core/v2';
import {
  FilePlus,
  ArrowUp,
  Plus,
  Clock3,
  Link2,
  Phone,
  PhoneOff,
  Square,
  X,
  ChevronDown,
  Brain,
  Search,
  BarChart2,
  Mic,
  AudioLines,
  Lightbulb,
  FileText,
  ArrowUpRight,
  Trash2,
  Paperclip,
  Image as ImageIcon,
  FolderOpen,
  FolderGit2,
  FileUp,
} from 'lucide-react';
import { useSpeechToText, STT_MODELS } from './useSpeechToText';
import { cleanClipboardHtml, isRichClipboardHtml } from './paste-utils';
import {
  ComputerToolCard,
  type ComputerToolRenderProps,
} from './ComputerToolCard';
import { ChatTranscript, isInternalSystemPrompt } from './ChatTranscript';
import type {
  Artifact,
  CallReceipt,
  Conversation,
  Dot,
} from '../shared/types';
import ReactMarkdown from 'react-markdown';
import { Mascot } from './Mascot';
import { useVoice } from './useVoice';
import { CallView } from './CallView';
import { ConfirmDeleteModal } from './ConfirmDeleteModal';
import {
  SlashCommandsMenu,
  SLASH_COMMANDS,
  type SlashCommand,
} from './SlashCommandsMenu';
import { calculateTokenUsage, recordSessionTokenStats } from './token-counter';

interface ChatAttachment {
  id: string;
  name: string;
  mime: string;
  size: number;
  kind: 'image' | 'text' | 'file';
  textContent?: string;
  dataUrl?: string;
  /** Original bytes, kept so binaries upload intact to the server. */
  file?: File;
}

function isImageMime(mime: string, name: string): boolean {
  if (mime.startsWith('image/')) return true;
  return /\.(png|jpe?g|gif|webp|svg|bmp|ico)$/i.test(name);
}

function isTextReadable(mime: string, name: string): boolean {
  if (mime.startsWith('text/')) return true;
  if (
    mime.includes('json') ||
    mime.includes('javascript') ||
    mime.includes('typescript')
  )
    return true;
  return /\.(ts|tsx|js|jsx|py|go|rs|java|rb|php|c|h|cpp|hpp|cs|swift|kt|kts|dart|lua|r|vue|svelte|css|scss|less|html|md|mdx|txt|json|jsonl|yml|yaml|toml|ini|cfg|sh|bash|zsh|sql|xml|csv|tsv|dockerfile|makefile|gradle|properties|env)$/i.test(
    name,
  );
}

/** Models with no vision input — images sent to these arrive as text only. */
function isVisionCapableModel(model: string): boolean {
  const m = model.toLowerCase();
  if (m.includes('deepseek-chat') || m.includes('deepseek-reasoner'))
    return false;
  if (
    m.includes('deepseek-r1') ||
    (m.includes('deepseek-v3') && !m.includes('flash'))
  )
    return false;
  return true;
}

/**
 * Downscale large images client-side so vision models receive an intact
 * (never truncated) data URL. Mirrors OpenCode's drag-drop attach behaviour:
 * screenshots stay PNG, photos compress to JPEG. Max side 1568px.
 */
function downscaleImage(
  file: File,
): Promise<{ dataUrl: string; mime: string }> {
  return new Promise((resolve) => {
    const fallback = () => {
      const r = new FileReader();
      r.onload = () =>
        resolve({
          dataUrl: String(r.result || ''),
          mime: file.type || 'image/png',
        });
      r.readAsDataURL(file);
    };
    try {
      const url = URL.createObjectURL(file);
      const img = new Image();
      img.onload = () => {
        try {
          const MAX = 1568;
          const scale = Math.min(
            1,
            MAX / Math.max(img.width || 1, img.height || 1),
          );
          const w = Math.max(1, Math.round((img.width || 1) * scale));
          const h = Math.max(1, Math.round((img.height || 1) * scale));
          const canvas = document.createElement('canvas');
          canvas.width = w;
          canvas.height = h;
          const ctx = canvas.getContext('2d');
          if (!ctx) throw new Error('no 2d context');
          ctx.drawImage(img, 0, 0, w, h);
          URL.revokeObjectURL(url);
          const srcMime = file.type || 'image/png';
          const outMime =
            srcMime === 'image/png' || srcMime === 'image/webp'
              ? srcMime
              : 'image/jpeg';
          resolve({ dataUrl: canvas.toDataURL(outMime, 0.85), mime: outMime });
        } catch {
          URL.revokeObjectURL(url);
          fallback();
        }
      };
      img.onerror = () => {
        URL.revokeObjectURL(url);
        fallback();
      };
      img.src = url;
    } catch {
      fallback();
    }
  });
}

function formatModelName(model: string): string {
  if (model.includes('fledge-alpha-free')) return 'Fledge Alpha (Free)';
  if (model.includes('ling-3.1-flash-free')) return 'Ling 3.1 Flash (Free)';
  if (model.includes('big-pickle')) return 'Big Pickle (Free)';
  if (model.includes('space-bunny-free')) return 'Space Bunny (Free)';
  if (model.includes('nemotron-3.5-lightning-free'))
    return 'Nemotron 3.5 (Free)';
  if (model.includes('longcat-2.5-preview-free')) return 'LongCat 2.5 (Free)';
  if (model.includes('mimo-v2.6-flash-free')) return 'Mimo 2.6 (Free)';
  if (model.includes('muse-spark-1.3-contributor-free'))
    return 'Muse Spark (Free)';
  if (model.includes('sonnet')) return 'Sonnet 3.7';
  if (model.includes('gpt-4o')) return 'GPT-4o';
  if (model.includes('gemini-2.5-pro')) return 'Gemini 2.5 Pro';
  if (model.includes('gemini-3.8-live')) return 'Gemini 3.8 Live';
  if (model.includes('deepseek-reasoner')) return 'DeepSeek R1';
  if (model.includes('deepseek-chat')) return 'DeepSeek V3';
  if (model === 'auto-code') return 'Auto Code';
  if (model === 'auto-complex') return 'Auto Complex';
  return model.replace(/^models\//, '').replace(/^opencode\//, '');
}

function formatEffortName(effort: string): string {
  if (!effort || effort === 'default' || effort === 'medium') return 'Medium';
  if (effort === 'low') return 'Low';
  if (effort === 'high') return 'High';
  if (effort === 'xhigh') return 'Extra High';
  if (effort === 'max') return 'Max';
  return effort.charAt(0).toUpperCase() + effort.slice(1);
}

const EFFORT_LEVELS = [
  { id: 'low', label: 'Low', desc: 'Brief thinking for simple tasks' },
  {
    id: 'default',
    label: 'Medium',
    desc: 'Balanced analytical reasoning (default)',
  },
  { id: 'high', label: 'High', desc: 'Deep problem solving & verification' },
  {
    id: 'xhigh',
    label: 'Extra High',
    desc: 'Intensive reasoning for tough problems',
  },
  { id: 'max', label: 'Max', desc: 'Maximum reasoning token budget' },
];

/**
 * Floating "Add to chat" action for text selected inside the transcript.
 * Selecting a passage pops a small quote button; clicking it drops the
 * selection into the composer as a markdown quote ready to ask about.
 */
function SelectionQuoteMenu({ onQuote }: { onQuote: (text: string) => void }) {
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const textRef = useRef('');
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => {
    const update = () => {
      const selection = window.getSelection();
      if (
        !selection ||
        selection.isCollapsed ||
        selection.rangeCount === 0
      ) {
        setPos(null);
        return;
      }
      const selected = selection.toString().trim();
      const anchor = selection.anchorNode;
      const element =
        anchor?.nodeType === Node.ELEMENT_NODE
          ? (anchor as Element)
          : (anchor?.parentElement ?? null);
      // Only selections made inside the transcript — not the composer or UI.
      if (
        !selected ||
        selected.length > 4000 ||
        !element?.closest('.chat-transcript')
      ) {
        setPos(null);
        return;
      }
      const rect = selection.getRangeAt(0).getBoundingClientRect();
      setPos({
        top: Math.max(8, rect.top - 38),
        left: Math.min(Math.max(8, rect.left), window.innerWidth - 180),
      });
      textRef.current = selected;
    };
    const debounced = () => {
      clearTimeout(timer.current);
      timer.current = setTimeout(update, 150);
    };
    document.addEventListener('selectionchange', debounced);
    const hide = () => setPos(null);
    window.addEventListener('scroll', hide, true);
    window.addEventListener('resize', hide);
    return () => {
      document.removeEventListener('selectionchange', debounced);
      window.removeEventListener('scroll', hide, true);
      window.removeEventListener('resize', hide);
      clearTimeout(timer.current);
    };
  }, []);
  if (!pos) return null;
  return (
    <button
      type="button"
      className="selection-quote-btn"
      style={{ top: pos.top, left: pos.left }}
      // preventDefault keeps the text selected until the quote is applied.
      onMouseDown={(e) => e.preventDefault()}
      onClick={() => {
        onQuote(textRef.current);
        setPos(null);
        window.getSelection()?.removeAllRanges();
      }}
    >
      ＋ Add to chat
    </button>
  );
}

export function Chat({
  thread,
  dot,
  initialPrompt,
  onConsumed,
  voiceReady,
  calls,
  paused,
  onSaved,
  onSchedule,
  onComputer,
  onDeleteConversation,
  onOpenSettings,
  onOpenTasks,
  onNewChat,
  onForked,
}: {
  thread: Conversation;
  dot: Dot;
  initialPrompt?: string;
  onConsumed: () => void;
  voiceReady: boolean;
  calls: CallReceipt[];
  paused: boolean;
  onSaved: () => void;
  onSchedule: () => void;
  onComputer?: () => void;
  onDeleteConversation?: () => void;
  onOpenSettings?: (tab?: string) => void;
  onOpenTasks?: () => void;
  onNewChat?: () => void;
  onForked?: (threadId: string) => void;
}) {
  const { agent, isReady } = useAgent({
    agentId: `chat-${thread.id}`,
    runtimeAgentId: dot.id,
    threadId: thread.id,
  });
  const { copilotkit } = useCopilotKit();
  const [pageContext, setPageContext] = useState<PageContext | null>();
  const [contextError, setContextError] = useState('');
  const [contextAttempt, setContextAttempt] = useState(0);
  const [confirmDeleteOpen, setConfirmDeleteOpen] = useState(false);
  // /btw side answers: shown as an ephemeral card, never in chat context.
  const [btw, setBtw] = useState<{ question: string; reply: string } | null>(
    null,
  );
  const [btwRunning, setBtwRunning] = useState(false);
  // Generative UI: artifacts the Dot creates render in a live side panel.
  const [artifacts, setArtifacts] = useState<Artifact[]>([]);
  const [artifactsOpen, setArtifactsOpen] = useState(false);
  const [selectedArtifactId, setSelectedArtifactId] = useState<
    string | null
  >(null);
  const knownArtifactIds = useRef<Set<string>>(new Set());
  const refreshArtifacts = () =>
    void api<Artifact[]>(`/artifacts?threadId=${thread.id}`, 'GET')
      .then((list) => {
        setArtifacts(Array.isArray(list) ? list : []);
        // Auto-open the panel when this turn created new artifacts.
        const fresh = (list ?? []).filter(
          (a) => !knownArtifactIds.current.has(a.id),
        );
        for (const a of list ?? []) knownArtifactIds.current.add(a.id);
        if (fresh.length > 0 && list.length > 0) {
          setSelectedArtifactId((current) => current ?? list[0]!.id);
          setArtifactsOpen(true);
        }
      })
      .catch(() => setArtifacts([]));
  useEffect(() => {
    knownArtifactIds.current = new Set();
    setArtifacts([]);
    setSelectedArtifactId(null);
    setArtifactsOpen(false);
    refreshArtifacts();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [thread.id]);
  const contextReady = pageContext !== undefined;
  useEffect(() => {
    let active = true;
    setPageContext(undefined);
    setContextError('');
    void api<PageContext | null>(
      `/conversations/${thread.id}/page-context`,
      'GET',
      undefined,
      AbortSignal.timeout(10000),
    )
      .then((page) => {
        if (active) setPageContext(page);
      })
      .catch(() => {
        if (active)
          setContextError(
            'Conversation context could not load. Retry before sending your message.',
          );
      });
    return () => {
      active = false;
    };
  }, [thread.id, contextAttempt]);
  const [draft, setDraft] = useState('');
  const [source, setSource] = useState('');
  const [sourceOpen, setSourceOpen] = useState(false);
  const [error, setError] = useState('');
  const [loaded, setLoaded] = useState(false);
  const [running, setRunning] = useState(false);
  const [currentModel, setCurrentModel] = useState(dot.model || 'auto-code');
  const [currentEffort, setCurrentEffort] = useState(
    dot.reasoningEffort || 'default',
  );
  const [modelOpen, setModelOpen] = useState(false);
  const [effortOpen, setEffortOpen] = useState(false);
  const [audioOpen, setAudioOpen] = useState(false);
  const [chatModelSearch, setChatModelSearch] = useState('');
  const modelPopoverRef = useRef<HTMLDivElement>(null);
  const effortPopoverRef = useRef<HTMLDivElement>(null);
  const audioPopoverRef = useRef<HTMLDivElement>(null);

  // Slash commands menu & context compaction state (DSH & OpenWork style)
  const [slashMenuOpen, setSlashMenuOpen] = useState(false);
  const [slashSelectedIndex, setSlashSelectedIndex] = useState(0);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [compactMessage, setCompactMessage] = useState<string | null>(null);
  // The removed tail of the latest revert, held for the Undo affordance.
  const [undoTail, setUndoTail] = useState<
    Array<{ id: string; role: string; content: string }> | null
  >(null);
  const [attachments, setAttachments] = useState<ChatAttachment[]>([]);
  const [attachMenuOpen, setAttachMenuOpen] = useState(false);
  // Whole-window file drop: a depth counter keeps the overlay steady while
  // the cursor crosses child elements.
  const [dropActive, setDropActive] = useState(false);
  const dropDepth = useRef(0);
  const pasteCount = useRef(0);
  const [fullDirPath, setFullDirPath] = useState('');
  const [dirOpen, setDirOpen] = useState(false);
  const [dirDraft, setDirDraft] = useState('');
  const [dirStatus, setDirStatus] = useState('');
  const [dirIsGit, setDirIsGit] = useState(false);
  const [dirSaving, setDirSaving] = useState(false);
  const [browsePath, setBrowsePath] = useState('');
  const [browseParent, setBrowseParent] = useState('');
  // Refresh artifacts after each turn so new panels appear without a reload.
  useEffect(() => {
    if (!running) refreshArtifacts();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [running]);
  const [browseEntries, setBrowseEntries] = useState<
    Array<{ name: string; path: string }>
  >([]);
  const [browseLoading, setBrowseLoading] = useState(false);
  const [browseError, setBrowseError] = useState('');
  const [browseOpen, setBrowseOpen] = useState(false);

  const loadBrowse = async (path?: string) => {
    const target = (path ?? dirDraft.trim() ?? fullDirPath ?? '').trim();
    setBrowseLoading(true);
    setBrowseError('');
    try {
      const data = await api<{
        path: string;
        parent: string;
        entries: { name: string; path: string }[];
      }>(
        `/workspace/browse${target ? `?path=${encodeURIComponent(target)}` : ''}`,
      );
      setBrowsePath(data.path);
      setBrowseParent(data.parent);
      setBrowseEntries(data.entries ?? []);
      setBrowseOpen(true);
    } catch (error) {
      setBrowseError(
        error instanceof Error
          ? error.message
          : 'Could not reach server to browse folders.',
      );
    } finally {
      setBrowseLoading(false);
    }
  };
  const fileInputRef = useRef<HTMLInputElement>(null);
  const imageInputRef = useRef<HTMLInputElement>(null);
  const attachMenuRef = useRef<HTMLDivElement>(null);
  const dirPopoverRef = useRef<HTMLDivElement>(null);

  const stt = useSpeechToText((text) => {
    setDraft((prev) => (prev ? `${prev} ${text}` : text));
  });

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (
        modelPopoverRef.current &&
        !modelPopoverRef.current.contains(e.target as Node)
      ) {
        setModelOpen(false);
      }
      if (
        effortPopoverRef.current &&
        !effortPopoverRef.current.contains(e.target as Node)
      ) {
        setEffortOpen(false);
      }
      if (
        audioPopoverRef.current &&
        !audioPopoverRef.current.contains(e.target as Node)
      ) {
        setAudioOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const handleDraftChange = (text: string) => {
    setDraft(text);
    if (text.startsWith('/') && !text.includes('\n')) {
      setSlashMenuOpen(true);
      setSlashSelectedIndex(0);
    } else {
      setSlashMenuOpen(false);
    }
  };

  const handleCompact = async () => {
    try {
      setDraft('');
      setRunning(true);
      const res = await api<{ success: boolean; compacted: boolean }>(
        `/conversations/${thread.id}/compact`,
        'POST',
      );
      if (res?.compacted) {
        setCompactMessage(
          '⚡ Context compacted successfully! Token load minimized.',
        );
        setTimeout(() => setCompactMessage(null), 4000);
        await copilotkit.connectAgent({ agent });
        onSaved();
      } else {
        setCompactMessage('Context is already optimal.');
        setTimeout(() => setCompactMessage(null), 3000);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not compact context.');
    } finally {
      setRunning(false);
    }
  };

  const handleClear = async () => {
    try {
      setDraft('');
      await api(`/conversations/${thread.id}/clear`, 'POST');
      await copilotkit.connectAgent({ agent });
      onSaved();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not clear messages.');
    }
  };

  // Fork: a new chat carrying history up to (and including) the chosen
  // message. The original is untouched — the safe branch point.
  const handleForkFrom = async (messageId: string) => {
    try {
      const forked = await api<Conversation>(
        `/conversations/${thread.id}/fork`,
        'POST',
        { uptoMessageId: messageId },
      );
      if (onForked && forked?.id) {
        setCompactMessage(`Forked into “${forked.title}” — switching you there.`);
        setTimeout(() => setCompactMessage(null), 3000);
        onForked(forked.id);
      } else {
        onSaved();
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not fork the chat.');
    }
  };

  // Edit-and-resend: rewrite the message, drop later turns, reload.
  const handleEditMessage = async (messageId: string, content: string) => {
    try {
      await api(`/conversations/${thread.id}/edit`, 'POST', {
        messageId,
        content,
      });
      await copilotkit.connectAgent({ agent });
      onSaved();
      // Continue the conversation from the corrected message.
      void send(content);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not edit the message.');
    }
  };

  // Revert in place: history up to this message stays, the rest is dropped.
  // The removed tail comes back from the server so it can be restored.
  const handleRevertTo = async (messageId: string) => {
    try {
      const res = await api<{
        removed: number;
        tail: Array<{ id: string; role: string; content: string }>;
      }>(`/conversations/${thread.id}/revert`, 'POST', { messageId });
      await copilotkit.connectAgent({ agent });
      onSaved();
      setUndoTail(res.tail?.length ? res.tail : null);
      setCompactMessage(
        `Reverted — ${res.removed} message${res.removed === 1 ? '' : 's'} removed.`,
      );
      setTimeout(() => {
        setCompactMessage(null);
        setUndoTail(null);
      }, 8000);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not revert the chat.');
    }
  };

  // Undo for revert: the server appends the removed tail back as a fresh
  // snapshot row, so nothing that followed is lost.
  const handleUndoRevert = async () => {
    if (!undoTail) return;
    try {
      await api(`/conversations/${thread.id}/restore`, 'POST', {
        tail: undoTail,
      });
      setUndoTail(null);
      await copilotkit.connectAgent({ agent });
      onSaved();
      setCompactMessage('Restored the removed messages.');
      setTimeout(() => setCompactMessage(null), 3000);
    } catch (e) {
      setError(
        e instanceof Error ? e.message : 'Could not restore the messages.',
      );
    }
  };

  // Quote a passage selected in the transcript into the composer.
  const quoteSelection = (text: string) => {
    const quoted = text
      .split('\n')
      .map((line) => `> ${line}`)
      .join('\n');
    setDraft((prev) =>
      prev.trim() ? `${prev}\n\n${quoted}\n\n` : `${quoted}\n\n`,
    );
    textareaRef.current?.focus();
  };

  // /btw: a side question answered in a throwaway conversation; the reply
  // shows in this chat as an ephemeral card and never enters its context.
  const askBtw = async (question: string) => {
    setBtwRunning(true);
    setError('');
    try {
      const res = await api<{ reply: string }>(
        `/conversations/${thread.id}/btw`,
        'POST',
        { question },
      );
      setBtw({ question, reply: res.reply });
    } catch (e) {
      setError(e instanceof Error ? e.message : 'The side question failed.');
    } finally {
      setBtwRunning(false);
    }
  };

  const sendSchedule = async (
    intervalSeconds: number | null,
    objective: string,
  ) => {
    if (!objective && intervalSeconds !== null) {
      setError(
        'Tell me what to schedule after the interval, e.g. /schedule 3600 check my inbox',
      );
      return;
    }
    setError('');
    setRunning(true);
    userStoppedRef.current = false;
    runErrorRef.current = null;
    const commandLine = `/schedule${intervalSeconds ? ` ${intervalSeconds}` : ''}${objective ? ` ${objective}` : ''}`;
    const instruction = `\n\nUnfold this schedule request: call manage_schedule with action 'draft', a precise instructions text for the objective, and intervalSeconds ${intervalSeconds ?? 'null'} (null = ask me for the interval first). Then confirm with ask_question whether to start it, and only start on explicit approval.`;
    agent.addMessage({
      id: crypto.randomUUID(),
      role: 'user',
      content: commandLine + instruction,
    });
    const MAX_RETRIES = 5;
    let turnSuccess = false;
    let lastError: unknown = null;
    const initialMessageCount = agent.messages.length;
    try {
      for (let attempt = 1; attempt <= MAX_RETRIES + 1; attempt++) {
        try {
          runErrorRef.current = null;
          if (attempt > 1) {
            setError(`Scheduling failed. Retrying (${attempt - 1}/${MAX_RETRIES})…`);
            if (agent.messages.length > initialMessageCount) {
              agent.setMessages(agent.messages.slice(0, initialMessageCount));
            }
            await new Promise((r) => setTimeout(r, Math.min(1000 * Math.pow(1.4, attempt - 2), 4000)));
          }
          if (userStoppedRef.current) break;
          const result = await copilotkit.runAgent({ agent });
          if (userStoppedRef.current) break;
          if (runErrorRef.current) throw new Error(runErrorRef.current);
          if (!result.newMessages.some((message) => message.role === 'assistant'))
            throw new Error('The current turn returned no response.');
          setError('');
          onSaved();
          turnSuccess = true;
          break;
        } catch (e) {
          lastError = e;
          const msg = e instanceof Error ? e.message : String(e);
          if (userStoppedRef.current || (e instanceof Error && (e.name === 'AbortError' || /abort|cancel|stop/i.test(msg)))) break;
          console.warn(`[Chat] Schedule attempt ${attempt} failed:`, e);
          if (attempt <= MAX_RETRIES) continue;
        }
      }
      if (!turnSuccess && lastError && !userStoppedRef.current) {
        setError(
          lastError instanceof Error
            ? `${lastError.message} (failed after ${MAX_RETRIES} retries)`
            : 'Scheduling failed after retries.',
        );
      }
    } finally {
      setRunning(false);
      userStoppedRef.current = false;
    }
  };

  const handleSelectSlashCommand = (cmd: SlashCommand) => {
    setSlashMenuOpen(false);
    if (cmd.id === 'compact') {
      void handleCompact();
    } else if (cmd.id === 'clear') {
      void handleClear();
    } else if (cmd.id === 'mcp') {
      if (onOpenSettings) {
        onOpenSettings('connectors');
      } else {
        void send('/mcp');
      }
    } else if (cmd.id === 'skills') {
      if (onOpenSettings) {
        onOpenSettings('skills');
      } else {
        void send('/skills');
      }
    } else if (cmd.id === 'model') {
      if (onOpenSettings) {
        onOpenSettings('models');
      } else {
        void send('/model');
      }
    } else if (cmd.id === 'tasks') {
      if (onOpenTasks) {
        onOpenTasks();
      } else {
        void send('/tasks');
      }
    } else if (cmd.id === 'new') {
      if (onNewChat) {
        onNewChat();
      } else {
        void send('/new');
      }
    } else if (cmd.id === 'subagents') {
      setDraft('/subagents ');
      textareaRef.current?.focus();
    } else if (cmd.id === 'help') {
      void send('/help');
    } else if (cmd.placeholder) {
      setDraft(cmd.placeholder);
      textareaRef.current?.focus();
    } else {
      setDraft(`${cmd.command} `);
      textareaRef.current?.focus();
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (slashMenuOpen) {
      const query = draft.startsWith('/')
        ? draft.slice(1).toLowerCase()
        : draft.toLowerCase();
      const filtered = SLASH_COMMANDS.filter(
        (cmd) =>
          cmd.command.toLowerCase().includes(query) ||
          cmd.name.toLowerCase().includes(query) ||
          cmd.description.toLowerCase().includes(query),
      );
      if (filtered.length > 0) {
        if (e.key === 'ArrowDown') {
          e.preventDefault();
          setSlashSelectedIndex((prev) => (prev + 1) % filtered.length);
          return;
        }
        if (e.key === 'ArrowUp') {
          e.preventDefault();
          setSlashSelectedIndex(
            (prev) => (prev - 1 + filtered.length) % filtered.length,
          );
          return;
        }
        if (e.key === 'Enter' || e.key === 'Tab') {
          const selected =
            filtered[Math.min(slashSelectedIndex, filtered.length - 1)];
          if (selected) {
            e.preventDefault();
            handleSelectSlashCommand(selected);
            return;
          }
        }
        if (e.key === 'Escape') {
          e.preventDefault();
          setSlashMenuOpen(false);
          return;
        }
      }
    }
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      e.currentTarget.form?.requestSubmit();
    }
  };

  const [modelOptions, setModelOptions] = useState<string[]>([
    'auto-code',
    'auto-complex',
    'deepseek-chat',
    'deepseek-reasoner',
    'deepseek-v4-pro',
    'kimi-k2.6',
    'qwen3.8-27b',
    'gemini-2.5-pro',
    'claude-3-7-sonnet',
    'gpt-4o',
  ]);

  const [connectedDir, setConnectedDir] = useState<string>('');
  const [codingEnabled, setCodingEnabled] = useState(true);

  useEffect(() => {
    void api<{ models?: string[] }>('/models')
      .then((data) => {
        if (data && Array.isArray(data.models) && data.models.length > 0) {
          setModelOptions(data.models);
        }
      })
      .catch(() => {
        /* model list unavailable; fallback list stays in place */
      });

    void api<{
      directory?: string;
      isGit?: boolean;
      codingEnabled?: boolean;
    }>('/workspace/directory')
      .then((data) => {
        if (data && data.directory) {
          setFullDirPath(data.directory);
          setDirDraft(data.directory);
          const parts = data.directory.split('/');
          setConnectedDir(parts[parts.length - 1] || data.directory);
          setDirIsGit(!!data.isGit);
          if (typeof data.codingEnabled === 'boolean')
            setCodingEnabled(data.codingEnabled);
        } else {
          // Blank by default: no folder connected — pure chat.
          setFullDirPath('');
          setConnectedDir('');
          setDirDraft('');
          setDirIsGit(false);
          if (data && typeof data.codingEnabled === 'boolean')
            setCodingEnabled(data.codingEnabled);
        }
      })
      .catch(() => {
        /* directory unavailable; folder pill stays in its last state */
      });
  }, []);

  useEffect(() => {
    const onDocClick = (e: MouseEvent) => {
      if (
        attachMenuRef.current &&
        !attachMenuRef.current.contains(e.target as Node)
      ) {
        setAttachMenuOpen(false);
      }
      if (
        dirPopoverRef.current &&
        !dirPopoverRef.current.contains(e.target as Node)
      ) {
        setDirOpen(false);
      }
    };
    document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, []);

  const refreshDirectory = async () => {
    try {
      const data = await api<{
        directory?: string;
        isGit?: boolean;
        codingEnabled?: boolean;
      }>('/workspace/directory');
      if (data?.directory) {
        setFullDirPath(data.directory);
        setDirDraft(data.directory);
        const parts = data.directory.split('/');
        setConnectedDir(parts[parts.length - 1] || data.directory);
        setDirIsGit(!!data.isGit);
        if (typeof data.codingEnabled === 'boolean')
          setCodingEnabled(data.codingEnabled);
      } else {
        setFullDirPath('');
        setConnectedDir('');
        setDirIsGit(false);
        if (data && typeof data.codingEnabled === 'boolean')
          setCodingEnabled(data.codingEnabled);
      }
    } catch {
      /* refresh is best-effort; keep last known folder state */
    }
  };

  const toggleFolderTools = async () => {
    const next = !codingEnabled;
    setCodingEnabled(next);
    try {
      await api('/settings', 'PATCH', { codingEnabled: next });
      onSaved();
    } catch {
      setCodingEnabled(!next);
      setDirStatus('Could not save folder toggle.');
    }
  };

  const handleConnectDirectory = async () => {
    const target = dirDraft.trim();
    if (!target) {
      setDirStatus('Enter an absolute folder path, e.g. /Users/you/my-project');
      return;
    }
    setDirSaving(true);
    setDirStatus('');
    try {
      const data = await api<{ directory: string; isGit?: boolean }>(
        '/workspace/directory',
        'POST',
        { directory: target },
      );
      setFullDirPath(data.directory);
      const parts = String(data.directory).split('/');
      setConnectedDir(parts[parts.length - 1] || data.directory);
      setDirIsGit(!!data.isGit);
      setDirStatus(`Connected — tools now run in ${data.directory}`);
      onSaved();
    } catch (error) {
      setDirStatus(
        error instanceof Error
          ? error.message
          : 'Could not reach server to verify directory.',
      );
    } finally {
      setDirSaving(false);
    }
  };

  const handleDisconnectDirectory = async () => {
    setDirSaving(true);
    setDirStatus('');
    try {
      await api('/workspace/directory', 'POST', { directory: null });
      setFullDirPath('');
      setConnectedDir('');
      setDirDraft('');
      setDirIsGit(false);
      setBrowseOpen(false);
      setDirStatus('Disconnected — pure chat, no local files.');
      onSaved();
    } catch (error) {
      setDirStatus(
        error instanceof Error
          ? error.message
          : 'Could not disconnect the folder.',
      );
    } finally {
      setDirSaving(false);
    }
  };

  // Native OS folder picker (Finder on macOS, File Explorer on Windows).
  // Browsers hide the absolute path for security, so the picked folder name
  // is only a hint: the owner confirms the matching server path below via
  // Browse… (starts at the home directory when blank) or by typing it.
  const dirNativeInputRef = useRef<HTMLInputElement>(null);
  const handleNativeFolderHint = (name: string) => {
    const clean = name.trim();
    if (clean) {
      setDirStatus(
        `Picked “${clean}” on this device — now select the same folder below (Browse…) or type its full path, then Verify & Connect.`,
      );
    }
    setBrowseOpen(true);
    void loadBrowse();
  };
  const handleNativeFolderPick = async () => {
    const w = window as unknown as {
      showDirectoryPicker?: () => Promise<{ name?: string }>;
    };
    if (typeof w.showDirectoryPicker === 'function') {
      try {
        const handle = await w.showDirectoryPicker();
        if (handle?.name) handleNativeFolderHint(String(handle.name));
      } catch {
        /* the owner cancelled the native dialog */
      }
      return;
    }
    // Fallback for browsers without showDirectoryPicker: the classic
    // webkitdirectory input still pops the native OS folder dialog.
    dirNativeInputRef.current?.click();
  };
  const handleNativeFolderFiles = (files: FileList | null) => {
    if (!files || files.length === 0) return;
    const first = files[0];
    const top =
      (first.webkitRelativePath || first.name || '').split('/')[0] || '';
    if (dirNativeInputRef.current) dirNativeInputRef.current.value = '';
    handleNativeFolderHint(top);
  };

  const handleFilesSelected = async (
    files: FileList | File[] | null,
    forceImage = false,
  ) => {
    if (!files || files.length === 0) return;
    // No count limit on images; a generous total cap keeps one click from
    // staging the whole disk. The server enforces 50MB per file on upload.
    const list = Array.from(files).slice(0, 64);
    const next: ChatAttachment[] = [];
    for (const file of list) {
      if (file.size > 50 * 1024 * 1024) {
        setError(`"${file.name}" exceeds 50MB and was skipped.`);
        continue;
      }
      const id = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
      const mime = file.type || 'application/octet-stream';
      const image = forceImage || isImageMime(mime, file.name);
      if (image) {
        const { dataUrl, mime: outMime } = await downscaleImage(file);
        if (!dataUrl) {
          setError(`"${file.name}" could not be read as an image.`);
          continue;
        }
        next.push({
          id,
          name: file.name,
          mime: outMime,
          size: file.size,
          kind: 'image',
          dataUrl,
          file,
        });
      } else if (isTextReadable(mime, file.name) && file.size < 1024 * 1024) {
        const textContent = await file.text().catch(() => '');
        next.push({
          id,
          name: file.name,
          mime,
          size: file.size,
          kind: 'text',
          textContent: textContent.slice(0, 60000),
          file,
        });
      } else if (mime === 'application/pdf' || /\.pdf$/i.test(file.name)) {
        next.push({
          id,
          name: file.name,
          mime: mime === 'application/octet-stream' ? 'application/pdf' : mime,
          size: file.size,
          kind: 'file',
          file,
        });
      } else {
        next.push({
          id,
          name: file.name,
          mime,
          size: file.size,
          kind: 'file',
          file,
        });
      }
    }
    if (next.length) {
      setAttachments((prev) => [...prev, ...next].slice(0, 64));
      setAttachMenuOpen(false);
    }
    if (fileInputRef.current) fileInputRef.current.value = '';
    if (imageInputRef.current) imageInputRef.current.value = '';
  };

  /**
   * Paste anything: files (Finder copies, screenshots), images hiding in
   * clipboard items, and rich content (Excel/Sheets tables, Word/Docs
   * passages, copied web content). Files attach as files; rich HTML rides
   * along as a text/html attachment so the Dot sees the real structure —
   * the plain text still lands in the composer as usual.
   */
  const handlePaste = (e: ReactClipboardEvent<HTMLTextAreaElement>) => {
    const dt = e.clipboardData;
    if (!dt) return;
    const files: File[] = Array.from(dt.files ?? []);
    if (files.length === 0) {
      // Some browsers only expose pasted images through items.
      for (const item of Array.from(dt.items ?? [])) {
        if (item.kind === 'file') {
          const file = item.getAsFile();
          if (file) files.push(file);
        }
      }
    }
    if (files.length > 0) {
      e.preventDefault();
      void handleFilesSelected(files);
      return;
    }
    const html = dt.getData('text/html');
    if (!isRichClipboardHtml(html)) return;
    const isTable = /<table[\s>]/i.test(html);
    const clean = cleanClipboardHtml(html, isTable);
    if (!clean.trim()) return;
    const n = ++pasteCount.current;
    const name = isTable ? `pasted-table-${n}.html` : `pasted-content-${n}.html`;
    void handleFilesSelected([
      new File([clean], name, { type: 'text/html' }),
    ]);
    // No preventDefault: the plain-text form of the paste still goes into
    // the composer, so the message reads naturally while the structured
    // version is attached above it.
  };

  const buildAttachmentContext = async (): Promise<string> => {
    if (attachments.length === 0) return '';
    // Upload every attachment that still has its original bytes so the Dot
    // can process binaries (list_uploads / push_upload_to_computer). Text and
    // image previews continue to inline as before.
    const uploadIds = new Map<string, string>();
    const toUpload = attachments.filter(
      (a): a is ChatAttachment & { file: File } => a.file !== undefined,
    );
    if (toUpload.length > 0) {
      try {
        const form = new FormData();
        for (const a of toUpload) form.append('file', a.file, a.name);
        form.append('threadId', thread.id);
        const res = await api<{ uploads: Array<{ id: string; name: string }> }>(
          '/files',
          'POST',
          form,
        );
        if (res?.uploads) {
          res.uploads.forEach((u, i) => {
            const attachment = toUpload[i];
            if (attachment) uploadIds.set(attachment.id, u.id);
          });
        }
      } catch (e) {
        console.warn('[Chat] Attachment upload failed:', e);
      }
    }
    // Auto-capture: text attachments go straight into this conversation's
    // task memory as raw markdown, so the full content is retrievable even
    // when the inline copy is truncated. Binaries are extracted agent-side.
    for (const a of attachments) {
      if (a.kind !== 'text' || a.textContent === undefined) continue;
      try {
        await api(`/conversations/${thread.id}/task-memory`, 'POST', {
          name: a.name,
          summary: `Attached file "${a.name}" — full raw content captured on upload.`,
          content: a.textContent,
          kind: 'file',
          source: a.name,
        });
      } catch {
        /* task-memory capture is best-effort; the inline copy still works */
      }
    }
    const parts: string[] = ['\n\n--- Attached files ---'];
    for (const a of attachments) {
      const uploadRef = uploadIds.get(a.id);
      const uploadNote = uploadRef
        ? ` Uploaded as id ${uploadRef}: call push_upload_to_computer with uploadId "${uploadRef}" to place it in your computer workspace for processing.`
        : '';
      if (a.kind === 'image' && a.dataUrl) {
        // Never truncate base64 — a sliced data URL is an unreadable image.
        // Vision models (GPT-4o, Gemini, deepseek-flash, OpenCode vision models)
        // read the markdown image below; text-only models (deepseek-chat/reasoner)
        // should ask the user for a description instead of guessing.
        parts.push(
          `\n[Attached image: ${a.name} (${a.mime}, ${Math.round(a.size / 1024)}KB)]${uploadNote}\n![${a.name}](${a.dataUrl})`,
        );
      } else if (a.kind === 'text' && a.textContent !== undefined) {
        const truncated =
          a.textContent.length >= 60000
            ? '\n[content truncated at 60000 chars — the FULL raw content was saved to task memory as an entry: read it with read_task_memory instead of asking the user to re-send]'
            : '';
        parts.push(
          `\n[Attached file: ${a.name}]${uploadNote}\n\`\`\`\n${a.textContent}\n\`\`\`${truncated}`,
        );
      } else if (/pdf$/i.test(a.mime) || /\.pdf$/i.test(a.name)) {
        parts.push(
          `\n[Attached file: ${a.name} (PDF, ${Math.round(a.size / 1024)}KB) — text was not inlined.${uploadRef ? ` Process it in your computer: push_upload_to_computer uploadId "${uploadRef}", then extract text with exec (e.g. a Python script or apk add poppler-utils for pdftotext).` : ' If the file lives in the connected coding workspace, read it with str_replace_editor view or bash.'}]`,
        );
      } else {
        parts.push(
          `\n[Attached file: ${a.name} (${a.mime}, ${Math.round(a.size / 1024)}KB) — binary.${uploadRef ? ` It is uploaded as id ${uploadRef}: use push_upload_to_computer to place it in your computer workspace, then analyze it there with exec (install tools first if needed, e.g. apk add python3 py3-pip).` : ' If it lives in the connected coding workspace, inspect it with str_replace_editor view / bash.'}]`,
        );
      }
    }
    return parts.join('\n');
  };

  useEffect(() => {
    setCurrentModel(dot.model || 'auto-code');
    setCurrentEffort(dot.reasoningEffort || 'default');
  }, [dot.model, dot.reasoningEffort]);

  const handleModelChange = async (newModel: string) => {
    setCurrentModel(newModel);
    try {
      await api(`/dots/${dot.id}`, 'PUT', {
        name: dot.name,
        instructions: dot.instructions,
        researchAllowed: dot.researchAllowed,
        memoryAllowed: dot.memoryAllowed,
        spaceId: dot.spaceId,
        spaceIds: dot.spaceIds,
        learningContainerId: dot.learningContainerId ?? null,
        skillDeliveryEnabled: dot.skillDeliveryEnabled ?? false,
        model: newModel,
        reasoningEffort: currentEffort,
      });
      onSaved();
    } catch {
      setError('Could not save the model choice. Reconnect and retry.');
    }
  };

  const handleEffortChange = async (newEffort: string) => {
    setCurrentEffort(newEffort);
    try {
      await api(`/dots/${dot.id}`, 'PUT', {
        name: dot.name,
        instructions: dot.instructions,
        researchAllowed: dot.researchAllowed,
        memoryAllowed: dot.memoryAllowed,
        spaceId: dot.spaceId,
        spaceIds: dot.spaceIds,
        learningContainerId: dot.learningContainerId ?? null,
        skillDeliveryEnabled: dot.skillDeliveryEnabled ?? false,
        model: currentModel,
        reasoningEffort: newEffort,
      });
      onSaved();
    } catch {
      setError('Could not save the effort choice. Reconnect and retry.');
    }
  };

  const voice = useVoice(thread.id, onSaved, agent.messages.at(-1)?.id);
  const sent = useRef(false);
  const bottom = useRef<HTMLDivElement>(null);
  const autoCallStarted = useRef(false);
  // Live reasoning stream: deltas land in the ref, UI state follows.
  const thinkingBuffer = useRef('');
  const [liveThinking, setLiveThinking] = useState('');
  const [finishedThinking, setFinishedThinking] = useState('');
  const [thinkingOpen, setThinkingOpen] = useState(false);
  const thinkingBodyRef = useRef<HTMLPreElement>(null);

  useEffect(() => {
    if (liveThinking && thinkingOpen && thinkingBodyRef.current)
      thinkingBodyRef.current.scrollTop = thinkingBodyRef.current.scrollHeight;
  }, [liveThinking, thinkingOpen]);
  useEffect(() => {
    if (
      !autoCallStarted.current &&
      loaded &&
      voice.status === 'idle' &&
      sessionStorage.getItem('opendots-autocall') === thread.id
    ) {
      autoCallStarted.current = true;
      sessionStorage.removeItem('opendots-autocall');
      void voice.start();
    }
  }, [loaded, thread.id, voice]);
  // A finished call may have written server-side turns (voice compute,
  // receipts) into this same thread. Reconnect so they appear in the open
  // chat without a manual reload — never mid text-turn.
  const seenEndedCalls = useRef<Set<string>>(new Set());
  useEffect(() => {
    const newlyEnded = calls.filter(
      (call) =>
        (call.status === 'ended' || call.status === 'failed') &&
        !seenEndedCalls.current.has(call.id),
    );
    if (newlyEnded.length === 0) return;
    for (const call of newlyEnded) seenEndedCalls.current.add(call.id);
    if (running) return;
    void copilotkit.connectAgent({ agent }).catch((e) => {
      setError(
        e instanceof Error
          ? e.message
          : 'Conversation could not reload after the call.',
      );
    });
  }, [calls, running, agent, copilotkit]);
  const runErrorRef = useRef<string | null>(null);
  const userStoppedRef = useRef(false);

  useEffect(() => {
    const subscription = copilotkit.subscribe({
      onError: ({ error }) => {
        runErrorRef.current = error.message;
        setError(error.message);
      },
    });
    const events = agent.subscribe({
      onRunErrorEvent: ({ event }) => {
        runErrorRef.current = event.message;
        setError(event.message);
      },
      // Live chain-of-thought streaming (REASONING_* AG-UI events from
      // reasoning models — DeepSeek/Qwen/GLM/Kimi style reasoning_content).
      onReasoningStartEvent: () => {
        thinkingBuffer.current = '';
        setLiveThinking('');
        setThinkingOpen(true);
      },
      onReasoningMessageContentEvent: ({ event }) => {
        if (typeof event.delta === 'string' && event.delta) {
          thinkingBuffer.current += event.delta;
          setLiveThinking(thinkingBuffer.current);
        }
      },
      onReasoningEndEvent: () => {
        if (thinkingBuffer.current) setFinishedThinking(thinkingBuffer.current);
        setLiveThinking('');
        setThinkingOpen(false);
      },
    });
    return () => {
      subscription.unsubscribe();
      events.unsubscribe();
    };
  }, [agent, copilotkit]);
  useEffect(() => {
    if (!isReady) return;
    let active = true;
    void copilotkit
      .connectAgent({ agent })
      .then(() => {
        if (active) setLoaded(true);
      })
      .catch((e) => {
        if (active)
          setError(
            e instanceof Error ? e.message : 'Conversation could not connect.',
          );
      });
    return () => {
      active = false;
    };
  }, [agent, copilotkit, isReady]);
  const send = async (text: string) => {
    const hasAttachments = attachments.length > 0;
    if (
      (!text.trim() && !hasAttachments) ||
      running ||
      !loaded ||
      !contextReady ||
      paused
    )
      return;
    const trimmed =
      text.trim() ||
      (hasAttachments
        ? `Please review the attached file(s): ${attachments.map((a) => a.name).join(', ')}`
        : '');
    if (trimmed.startsWith('/btw')) {
      const question = trimmed.slice(4).trim();
      setDraft('');
      if (!question) {
        setError('Add your question after /btw, e.g. /btw what is the deploy command?');
        return;
      }
      void askBtw(question);
      return;
    }
    if (trimmed === '/compact') {
      void handleCompact();
      return;
    }
    if (trimmed === '/clear') {
      void handleClear();
      return;
    }
    if (trimmed === '/mcp') {
      setDraft('');
      if (onOpenSettings) {
        onOpenSettings('connectors');
      } else {
        setCompactMessage('Opening MCP Servers configuration…');
        setTimeout(() => setCompactMessage(null), 3000);
      }
      return;
    }
    let outgoing = text;
    if (trimmed === '/skills') {
      setDraft('');
      if (onOpenSettings) {
        onOpenSettings('skills');
        setCompactMessage('Opening the skill library…');
        setTimeout(() => setCompactMessage(null), 3000);
        return;
      }
      outgoing =
        'List your available skills: call list_skills, then summarize each skill name and description so I can pick one for you to use.';
    } else if (trimmed === '/model') {
      setDraft('');
      if (onOpenSettings) {
        onOpenSettings('models');
        setCompactMessage('Opening model settings…');
        setTimeout(() => setCompactMessage(null), 3000);
        return;
      }
      outgoing =
        'Which model are you running on right now? Briefly state your current model, and tell me how to switch models from Settings.';
    } else if (trimmed === '/tasks') {
      setDraft('');
      if (onOpenTasks) {
        onOpenTasks();
        return;
      }
      outgoing =
        'List every task and schedule in this workspace: call manage_schedule with action "list", then summarize each task with its status, interval, and next run.';
    } else if (trimmed === '/new') {
      setDraft('');
      if (onNewChat) {
        onNewChat();
        return;
      }
      outgoing =
        'We are starting fresh. Acknowledge briefly and ignore prior context.';
    } else if (trimmed.startsWith('/schedule')) {
      const rest = trimmed.slice(9).trim();
      const match = rest.match(/^(\d+)\s*(.*)$/);
      const interval = match ? Number(match[1]) : null;
      const objective = match ? match[2].trim() : rest;
      setDraft('');
      void sendSchedule(interval, objective);
      return;
    }
    if (trimmed.startsWith('/memory ')) {
      const memContent = trimmed.slice(8).trim();
      if (memContent) {
        let isSession = false;
        let isGlobal = false;
        let category = 'note';
        let textToSave = memContent;

        const scopeMatch = memContent.match(/^\[(session|global)\]\s*(.*)$/i);
        if (scopeMatch) {
          isSession = scopeMatch[1].toLowerCase() === 'session';
          isGlobal = scopeMatch[1].toLowerCase() === 'global';
          textToSave = scopeMatch[2] || memContent;
        }

        const catMatch = textToSave.match(
          /^\[(preference|fact|instruction|project|goal|note|todo)\]\s*(.*)$/i,
        );
        if (catMatch) {
          category = catMatch[1].toLowerCase();
          textToSave = catMatch[2] || textToSave;
        }

        try {
          if (isSession || !isGlobal) {
            await api(`/conversations/${thread.id}/memories`, 'POST', {
              text: textToSave,
              category,
            });
            setCompactMessage(
              `Saved session note: "${textToSave.slice(0, 35)}..."`,
            );
          } else {
            await api('/memories', 'POST', {
              text: textToSave,
              category: category === 'note' ? 'general' : category,
            });
            setCompactMessage(
              `Saved workspace memory: "${textToSave.slice(0, 35)}..."`,
            );
          }
          setTimeout(() => setCompactMessage(null), 3000);
          onSaved();
          setDraft('');
          return;
        } catch (e) {
          setError(e instanceof Error ? e.message : 'Could not save memory.');
          return;
        }
      }
    }

    if (trimmed.startsWith('/goal ')) {
      const goal = trimmed.slice(6).trim();
      outgoing = `**Goal Mode Active**\nObjective: ${goal}\n\nPlease autonomously plan and execute all necessary steps, inspect tool evidence, verify completion, and do not stop until fully achieved. If the goal is too big or too parallel for one pass, automatically fan out a run_subagents swarm (your call on size) and synthesize the results.`;
    } else if (trimmed.startsWith('/code ')) {
      const codeTask = trimmed.slice(6).trim();
      outgoing = `**Code Mode Active**\nTask: ${codeTask}\n\nPlease inspect the local project files, view or edit code using your str_replace_editor and bash tools, execute necessary commands (builds/tests), and verify the outcome.`;
    } else if (trimmed.startsWith('/plan ')) {
      const planTask = trimmed.slice(6).trim();
      outgoing = `**Plan Mode Active**\nTask: ${planTask}\n\nPlease formulate an explicit, phased execution plan with milestone checkboxes and dependencies.`;
    } else if (trimmed.startsWith('/init')) {
      const target = trimmed.slice(5).trim();
      outgoing = `**Workspace Init Active**\n${target ? `Focus: ${target}\n` : ''}Please inspect the connected workspace and create or update an AGENTS.md file at its root documenting: project purpose, directory structure, build and test commands, key conventions, and any gotchas a coding agent must know. Show me the file you wrote.`;
    } else if (trimmed.startsWith('/review')) {
      const target = trimmed.slice(7).trim();
      outgoing = `**Code Review Active**\n${target ? `Review target: ${target}\n` : 'Review the current changes (check git status and git diff first).\n'}Please report findings in severity order (critical, high, medium, low) with file and line references, and only report real issues you verified in the code.`;
    } else if (trimmed.startsWith('/undo')) {
      const note = trimmed.slice(5).trim();
      outgoing = `**Undo Active**\n${note ? `Scope note: ${note}\n` : ''}Please inspect the most recent edits in the connected workspace (git status, git diff, and recent changes), show me a concise summary of what changed, and ask me to confirm before reverting. Only revert after my explicit approval.`;
    } else if (trimmed.startsWith('/subagents')) {
      const mission = trimmed.slice(11).trim();
      outgoing = `**Swarm Mode Active**\nMission: ${mission || '(see conversation context)'}\n\nSplit this mission into independent parallel tracks and execute them with ONE run_subagents call (all tracks at once) — the swarm size is your decision: 2-5 tracks for focused work, dozens for broad sweeps with one file or area per track. Give each track a name and pick the right specialist agent profile for it (explore for read-only research, plan for planning, build or general for hands-on work). Then synthesize the merged per-track results into a single final answer with evidence.`;
    } else if (
      trimmed === '/tf' ||
      trimmed.startsWith('/tf ') ||
      trimmed === '/taskforce' ||
      trimmed.startsWith('/taskforce ')
    ) {
      const rest = trimmed.replace(/^\/(tf|taskforce)\s*/, '').trim();
      // Optional hours budget as the first token: "/tf 6 audit my app".
      // Only a plausible budget (0.25-24) followed by a space counts —
      // "/tf 1984 novel analysis" stays a plain mission.
      const hoursMatch = rest.match(/^(\d{1,2}(?:\.\d+)?)\s+([\s\S]+)$/);
      const parsed = hoursMatch ? Number(hoursMatch[1]) : undefined;
      const hours =
        parsed !== undefined && parsed >= 0.25 && parsed <= 24
          ? parsed
          : undefined;
      const mission = (hours && hoursMatch ? hoursMatch[2] : rest).trim();
      if (!mission) {
        setDraft('/tf ');
        setError(
          'Add your mission after /tf — e.g. /tf 6 Full UX/UI audit of my app onboarding, designs attached',
        );
        return;
      }
      outgoing = `**Task Force Mode Active**\nMission: ${mission}\n${hours ? `Time budget: ${hours} hours (the owner chose this — pass it to the tool).\n` : ''}\nLaunch the task_force tool NOW with this mission${hours ? ` and hours: ${hours}` : ' (you pick the hours based on mission scale)'}. Include the full context the owner provided (any attached code, designs, files are in this conversation — inline what matters into the mission). The swarm runs for hours server-side, evolves generations of workers, and files its report back into this conversation as an artifact. After launching, tell the owner it is running and that they can ask you to check progress anytime; do NOT wait for it to finish.`;
    } else if (trimmed.startsWith('/search ')) {
      const q = trimmed.slice(8).trim();
      outgoing = `Please search the web for "${q}" and summarize findings with source citations.`;
    } else if (trimmed.startsWith('/browse ')) {
      const url = trimmed.slice(8).trim();
      outgoing = `Please navigate to ${url} using your computer browser tool and inspect the page content.`;
    } else if (trimmed === '/help') {
      outgoing = `What commands and tools are available in DoshBot by SafarNow? Please list the slash commands (/goal, /code, /plan, /init, /review, /undo, /subagents, /tf, /skills, /compact, /memory, /btw, /model, /tasks, /new, /mcp, /schedule, /search, /browse, /clear) and explain briefly how to use each.`;
    }

    const attachmentContext = await buildAttachmentContext();
    if (attachmentContext) {
      outgoing = `${outgoing}${attachmentContext}`;
    }

    setError('');
    setRunning(true);
    userStoppedRef.current = false;
    runErrorRef.current = null;
    agent.addMessage({
      id: crypto.randomUUID(),
      role: 'user',
      content: contextualMessage(outgoing, pageContext),
    });
    setDraft('');
    setAttachments([]);
    setSource('');
    setSourceOpen(false);
    setSlashMenuOpen(false);
    const MAX_RETRIES = 5;
    let turnSuccess = false;
    let lastError: unknown = null;
    const initialMessageCount = agent.messages.length;
    try {
      for (let attempt = 1; attempt <= MAX_RETRIES + 1; attempt++) {
        try {
          runErrorRef.current = null;
          if (attempt > 1) {
            setError(
              `Turn encountered an issue. Retrying (${attempt - 1}/${MAX_RETRIES})…`,
            );
            if (agent.messages.length > initialMessageCount) {
              agent.setMessages(agent.messages.slice(0, initialMessageCount));
            }
            const delay = Math.min(1000 * Math.pow(1.4, attempt - 2), 4000);
            await new Promise((resolve) => setTimeout(resolve, delay));
          }

          if (userStoppedRef.current) break;

          const result = await copilotkit.runAgent({ agent });

          if (userStoppedRef.current) break;

          if (runErrorRef.current) {
            throw new Error(runErrorRef.current);
          }

          const assistantMessages = result.newMessages.filter(
            (message) => message.role === 'assistant',
          );
          if (!assistantMessages.length) {
            throw new Error(
              'The current turn returned no response. Check the runtime connection and retry.',
            );
          }

          setError('');
          onSaved();
          turnSuccess = true;
          lastError = null;
          break;
        } catch (e) {
          lastError = e;
          const msg = e instanceof Error ? e.message : String(e);
          const isAbort =
            userStoppedRef.current ||
            (e instanceof Error && e.name === 'AbortError') ||
            /abort|cancel|stop/i.test(msg);
          if (isAbort) {
            break;
          }
          console.warn(`[Chat] Turn attempt ${attempt} failed:`, e);
          if (attempt <= MAX_RETRIES) {
            continue;
          }
        }
      }

      if (!turnSuccess && lastError && !userStoppedRef.current) {
        const msg =
          lastError instanceof Error ? lastError.message : String(lastError);
        const isAbort =
          (lastError instanceof Error && lastError.name === 'AbortError') ||
          /abort|cancel|stop/i.test(msg);
        if (!isAbort) {
          setError(
            lastError instanceof Error
              ? `${lastError.message} (failed after ${MAX_RETRIES} retries)`
              : `The turn failed after ${MAX_RETRIES} retries. Your conversation remains saved.`,
          );
        }
      }
    } finally {
      setRunning(false);
      userStoppedRef.current = false;
    }
  };
  const sendLatest = useRef<((text: string) => Promise<void>) | null>(null);
  useEffect(() => {
    sendLatest.current = send;
  });
  useEffect(() => {
    if (loaded && contextReady && !paused && initialPrompt && !sent.current) {
      sent.current = true;
      onConsumed();
      void sendLatest.current?.(initialPrompt);
    }
  }, [loaded, contextReady, paused, initialPrompt, onConsumed]);
  useEffect(() => {
    bottom.current?.scrollIntoView({ behavior: 'instant', block: 'end' });
  }, [agent.messages.length, running]);
  useEffect(() => {
    if (paused && voice.status !== 'idle') void voice.end();
  }, [paused, voice]);
  useHumanInTheLoop(
    {
      name: pageReviewTool.name,
      description: pageReviewTool.description,
      parameters: pageReviewSchema,
      render: (props) => (
        <PageReviewCard {...props} threadId={thread.id} onSaved={onSaved} />
      ),
    },
    [thread.id, onSaved],
  );
  useHumanInTheLoop(
    {
      name: askQuestionTool.name,
      description: askQuestionTool.description,
      parameters: askQuestionSchema,
      render: (props) => <AskQuestionCard {...props} />,
    },
    [],
  );
  const computerCalls = agent.messages.flatMap((message) =>
    message.role === 'assistant' ? (message.toolCalls ?? []) : [],
  );
  const latestBrowserCall = computerCalls.findLast((call) =>
    [
      'navigate',
      'snapshot',
      'read',
      'screenshot',
      'click',
      'type',
      'key',
      'scroll',
    ].some((action) => call.function.name === `computer_${action}`),
  );
  useRenderTool(
    {
      name: '*',
      render: (props: ComputerToolRenderProps) =>
        props.name.startsWith('computer_') ? (
          <ComputerToolCard
            {...props}
            dotId={dot.id}
            dotName={dot.name}
            running={running}
            showScreen={props.toolCallId === latestBrowserCall?.id}
            onExpand={onComputer}
          />
        ) : props.name === pageReviewTool.name ||
          props.name === askQuestionTool.name ? null : (
          <CompactToolCard {...props} running={running} />
        ),
    },
    [dot.id, dot.name, running, latestBrowserCall?.id, onComputer],
  );
  const visible = agent.messages.filter(
    (message) =>
      !isInternalSystemPrompt(message) &&
      ['user', 'assistant'].includes(message.role) &&
      ((typeof message.content === 'string' && message.content.trim()) ||
        (message.role === 'assistant' &&
          (message.toolCalls?.length ?? 0) > 0)),
  );

  const latestAssistantMessage = agent.messages.findLast(
    (m) => m.role === 'assistant',
  );
  const activeToolCall = running
    ? latestAssistantMessage?.toolCalls?.at(-1)
    : undefined;
  const activeToolMeta = activeToolCall
    ? getToolMeta(
        activeToolCall.function.name,
        computerToolResult(activeToolCall.function.arguments),
      )
    : null;

  const tokenUsage = calculateTokenUsage(agent.messages, currentModel);
  useEffect(() => {
    if (agent.messages.length > 0) {
      recordSessionTokenStats(thread.id, tokenUsage);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [agent.messages.length, thread.id]);

  return (
    <div
      className="live-chat"
      onDragEnter={(e: ReactDragEvent<HTMLDivElement>) => {
        if (!e.dataTransfer.types.includes('Files')) return;
        e.preventDefault();
        dropDepth.current += 1;
        setDropActive(true);
      }}
      onDragOver={(e: ReactDragEvent<HTMLDivElement>) => {
        if (!e.dataTransfer.types.includes('Files')) return;
        e.preventDefault();
      }}
      onDragLeave={(e: ReactDragEvent<HTMLDivElement>) => {
        if (!e.dataTransfer.types.includes('Files')) return;
        dropDepth.current = Math.max(0, dropDepth.current - 1);
        if (dropDepth.current === 0) setDropActive(false);
      }}
      onDrop={(e: ReactDragEvent<HTMLDivElement>) => {
        if (!e.dataTransfer.types.includes('Files')) return;
        e.preventDefault();
        dropDepth.current = 0;
        setDropActive(false);
        if (e.dataTransfer.files.length > 0)
          void handleFilesSelected(e.dataTransfer.files);
      }}
    >
      {dropActive && (
        <div className="drop-overlay" role="presentation">
          <div className="drop-overlay-card">
            <FileUp size={30} />
            <strong>Drop files to attach</strong>
            <span>
              Docs, images, spreadsheets, PDFs — anything up to 50MB each
            </span>
          </div>
        </div>
      )}
      <header className="chat-persona">
        <Mascot
          identity={dot.id}
          name={dot.name}
          small
          state={running ? 'working' : paused ? 'paused' : 'idle'}
        />
        <div>
          <strong>{dot.name}</strong>
          <span>
            {paused
              ? 'Paused'
              : running
                ? 'Thinking…'
                : loaded && contextReady
                  ? 'Here with you'
                  : 'Connecting to your conversation…'}
          </span>
        </div>
        <div className="chat-persona-actions">
          {artifacts.length > 0 && (
            <button
              type="button"
              className={`token-meter-pill ${artifactsOpen ? 'active' : ''}`}
              role="button"
              aria-pressed={artifactsOpen}
              title={`${artifacts.length} artifact(s) created in this chat. Click to open the panel.`}
              onClick={() => setArtifactsOpen((open) => !open)}
            >
              <span className="token-meter-text">✦ {artifacts.length}</span>
            </button>
          )}
          {/* DSH Token Usage Meter Badge — per-session in/out tracking */}
          <div
            className={`token-meter-pill ${tokenUsage.status}`}
            title={`Session ${thread.id.slice(0, 8)} — In: ${tokenUsage.inputFormatted} / Out: ${tokenUsage.outputFormatted} / Total: ${tokenUsage.formatted} of ${tokenUsage.maxFormatted} (${tokenUsage.percentage}%). ${tokenUsage.messageCount} msgs. Click to compact context and free cache.`}
            onClick={() => void handleCompact()}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                void handleCompact();
              }
            }}
            role="button"
            tabIndex={0}
          >
            <span
              className="token-meter-text"
              title={`Input ≈ ${tokenUsage.inputFormatted}`}
            >
              ↑{tokenUsage.inputFormatted}
            </span>
            <span
              className="token-meter-text"
              title={`Output ≈ ${tokenUsage.outputFormatted}`}
            >
              ↓{tokenUsage.outputFormatted}
            </span>
            <span className="token-meter-pct">({tokenUsage.percentage}%)</span>
          </div>

          <button
            className="icon-button"
            aria-label="Save conversation as page"
            disabled={running}
            onClick={async () => {
              const title = window.prompt('Page title', thread.title);
              if (!title) return;
              try {
                const page = await api<Page>(
                  `/conversations/${thread.id}/page`,
                  'POST',
                  { title },
                );
                location.hash = `/spaces/${page.spaceId}/pages/${page.id}`;
              } catch (e) {
                setError(
                  e instanceof Error
                    ? e.message
                    : 'Could not save conversation.',
                );
              }
            }}
          >
            <FilePlus size={18} />
          </button>
          <button
            className="icon-button"
            aria-label="Schedule a task in this conversation"
            onClick={onSchedule}
          >
            <Clock3 size={18} />
          </button>
          <button
            className={`icon-button ${voice.status === 'active' ? 'on-call' : ''}`}
            aria-label={
              voice.status === 'idle' ? 'Start voice call' : 'End voice call'
            }
            title={
              voiceReady
                ? 'Talk with your Dot'
                : 'Voice setup requires VOICE_API_KEY and VOICE_MODEL'
            }
            disabled={!voiceReady || paused || !loaded || !contextReady}
            onClick={() =>
              voice.status === 'idle' ? void voice.start() : void voice.end()
            }
          >
            {voice.status === 'idle' ? (
              <Phone size={18} />
            ) : (
              <PhoneOff size={18} />
            )}
          </button>
          <button
            className={`icon-button ${codingEnabled && fullDirPath ? 'folder-on' : ''}`}
            aria-label={
              codingEnabled
                ? 'Folder tools on — turn off local file access'
                : 'Folder tools off — turn on local file access'
            }
            aria-pressed={codingEnabled}
            title={
              codingEnabled
                ? fullDirPath
                  ? `Folder tools on in ${fullDirPath}. Click to chat without local files.`
                  : 'Folder tools on (no folder connected). Click to turn off.'
                : 'Folder tools off — pure chat, no local files. Click to turn on.'
            }
            onClick={() => void toggleFolderTools()}
          >
            {codingEnabled ? <FolderGit2 size={18} /> : <FolderOpen size={18} />}
          </button>
          {onDeleteConversation && (
            <button
              className="icon-button delete-chat-btn"
              aria-label="Delete conversation session"
              title="Delete conversation session"
              onClick={() => setConfirmDeleteOpen(true)}
            >
              <Trash2 size={18} />
            </button>
          )}
        </div>
      </header>
      {pageContext && (
        <div className="page-chat-context">
          Working on{' '}
          <a href={`/#/spaces/${pageContext.spaceId}/pages/${pageContext.id}`}>
            {pageContext.title}
          </a>
        </div>
      )}
      <div className="chat-transcript">
        {!visible.length && (
          <div className="chat-welcome">
            <span className="eyebrow">A LITTLE SPACE TO THINK</span>
            <h1>What’s on your mind?</h1>
            <p>{dot.instructions}</p>
            <p className="muted">
              Your conversation stays with this Dot, across text and calls.
            </p>
          </div>
        )}
        <ChatTranscript
          messages={visible}
          calls={calls}
          renderTools={(message) => (
            <CopilotChatToolCallsView
              message={message}
              messages={agent.messages}
            />
          )}
          onFork={(messageId) => void handleForkFrom(messageId)}
          onEdit={(messageId, content) => void handleEditMessage(messageId, content)}
          onRevert={(messageId) => void handleRevertTo(messageId)}
        />
        {(liveThinking || finishedThinking) && (
          <div className={`thinking-panel ${thinkingOpen ? 'open' : ''}`}>
            <button
              type="button"
              className="thinking-header"
              aria-expanded={thinkingOpen}
              onClick={() => setThinkingOpen(!thinkingOpen)}
            >
              <Brain size={13} />
              <span className="thinking-label">
                {liveThinking ? 'Thinking…' : 'Thought process'}
              </span>
              <span className="thinking-meta">
                {(liveThinking || finishedThinking).length.toLocaleString()}{' '}
                chars
              </span>
              <span
                className={`pill-chevron ${thinkingOpen ? 'rotated' : ''}`}
                aria-hidden="true"
              >
                ▾
              </span>
            </button>
            {thinkingOpen && (
              <pre className="thinking-body" aria-live="polite" ref={thinkingBodyRef}>
                {liveThinking || finishedThinking}
              </pre>
            )}
          </div>
        )}
        {running && !liveThinking && (
          <div className="thinking" role="status">
            <span />
            <span />
            <span />
            <span>
              {activeToolMeta
                ? `${dot.name} is using ${activeToolMeta.label}`
                : `${dot.name} is thinking`}
            </span>
            {activeToolMeta && (
              <span className="live-tool-indicator-badge">
                <activeToolMeta.Icon size={12} />
                <span>
                  {activeToolMeta.summary || activeToolCall?.function.name}
                </span>
              </span>
            )}
          </div>
        )}
        <div ref={bottom} />
      </div>
      {contextError && (
        <div className="chat-error" role="alert">
          {contextError}
          <button onClick={() => setContextAttempt((value) => value + 1)}>
            Retry context
          </button>
        </div>
      )}
      {(error || voice.error) && (
        <div className="chat-error" role="alert">
          <span>{error || voice.error}</span>
          <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
            {error && (
              <button
                type="button"
                onClick={() => {
                  setError('');
                  setRunning(true);
                  userStoppedRef.current = false;
                  runErrorRef.current = null;
                  void (async () => {
                    const MAX_RETRIES = 5;
                    let turnSuccess = false;
                    let lastError: unknown = null;
                    const msgs = agent.messages;
                    const lastMsg = msgs.at(-1);
                    const lastHasToolCalls =
                      lastMsg &&
                      'toolCalls' in lastMsg &&
                      Array.isArray(lastMsg.toolCalls) &&
                      lastMsg.toolCalls.length > 0;
                    if (
                      lastMsg &&
                      lastMsg.role === 'assistant' &&
                      (!lastMsg.content || !String(lastMsg.content).trim()) &&
                      !lastHasToolCalls
                    ) {
                      agent.setMessages(msgs.slice(0, -1));
                    }
                    const initialMessageCount = agent.messages.length;

                    for (let attempt = 1; attempt <= MAX_RETRIES + 1; attempt++) {
                      try {
                        runErrorRef.current = null;
                        if (attempt > 1) {
                          setError(
                            `Turn encountered an issue. Retrying (${attempt - 1}/${MAX_RETRIES})…`,
                          );
                          if (agent.messages.length > initialMessageCount) {
                            agent.setMessages(agent.messages.slice(0, initialMessageCount));
                          }
                          await new Promise((r) =>
                            setTimeout(
                              r,
                              Math.min(1000 * Math.pow(1.4, attempt - 2), 4000),
                            ),
                          );
                        }
                        if (userStoppedRef.current) break;
                        const result = await copilotkit.runAgent({ agent });
                        if (userStoppedRef.current) break;
                        if (runErrorRef.current) throw new Error(runErrorRef.current);
                        if (
                          !result.newMessages.some(
                            (m) => m.role === 'assistant',
                          )
                        ) {
                          throw new Error('The turn returned no response.');
                        }
                        setError('');
                        onSaved();
                        turnSuccess = true;
                        break;
                      } catch (e) {
                        lastError = e;
                        const msg = e instanceof Error ? e.message : String(e);
                        if (
                          userStoppedRef.current ||
                          (e instanceof Error &&
                            (e.name === 'AbortError' || /abort|cancel|stop/i.test(msg)))
                        )
                          break;
                        if (attempt <= MAX_RETRIES) continue;
                      }
                    }
                    if (!turnSuccess && lastError && !userStoppedRef.current) {
                      setError(
                        lastError instanceof Error
                          ? `${lastError.message} (failed after ${MAX_RETRIES} retries)`
                          : 'Turn failed after retries.',
                      );
                    }
                    setRunning(false);
                    userStoppedRef.current = false;
                  })();
                }}
              >
                Retry turn
              </button>
            )}
            {error && (
              <button
                type="button"
                onClick={() => {
                  setError('');
                  void copilotkit
                    .connectAgent({ agent })
                    .then(() => setLoaded(true))
                    .catch((e) => setError(e.message));
                }}
              >
                Reconnect
              </button>
            )}
          </div>
        </div>
      )}
      <CallView
        key={voice.status === 'idle' ? 'idle' : 'call'}
        dot={dot}
        voice={voice}
      />
      <SelectionQuoteMenu onQuote={quoteSelection} />
      {(btwRunning || btw) && (
        <div className="btw-card" role="complementary" aria-label="Side answer">
          <div className="btw-header">
            <span className="btw-badge">BTW</span>
            <span className="btw-title">
              Answered on the side — this chat's context is untouched
            </span>
            {btw && (
              <button
                type="button"
                className="icon-button"
                aria-label="Dismiss side answer"
                title="Delete this side answer"
                onClick={() => setBtw(null)}
              >
                ✕
              </button>
            )}
          </div>
          {btw ? (
            <>
              <p className="btw-question">{btw.question}</p>
              <div className="btw-reply">
                <ReactMarkdown>{btw.reply}</ReactMarkdown>
              </div>
            </>
          ) : (
            <p className="btw-loading" role="status">
              Asking on the side… (a throwaway session handles it)
            </p>
          )}
        </div>
      )}
      <form
        className="chat-composer"
        onSubmit={(e) => {
          e.preventDefault();
          void send(`${source ? `From ${source}:\n\n` : ''}${draft}`);
        }}
      >
        {sourceOpen && (
          <div className="source-input">
            <Link2 size={15} />
            <input
              aria-label="Source page URL"
              type="url"
              value={source}
              onChange={(e) => setSource(e.target.value)}
              placeholder="https://example.com/page"
            />
            <button
              type="button"
              className="icon-button"
              aria-label="Remove source"
              onClick={() => {
                setSourceOpen(false);
                setSource('');
              }}
            >
              <X size={14} />
            </button>
          </div>
        )}
        {compactMessage && (
          <div className="compact-toast-banner">
            <span>{compactMessage}</span>
            {undoTail && (
              <button
                type="button"
                className="compact-toast-undo"
                onClick={() => void handleUndoRevert()}
              >
                Undo
              </button>
            )}
          </div>
        )}
        <div
          className="chat-composer-box"
          style={{ position: 'relative' }}
        >
          {slashMenuOpen && (
            <SlashCommandsMenu
              filter={draft}
              selectedIndex={slashSelectedIndex}
              onSelect={handleSelectSlashCommand}
              onClose={() => setSlashMenuOpen(false)}
            />
          )}
          {attachments.length > 0 && (
            <div className="attach-preview-row">
              {attachments.map((a) => (
                <div
                  key={a.id}
                  className="attach-chip"
                  title={`${a.name} — ${a.mime}`}
                >
                  {a.kind === 'image' && a.dataUrl ? (
                    <img
                      src={a.dataUrl}
                      alt={a.name}
                      className="attach-thumb"
                    />
                  ) : a.kind === 'image' ? (
                    <ImageIcon size={14} />
                  ) : (
                    <FileText size={14} />
                  )}
                  <span className="attach-name">
                    {a.name.length > 18 ? `${a.name.slice(0, 15)}…` : a.name}
                  </span>
                  <button
                    type="button"
                    className="attach-remove"
                    aria-label={`Remove ${a.name}`}
                    onClick={() =>
                      setAttachments((prev) =>
                        prev.filter((x) => x.id !== a.id),
                      )
                    }
                  >
                    <X size={12} />
                  </button>
                </div>
              ))}
            </div>
          )}
          {attachments.some((a) => a.kind === 'image') &&
            !isVisionCapableModel(currentModel) && (
              <div className="dir-status" style={{ margin: '0 0 8px' }}>
                {currentModel} can&apos;t see images (DeepSeek chat/reasoner are
                text-only). Describe the image in words, or switch to a vision
                model such as deepseek-flash, GPT-4o or Gemini.
              </div>
            )}
          <textarea
            ref={textareaRef}
            aria-label="Message your Dot"
            placeholder={`Message ${dot.name} — type / for commands, + to attach files… (drop or paste anything: images, docs, Excel)`}
            rows={1}
            value={draft}
            maxLength={12000}
            onChange={(e) => handleDraftChange(e.target.value)}
            onKeyDown={handleKeyDown}
            onPaste={handlePaste}
          />
          <input
            ref={fileInputRef}
            type="file"
            multiple
            style={{ display: 'none' }}
            onChange={(e) => void handleFilesSelected(e.target.files)}
          />
          <input
            ref={imageInputRef}
            type="file"
            accept="image/*"
            multiple
            style={{ display: 'none' }}
            onChange={(e) => void handleFilesSelected(e.target.files, true)}
          />
          <div className="chat-composer-footer">
            <div className="chat-composer-left">
              {running ? (
                <button
                  type="button"
                  className="composer-send-btn stop"
                  aria-label="Stop response"
                  onClick={() => {
                    userStoppedRef.current = true;
                    copilotkit.stopAgent({ agent });
                  }}
                >
                  <Square size={13} />
                </button>
              ) : (
                <button
                  type="submit"
                  className="composer-send-btn"
                  aria-label="Send message"
                  disabled={
                    (!draft.trim() && attachments.length === 0) ||
                    !loaded ||
                    !contextReady ||
                    paused
                  }
                >
                  <ArrowUp size={15} strokeWidth={2.5} />
                </button>
              )}

              <div className="chat-popover-container" ref={attachMenuRef}>
                <button
                  type="button"
                  className={`composer-icon-btn ${sourceOpen || attachMenuOpen ? 'active' : ''}`}
                  aria-label="Add files, images or links"
                  title="Add files, images, links or local folder"
                  onClick={() => setAttachMenuOpen(!attachMenuOpen)}
                >
                  <Plus size={15} strokeWidth={2.2} />
                </button>
                {attachMenuOpen && (
                  <div className="chat-popover-menu attach-menu">
                    <div className="chat-popover-header">
                      <span>Add context</span>
                      <small>files · images · code</small>
                    </div>
                    <button
                      type="button"
                      className="chat-popover-item"
                      onClick={() => fileInputRef.current?.click()}
                    >
                      <Paperclip size={15} />
                      <div className="chat-effort-col">
                        <span className="chat-item-name">Upload files</span>
                        <span className="chat-item-desc">
                          Code, docs, text up to 8MB — inlined for the agent
                        </span>
                      </div>
                    </button>
                    <button
                      type="button"
                      className="chat-popover-item"
                      onClick={() => imageInputRef.current?.click()}
                    >
                      <ImageIcon size={15} />
                      <div className="chat-effort-col">
                        <span className="chat-item-name">Upload images</span>
                        <span className="chat-item-desc">
                          Screenshots, diagrams — auto-compressed, never
                          truncated
                        </span>
                      </div>
                    </button>
                    <button
                      type="button"
                      className="chat-popover-item"
                      onClick={() => {
                        setSourceOpen(!sourceOpen);
                        setAttachMenuOpen(false);
                      }}
                    >
                      <Link2 size={15} />
                      <div className="chat-effort-col">
                        <span className="chat-item-name">Attach link</span>
                        <span className="chat-item-desc">
                          Public page for research
                        </span>
                      </div>
                    </button>
                    <button
                      type="button"
                      className="chat-popover-item"
                      onClick={() => {
                        setAttachMenuOpen(false);
                        setDirDraft(fullDirPath);
                        setDirStatus('');
                        setDirOpen(true);
                      }}
                    >
                      <FolderOpen size={15} />
                      <div className="chat-effort-col">
                        <span className="chat-item-name">
                          Connect local folder
                        </span>
                        <span className="chat-item-desc">
                          {fullDirPath ||
                            connectedDir ||
                            'Choose coding directory'}
                        </span>
                      </div>
                    </button>
                  </div>
                )}
              </div>
            </div>

            <div className="chat-composer-right">
              <div className="chat-popover-container" ref={dirPopoverRef}>
                <button
                  type="button"
                  className={`composer-pill-btn dir-pill ${dirOpen ? 'open' : ''}`}
                  onClick={() => {
                    setDirDraft(fullDirPath);
                    setDirStatus('');
                    setDirOpen(!dirOpen);
                  }}
                  title={
                    codingEnabled
                      ? fullDirPath
                        ? `Coding workspace: ${fullDirPath}. Click to change (Claude / DSH-style local folder).`
                        : 'No folder connected (blank by default). Click to choose one with your OS folder picker, browse, or type a path.'
                      : 'Folder tools are off — click to turn them on.'
                    }
                  >
                    <FolderGit2 size={13} />
                    <span>
                      {codingEnabled
                        ? connectedDir || 'Connect folder'
                        : 'No folder'}
                    </span>
                  {codingEnabled && dirIsGit && (
                    <span className="dir-git-dot" title="Git repo detected">
                      ●
                    </span>
                  )}
                </button>
                {dirOpen && (
                  <div className="chat-popover-menu dir-menu">
                    <div className="chat-popover-header">
                      <span>Local folder — DSH / Claude style</span>
                      <small>{dirIsGit ? 'git repo' : 'local fs'}</small>
                    </div>
                    <div className="dir-picker-body">
                      <div
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'space-between',
                          margin: '0 0 8px',
                        }}
                      >
                        <span className="chat-item-desc" style={{ margin: 0 }}>
                          Folder tools
                        </span>
                        <button
                          type="button"
                          role="switch"
                          aria-checked={codingEnabled}
                          title={
                            codingEnabled
                              ? 'Turn folder tools off (chat without local files)'
                              : 'Turn folder tools on (chat with local files)'
                          }
                          onClick={() => void toggleFolderTools()}
                          style={{
                            minWidth: 52,
                            borderRadius: 999,
                            background: codingEnabled ? '#111' : '#e5e5e5',
                            color: codingEnabled ? '#fff' : '#111',
                            border: '1px solid #111',
                            fontSize: 11,
                            fontWeight: 600,
                          }}
                        >
                          {codingEnabled ? 'On' : 'Off'}
                        </button>
                      </div>
                      <p
                        className="chat-item-desc"
                        style={{ margin: '0 0 8px' }}
                      >
                        {codingEnabled ? (
                          <>
                            Agent runs <code>str_replace_editor</code>,{' '}
                            <code>bash</code>, <code>code_interpreter</code>{' '}
                            here.
                          </>
                        ) : (
                          'Folder tools are off — the agent chats without reading or editing local files.'
                        )}
                      </p>
                      <input
                        type="text"
                        value={dirDraft}
                        onChange={(e) => setDirDraft(e.target.value)}
                        placeholder="No folder — type a full path, e.g. /Users/you/my-project"
                        spellCheck={false}
                        style={{ fontFamily: 'monospace', fontSize: '12px' }}
                      />
                      <input
                        ref={(el) => {
                          dirNativeInputRef.current = el;
                          if (el) el.setAttribute('webkitdirectory', '');
                        }}
                        type="file"
                        multiple
                        aria-hidden="true"
                        tabIndex={-1}
                        // Visually hidden but NOT display:none: Safari ignores
                        // programmatic .click() on display:none file inputs,
                        // so the OS folder dialog would never open there.
                        style={{
                          position: 'fixed',
                          width: 1,
                          height: 1,
                          opacity: 0,
                          pointerEvents: 'none',
                        }}
                        onChange={(e) =>
                          handleNativeFolderFiles(e.target.files)
                        }
                      />
                      <button
                        type="button"
                        className="chat-popover-item"
                        style={{ marginTop: 6 }}
                        onClick={() => void handleNativeFolderPick()}
                        title="Open your OS folder picker (Finder / File Explorer) to choose a folder"
                      >
                        <FolderOpen size={15} />
                        <div className="chat-effort-col">
                          <span className="chat-item-name">
                            Choose on this device…
                          </span>
                          <span className="chat-item-desc">
                            Pops open Finder / File Explorer
                          </span>
                        </div>
                      </button>
                      {fullDirPath && (
                        <div className="dir-current" title={fullDirPath}>
                          Current: {fullDirPath}
                        </div>
                      )}
                      {dirStatus && (
                        <div className="dir-status">{dirStatus}</div>
                      )}
                      {browseOpen && (
                        <div
                          className="dir-current"
                          style={{
                            display: 'flex',
                            flexDirection: 'column',
                            gap: 6,
                            alignItems: 'stretch',
                          }}
                        >
                          <div
                            title={browsePath}
                            style={{
                              overflow: 'hidden',
                              textOverflow: 'ellipsis',
                              whiteSpace: 'nowrap',
                            }}
                          >
                            {browsePath || '…'}
                          </div>
                          {browseError && (
                            <div className="dir-status">{browseError}</div>
                          )}
                          <div style={{ display: 'flex', gap: 6 }}>
                            <button
                              type="button"
                              disabled={
                                browseLoading ||
                                !browseParent ||
                                browseParent === browsePath
                              }
                              onClick={() => void loadBrowse(browseParent)}
                            >
                              ↑ Up
                            </button>
                            <button
                              type="button"
                              disabled={browseLoading || !browsePath}
                              onClick={() => {
                                setDirDraft(browsePath);
                                setBrowseOpen(false);
                                setDirStatus('');
                              }}
                            >
                              Use this folder
                            </button>
                          </div>
                          <div
                            style={{
                              maxHeight: 180,
                              overflowY: 'auto',
                              display: 'flex',
                              flexDirection: 'column',
                              gap: 2,
                            }}
                          >
                            {browseLoading && (
                              <span className="chat-item-desc">
                                Listing device folders…
                              </span>
                            )}
                            {!browseLoading &&
                              browseEntries.length === 0 &&
                              !browseError && (
                                <span className="chat-item-desc">
                                  No subfolders here.
                                </span>
                              )}
                            {browseEntries.map((e) => (
                              <button
                                key={e.path}
                                type="button"
                                title={e.path}
                                style={{
                                  justifyContent: 'flex-start',
                                  fontFamily: 'monospace',
                                  fontSize: '12px',
                                }}
                                onClick={() => void loadBrowse(e.path)}
                              >
                                <FolderOpen size={13} /> {e.name}
                              </button>
                            ))}
                          </div>
                        </div>
                      )}
                      <div className="dir-actions">
                        <button
                          type="button"
                          disabled={browseLoading}
                          onClick={() => {
                            if (browseOpen) setBrowseOpen(false);
                            else void loadBrowse();
                          }}
                        >
                          {browseLoading
                            ? 'Browsing…'
                            : browseOpen
                              ? 'Hide folders'
                              : 'Browse…'}
                        </button>
                        <button
                          type="button"
                          className="primary small"
                          disabled={dirSaving}
                          onClick={() => void handleConnectDirectory()}
                        >
                          {dirSaving ? 'Verifying…' : 'Verify & Connect'}
                        </button>
                        <button
                          type="button"
                          disabled={dirSaving || !fullDirPath}
                          title="Disconnect the folder — pure chat, no local files"
                          onClick={() => void handleDisconnectDirectory()}
                        >
                          Disconnect
                        </button>
                        <button
                          type="button"
                          onClick={() => void refreshDirectory()}
                        >
                          Refresh
                        </button>
                        {onOpenSettings && (
                          <button
                            type="button"
                            onClick={() => {
                              setDirOpen(false);
                              onOpenSettings('coding');
                            }}
                          >
                            Advanced…
                          </button>
                        )}
                      </div>
                    </div>
                  </div>
                )}
              </div>
              {/* Model Pill */}
              <div className="chat-popover-container" ref={modelPopoverRef}>
                <button
                  type="button"
                  className={`composer-pill-btn ${modelOpen ? 'open' : ''}`}
                  onClick={() => {
                    setModelOpen(!modelOpen);
                    setEffortOpen(false);
                  }}
                  aria-label="Select AI Model"
                >
                  <span>{formatModelName(currentModel)}</span>
                  <ChevronDown
                    size={12}
                    className={`pill-chevron ${modelOpen ? 'rotated' : ''}`}
                  />
                </button>
                {modelOpen && (
                  <div className="chat-popover-menu model-menu">
                    <div className="chat-popover-header">
                      <span>Model</span>
                      <small>{modelOptions.length} available</small>
                    </div>
                    <div className="chat-popover-search">
                      <Search size={13} />
                      <input
                        type="text"
                        placeholder="Search model…"
                        value={chatModelSearch}
                        onChange={(e) => setChatModelSearch(e.target.value)}
                        autoFocus
                      />
                    </div>
                    <div className="chat-popover-list">
                      {modelOptions
                        .filter(
                          (m) =>
                            !chatModelSearch.trim() ||
                            m
                              .toLowerCase()
                              .includes(chatModelSearch.trim().toLowerCase()),
                        )
                        .map((m) => (
                          <button
                            key={m}
                            type="button"
                            className={`chat-popover-item ${currentModel === m ? 'active' : ''}`}
                            onClick={() => {
                              void handleModelChange(m);
                              setModelOpen(false);
                              setChatModelSearch('');
                            }}
                          >
                            <span className="chat-item-name">
                              {formatModelName(m)}
                            </span>
                            <span className="chat-item-id">{m}</span>
                            {currentModel === m && (
                              <span className="chat-item-check">✓</span>
                            )}
                          </button>
                        ))}
                    </div>
                  </div>
                )}
              </div>

              {/* Effort Pill */}
              <div className="chat-popover-container" ref={effortPopoverRef}>
                <button
                  type="button"
                  className={`composer-pill-btn ${effortOpen ? 'open' : ''}`}
                  onClick={() => {
                    setEffortOpen(!effortOpen);
                    setModelOpen(false);
                  }}
                  aria-label="Select Reasoning Effort"
                >
                  <BarChart2 size={13} strokeWidth={2.2} />
                  <span>{formatEffortName(currentEffort)}</span>
                  <ChevronDown
                    size={12}
                    className={`pill-chevron ${effortOpen ? 'rotated' : ''}`}
                  />
                </button>
                {effortOpen && (
                  <div className="chat-popover-menu effort-menu">
                    <div className="chat-popover-header">
                      <span>Thinking Effort</span>
                      <small>Reasoning tokens</small>
                    </div>
                    <div className="chat-popover-list">
                      {EFFORT_LEVELS.map((eff) => (
                        <button
                          key={eff.id}
                          type="button"
                          className={`chat-popover-item ${currentEffort === eff.id ? 'active' : ''}`}
                          onClick={() => {
                            void handleEffortChange(eff.id);
                            setEffortOpen(false);
                          }}
                        >
                          <div className="chat-effort-col">
                            <span className="chat-item-name">{eff.label}</span>
                            <span className="chat-item-desc">{eff.desc}</span>
                          </div>
                          {currentEffort === eff.id && (
                            <span className="chat-item-check">✓</span>
                          )}
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </div>

              {/* Vertical Divider */}
              <div className="composer-divider" />

              {/* Mic Speech-to-Text Button */}
              {stt.errorMessage && (
                <span
                  className="composer-error-note"
                  role="alert"
                  title={stt.errorMessage}
                >
                  {stt.errorMessage}
                </span>
              )}
              <button
                type="button"
                className={`composer-icon-btn ${stt.isRecording ? 'recording' : ''} ${stt.isTranscribing ? 'transcribing' : ''}`}
                aria-label="Speech to text"
                title={
                  stt.isRecording
                    ? 'Listening... Click to finish speaking'
                    : stt.isTranscribing
                      ? 'Transcribing speech...'
                      : stt.errorMessage
                        ? stt.errorMessage
                        : `Dictate message (${stt.sttModel})`
                }
                onClick={() => void stt.toggleRecording()}
              >
                <Mic size={15} />
              </button>

              {/* Audio / Voice Call & STT Selector */}
              <div className="chat-popover-container" ref={audioPopoverRef}>
                <button
                  type="button"
                  className={`composer-audio-btn ${voice.status === 'active' ? 'on-call' : ''} ${audioOpen ? 'open' : ''}`}
                  aria-label="Voice options and models"
                  title={
                    voice.status === 'active'
                      ? 'End live voice call'
                      : 'Voice options & STT models'
                  }
                  onClick={() => {
                    if (voice.status === 'active') {
                      void voice.end();
                    } else {
                      setAudioOpen(!audioOpen);
                      setModelOpen(false);
                      setEffortOpen(false);
                    }
                  }}
                >
                  <AudioLines size={15} />
                  <ChevronDown
                    size={12}
                    className={`pill-chevron ${audioOpen ? 'rotated' : ''}`}
                  />
                </button>
                {audioOpen && (
                  <div className="chat-popover-menu audio-menu">
                    <div className="chat-popover-header">
                      <span>Voice & Speech</span>
                      <small>Live call & STT</small>
                    </div>

                    <div style={{ padding: '6px 4px 4px' }}>
                      <button
                        type="button"
                        className="chat-popover-item"
                        style={{
                          background:
                            voice.status === 'active' ? '#dc3545' : '#242633',
                          color: '#fff',
                          borderRadius: '8px',
                          justifyContent: 'center',
                          gap: '8px',
                        }}
                        onClick={() => {
                          setAudioOpen(false);
                          if (voice.status === 'idle') void voice.start();
                          else void voice.end();
                        }}
                      >
                        <AudioLines size={16} />
                        <span style={{ color: '#fff', fontWeight: 600 }}>
                          {voice.status === 'idle'
                            ? 'Start Live Voice Call'
                            : 'End Live Voice Call'}
                        </span>
                      </button>
                    </div>

                    <div className="chat-popover-section-label">
                      Voice-to-Text Model (Mic)
                    </div>
                    <div className="chat-popover-list">
                      {STT_MODELS.map((m) => (
                        <button
                          key={m.id}
                          type="button"
                          className={`stt-model-item ${stt.sttModel === m.id ? 'active' : ''}`}
                          onClick={() => {
                            stt.setSttModel(m.id);
                            setAudioOpen(false);
                          }}
                        >
                          <div className="stt-model-info">
                            <div className="stt-model-title">
                              <span>{m.name}</span>
                              {m.badge && (
                                <span
                                  className={`stt-badge ${m.badge === 'Recommended' ? 'recommended' : ''}`}
                                >
                                  {m.badge}
                                </span>
                              )}
                            </div>
                            <span className="stt-model-desc">
                              {m.description}
                            </span>
                          </div>
                          {stt.sttModel === m.id && (
                            <span className="chat-item-check">✓</span>
                          )}
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* Suggestion Chips Below Composer Box — only visible on empty chat without draft */}
        {agent.messages.length === 0 && !draft.trim() && (
          <div className="composer-suggestions">
            <button
              type="button"
              onClick={() => setDraft('Help me think this through')}
            >
              <Lightbulb size={14} />
              <span>Help me think this through</span>
              <ArrowUpRight size={12} />
            </button>
            <button
              type="button"
              onClick={() => setDraft('Research a public page')}
            >
              <Search size={14} />
              <span>Research a public page</span>
              <ArrowUpRight size={12} />
            </button>
            <button
              type="button"
              onClick={() => setDraft('Make a plan I can follow')}
            >
              <FileText size={14} />
              <span>Make a plan I can follow</span>
              <ArrowUpRight size={12} />
            </button>
          </div>
        )}
      </form>

      {/* Delete Chat Confirmation Modal */}
      <ConfirmDeleteModal
        isOpen={confirmDeleteOpen}
        title="Delete chat?"
        description="This will permanently delete this conversation and its history. This action cannot be undone."
        itemTitle={thread.title}
        confirmLabel="Delete"
        cancelLabel="Cancel"
        onClose={() => setConfirmDeleteOpen(false)}
        onConfirm={() => {
          if (onDeleteConversation) {
            onDeleteConversation();
          }
        }}
      />

      {/* Generative UI: live artifact panel (docs/code the Dot created) */}
      {artifactsOpen && (
        <aside
          className="artifact-drawer"
          aria-label="Artifacts created in this chat"
        >
          <div className="artifact-drawer-header">
            <span className="artifact-drawer-title">Artifacts</span>
            <div className="artifact-drawer-actions">
              <button
                type="button"
                className="icon-button"
                aria-label="Refresh artifacts"
                onClick={refreshArtifacts}
              >
                ⟳
              </button>
              <button
                type="button"
                className="icon-button"
                aria-label="Close artifacts"
                onClick={() => setArtifactsOpen(false)}
              >
                ✕
              </button>
            </div>
          </div>
          {artifacts.length > 1 && (
            <div className="artifact-tabs" role="tablist">
              {artifacts.map((a) => (
                <button
                  key={a.id}
                  type="button"
                  role="tab"
                  aria-selected={
                    (selectedArtifactId ?? artifacts[0]!.id) === a.id
                  }
                  className={`artifact-tab ${
                    (selectedArtifactId ?? artifacts[0]!.id) === a.id
                      ? 'active'
                      : ''
                  }`}
                  onClick={() => setSelectedArtifactId(a.id)}
                  title={a.title}
                >
                  {a.kind === 'code' ? '⌘' : a.kind === 'markdown' ? '📄' : '📝'}{' '}
                  {a.title.length > 18 ? `${a.title.slice(0, 18)}…` : a.title}
                </button>
              ))}
            </div>
          )}
          {(() => {
            const active =
              artifacts.find((a) => a.id === selectedArtifactId) ??
              artifacts[0];
            if (!active) return null;
            return (
              <div className="artifact-body">
                <div className="artifact-meta">
                  <strong>{active.title}</strong>
                  <span>
                    {active.kind}
                    {active.language ? ` · ${active.language}` : ''} ·{' '}
                    {new Date(active.createdAt).toLocaleString()}
                  </span>
                </div>
                {active.kind === 'markdown' ? (
                  <div className="artifact-markdown">
                    <ReactMarkdown>{active.content}</ReactMarkdown>
                  </div>
                ) : (
                  <pre className="artifact-code">
                    <code>{active.content}</code>
                  </pre>
                )}
                <div className="artifact-footer">
                  <button
                    type="button"
                    className="artifact-copy"
                    onClick={() =>
                      void navigator.clipboard
                        ?.writeText(active.content)
                        .then(() => {
                          setCompactMessage('Artifact copied to clipboard.');
                          setTimeout(() => setCompactMessage(null), 2500);
                        })
                        .catch(() => undefined)
                    }
                  >
                    Copy
                  </button>
                  <button
                    type="button"
                    className="artifact-copy danger"
                    onClick={() => {
                      void api(`/artifacts/${active.id}`, 'DELETE').then(() => {
                        const remaining = artifacts.filter(
                          (a) => a.id !== active.id,
                        );
                        setArtifacts(remaining);
                        knownArtifactIds.current.delete(active.id);
                        setSelectedArtifactId(remaining[0]?.id ?? null);
                        if (remaining.length === 0) setArtifactsOpen(false);
                      });
                    }}
                  >
                    Delete
                  </button>
                </div>
              </div>
            );
          })()}
        </aside>
      )}
    </div>
  );
}
