import { PageReviewCard } from './PageReviewCard';
import { pageReviewSchema, pageReviewTool } from '../shared/page-review';
import { AskQuestionCard } from './AskQuestionCard';
import { askQuestionSchema, askQuestionTool } from '../shared/ask-question';
import { contextualMessage, type PageContext } from './page-context';
import { api } from './api';
import type { Page } from '../server/pages';
import { useEffect, useRef, useState } from 'react';
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
  Brain,
  ChevronDown,
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
} from 'lucide-react';
import { useSpeechToText, STT_MODELS } from './useSpeechToText';
import {
  ComputerToolCard,
  type ComputerToolRenderProps,
} from './ComputerToolCard';
import { ChatTranscript, isInternalVoiceReceipt } from './ChatTranscript';
import type { CallReceipt, Conversation, Dot } from '../shared/types';
import { Mascot } from './Mascot';
import { useVoice } from './useVoice';
import { CallView } from './CallView';
import { ConfirmDeleteModal } from './ConfirmDeleteModal';
import { SlashCommandsMenu, SLASH_COMMANDS, type SlashCommand } from './SlashCommandsMenu';
import { calculateTokenUsage, recordSessionTokenStats } from './token-counter';

interface ChatAttachment {
  id: string;
  name: string;
  mime: string;
  size: number;
  kind: 'image' | 'text' | 'file';
  textContent?: string;
  dataUrl?: string;
}

function isImageMime(mime: string, name: string): boolean {
  if (mime.startsWith('image/')) return true;
  return /\.(png|jpe?g|gif|webp|svg|bmp|ico)$/i.test(name);
}

function isTextReadable(mime: string, name: string): boolean {
  if (mime.startsWith('text/')) return true;
  if (mime.includes('json') || mime.includes('javascript') || mime.includes('typescript')) return true;
  return /\.(ts|tsx|js|jsx|py|go|rs|java|rb|php|css|html|md|txt|json|yml|yaml|toml|ini|sh|sql|xml|csv)$/i.test(name);
}

function formatModelName(model: string): string {
  if (model.includes('fledge-alpha-free')) return 'Fledge Alpha (Free)';
  if (model.includes('ling-3.1-flash-free')) return 'Ling 3.1 Flash (Free)';
  if (model.includes('big-pickle')) return 'Big Pickle (Free)';
  if (model.includes('space-bunny-free')) return 'Space Bunny (Free)';
  if (model.includes('nemotron-3.5-lightning-free')) return 'Nemotron 3.5 (Free)';
  if (model.includes('longcat-2.5-preview-free')) return 'LongCat 2.5 (Free)';
  if (model.includes('mimo-v2.6-flash-free')) return 'Mimo 2.6 (Free)';
  if (model.includes('muse-spark-1.3-contributor-free')) return 'Muse Spark (Free)';
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
  { id: 'default', label: 'Medium', desc: 'Balanced analytical reasoning (default)' },
  { id: 'high', label: 'High', desc: 'Deep problem solving & verification' },
  { id: 'xhigh', label: 'Extra High', desc: 'Intensive reasoning for tough problems' },
  { id: 'max', label: 'Max', desc: 'Maximum reasoning token budget' },
];

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
  const [currentEffort, setCurrentEffort] = useState(dot.reasoningEffort || 'default');
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
  const [attachments, setAttachments] = useState<ChatAttachment[]>([]);
  const [attachMenuOpen, setAttachMenuOpen] = useState(false);
  const [fullDirPath, setFullDirPath] = useState('');
  const [dirOpen, setDirOpen] = useState(false);
  const [dirDraft, setDirDraft] = useState('');
  const [dirStatus, setDirStatus] = useState('');
  const [dirIsGit, setDirIsGit] = useState(false);
  const [dirSaving, setDirSaving] = useState(false);
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
        setCompactMessage('⚡ Context compacted successfully! Token load minimized.');
        setTimeout(() => setCompactMessage(null), 4000);
        await copilotkit.connectAgent({ agent });
        onSaved();
      } else {
        setCompactMessage('Context is already optimal.');
        setTimeout(() => setCompactMessage(null), 3000);
      }
    } catch (e: any) {
      setError(e?.message || 'Could not compact context.');
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
    } catch (e: any) {
      setError(e?.message || 'Could not clear messages.');
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
    } else if (cmd.id === 'subagents') {
      if (onOpenSettings) {
        onOpenSettings('subagents');
      } else {
        void send('/subagents');
      }
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
      const query = draft.startsWith('/') ? draft.slice(1).toLowerCase() : draft.toLowerCase();
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
          setSlashSelectedIndex((prev) => (prev - 1 + filtered.length) % filtered.length);
          return;
        }
        if (e.key === 'Enter' || e.key === 'Tab') {
          const selected = filtered[Math.min(slashSelectedIndex, filtered.length - 1)];
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

  useEffect(() => {
    fetch('/api/models')
      .then((res) => res.json())
      .then((data) => {
        if (data && Array.isArray(data.models) && data.models.length > 0) {
          setModelOptions(data.models);
        }
      })
      .catch(() => {});

    fetch('/api/workspace/directory')
      .then((res) => res.json())
      .then((data) => {
        if (data && data.directory) {
          setFullDirPath(data.directory);
          setDirDraft(data.directory);
          const parts = data.directory.split('/');
          setConnectedDir(parts[parts.length - 1] || data.directory);
          setDirIsGit(!!data.isGit);
        }
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    const onDocClick = (e: MouseEvent) => {
      if (attachMenuRef.current && !attachMenuRef.current.contains(e.target as Node)) {
        setAttachMenuOpen(false);
      }
      if (dirPopoverRef.current && !dirPopoverRef.current.contains(e.target as Node)) {
        setDirOpen(false);
      }
    };
    document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, []);

  const refreshDirectory = async () => {
    try {
      const res = await fetch('/api/workspace/directory');
      const data = await res.json();
      if (data?.directory) {
        setFullDirPath(data.directory);
        setDirDraft(data.directory);
        const parts = data.directory.split('/');
        setConnectedDir(parts[parts.length - 1] || data.directory);
        setDirIsGit(!!data.isGit);
      }
    } catch {}
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
      const res = await fetch('/api/workspace/directory', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ directory: target }),
      });
      const data = await res.json();
      if (!res.ok) {
        setDirStatus(data?.error || 'Directory not found on server disk.');
      } else {
        setFullDirPath(data.directory);
        const parts = String(data.directory).split('/');
        setConnectedDir(parts[parts.length - 1] || data.directory);
        setDirIsGit(!!data.isGit);
        setDirStatus(`Connected — tools now run in ${data.directory}`);
        onSaved();
      }
    } catch {
      setDirStatus('Could not reach server to verify directory.');
    } finally {
      setDirSaving(false);
    }
  };

  const handleFilesSelected = async (files: FileList | null, forceImage = false) => {
    if (!files || files.length === 0) return;
    const next: ChatAttachment[] = [];
    for (const file of Array.from(files).slice(0, 5)) {
      if (file.size > 8 * 1024 * 1024) {
        setError(`"${file.name}" exceeds 8MB and was skipped.`);
        continue;
      }
      const id = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
      const mime = file.type || 'application/octet-stream';
      const image = forceImage || isImageMime(mime, file.name);
      if (image) {
        const dataUrl = await new Promise<string>((resolve) => {
          const r = new FileReader();
          r.onload = () => resolve(String(r.result || ''));
          r.readAsDataURL(file);
        });
        next.push({ id, name: file.name, mime, size: file.size, kind: 'image', dataUrl });
      } else if (isTextReadable(mime, file.name) && file.size < 500 * 1024) {
        const textContent = await file.text().catch(() => '');
        next.push({ id, name: file.name, mime, size: file.size, kind: 'text', textContent: textContent.slice(0, 60000) });
      } else {
        next.push({ id, name: file.name, mime, size: file.size, kind: 'file' });
      }
    }
    if (next.length) {
      setAttachments((prev) => [...prev, ...next].slice(0, 6));
      setAttachMenuOpen(false);
    }
    if (fileInputRef.current) fileInputRef.current.value = '';
    if (imageInputRef.current) imageInputRef.current.value = '';
  };

  const buildAttachmentContext = (): string => {
    if (attachments.length === 0) return '';
    const parts: string[] = ['\n\n--- Attached files ---'];
    for (const a of attachments) {
      if (a.kind === 'image' && a.dataUrl) {
        parts.push(`\n[Attached image: ${a.name} (${a.mime}, ${Math.round(a.size / 1024)}KB)]\n![${a.name}](${a.dataUrl.slice(0, 200000)})`);
      } else if (a.kind === 'text' && a.textContent !== undefined) {
        parts.push(`\n[Attached file: ${a.name}]\n\`\`\`\n${a.textContent}\n\`\`\``);
      } else {
        parts.push(`\n[Attached file: ${a.name} (${a.mime}, ${Math.round(a.size / 1024)}KB) — binary, inspect via local coding workspace if available]`);
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
    } catch {}
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
    } catch {}
  };

  const voice = useVoice(thread.id, onSaved, agent.messages.at(-1)?.id);
  const sent = useRef(false);
  const bottom = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const subscription = copilotkit.subscribe({
      onError: ({ error }) => setError(error.message),
    });
    const events = agent.subscribe({
      onRunErrorEvent: ({ event }) => setError(event.message),
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
    if ((!text.trim() && !hasAttachments) || running || !loaded || !contextReady || paused) return;
    const trimmed = text.trim() || (hasAttachments ? `Please review the attached file(s): ${attachments.map((a) => a.name).join(', ')}` : '');
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

        const catMatch = textToSave.match(/^\[(preference|fact|instruction|project|goal|note|todo)\]\s*(.*)$/i);
        if (catMatch) {
          category = catMatch[1].toLowerCase();
          textToSave = catMatch[2] || textToSave;
        }

        try {
          if (isSession || !isGlobal) {
            await api(`/conversations/${thread.id}/memories`, 'POST', { text: textToSave, category });
            setCompactMessage(`Saved session note: "${textToSave.slice(0, 35)}..."`);
          } else {
            await api('/memories', 'POST', { text: textToSave, category: category === 'note' ? 'general' : category });
            setCompactMessage(`Saved workspace memory: "${textToSave.slice(0, 35)}..."`);
          }
          setTimeout(() => setCompactMessage(null), 3000);
          onSaved();
          setDraft('');
          return;
        } catch (e: any) {
          setError(e?.message || 'Could not save memory.');
          return;
        }
      }
    }

    let outgoing = text;
    if (trimmed.startsWith('/goal ')) {
      const goal = trimmed.slice(6).trim();
      outgoing = `🎯 **Goal Mode Active**\nObjective: ${goal}\n\nPlease autonomously plan and execute all necessary steps, inspect tool evidence, verify completion, and do not stop until fully achieved.`;
    } else if (trimmed.startsWith('/code ')) {
      const codeTask = trimmed.slice(6).trim();
      outgoing = `💻 **Code Mode Active**\nTask: ${codeTask}\n\nPlease inspect the local project files, view or edit code using your str_replace_editor and bash tools, execute necessary commands (builds/tests), and verify the outcome.`;
    } else if (trimmed.startsWith('/plan ')) {
      const planTask = trimmed.slice(6).trim();
      outgoing = `📋 **Plan Mode Active**\nTask: ${planTask}\n\nPlease formulate an explicit, phased execution plan with milestone checkboxes and dependencies.`;
    } else if (trimmed.startsWith('/search ')) {
      const q = trimmed.slice(8).trim();
      outgoing = `Please search the web for "${q}" and summarize findings with source citations.`;
    } else if (trimmed.startsWith('/browse ')) {
      const url = trimmed.slice(8).trim();
      outgoing = `Please navigate to ${url} using your computer browser tool and inspect the page content.`;
    } else if (trimmed === '/help') {
      outgoing = `What commands and tools are available in DoshBot by SafarNow? Please list the slash commands (/goal, /code, /plan, /compact, /memory, /mcp, /schedule, /search, /browse, /clear) and explain how to use them with MCP and local tools.`;
    }

    const attachmentContext = buildAttachmentContext();
    if (attachmentContext) {
      outgoing = `${outgoing}${attachmentContext}`;
    }

    setError('');
    setRunning(true);
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
    try {
      const result = await copilotkit.runAgent({ agent });
      if (!result.newMessages.some((message) => message.role === 'assistant'))
        throw new Error(
          'The current turn returned no response. Check the runtime connection and retry.',
        );
      onSaved();
    } catch (e) {
      setError(
        e instanceof Error
          ? e.message
          : 'The turn failed. Your conversation remains saved.',
      );
    } finally {
      setRunning(false);
    }
  };
  useEffect(() => {
    if (loaded && contextReady && !paused && initialPrompt && !sent.current) {
      sent.current = true;
      onConsumed();
      void send(initialPrompt);
    }
  }, [loaded, contextReady, paused, initialPrompt]);
  useEffect(() => {
    bottom.current?.scrollIntoView({ behavior: 'instant', block: 'end' });
  }, [agent.messages.length, running]);
  useEffect(() => {
    if (paused && voice.status !== 'idle') void voice.end();
  }, [paused]);
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
        ) : null,
    },
    [dot.id, dot.name, running, latestBrowserCall?.id, onComputer],
  );
  const visible = agent.messages.filter(
    (message) =>
      !isInternalVoiceReceipt(message) &&
      ['user', 'assistant'].includes(message.role) &&
      ((typeof message.content === 'string' && message.content.trim()) ||
        (message.role === 'assistant' &&
          message.toolCalls?.some(
            (call) =>
              call.function.name.startsWith('computer_') ||
              call.function.name === pageReviewTool.name,
          ))),
  );

  const tokenUsage = calculateTokenUsage(agent.messages, currentModel);
  useEffect(() => {
    if (agent.messages.length > 0) {
      recordSessionTokenStats(thread.id, tokenUsage);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [agent.messages.length, thread.id]);

  return (
    <div className="live-chat">
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
          {/* DSH Token Usage Meter Badge — per-session in/out tracking */}
          <div
            className={`token-meter-pill ${tokenUsage.status}`}
            title={`Session ${thread.id.slice(0, 8)} — In: ${tokenUsage.inputFormatted} / Out: ${tokenUsage.outputFormatted} / Total: ${tokenUsage.formatted} of ${tokenUsage.maxFormatted} (${tokenUsage.percentage}%). ${tokenUsage.messageCount} msgs. Click to compact context and free cache.`}
            onClick={() => void handleCompact()}
            role="button"
            tabIndex={0}
          >
            <span className="token-meter-text" title={`Input ≈ ${tokenUsage.inputFormatted}`}>↑{tokenUsage.inputFormatted}</span>
            <span className="token-meter-text" title={`Output ≈ ${tokenUsage.outputFormatted}`}>↓{tokenUsage.outputFormatted}</span>
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
        />
        {running && (
          <div className="thinking">
            <span />
            <span />
            <span />
            <span>{dot.name} is thinking</span>
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
          {error || voice.error}
          {error && (
            <button
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
      )}
      <CallView
        key={voice.status === 'idle' ? 'idle' : 'call'}
        dot={dot}
        voice={voice}
      />
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
          </div>
        )}
        <div className="chat-composer-box" style={{ position: 'relative' }}>
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
                <div key={a.id} className="attach-chip" title={`${a.name} — ${a.mime}`}>
                  {a.kind === 'image' && a.dataUrl ? (
                    <img src={a.dataUrl} alt={a.name} className="attach-thumb" />
                  ) : a.kind === 'image' ? (
                    <ImageIcon size={14} />
                  ) : (
                    <FileText size={14} />
                  )}
                  <span className="attach-name">{a.name.length > 18 ? `${a.name.slice(0, 15)}…` : a.name}</span>
                  <button
                    type="button"
                    className="attach-remove"
                    aria-label={`Remove ${a.name}`}
                    onClick={() => setAttachments((prev) => prev.filter((x) => x.id !== a.id))}
                  >
                    <X size={12} />
                  </button>
                </div>
              ))}
            </div>
          )}
          <textarea
            ref={textareaRef}
            aria-label="Message your Dot"
            placeholder={`Message ${dot.name} — type / for commands, + to attach files…`}
            rows={1}
            value={draft}
            maxLength={12000}
            onChange={(e) => handleDraftChange(e.target.value)}
            onKeyDown={handleKeyDown}
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
                  onClick={() => copilotkit.stopAgent({ agent })}
                >
                  <Square size={15} />
                </button>
              ) : (
                <button
                  type="submit"
                  className="composer-send-btn"
                  aria-label="Send message"
                  disabled={(!draft.trim() && attachments.length === 0) || !loaded || !contextReady || paused}
                >
                  <ArrowUp size={18} strokeWidth={2.5} />
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
                  <Plus size={18} strokeWidth={2} />
                </button>
                {attachMenuOpen && (
                  <div className="chat-popover-menu attach-menu">
                    <div className="chat-popover-header">
                      <span>Add context</span>
                      <small>files · images · code</small>
                    </div>
                    <button type="button" className="chat-popover-item" onClick={() => fileInputRef.current?.click()}>
                      <Paperclip size={15} />
                      <div className="chat-effort-col">
                        <span className="chat-item-name">Upload files</span>
                        <span className="chat-item-desc">Code, docs, text up to 8MB</span>
                      </div>
                    </button>
                    <button type="button" className="chat-popover-item" onClick={() => imageInputRef.current?.click()}>
                      <ImageIcon size={15} />
                      <div className="chat-effort-col">
                        <span className="chat-item-name">Upload images</span>
                        <span className="chat-item-desc">Screenshots, diagrams, UI</span>
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
                        <span className="chat-item-desc">Public page for research</span>
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
                        <span className="chat-item-name">Connect local folder</span>
                        <span className="chat-item-desc">{fullDirPath || connectedDir || 'Choose coding directory'}</span>
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
                  title={fullDirPath ? `Coding workspace: ${fullDirPath}. Click to change (Claude / DSH-style local folder).` : 'Connect a local folder to code in (Claude / DSH-style)'}
                >
                  <FolderGit2 size={14} />
                  <span>{connectedDir || 'Connect folder'}</span>
                  {dirIsGit && <span className="dir-git-dot" title="Git repo detected">●</span>}
                </button>
                {dirOpen && (
                  <div className="chat-popover-menu dir-menu">
                    <div className="chat-popover-header">
                      <span>Local folder — DSH / Claude style</span>
                      <small>{dirIsGit ? 'git repo' : 'local fs'}</small>
                    </div>
                    <div className="dir-picker-body">
                      <p className="chat-item-desc" style={{ margin: '0 0 8px' }}>
                        Agent runs <code>str_replace_editor</code>, <code>bash</code>, <code>code_interpreter</code> here.
                      </p>
                      <input
                        type="text"
                        value={dirDraft}
                        onChange={(e) => setDirDraft(e.target.value)}
                        placeholder="/Users/you/my-project"
                        spellCheck={false}
                        style={{ fontFamily: 'monospace', fontSize: '12px' }}
                      />
                      {fullDirPath && (
                        <div className="dir-current" title={fullDirPath}>
                          Current: {fullDirPath}
                        </div>
                      )}
                      {dirStatus && <div className="dir-status">{dirStatus}</div>}
                      <div className="dir-actions">
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
                    size={14}
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
                            <span className="chat-item-name">{formatModelName(m)}</span>
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
                  <BarChart2 size={15} strokeWidth={2.2} />
                  <span>{formatEffortName(currentEffort)}</span>
                  <ChevronDown
                    size={14}
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
              <button
                type="button"
                className={`composer-icon-btn ${stt.isRecording ? 'recording' : ''} ${stt.isTranscribing ? 'transcribing' : ''}`}
                aria-label="Speech to text"
                title={
                  stt.isRecording
                    ? 'Listening... Click to finish speaking'
                    : stt.isTranscribing
                      ? 'Transcribing speech...'
                      : `Dictate message (${stt.sttModel})`
                }
                onClick={() => void stt.toggleRecording()}
              >
                <Mic size={17} />
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
                  <AudioLines size={18} />
                  <ChevronDown
                    size={14}
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
                            <span className="stt-model-desc">{m.description}</span>
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

        {/* Suggestion Chips Below Composer Box */}
        <div className="composer-suggestions">
          <button
            type="button"
            onClick={() => setDraft('Help me think this through')}
          >
            <Lightbulb size={16} />
            <span>Help me think this through</span>
            <ArrowUpRight size={14} />
          </button>
          <button
            type="button"
            onClick={() => setDraft('Research a public page')}
          >
            <Search size={16} />
            <span>Research a public page</span>
            <ArrowUpRight size={14} />
          </button>
          <button
            type="button"
            onClick={() => setDraft('Make a plan I can follow')}
          >
            <FileText size={16} />
            <span>Make a plan I can follow</span>
            <ArrowUpRight size={14} />
          </button>
        </div>
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
    </div>
  );
}
