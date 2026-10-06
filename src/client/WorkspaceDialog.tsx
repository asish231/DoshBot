import { useEffect, useRef, useState } from 'react';
import {
  X,
  Plug,
  Clock3,
  Play,
  Pause,
  Trash2,
  Plus,
  ExternalLink,
  RefreshCw,
  Check,
  Globe,
  Server,
  Cpu,
  FolderOpen,
} from 'lucide-react';
import type { Dot, Memory, State, WorkspaceState, Connector } from '../shared/types';
import { COMPUTER_ENVIRONMENTS } from '../shared/computer-types';
export type Dialog =
  | { type: 'space' }
  | { type: 'dot'; dot?: Dot; spaceId: string }
  | { type: 'settings'; initialTab?: string }
  | { type: 'memory'; memory?: Memory }
  | { type: 'schedule'; threadId: string };

export interface ModelInfo {
  id: string;
  name: string;
  provider: string;
  desc: string;
  tag?: string;
}

/** Curated metadata overlay — only applied when the id matches a live provider model. */
const KNOWN_MODEL_META: ModelInfo[] = [
  // DeepSeek
  { id: 'deepseek-chat', name: 'deepseek-chat', provider: 'DeepSeek', desc: 'V3 architecture with fast inference, coding, and chat', tag: 'Fast Chat' },
  { id: 'deepseek-reasoner', name: 'deepseek-reasoner', provider: 'DeepSeek', desc: 'R1 deep reasoning engine with thorough step-by-step thinking', tag: 'Deep Thinking' },
  { id: 'deepseek-v4-pro', name: 'deepseek-v4-pro', provider: 'DeepSeek', desc: 'Next-gen flagship reasoning and agentic synthesis', tag: 'Flagship' },
  { id: 'deepseek-v4.1-flash', name: 'deepseek-v4.1-flash', provider: 'DeepSeek', desc: 'Ultra-low latency model for instant code and tool replies', tag: 'Speed' },
  { id: 'deepseek-v4-flash', name: 'deepseek-v4-flash', provider: 'DeepSeek', desc: 'Fast, compact agent model', tag: 'Speed' },
  { id: 'deepseek-v3.2', name: 'deepseek-v3.2', provider: 'DeepSeek', desc: 'Stable versatile general assistant', tag: 'Stable' },

  // Moonshot / Kimi
  { id: 'kimi-k2.7-code', name: 'kimi-k2.7-code', provider: 'Moonshot', desc: 'Specialized code generation, debugging, and terminal agent', tag: 'Coding' },
  { id: 'kimi-k2.6', name: 'kimi-k2.6', provider: 'Moonshot', desc: 'Long-context conversational understanding and file synthesis', tag: 'Long Context' },
  { id: 'kimi-k3', name: 'kimi-k3', provider: 'Moonshot', desc: 'Next-generation reasoning model with extended context', tag: 'Reasoning' },

  // Alibaba / Qwen
  { id: 'qwen3.8-max', name: 'qwen3.8-max', provider: 'Alibaba', desc: 'Frontier reasoning model with comprehensive tool-use capabilities', tag: 'Flagship' },
  { id: 'qwen3-coder-plus', name: 'qwen3-coder-plus', provider: 'Alibaba', desc: 'Code specialist with deep repository-level understanding', tag: 'Coding' },
  { id: 'qwen3.8-27b', name: 'qwen3.8-27b', provider: 'Alibaba', desc: 'Efficient balanced reasoning for agentic loops', tag: 'Balanced' },
  { id: 'qwen3.8-flash', name: 'qwen3.8-flash', provider: 'Alibaba', desc: 'High-speed lightweight Qwen model for agile queries', tag: 'Speed' },
  { id: 'qwen3.7-max', name: 'qwen3.7-max', provider: 'Alibaba', desc: 'High-capability analytical intelligence', tag: 'High Cap' },

  // Google Gemini
  { id: 'gemini-2.5-pro', name: 'gemini-2.5-pro', provider: 'Google', desc: '2M context reasoning model with advanced code analysis', tag: '2M Context' },
  { id: 'gemini-2.5-flash', name: 'gemini-2.5-flash', provider: 'Google', desc: 'Fast, high-throughput model with multimodal reasoning', tag: 'Fast Multimodal' },

  // Anthropic & OpenAI
  { id: 'claude-3-7-sonnet', name: 'claude-3-7-sonnet', provider: 'Anthropic', desc: 'State-of-the-art hybrid reasoning, coding, and agent execution', tag: 'Top Tier' },
  { id: 'claude-3-5-sonnet', name: 'claude-3-5-sonnet', provider: 'Anthropic', desc: 'Proven industry standard for software development and tools', tag: 'Industry Standard' },
  { id: 'gpt-4o', name: 'gpt-4o', provider: 'OpenAI', desc: 'Flagship multimodal Omni model with high precision', tag: 'Omni' },
  { id: 'gpt-4o-mini', name: 'gpt-4o-mini', provider: 'OpenAI', desc: 'Fast, cost-efficient model for everyday coding', tag: 'Lightweight' },
  { id: 'o3-mini', name: 'o3-mini', provider: 'OpenAI', desc: 'High-speed STEM and code reasoning model', tag: 'STEM Reasoning' },
  { id: 'o1', name: 'o1', provider: 'OpenAI', desc: 'Deep reinforcement-learned reasoning model', tag: 'Deep Thinking' },

  // OpenDots Auto Presets
  { id: 'auto-code', name: 'auto-code', provider: 'OpenDots', desc: 'Intelligent router optimized for coding and computer execution', tag: 'Auto Default' },
  { id: 'auto-complex', name: 'auto-complex', provider: 'OpenDots', desc: 'Deep research router with thorough verification steps', tag: 'Auto Deep' },
  { id: 'auto-fast', name: 'auto-fast', provider: 'OpenDots', desc: 'Fastest router for quick edits and single-turn queries', tag: 'Auto Fast' },
  { id: 'auto-flash', name: 'auto-flash', provider: 'OpenDots', desc: 'Sub-second response router for interactive tasks', tag: 'Auto Flash' },
  { id: 'auto-vision', name: 'auto-vision', provider: 'OpenDots', desc: 'Vision and browser screenshot analysis specialist', tag: 'Auto Vision' },

  // Meta & Others
  { id: 'llama-3.3-70b-versatile', name: 'llama-3.3-70b-versatile', provider: 'Meta', desc: 'Open weights general-purpose intelligence', tag: 'Open Weights' },
  { id: 'glm-5.3', name: 'glm-5.3', provider: 'Zhipu', desc: 'Bilingual reasoning and agentic tooling model', tag: 'Agent' },
  { id: 'minimax-m3', name: 'minimax-m3', provider: 'MiniMax', desc: 'Long-form reasoning and language synthesis', tag: 'Long Form' },

  // OpenCode (Free Tier Models)
  { id: 'opencode/fledge-alpha-free', name: 'fledge-alpha-free', provider: 'OpenCode Free', desc: 'Free high-speed coding and autonomous task execution', tag: 'Free Tier' },
  { id: 'opencode/ling-3.1-flash-free', name: 'ling-3.1-flash-free', provider: 'OpenCode Free', desc: 'Free bilingual reasoning and agile tool execution', tag: 'Free Tier' },
  { id: 'opencode/ling-3.0-flash-fin-free', name: 'ling-3.0-flash-fin-free', provider: 'OpenCode Free', desc: 'Free analytical reasoning and financial synthesis', tag: 'Free Tier' },
  { id: 'opencode/longcat-2.5-preview-free', name: 'longcat-2.5-preview-free', provider: 'OpenCode Free', desc: 'Free extended context window for code analysis', tag: 'Free Tier' },
  { id: 'opencode/mimo-v2.6-flash-free', name: 'mimo-v2.6-flash-free', provider: 'OpenCode Free', desc: 'Free agile lightweight agent model', tag: 'Free Tier' },
  { id: 'opencode/muse-spark-1.3-contributor-free', name: 'muse-spark-1.3-contributor-free', provider: 'OpenCode Free', desc: 'Free contributor-tier coding and creative synthesis', tag: 'Free Tier' },
  { id: 'opencode/nemotron-3.5-lightning-free', name: 'nemotron-3.5-lightning-free', provider: 'OpenCode Free', desc: 'Free NVIDIA-powered lightning STEM inference', tag: 'Free Tier' },
  { id: 'opencode/space-bunny-free', name: 'space-bunny-free', provider: 'OpenCode Free', desc: 'Free lightweight versatile chat and coding agent', tag: 'Free Tier' },
  { id: 'opencode/big-pickle', name: 'big-pickle', provider: 'OpenCode Free', desc: 'Free 200k context flagship reasoning engine', tag: 'Free Tier' },
];

function getModelCategory(m: string): string {
  const lower = m.toLowerCase();
  if (lower.startsWith('opencode')) return 'OpenCode Free';
  if (lower.startsWith('deepseek')) return 'DeepSeek';
  if (lower.startsWith('kimi')) return 'Kimi / Moonshot';
  if (lower.startsWith('qwen')) return 'Qwen';
  if (lower.startsWith('gemini')) return 'Gemini';
  if (
    lower.startsWith('claude') ||
    lower.startsWith('gpt') ||
    lower.startsWith('o1') ||
    lower.startsWith('o3')
  )
    return 'Anthropic & OpenAI';
  if (lower.startsWith('auto')) return 'Auto Presets';
  return 'Other';
}


const effortCaptions: Record<string, string> = {
  '': 'Follows workspace default or provider standard reasoning.',
  default: 'Follows workspace default or provider standard reasoning.',
  none: 'No reasoning tokens. Fastest execution and immediate response.',
  low: 'Brief step-by-step thinking for straightforward requests.',
  medium: 'Balanced analytical reasoning for multi-step tasks.',
  high: 'Deep reasoning and careful verification for coding and technical problems.',
  xhigh: 'Extended reasoning budget for difficult engineering questions.',
  max: 'Maximum reasoning depth for complex logic and deep problem solving.',
};

export function WorkspaceDialog({
  dialog,
  state,
  workspace,
  onClose,
  mutate,
}: {
  dialog: Dialog;
  state: State;
  workspace: WorkspaceState;
  onClose: () => void;
  mutate: (path: string, method: string, body?: unknown) => Promise<boolean>;
}) {
  const [name, setName] = useState(
    dialog.type === 'dot' ? (dialog.dot?.name ?? '') : '',
  );
  const [text, setText] = useState(
    dialog.type === 'dot'
      ? (dialog.dot?.instructions ?? '')
      : dialog.type === 'memory'
        ? (dialog.memory?.text ?? '')
        : '',
  );
  const [research, setResearch] = useState(
    dialog.type === 'dot'
      ? (dialog.dot?.researchAllowed ?? true)
      : state.settings.researchAllowed,
  );
  const [memory, setMemory] = useState(
    dialog.type === 'dot'
      ? (dialog.dot?.memoryAllowed ?? true)
      : state.settings.memoryAllowed,
  );
  const [spaceIds, setSpaceIds] = useState(
    dialog.type === 'dot' ? (dialog.dot?.spaceIds ?? [dialog.spaceId]) : [],
  );
  const [defaultSpace, setDefaultSpace] = useState(
    dialog.type === 'dot' ? (dialog.dot?.spaceId ?? dialog.spaceId) : '',
  );
  const [interval, setInterval] = useState('86400');
  const [learningContainer, setLearningContainer] = useState(
    dialog.type === 'dot' ? (dialog.dot?.learningContainerId ?? '') : '',
  );
  const [skillDelivery, setSkillDelivery] = useState(
    dialog.type === 'dot' ? (dialog.dot?.skillDeliveryEnabled ?? false) : false,
  );
  const [model, setModel] = useState(
    dialog.type === 'dot'
      ? (dialog.dot?.model ?? '')
      : (state.settings.model ?? ''),
  );
  const [reasoningEffort, setReasoningEffort] = useState(
    dialog.type === 'dot'
      ? (dialog.dot?.reasoningEffort ?? '')
      : (state.settings.reasoningEffort ?? ''),
  );
  const [settingsTab, setSettingsTab] = useState<
    'setup' | 'models' | 'coding' | 'subagents' | 'memory' | 'connectors' | 'automations' | 'computer' | 'voice' | 'general'
  >((dialog.type === 'settings' && (dialog as any).initialTab) || 'setup');

  // OpenCode & Coding workspace state
  const [codingDirectory, setCodingDirectory] = useState<string>(
    state.settings.codingDirectory || '',
  );
  const [codingEnabled, setCodingEnabled] = useState<boolean>(
    state.settings.codingEnabled !== false,
  );
  const [bashPermission, setBashPermission] = useState<'auto' | 'ask' | 'deny'>(() => {
    try {
      const p = JSON.parse(state.settings.codingPermissions || '{}');
      return p.bash || 'auto';
    } catch {
      return 'auto';
    }
  });
  const [editsPermission, setEditsPermission] = useState<'auto' | 'ask' | 'deny'>(() => {
    try {
      const p = JSON.parse(state.settings.codingPermissions || '{}');
      return p.edits || 'auto';
    } catch {
      return 'auto';
    }
  });
  const [opencodeVariant, setOpencodeVariant] = useState<string>(
    state.settings.opencodeVariant || 'high',
  );
  const [opencodeStatus, setOpencodeStatus] = useState<any>(null);
  const [dirVerifyStatus, setDirVerifyStatus] = useState<string>('');
  const [browsePath, setBrowsePath] = useState('');
  const [browseParent, setBrowseParent] = useState('');
  const [browseEntries, setBrowseEntries] = useState<Array<{ name: string; path: string }>>([]);
  const [browseLoading, setBrowseLoading] = useState(false);
  const [browseError, setBrowseError] = useState('');
  const [browseOpen, setBrowseOpen] = useState(false);

  const loadBrowse = async (path?: string) => {
    const target = (path ?? codingDirectory.trim()).trim();
    setBrowseLoading(true);
    setBrowseError('');
    try {
      const res = await fetch(`/api/workspace/browse${target ? `?path=${encodeURIComponent(target)}` : ''}`);
      const data = await res.json();
      if (!res.ok) {
        setBrowseError(data?.error || 'Cannot list folders on this device.');
        return;
      }
      setBrowsePath(data.path);
      setBrowseParent(data.parent);
      setBrowseEntries(data.entries ?? []);
      setBrowseOpen(true);
    } catch {
      setBrowseError('Could not reach server to browse folders.');
    } finally {
      setBrowseLoading(false);
    }
  };

  // Dual-layer memory state
  const [sessionMemories, setSessionMemories] = useState<any[]>([]);
  const [selectedThreadForMem, setSelectedThreadForMem] = useState<string>(
    workspace.conversations[0]?.id || '',
  );
  const [newSessionMemText, setNewSessionMemText] = useState('');
  const [newSessionMemCategory, setNewSessionMemCategory] = useState('note');
  const [newGlobalMemText, setNewGlobalMemText] = useState('');
  const [newGlobalMemCategory, setNewGlobalMemCategory] = useState('preference');

  // Subagents creation state
  const [newDotName, setNewDotName] = useState('');
  const [newDotInstructions, setNewDotInstructions] = useState('');
  const [newDotSpace, setNewDotSpace] = useState(workspace.spaces[0]?.id || '');
  const [newDotModel, setNewDotModel] = useState('opencode/fledge-alpha-free');
  const [newDotEffort, setNewDotEffort] = useState('high');
  const [dotCreatedMessage, setDotCreatedMessage] = useState(false);
  const [computerEnv, setComputerEnv] = useState<string>(
    state.settings.computerEnvironment || 'ubuntu',
  );
  const [voiceProvider, setVoiceProvider] = useState<string>(
    state.settings.voiceProvider || 'gemini',
  );
  const [voiceModel, setVoiceModel] = useState<string>(
    state.settings.voiceModel || 'gemini-3.8-live',
  );
  const [voiceName, setVoiceName] = useState<string>(
    state.settings.voiceName || 'Aoede',
  );
  const [voiceTelephonyProvider, setVoiceTelephonyProvider] = useState<string>(
    state.settings.voiceTelephonyProvider || 'none',
  );
  const [telegramBotToken, setTelegramBotToken] = useState<string>(
    state.settings.telegramBotToken || '',
  );
  const [telegramAllowedUsers, setTelegramAllowedUsers] = useState<string>(
    state.settings.telegramAllowedUsers || '',
  );
  const [whatsappPhoneNumberId, setWhatsappPhoneNumberId] = useState<string>(
    state.settings.whatsappPhoneNumberId || '',
  );
  const [whatsappAccessToken, setWhatsappAccessToken] = useState<string>(
    state.settings.whatsappAccessToken || '',
  );
  const [whatsappVerifyToken, setWhatsappVerifyToken] = useState<string>(
    state.settings.whatsappVerifyToken || '',
  );
  const [twilioAccountSid, setTwilioAccountSid] = useState<string>(
    state.settings.twilioAccountSid || '',
  );
  const [twilioAuthToken, setTwilioAuthToken] = useState<string>(
    state.settings.twilioAuthToken || '',
  );
  const [twilioPhoneNumber, setTwilioPhoneNumber] = useState<string>(
    state.settings.twilioPhoneNumber || '',
  );
  const [voiceKeys, setVoiceKeys] = useState<
    { id: string; label: string; key: string; provider: string }[]
  >(() => {
    try {
      const parsed = JSON.parse(state.settings.voiceApiKeys || '[]');
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  });
  const [newKeyLabel, setNewKeyLabel] = useState('');
  const [newKeyValue, setNewKeyValue] = useState('');
  const [newKeyProvider, setNewKeyProvider] = useState('gemini');
  const [keyAddedMessage, setKeyAddedMessage] = useState(false);

  // MCP Servers State
  const [connectors, setConnectors] = useState<Connector[]>(() => {
    try {
      const parsed = JSON.parse(state.settings.connectors || '[]');
      if (Array.isArray(parsed) && parsed.length > 0) {
        return parsed.filter((c: any) => c.id !== 'openwork-cloud');
      }
    } catch {}
    return [];
  });
  const [newConnName, setNewConnName] = useState('');
  const [newConnType, setNewConnType] = useState<'local_stdio' | 'remote_sse'>('local_stdio');
  const [newConnUrl, setNewConnUrl] = useState('');
  const [newConnToken, setNewConnToken] = useState('');
  const [connAddedMessage, setConnAddedMessage] = useState(false);

  // Automations state
  const [newAutoPrompt, setNewAutoPrompt] = useState('');
  const [newAutoInterval, setNewAutoInterval] = useState('3600');
  const [newAutoThread, setNewAutoThread] = useState(workspace.conversations[0]?.id || '');
  const [autoAddedMessage, setAutoAddedMessage] = useState(false);

  // Memory category state (DSH style)
  const [memoryCategory, setMemoryCategory] = useState<string>(
    dialog.type === 'memory' ? (dialog.memory?.category || 'general') : 'general'
  );
  const [modelSearch, setModelSearch] = useState('');
  const [modelFilter, setModelFilter] = useState('All');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [modelOptions, setModelOptions] = useState<string[]>([
    'auto-code',
    'auto-complex',
    'auto',
    'auto-fast',
    'auto-flash',
    'auto-vision',
    'deepseek-v4-pro',
    'deepseek-v4.1-flash',
    'deepseek-v4-flash',
    'deepseek-v3.2',
    'qwen3.8-max',
    'qwen3.8-flash',
    'qwen3.8-27b',
    'qwen3.7-max',
    'qwen3-coder-plus',
    'kimi-k3',
    'kimi-k2.7-code',
    'kimi-k2.6',
    'glm-5.3',
    'minimax-m3',
    'gemini-2.5-pro',
    'gemini-2.5-flash',
    'llama-3.3-70b-versatile',
    'scholar-s2',
    'atria-dawn',
    'agents-a1',
  ]);
  const container = useRef<HTMLElement>(null);

  const knownMetaById = new Map(KNOWN_MODEL_META.map((m) => [m.id, m]));
  /** Original provider models first — metadata overlay only when the id matches. */
  const liveModels: ModelInfo[] = modelOptions.map((id) => {
    const known = knownMetaById.get(id);
    if (known) return known;
    return {
      id,
      name: id,
      provider: getModelCategory(id),
      desc: 'Available on your configured provider.',
    };
  });
  const filteredModels = liveModels.filter((m) => {
    const matchesFilter =
      modelFilter === 'All' ||
      m.provider.toLowerCase().includes(modelFilter.toLowerCase()) ||
      (modelFilter === 'OpenDots' && m.provider === 'OpenDots');
    const query = modelSearch.trim().toLowerCase();
    const matchesQuery =
      !query ||
      m.id.toLowerCase().includes(query) ||
      m.provider.toLowerCase().includes(query) ||
      m.desc.toLowerCase().includes(query);
    return matchesFilter && matchesQuery;
  });
  /** Specialist quick picks derived from the live provider list. */
  const dynamicPresets = (() => {
    const picks: string[] = [];
    for (const id of ['auto-code', 'auto-complex', ...modelOptions]) {
      if (!picks.includes(id)) picks.push(id);
      if (picks.length >= 8) break;
    }
    return picks;
  })();

  useEffect(() => {
    fetch('/api/models')
      .then((res) => res.json())
      .then((data) => {
        if (data && Array.isArray(data.models) && data.models.length > 0) {
          setModelOptions(data.models);
        }
        if (data && data.opencode) {
          setOpencodeStatus(data.opencode);
        }
      })
      .catch(() => {});

    fetch('/api/workspace/directory')
      .then((res) => res.json())
      .then((data) => {
        if (data && data.directory) {
          if (!codingDirectory) setCodingDirectory(data.directory);
          if (data.permissions) {
            if (data.permissions.bash) setBashPermission(data.permissions.bash);
            if (data.permissions.edits) setEditsPermission(data.permissions.edits);
          }
        }
      })
      .catch(() => {});
  }, []);

  const loadSessionMemories = (threadId: string) => {
    if (!threadId) return;
    fetch(`/api/conversations/${threadId}/session-memories`)
      .then((res) => res.json())
      .then((data) => {
        if (Array.isArray(data)) setSessionMemories(data);
      })
      .catch(() => {});
  };

  useEffect(() => {
    if (selectedThreadForMem) {
      loadSessionMemories(selectedThreadForMem);
    }
  }, [selectedThreadForMem]);
  useEffect(() => {
    const previous =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    container.current
      ?.querySelector<HTMLElement>('input,textarea,select')
      ?.focus();
    const key = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
      if (event.key === 'Tab') {
        const items = [
          ...(container.current?.querySelectorAll<HTMLElement>(
            'button:not([disabled]),input,textarea,select,a[href]',
          ) ?? []),
        ];
        if (event.shiftKey && document.activeElement === items[0]) {
          event.preventDefault();
          items.at(-1)?.focus();
        } else if (!event.shiftKey && document.activeElement === items.at(-1)) {
          event.preventDefault();
          items[0]?.focus();
        }
      }
    };
    document.addEventListener('keydown', key);
    return () => {
      document.removeEventListener('keydown', key);
      previous?.focus();
    };
  }, []);
  const title =
    dialog.type === 'space'
      ? 'A space for something.'
      : dialog.type === 'dot'
        ? dialog.dot
          ? 'Make this Dot yours.'
          : 'Meet your next specialist.'
        : dialog.type === 'settings'
          ? 'Your workspace, your rules.'
          : dialog.type === 'memory'
            ? 'Something to remember.'
            : 'Let your Dot keep time.';
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <section
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="dialog-title"
        ref={container}
        onClick={(e) => e.stopPropagation()}
      >
        <button
          className="modal-close icon-button"
          aria-label="Close dialog"
          onClick={onClose}
        >
          ✕
        </button>
        <span className="eyebrow">DOSHBOT</span>
        <h2 id="dialog-title">{title}</h2>
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            setBusy(true);
            setError('');
            let path = '',
              method = 'POST',
              body: unknown;
            if (dialog.type === 'space') {
              path = '/spaces';
              body = { name, description: text };
            }
            if (dialog.type === 'dot') {
              path = dialog.dot ? `/dots/${dialog.dot.id}` : '/dots';
              method = dialog.dot ? 'PUT' : 'POST';
              body = {
                spaceId: defaultSpace,
                spaceIds,
                name,
                instructions: text,
                researchAllowed: research,
                memoryAllowed: memory,
                learningContainerId: learningContainer.trim() || null,
                skillDeliveryEnabled: skillDelivery,
                model: model.trim() || null,
                reasoningEffort: reasoningEffort.trim() || null,
              };
            }
            if (dialog.type === 'settings') {
              path = '/settings';
              method = 'PATCH';
              const effectiveVoiceKeys = [...voiceKeys];
              if (newKeyValue.trim()) {
                effectiveVoiceKeys.push({
                  id: `key-${Date.now()}`,
                  label: newKeyLabel.trim() || `Key ${effectiveVoiceKeys.length + 1}`,
                  key: newKeyValue.trim(),
                  provider: newKeyProvider,
                });
              }
              body = {
                researchAllowed: research,
                memoryAllowed: memory,
                model: model.trim() || null,
                reasoningEffort: reasoningEffort.trim() || null,
                computerEnvironment: computerEnv.trim() || null,
                voiceProvider: voiceProvider.trim() || null,
                voiceModel: voiceModel.trim() || null,
                voiceName: voiceName.trim() || null,
                voiceTelephonyProvider: voiceTelephonyProvider.trim() || null,
                voiceApiKeys: JSON.stringify(effectiveVoiceKeys),
                telegramBotToken: telegramBotToken.trim() || null,
                telegramAllowedUsers: telegramAllowedUsers.trim() || null,
                whatsappPhoneNumberId: whatsappPhoneNumberId.trim() || null,
                whatsappAccessToken: whatsappAccessToken.trim() || null,
                whatsappVerifyToken: whatsappVerifyToken.trim() || null,
                twilioAccountSid: twilioAccountSid.trim() || null,
                twilioAuthToken: twilioAuthToken.trim() || null,
                twilioPhoneNumber: twilioPhoneNumber.trim() || null,
                connectors: JSON.stringify(connectors),
                codingDirectory: codingDirectory.trim() || null,
                codingEnabled,
                codingPermissions: JSON.stringify({ bash: bashPermission, edits: editsPermission }),
                opencodeVariant: opencodeVariant.trim() || null,
              };
            }
            if (dialog.type === 'memory') {
              path = dialog.memory
                ? `/memories/${dialog.memory.id}`
                : '/memories';
              method = dialog.memory ? 'PUT' : 'POST';
              body = { text, category: memoryCategory };
            }
            if (dialog.type === 'schedule') {
              path = '/tasks';
              body = {
                prompt: text,
                threadId: dialog.threadId,
                intervalSeconds: Number(interval),
              };
            }
            if (await mutate(path, method, body)) onClose();
            else
              setError('Could not save. Review the workspace error and retry.');
            setBusy(false);
          }}
        >
          {(dialog.type === 'space' || dialog.type === 'dot') && (
            <>
              <label className="field-label" htmlFor="entity-name">
                Name
              </label>
              <input
                id="entity-name"
                value={name}
                maxLength={40}
                onChange={(e) => setName(e.target.value)}
                required
              />
            </>
          )}
          {dialog.type !== 'settings' && (
            <>
              <label className="field-label" htmlFor="entity-text">
                {dialog.type === 'dot'
                  ? 'Role instructions'
                  : dialog.type === 'space'
                    ? 'What belongs here?'
                    : dialog.type === 'memory'
                      ? 'Preference or context'
                      : 'Task to revisit'}
              </label>
              <textarea
                id="entity-text"
                rows={4}
                maxLength={dialog.type === 'schedule' ? 4000 : 2000}
                required={dialog.type !== 'space'}
                value={text}
                onChange={(e) => setText(e.target.value)}
                placeholder={
                  dialog.type === 'dot'
                    ? 'You are a thoughtful research partner. Compare evidence and be clear about uncertainty.'
                    : ''
                }
              />
              {dialog.type === 'memory' && (
                <div style={{ marginTop: '10px' }}>
                  <label className="field-label" htmlFor="memory-category-select">
                    Category
                  </label>
                  <select
                    id="memory-category-select"
                    value={memoryCategory}
                    onChange={(e) => setMemoryCategory(e.target.value)}
                    style={{
                      width: '100%',
                      padding: '8px 12px',
                      background: 'rgba(255,255,255,0.06)',
                      border: '1px solid rgba(255,255,255,0.12)',
                      borderRadius: 0,
                      color: 'inherit',
                      fontSize: '13px',
                    }}
                  >
                    <option value="general">General Context</option>
                    <option value="preference">User Preference</option>
                    <option value="fact">Fact & Knowledge</option>
                    <option value="instruction">Instruction & Rule</option>
                    <option value="project">Project Note</option>
                    <option value="goal">Goal & Objective</option>
                  </select>
                </div>
              )}
            </>
          )}
          {dialog.type === 'dot' && (
            <fieldset className="space-access-fields">
              <legend>Space access</legend>
              <p className="muted">
                Choose where this Dot can read and edit pages.
              </p>
              {workspace.spaces.map((space) => (
                <label className="permission-row" key={space.id}>
                  <input
                    type="checkbox"
                    checked={spaceIds.includes(space.id)}
                    onChange={(event) => {
                      const next = event.target.checked
                        ? [...spaceIds, space.id]
                        : spaceIds.filter((id) => id !== space.id);
                      setSpaceIds(next);
                      if (!next.includes(defaultSpace))
                        setDefaultSpace(next[0] ?? '');
                    }}
                  />
                  <span>{space.name}</span>
                </label>
              ))}
              <label className="field-label" htmlFor="default-space">
                Default destination for saved pages
              </label>
              <select
                id="default-space"
                value={defaultSpace}
                required
                onChange={(event) => setDefaultSpace(event.target.value)}
              >
                <option value="" disabled>
                  Choose a Space
                </option>
                {workspace.spaces
                  .filter((space) => spaceIds.includes(space.id))
                  .map((space) => (
                    <option key={space.id} value={space.id}>
                      {space.name}
                    </option>
                  ))}
              </select>
            </fieldset>
          )}
          {dialog.type === 'dot' && (
            <>
              <label className="permission-row">
                <input
                  type="checkbox"
                  checked={research}
                  onChange={(e) => setResearch(e.target.checked)}
                />
                <span>
                  <strong>Public-page research</strong>
                  <small>
                    Allow the server-side read-only browser tool. Global
                    settings always take precedence.
                  </small>
                </span>
              </label>
              <label className="permission-row">
                <input
                  type="checkbox"
                  checked={memory}
                  onChange={(e) => setMemory(e.target.checked)}
                />
                <span>
                  <strong>Use saved memories</strong>
                  <small>
                    Include your preferences in new turns. Changing permission
                    stops active work.
                  </small>
                </span>
              </label>
            </>
          )}
          {dialog.type === 'dot' && (
            <fieldset className="space-access-fields">
              <legend>Automatic Learning</legend>
              <label className="field-label" htmlFor="learning-container">
                Learning container ID
              </label>
              <input
                id="learning-container"
                value={learningContainer}
                maxLength={64}
                pattern="[a-z0-9]+(-[a-z0-9]+)*"
                placeholder="research-workflow"
                aria-describedby="learning-help"
                onChange={(event) => {
                  setLearningContainer(event.target.value);
                  if (!event.target.value.trim()) setSkillDelivery(false);
                }}
              />
              <p className="muted" id="learning-help">
                Create this container in your Intelligence project first. New
                conversations will contribute evidence to it. Leave blank to
                keep new conversations out of Learning. Existing conversations
                retain their original assignment.
              </p>
              <label className="permission-row">
                <input
                  type="checkbox"
                  checked={skillDelivery}
                  disabled={!learningContainer.trim()}
                  onChange={(event) => setSkillDelivery(event.target.checked)}
                />
                <span>
                  <strong>Use published skills</strong>
                  <small>
                    Load reviewed skills from each conversation’s assigned
                    container. Enable delivery in Intelligence too. Turning this
                    off stops skill loading; it does not stop evidence
                    collection.
                  </small>
                </span>
              </label>
              <a
                href="https://docs.copilotkit.ai/learning"
                target="_blank"
                rel="noreferrer"
              >
                Set up Learning and review skills ↗
              </a>
            </fieldset>
          )}
          {dialog.type === 'schedule' && (
            <>
              <label className="field-label" htmlFor="schedule-interval">
                Repeat after each successful run
              </label>
              <select
                id="schedule-interval"
                value={interval}
                onChange={(e) => setInterval(e.target.value)}
              >
                <option value="60">Every minute (testing)</option>
                <option value="3600">Every hour</option>
                <option value="86400">Every day</option>
                <option value="604800">Every week</option>
              </select>
              <p className="muted">
                Runs on the server in this same conversation, even with the tab
                closed. Failed runs wait for manual retry.
              </p>
            </>
          )}
          {dialog.type === 'dot' && (
            <div className="model-config-card">
              <div className="model-config-header">
                <span className="model-config-title">
                  Intelligence & Reasoning
                </span>
                <span className="model-config-badge">Local Runner</span>
              </div>
              <p className="model-config-desc">
                Select the intelligence model that guides this Dot and how deeply it thinks before answering.
              </p>

              <div className="model-input-wrapper">
                <label className="field-label" htmlFor="dot-model" style={{ margin: '0 0 4px' }}>
                  Specialist Model
                </label>
                <input
                  id="dot-model"
                  list="model-list-options"
                  value={model}
                  placeholder={`Use Workspace Default (${state.settings.model || 'auto-code'})`}
                  onChange={(e) => setModel(e.target.value)}
                  autoComplete="off"
                />
                <datalist id="model-list-options">
                  {modelOptions.map((opt) => (
                    <option key={opt} value={opt} />
                  ))}
                </datalist>

                <div className="model-presets">
                  {dynamicPresets.map((preset) => (
                    <button
                      key={preset}
                      type="button"
                      className={`model-preset-pill ${model === preset ? 'active' : ''}`}
                      onClick={() => setModel(preset)}
                    >
                      {preset}
                    </button>
                  ))}
                  {model && !dynamicPresets.includes(model) && (
                    <span className="model-preset-pill active">
                      Custom: {model}
                    </span>
                  )}
                </div>
              </div>

              <div style={{ marginTop: '14px' }}>
                <label className="field-label" style={{ margin: '0 0 4px' }}>
                  Reasoning Effort
                </label>
                <div className="effort-segmented-control" role="group" aria-label="Reasoning Effort">
                  {[
                    { id: '', label: 'Default' },
                    { id: 'low', label: 'Low' },
                    { id: 'medium', label: 'Medium' },
                    { id: 'high', label: 'High' },
                    { id: 'xhigh', label: 'Extra High' },
                    { id: 'max', label: 'Max' },
                  ].map((eff) => (
                    <button
                      key={eff.id}
                      type="button"
                      className={`effort-btn ${(reasoningEffort || '') === eff.id ? 'active' : ''}`}
                      onClick={() => setReasoningEffort(eff.id)}
                    >
                      {eff.label}
                    </button>
                  ))}
                </div>
                <div className="effort-caption">
                  {effortCaptions[reasoningEffort || ''] || effortCaptions['']}
                </div>
              </div>
            </div>
          )}
          {dialog.type === 'settings' && (
            <>
              <div className="settings-tabs" role="tablist">
                <button
                  type="button"
                  role="tab"
                  aria-selected={settingsTab === 'setup'}
                  className={`settings-tab-btn ${settingsTab === 'setup' ? 'active' : ''}`}
                  onClick={() => setSettingsTab('setup')}
                >
                  Setup
                </button>
                <button
                  type="button"
                  role="tab"
                  aria-selected={settingsTab === 'models'}
                  className={`settings-tab-btn ${settingsTab === 'models' ? 'active' : ''}`}
                  onClick={() => setSettingsTab('models')}
                >
                  Models
                </button>
                <button
                  type="button"
                  role="tab"
                  aria-selected={settingsTab === 'coding'}
                  className={`settings-tab-btn ${settingsTab === 'coding' ? 'active' : ''}`}
                  onClick={() => setSettingsTab('coding')}
                >
                  Coding & Local
                </button>
                <button
                  type="button"
                  role="tab"
                  aria-selected={settingsTab === 'subagents'}
                  className={`settings-tab-btn ${settingsTab === 'subagents' ? 'active' : ''}`}
                  onClick={() => setSettingsTab('subagents')}
                >
                  Subagents
                </button>
                <button
                  type="button"
                  role="tab"
                  aria-selected={settingsTab === 'memory'}
                  className={`settings-tab-btn ${settingsTab === 'memory' ? 'active' : ''}`}
                  onClick={() => setSettingsTab('memory')}
                >
                  Memory
                </button>
                <button
                  type="button"
                  role="tab"
                  aria-selected={settingsTab === 'connectors'}
                  className={`settings-tab-btn ${settingsTab === 'connectors' ? 'active' : ''}`}
                  onClick={() => setSettingsTab('connectors')}
                >
                  MCP
                </button>
                <button
                  type="button"
                  role="tab"
                  aria-selected={settingsTab === 'automations'}
                  className={`settings-tab-btn ${settingsTab === 'automations' ? 'active' : ''}`}
                  onClick={() => setSettingsTab('automations')}
                >
                  Automations
                </button>
                <button
                  type="button"
                  role="tab"
                  aria-selected={settingsTab === 'computer'}
                  className={`settings-tab-btn ${settingsTab === 'computer' ? 'active' : ''}`}
                  onClick={() => setSettingsTab('computer')}
                >
                  Computer
                </button>
                <button
                  type="button"
                  role="tab"
                  aria-selected={settingsTab === 'voice'}
                  className={`settings-tab-btn ${settingsTab === 'voice' ? 'active' : ''}`}
                  onClick={() => setSettingsTab('voice')}
                >
                  Voice
                </button>
                <button
                  type="button"
                  role="tab"
                  aria-selected={settingsTab === 'general'}
                  className={`settings-tab-btn ${settingsTab === 'general' ? 'active' : ''}`}
                  onClick={() => setSettingsTab('general')}
                >
                  General
                </button>
              </div>

              {settingsTab === 'setup' && (
                <>
                  <label className="field-label" style={{ margin: '0 0 6px' }}>
                    Workspace Systems & Integration Status
                  </label>
                  <p className="muted" style={{ margin: '0 0 12px', fontSize: '11px' }}>
                    Overview of all local services, active AI models, sandbox environments, and telephony channels.
                  </p>

                  <div className="line-option-list" style={{ marginBottom: '14px' }}>
                    {/* Intelligence / LLM row */}
                    <div
                      className="line-option-row"
                      style={{ cursor: 'pointer' }}
                      onClick={() => setSettingsTab('models')}
                    >
                      <div className="line-option-content">
                        <div className="line-option-header">
                          <span className="line-option-title">Core Intelligence (LLM)</span>
                          <span className="line-option-tag" style={{ color: 'var(--blue-dark)' }}>Active</span>
                          <span className="line-option-tag">{model || state.settings.model || 'auto-code'}</span>
                        </div>
                        <p className="line-option-desc">
                          Reasoning: <code>{reasoningEffort || state.settings.reasoningEffort || 'default'}</code>. Click to change model or thinking depth.
                        </p>
                      </div>
                      <span className="muted" style={{ fontSize: '11px', flexShrink: 0 }}>Configure →</span>
                    </div>

                    {/* Computer Sandbox row */}
                    <div
                      className="line-option-row"
                      style={{ cursor: 'pointer' }}
                      onClick={() => setSettingsTab('computer')}
                    >
                      <div className="line-option-content">
                        <div className="line-option-header">
                          <span className="line-option-title">Computer Sandbox</span>
                          <span className="line-option-tag" style={{ color: 'var(--blue-dark)' }}>Running</span>
                          <span className="line-option-tag">{COMPUTER_ENVIRONMENTS.find((e) => e.id === computerEnv)?.name ?? 'Ubuntu 24.04'}</span>
                        </div>
                        <p className="line-option-desc">
                          Docker supervisor active on port 4312. Container filesystem & tools isolated.
                        </p>
                      </div>
                      <span className="muted" style={{ fontSize: '11px', flexShrink: 0 }}>Configure →</span>
                    </div>

                    {/* Voice Engine row */}
                    <div
                      className="line-option-row"
                      style={{ cursor: 'pointer' }}
                      onClick={() => setSettingsTab('voice')}
                    >
                      <div className="line-option-content">
                        <div className="line-option-header">
                          <span className="line-option-title">Voice & Realtime Audio</span>
                          <span
                            className="line-option-tag"
                            style={{
                              color:
                                voiceKeys.length > 0 || state.settings.voiceApiKeys
                                  ? 'var(--blue-dark)'
                                  : 'var(--muted)',
                            }}
                          >
                            {voiceKeys.length > 0 ? `${voiceKeys.length} key(s)` : 'Needs Key'}
                          </span>
                          <span className="line-option-tag">
                            {voiceProvider === 'gemini'
                              ? 'Gemini Live'
                              : voiceProvider === 'openai'
                                ? 'OpenAI Realtime'
                                : 'Browser WebRTC'}
                          </span>
                        </div>
                        <p className="line-option-desc">
                          Model: <code>{voiceModel}</code> · Persona: <code>{voiceName}</code>. Click to manage voice keys & persona.
                        </p>
                      </div>
                      <span className="muted" style={{ fontSize: '11px', flexShrink: 0 }}>Configure →</span>
                    </div>

                    {/* Telephony / Mobile channel row */}
                    <div
                      className="line-option-row"
                      style={{ cursor: 'pointer' }}
                      onClick={() => setSettingsTab('voice')}
                    >
                      <div className="line-option-content">
                        <div className="line-option-header">
                          <span className="line-option-title">Mobile & Telephony Channel</span>
                          <span
                            className="line-option-tag"
                            style={{
                              color:
                                voiceTelephonyProvider === 'telegram'
                                  ? telegramBotToken
                                    ? 'var(--blue-dark)'
                                    : '#c27b00'
                                  : voiceTelephonyProvider === 'whatsapp'
                                    ? whatsappAccessToken
                                      ? 'var(--blue-dark)'
                                      : '#c27b00'
                                    : 'var(--muted)',
                            }}
                          >
                            {voiceTelephonyProvider === 'telegram'
                              ? telegramBotToken
                                ? 'Telegram Ready'
                                : 'Telegram Setup Required'
                              : voiceTelephonyProvider === 'whatsapp'
                                ? whatsappAccessToken
                                  ? 'WhatsApp Ready'
                                  : 'WhatsApp Setup Required'
                                : voiceTelephonyProvider === 'twilio'
                                  ? twilioAuthToken
                                    ? 'Twilio Ready'
                                    : 'Twilio Setup Required'
                                  : 'Browser Only'}
                          </span>
                        </div>
                        <p className="line-option-desc">
                          {voiceTelephonyProvider === 'telegram'
                            ? `Telegram Bot: ${telegramBotToken ? 'Token configured' : 'No token set'}. Access restricted: ${telegramAllowedUsers ? 'Whitelist active' : 'Open'}.`
                            : voiceTelephonyProvider === 'whatsapp'
                              ? `WhatsApp Cloud API: ${whatsappAccessToken ? 'Token configured' : 'Needs token'}.`
                              : voiceTelephonyProvider === 'twilio'
                                ? `Twilio PSTN: ${twilioPhoneNumber || 'No number configured'}.`
                                : 'WebRTC in browser on mobile or desktop.'}
                        </p>
                      </div>
                      <span className="muted" style={{ fontSize: '11px', flexShrink: 0 }}>Configure →</span>
                    </div>

                    {/* Local Database row */}
                    <div className="line-option-row" style={{ cursor: 'default' }}>
                      <div className="line-option-content">
                        <div className="line-option-header">
                          <span className="line-option-title">Local Persistence</span>
                          <span className="line-option-tag" style={{ color: 'var(--blue-dark)' }}>WAL SQLite</span>
                          <span className="line-option-tag">{workspace.conversations.length} sessions</span>
                        </div>
                        <p className="line-option-desc">
                          Database: <code>data/opendots.sqlite</code>. Stored locally on this machine.
                        </p>
                      </div>
                    </div>
                  </div>
                </>
              )}

              {settingsTab === 'models' && (
                <>
                  {opencodeStatus && opencodeStatus.available && (
                    <div
                      className="callout-card"
                      style={{
                        marginBottom: '12px',
                        padding: '12px 14px',
                        background: '#ffffff',
                        border: '2px solid #000',
                        borderRadius: 0,
                      }}
                    >
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '4px' }}>
                        <strong style={{ fontSize: '12px', color: '#1c1c1e' }}>OpenCode Engine Connected</strong>
                        <span className="line-option-tag" style={{ color: '#4a6572' }}>
                          {opencodeStatus.freeModels?.length ?? 0} Free Models
                        </span>
                      </div>
                      <p className="muted" style={{ margin: '0 0 8px', fontSize: '11px' }}>
                        Local OpenCode binary detected. Access free-tier models with full tool-calling and zero cost.
                      </p>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '11.5px' }}>
                        <span style={{ color: '#767986' }}>Reasoning Variant:</span>
                        <select
                          value={opencodeVariant}
                          onChange={(e) => setOpencodeVariant(e.target.value)}
                          style={{
                            padding: '3px 8px',
                            borderRadius: '6px',
                            border: '2px solid #000',
                            background: '#ffffff',
                            fontSize: '11px',
                          }}
                        >
                          {['minimal', 'low', 'medium', 'high', 'max'].map((v) => (
                            <option key={v} value={v}>
                              {v}
                            </option>
                          ))}
                        </select>
                      </div>
                    </div>
                  )}

                  <label className="field-label" style={{ margin: '0 0 6px' }}>
                    Default Model
                  </label>
                  <div className="model-search-box">
                    <input
                      type="text"
                      value={modelSearch}
                      placeholder="Search model or provider…"
                      onChange={(e) => setModelSearch(e.target.value)}
                    />
                  </div>

                  <div className="model-presets" style={{ marginBottom: '8px' }}>
                    {['All', 'OpenCode Free', 'DeepSeek', 'Moonshot', 'Alibaba', 'Anthropic', 'OpenAI', 'Google', 'OpenDots'].map((cat) => (
                      <button
                        key={cat}
                        type="button"
                        className={`model-preset-pill ${modelFilter === cat ? 'active' : ''}`}
                        onClick={() => setModelFilter(cat)}
                      >
                        {cat}
                      </button>
                    ))}
                  </div>

                  <div className="line-option-list scrollable" role="radiogroup" aria-label="Default Model">
                    {filteredModels.map((m) => {
                      const isSelected = (model || 'auto-code') === m.id;
                      return (
                        <div
                          key={m.id}
                          role="radio"
                          tabIndex={0}
                          aria-checked={isSelected}
                          className={`line-option-row ${isSelected ? 'active' : ''}`}
                          onClick={() => setModel(m.id)}
                          onKeyDown={(e) => {
                            if (e.key === ' ' || e.key === 'Enter') {
                              e.preventDefault();
                              setModel(m.id);
                            }
                          }}
                        >
                          <div className="line-option-content">
                            <div className="line-option-header">
                              <span className="line-option-title mono">{m.name}</span>
                              <span className="line-option-tag">{m.provider}</span>
                              {m.tag && <span className="line-option-tag">{m.tag}</span>}
                            </div>
                            <p className="line-option-desc">{m.desc}</p>
                          </div>
                          <div className="line-option-radio" aria-hidden="true">
                            {isSelected && <div className="line-option-radio-dot" />}
                          </div>
                        </div>
                      );
                    })}
                  </div>

                  <label className="field-label" htmlFor="custom-model-id" style={{ marginTop: '14px' }}>
                    Or type custom model ID
                  </label>
                  <input
                    id="custom-model-id"
                    value={model}
                    placeholder="e.g. deepseek-chat, custom-route"
                    onChange={(e) => setModel(e.target.value)}
                  />

                  <div style={{ marginTop: '14px' }}>
                    <label className="field-label" style={{ margin: '0 0 4px' }}>
                      Default Reasoning Effort
                    </label>
                    <div className="effort-segmented-control" role="group" aria-label="Default Reasoning Effort">
                      {[
                        { id: 'default', label: 'Default' },
                        { id: 'low', label: 'Low' },
                        { id: 'medium', label: 'Medium' },
                        { id: 'high', label: 'High' },
                        { id: 'xhigh', label: 'Extra High' },
                        { id: 'max', label: 'Max' },
                      ].map((eff) => (
                        <button
                          key={eff.id}
                          type="button"
                          className={`effort-btn ${(reasoningEffort || 'default') === eff.id ? 'active' : ''}`}
                          onClick={() => setReasoningEffort(eff.id)}
                        >
                          {eff.label}
                        </button>
                      ))}
                    </div>
                    <div className="effort-caption">
                      {effortCaptions[reasoningEffort || 'default'] || effortCaptions['default']}
                    </div>
                  </div>
                </>
              )}

              {settingsTab === 'coding' && (
                <>
                  <label className="field-label" style={{ margin: '0 0 6px' }}>
                    Local Workspace Directory
                  </label>
                  <p className="muted" style={{ margin: '0 0 12px', fontSize: '11px' }}>
                    DoshBot connects directly to your local file system for native code editing, file searching, and terminal command execution.
                  </p>

                  <div className="callout-card" style={{ padding: '12px 14px', borderRadius: 0, background: '#ffffff', border: '2px solid #000', marginBottom: '16px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                    <div>
                      <div style={{ fontSize: '12px', fontWeight: 600 }}>Folder tools</div>
                      <div className="muted" style={{ fontSize: '11px' }}>
                        {codingEnabled ? 'With folder — agent can read, edit and run local files.' : 'No folder — pure chat, no local file or shell access.'}
                      </div>
                    </div>
                    <button
                      type="button"
                      role="switch"
                      aria-checked={codingEnabled}
                      onClick={() => setCodingEnabled(!codingEnabled)}
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

                  <div className="callout-card" style={{ padding: '14px 16px', borderRadius: 0, background: '#ffffff', border: '2px solid #000', marginBottom: '16px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '8px' }}>
                      <label className="field-label" style={{ fontSize: '11px', margin: 0 }}>Active Project Root Directory</label>
                      <span className="line-option-tag" style={{ color: '#4a6572' }}>
                        Local Filesystem
                      </span>
                    </div>
                    <div style={{ display: 'flex', gap: '8px', marginBottom: '8px' }}>
                      <input
                        type="text"
                        value={codingDirectory}
                        placeholder="/Users/username/my-project"
                        onChange={(e) => {
                          setCodingDirectory(e.target.value);
                          setDirVerifyStatus('');
                        }}
                        style={{ flex: 1, fontFamily: 'monospace', fontSize: '12px' }}
                      />
                      <button
                        type="button"
                        onClick={() => {
                          if (browseOpen) setBrowseOpen(false);
                          else void loadBrowse();
                        }}
                        disabled={browseLoading}
                        style={{ fontSize: '11.5px', padding: '6px 14px' }}
                      >
                        {browseLoading ? 'Browsing…' : browseOpen ? 'Hide' : 'Browse…'}
                      </button>
                      <button
                        type="button"
                        className="button"
                        onClick={async () => {
                          try {
                            const res = await fetch('/api/workspace/directory', {
                              method: 'POST',
                              headers: { 'Content-Type': 'application/json' },
                              body: JSON.stringify({ directory: codingDirectory }),
                            });
                            const data = await res.json();
                            if (res.ok) {
                              setDirVerifyStatus('Directory verified & connected');
                            } else {
                              setDirVerifyStatus(data.error || 'Invalid directory path');
                            }
                          } catch {
                            setDirVerifyStatus('Could not verify directory');
                          }
                        }}
                        style={{ fontSize: '11.5px', padding: '6px 14px' }}
                      >
                        Verify & Connect
                      </button>
                    </div>
                    {dirVerifyStatus && (
                      <p style={{ margin: 0, fontSize: '11px', color: dirVerifyStatus.includes('verified') ? '#4a6572' : '#991b1b' }}>
                        {dirVerifyStatus}
                      </p>
                    )}
                    {browseOpen && (
                      <div className="dir-current" style={{ display: 'flex', flexDirection: 'column', gap: 6, alignItems: 'stretch', marginTop: 8 }}>
                        <div title={browsePath} style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {browsePath || '…'}
                        </div>
                        {browseError && <div className="dir-status">{browseError}</div>}
                        <div style={{ display: 'flex', gap: 6 }}>
                          <button type="button" disabled={browseLoading || !browseParent || browseParent === browsePath} onClick={() => void loadBrowse(browseParent)} style={{ fontSize: '11.5px', padding: '6px 12px' }}>
                            ↑ Up
                          </button>
                          <button type="button" disabled={browseLoading || !browsePath} onClick={() => { setCodingDirectory(browsePath); setBrowseOpen(false); setDirVerifyStatus(''); }} style={{ fontSize: '11.5px', padding: '6px 12px' }}>
                            Use this folder
                          </button>
                        </div>
                        <div style={{ maxHeight: 180, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 2 }}>
                          {browseLoading && <span className="chat-item-desc">Listing device folders…</span>}
                          {!browseLoading && browseEntries.length === 0 && !browseError && (
                            <span className="chat-item-desc">No subfolders here.</span>
                          )}
                          {browseEntries.map((e) => (
                            <button key={e.path} type="button" title={e.path} style={{ justifyContent: 'flex-start', fontFamily: 'monospace', fontSize: '12px' }} onClick={() => void loadBrowse(e.path)}>
                              <FolderOpen size={13} /> {e.name}
                            </button>
                          ))}
                        </div>
                      </div>
                    )}
                    <p className="muted" style={{ margin: '6px 0 0', fontSize: '10.5px' }}>
                      All coding tools (<code>str_replace_editor</code>, <code>bash</code>, <code>search_files</code>) operate inside this directory path.
                    </p>
                  </div>

                  <label className="field-label" style={{ margin: '0 0 6px' }}>
                    DeepSeek Harness Permissions
                  </label>
                  <p className="muted" style={{ margin: '0 0 12px', fontSize: '11px' }}>
                    Fine-grained permission controls adapted from DeepSeek Harness for shell execution and code modifications.
                  </p>

                  <div className="line-option-list" style={{ marginBottom: '16px' }}>
                    <div className="line-option-row" style={{ alignItems: 'center' }}>
                      <div className="line-option-content">
                        <div className="line-option-header">
                          <span className="line-option-title">Bash Command Execution</span>
                          <span className="line-option-tag">Terminal</span>
                        </div>
                        <p className="line-option-desc">
                          Control how bash commands (compiles, tests, git operations) run in the workspace.
                        </p>
                      </div>
                      <select
                        value={bashPermission}
                        onChange={(e) => setBashPermission(e.target.value as any)}
                        style={{
                          padding: '6px 10px',
                          borderRadius: 0,
                          border: '2px solid #000',
                          background: '#ffffff',
                          fontSize: '11.5px',
                        }}
                      >
                        <option value="auto">Auto-run (Autonomous)</option>
                        <option value="ask">Ask Confirmation</option>
                        <option value="deny">Deny Execution</option>
                      </select>
                    </div>

                    <div className="line-option-row" style={{ alignItems: 'center' }}>
                      <div className="line-option-content">
                        <div className="line-option-header">
                          <span className="line-option-title">File Modifications</span>
                          <span className="line-option-tag">File Editor</span>
                        </div>
                        <p className="line-option-desc">
                          Control whether the agent can create or edit files in the workspace via str_replace.
                        </p>
                      </div>
                      <select
                        value={editsPermission}
                        onChange={(e) => setEditsPermission(e.target.value as any)}
                        style={{
                          padding: '6px 10px',
                          borderRadius: 0,
                          border: '2px solid #000',
                          background: '#ffffff',
                          fontSize: '11.5px',
                        }}
                      >
                        <option value="auto">Auto-save Edits</option>
                        <option value="ask">Ask Confirmation</option>
                        <option value="deny">Deny File Writes</option>
                      </select>
                    </div>
                  </div>

                  <div className="callout-card" style={{ padding: '14px 16px', borderRadius: 0, background: '#ffffff', border: '2px solid #000' }}>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '4px' }}>
                      <strong style={{ fontSize: '12px' }}>OpenCode Local Engine</strong>
                      <span className="line-option-tag" style={{ color: opencodeStatus?.available ? '#4a6572' : '#888' }}>
                        {opencodeStatus?.available ? 'Available' : 'Not Installed'}
                      </span>
                    </div>
                    <p className="muted" style={{ margin: '0 0 8px', fontSize: '11px' }}>
                      {opencodeStatus?.available
                        ? `Connected to ${opencodeStatus.binaryPath}. Provides free-tier models with zero API token costs.`
                        : 'OpenCode CLI is not found on PATH. Install it to access zero-cost free-tier models.'}
                    </p>
                    {opencodeStatus?.available && (
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '11.5px' }}>
                        <span style={{ color: '#767986' }}>Reasoning Variant:</span>
                        <select
                          value={opencodeVariant}
                          onChange={(e) => setOpencodeVariant(e.target.value)}
                          style={{
                            padding: '3px 8px',
                            borderRadius: '6px',
                            border: '2px solid #000',
                            background: '#ffffff',
                            fontSize: '11px',
                          }}
                        >
                          {['minimal', 'low', 'medium', 'high', 'max'].map((v) => (
                            <option key={v} value={v}>
                              {v}
                            </option>
                          ))}
                        </select>
                      </div>
                    )}
                  </div>
                </>
              )}

              {settingsTab === 'subagents' && (
                <>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '8px' }}>
                    <label className="field-label" style={{ margin: 0 }}>
                      Subagents & Specialist Dots
                    </label>
                    <span className="line-option-tag">
                      {workspace.dots.length} Active Subagents
                    </span>
                  </div>
                  <p className="muted" style={{ margin: '0 0 12px', fontSize: '11px' }}>
                    Configure specialized subagents with custom roles, models (including OpenCode free models), and reasoning depths.
                  </p>

                  <div className="line-option-list" style={{ marginBottom: '16px' }}>
                    {workspace.dots.map((d) => {
                      const space = workspace.spaces.find((s) => s.id === d.spaceId);
                      return (
                        <div key={d.id} className="line-option-row" style={{ alignItems: 'flex-start' }}>
                          <div className="line-option-content">
                            <div className="line-option-header">
                              <span className="line-option-title">{d.name}</span>
                              <span className="line-option-tag" style={{ textTransform: 'none' }}>
                                Space: {space?.name || 'General'}
                              </span>
                              {d.model && (
                                <span className="line-option-tag" style={{ color: d.model.includes('free') ? '#4a6572' : undefined }}>
                                  {d.model}
                                </span>
                              )}
                              {d.reasoningEffort && (
                                <span className="line-option-tag">{d.reasoningEffort}</span>
                              )}
                            </div>
                            <p className="line-option-desc" style={{ marginTop: '4px' }}>
                              {d.instructions}
                            </p>
                          </div>
                        </div>
                      );
                    })}
                  </div>

                  <div className="callout-card" style={{ padding: '14px 16px', borderRadius: 0, background: '#ffffff', border: '2px solid #000' }}>
                    <strong style={{ fontSize: '12px', display: 'block', marginBottom: '8px' }}>
                      Add Specialized Subagent
                    </strong>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px', marginBottom: '8px' }}>
                      <div>
                        <label className="field-label" style={{ fontSize: '10px', margin: '0 0 2px' }}>Name</label>
                        <input
                          type="text"
                          placeholder="e.g. Coding Agent, Reviewer"
                          value={newDotName}
                          onChange={(e) => setNewDotName(e.target.value)}
                        />
                      </div>
                      <div>
                        <label className="field-label" style={{ fontSize: '10px', margin: '0 0 2px' }}>Destination Space</label>
                        <select
                          value={newDotSpace}
                          onChange={(e) => setNewDotSpace(e.target.value)}
                          style={{
                            width: '100%',
                            padding: '8px 10px',
                            background: '#ffffff',
                            border: '2px solid #000',
                            borderRadius: 0,
                            fontSize: '12px',
                          }}
                        >
                          {workspace.spaces.map((s) => (
                            <option key={s.id} value={s.id}>
                              {s.name}
                            </option>
                          ))}
                        </select>
                      </div>
                    </div>

                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px', marginBottom: '8px' }}>
                      <div>
                        <label className="field-label" style={{ fontSize: '10px', margin: '0 0 2px' }}>Model</label>
                        <select
                          value={newDotModel}
                          onChange={(e) => setNewDotModel(e.target.value)}
                          style={{
                            width: '100%',
                            padding: '8px 10px',
                            background: '#ffffff',
                            border: '2px solid #000',
                            borderRadius: 0,
                            fontSize: '12px',
                          }}
                        >
                          <optgroup label="OpenCode Free Models">
                            <option value="opencode/fledge-alpha-free">fledge-alpha-free (Free)</option>
                            <option value="opencode/ling-3.1-flash-free">ling-3.1-flash-free (Free)</option>
                            <option value="opencode/big-pickle">big-pickle (Free 200k)</option>
                            <option value="opencode/longcat-2.5-preview-free">longcat-2.5-preview-free (Free)</option>
                            <option value="opencode/mimo-v2.6-flash-free">mimo-v2.6-flash-free (Free)</option>
                            <option value="opencode/nemotron-3.5-lightning-free">nemotron-3.5-lightning-free (Free)</option>
                          </optgroup>
                          <optgroup label="Frontier Models">
                            <option value="auto-code">auto-code</option>
                            <option value="deepseek-v4-pro">deepseek-v4-pro</option>
                            <option value="deepseek-reasoner">deepseek-reasoner (R1)</option>
                            <option value="claude-3-7-sonnet">claude-3-7-sonnet</option>
                            <option value="gpt-4o">gpt-4o</option>
                          </optgroup>
                        </select>
                      </div>
                      <div>
                        <label className="field-label" style={{ fontSize: '10px', margin: '0 0 2px' }}>Reasoning Effort</label>
                        <select
                          value={newDotEffort}
                          onChange={(e) => setNewDotEffort(e.target.value)}
                          style={{
                            width: '100%',
                            padding: '8px 10px',
                            background: '#ffffff',
                            border: '2px solid #000',
                            borderRadius: 0,
                            fontSize: '12px',
                          }}
                        >
                          {['default', 'low', 'medium', 'high', 'xhigh', 'max'].map((eff) => (
                            <option key={eff} value={eff}>
                              {eff}
                            </option>
                          ))}
                        </select>
                      </div>
                    </div>

                    <div style={{ marginBottom: '8px' }}>
                      <label className="field-label" style={{ fontSize: '10px', margin: '0 0 2px' }}>Role Instructions</label>
                      <textarea
                        rows={3}
                        placeholder="You are a specialized coding subagent. You write modular, clean code and verify every change by running tests."
                        value={newDotInstructions}
                        onChange={(e) => setNewDotInstructions(e.target.value)}
                      />
                    </div>

                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                      <button
                        type="button"
                        className="button"
                        disabled={!newDotName.trim() || !newDotInstructions.trim()}
                        onClick={async () => {
                          try {
                            const res = await fetch('/api/dots', {
                              method: 'POST',
                              headers: { 'Content-Type': 'application/json' },
                              body: JSON.stringify({
                                name: newDotName.trim(),
                                instructions: newDotInstructions.trim(),
                                spaceId: newDotSpace || workspace.spaces[0]?.id,
                                model: newDotModel,
                                reasoningEffort: newDotEffort,
                                researchAllowed: true,
                                memoryAllowed: true,
                              }),
                            });
                            if (res.ok) {
                              setNewDotName('');
                              setNewDotInstructions('');
                              setDotCreatedMessage(true);
                              setTimeout(() => setDotCreatedMessage(false), 3000);
                              onClose();
                            }
                          } catch {}
                        }}
                      >
                        Create Subagent
                      </button>
                      {dotCreatedMessage && (
                        <span style={{ fontSize: '11px', color: '#4a6572' }}>Subagent created</span>
                      )}
                    </div>
                  </div>
                </>
              )}

              {settingsTab === 'memory' && (
                <>
                  <label className="field-label" style={{ margin: '0 0 6px' }}>
                    Dual-Layer Memory Architecture
                  </label>
                  <p className="muted" style={{ margin: '0 0 12px', fontSize: '11px' }}>
                    DeepSeek Harness dual-layer memory system: Global Memories apply across all sessions, while Session Memories are thread-bound scratchpad notes.
                  </p>

                  {/* Section A: Global Memory */}
                  <div style={{ marginBottom: '20px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '6px' }}>
                      <strong style={{ fontSize: '12px', color: '#1c1c1e' }}>Global Workspace Memories</strong>
                      <span className="line-option-tag">{state.memories.length} Permanent Items</span>
                    </div>

                    <div className="line-option-list" style={{ marginBottom: '10px' }}>
                      {state.memories.length === 0 && (
                        <div className="line-option-row" style={{ color: '#888', fontSize: '11.5px', padding: '10px 12px' }}>
                          No global memories saved yet. Add persistent rules, preferences, or project guidelines.
                        </div>
                      )}
                      {state.memories.map((m) => (
                        <div key={m.id} className="line-option-row" style={{ alignItems: 'center' }}>
                          <div className="line-option-content">
                            <div className="line-option-header">
                              <span className="memory-category-badge" data-category={m.category || 'general'}>
                                {m.category || 'general'}
                              </span>
                            </div>
                            <p className="line-option-desc" style={{ marginTop: '4px', fontSize: '12px' }}>
                              {m.text}
                            </p>
                          </div>
                          <button
                            type="button"
                            className="icon-button"
                            aria-label="Delete global memory"
                            onClick={async () => {
                              await mutate(`/memories/${m.id}`, 'DELETE');
                            }}
                          >
                            <Trash2 size={13} />
                          </button>
                        </div>
                      ))}
                    </div>

                    <div style={{ display: 'flex', gap: '8px' }}>
                      <input
                        type="text"
                        placeholder="Add persistent rule or fact…"
                        value={newGlobalMemText}
                        onChange={(e) => setNewGlobalMemText(e.target.value)}
                        style={{ flex: 1, fontSize: '12px' }}
                      />
                      <select
                        value={newGlobalMemCategory}
                        onChange={(e) => setNewGlobalMemCategory(e.target.value)}
                        style={{
                          padding: '6px 10px',
                          borderRadius: 0,
                          border: '2px solid #000',
                          background: '#ffffff',
                          fontSize: '11px',
                        }}
                      >
                        <option value="preference">Preference</option>
                        <option value="instruction">Instruction</option>
                        <option value="project">Project</option>
                        <option value="fact">Fact</option>
                        <option value="general">General</option>
                      </select>
                      <button
                        type="button"
                        className="button"
                        disabled={!newGlobalMemText.trim()}
                        onClick={async () => {
                          if (!newGlobalMemText.trim()) return;
                          await mutate('/memories', 'POST', {
                            text: newGlobalMemText.trim(),
                            category: newGlobalMemCategory,
                          });
                          setNewGlobalMemText('');
                        }}
                        style={{ fontSize: '11px', padding: '6px 12px' }}
                      >
                        Save
                      </button>
                    </div>
                  </div>

                  {/* Section B: Session Memory */}
                  <div>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '6px' }}>
                      <strong style={{ fontSize: '12px', color: '#1c1c1e' }}>Active Session Memories (Scratchpad)</strong>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <select
                          value={selectedThreadForMem}
                          onChange={(e) => setSelectedThreadForMem(e.target.value)}
                          style={{
                            padding: '3px 8px',
                            borderRadius: '6px',
                            border: '2px solid #000',
                            background: '#ffffff',
                            fontSize: '11px',
                            maxWidth: '160px',
                          }}
                        >
                          {workspace.conversations.map((c) => (
                            <option key={c.id} value={c.id}>
                              {c.title || c.id.slice(0, 10)}
                            </option>
                          ))}
                        </select>
                        {sessionMemories.length > 0 && (
                          <button
                            type="button"
                            className="button secondary"
                            onClick={async () => {
                              await fetch(`/api/conversations/${selectedThreadForMem}/session-memories`, {
                                method: 'DELETE',
                              });
                              loadSessionMemories(selectedThreadForMem);
                            }}
                            style={{ fontSize: '10.5px', padding: '3px 8px' }}
                          >
                            Clear Thread
                          </button>
                        )}
                      </div>
                    </div>

                    <div className="line-option-list" style={{ marginBottom: '10px' }}>
                      {sessionMemories.length === 0 && (
                        <div className="line-option-row" style={{ color: '#888', fontSize: '11.5px', padding: '10px 12px' }}>
                          No session memories for this thread. Notes saved during conversation turns appear here.
                        </div>
                      )}
                      {sessionMemories.map((sm) => (
                        <div key={sm.id} className="line-option-row" style={{ alignItems: 'center' }}>
                          <div className="line-option-content">
                            <div className="line-option-header">
                              <span className="memory-category-badge" data-category={sm.category || 'note'}>
                                {sm.category || 'note'}
                              </span>
                            </div>
                            <p className="line-option-desc" style={{ marginTop: '4px', fontSize: '12px' }}>
                              {sm.text}
                            </p>
                          </div>
                          <button
                            type="button"
                            className="icon-button"
                            aria-label="Delete session note"
                            onClick={async () => {
                              await fetch(`/api/conversations/${selectedThreadForMem}/session-memories/${sm.id}`, {
                                method: 'DELETE',
                              });
                              loadSessionMemories(selectedThreadForMem);
                            }}
                          >
                            <Trash2 size={13} />
                          </button>
                        </div>
                      ))}
                    </div>

                    <div style={{ display: 'flex', gap: '8px' }}>
                      <input
                        type="text"
                        placeholder="Add thread note or task…"
                        value={newSessionMemText}
                        onChange={(e) => setNewSessionMemText(e.target.value)}
                        style={{ flex: 1, fontSize: '12px' }}
                      />
                      <select
                        value={newSessionMemCategory}
                        onChange={(e) => setNewSessionMemCategory(e.target.value)}
                        style={{
                          padding: '6px 10px',
                          borderRadius: 0,
                          border: '2px solid #000',
                          background: '#ffffff',
                          fontSize: '11px',
                        }}
                      >
                        <option value="note">Note</option>
                        <option value="todo">Todo</option>
                        <option value="context">Context</option>
                        <option value="goal">Goal</option>
                      </select>
                      <button
                        type="button"
                        className="button"
                        disabled={!newSessionMemText.trim()}
                        onClick={async () => {
                          if (!newSessionMemText.trim()) return;
                          await fetch(`/api/conversations/${selectedThreadForMem}/session-memories`, {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({
                              text: newSessionMemText.trim(),
                              category: newSessionMemCategory,
                            }),
                          });
                          setNewSessionMemText('');
                          loadSessionMemories(selectedThreadForMem);
                        }}
                        style={{ fontSize: '11px', padding: '6px 12px' }}
                      >
                        Add Note
                      </button>
                    </div>
                  </div>
                </>
              )}

              {settingsTab === 'connectors' && (
                <>
                  <label className="field-label" style={{ margin: '0 0 6px' }}>
                    MCP Servers
                  </label>
                  <p className="muted" style={{ margin: '0 0 12px', fontSize: '11px' }}>
                    Model Context Protocol (MCP) connects local tools and external data sources. MCP operates directly via local stdio processes on your computer or custom HTTP/SSE endpoints — no cloud account required.
                  </p>

                  <div className="line-option-list" style={{ marginBottom: '16px' }}>
                    {connectors.length === 0 && (
                      <div className="line-option-row" style={{ color: '#888', fontSize: '12px', padding: '12px 14px' }}>
                        No external MCP servers added yet. Add a local stdio command (e.g. filesystem or sqlite) or a remote SSE endpoint below.
                      </div>
                    )}
                    {connectors.map((c) => (
                      <div key={c.id} className="line-option-row" style={{ alignItems: 'center' }}>
                        <div className="line-option-content">
                          <div className="line-option-header">
                            <span className="line-option-title" style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                              <Plug size={14} style={{ color: c.enabled ? 'var(--blue-dark, #111)' : '#888' }} />
                              {c.name}
                            </span>
                            <span className="line-option-tag" style={{ textTransform: 'none' }}>
                              {c.type === 'local_stdio' ? 'Local Command (stdio)' : 'HTTP/SSE Endpoint'}
                            </span>
                            <span
                              className="line-option-tag"
                              style={{
                                color: c.enabled ? '#10b981' : '#6b7280',
                                borderColor: c.enabled ? 'rgba(16,185,129,0.3)' : undefined,
                              }}
                            >
                              {c.enabled ? 'Active' : 'Disabled'}
                            </span>
                          </div>
                          <p className="line-option-desc mono" style={{ fontSize: '11px', marginTop: '2px' }}>
                            {c.url || c.command}
                          </p>
                          {c.description && (
                            <p className="line-option-desc" style={{ marginTop: '2px', color: '#999' }}>
                              {c.description}
                            </p>
                          )}
                        </div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginLeft: 'auto' }}>
                          <label className="permission-row" style={{ margin: 0, padding: 0, cursor: 'pointer' }} title={c.enabled ? 'Disable MCP server' : 'Enable MCP server'}>
                            <input
                              type="checkbox"
                              checked={c.enabled}
                              onChange={(e) => {
                                const next = connectors.map((item) =>
                                  item.id === c.id ? { ...item, enabled: e.target.checked } : item
                                );
                                setConnectors(next);
                              }}
                            />
                          </label>
                          <button
                            type="button"
                            className="icon-button"
                            aria-label={`Remove ${c.name}`}
                            onClick={() => {
                              setConnectors(connectors.filter((item) => item.id !== c.id));
                            }}
                          >
                            <Trash2 size={14} />
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>

                  <div className="callout-card" style={{ padding: '14px 16px', borderRadius: 0, background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '8px' }}>
                      <Plus size={14} />
                      <strong style={{ fontSize: '12px' }}>Add MCP Server</strong>
                    </div>

                    <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: '8px', marginBottom: '8px' }}>
                      <div>
                        <label className="field-label" style={{ fontSize: '10px', margin: '0 0 2px' }}>Server Name</label>
                        <input
                          type="text"
                          placeholder="e.g. Local Filesystem or SQLite"
                          value={newConnName}
                          onChange={(e) => setNewConnName(e.target.value)}
                        />
                      </div>
                      <div>
                        <label className="field-label" style={{ fontSize: '10px', margin: '0 0 2px' }}>Server Type</label>
                        <select
                          value={newConnType}
                          onChange={(e) => setNewConnType(e.target.value as any)}
                        >
                          <option value="local_stdio">Local Command (stdio)</option>
                          <option value="remote_sse">Endpoint URL (SSE/HTTP)</option>
                        </select>
                      </div>
                    </div>

                    <div style={{ marginBottom: '8px' }}>
                      <label className="field-label" style={{ fontSize: '10px', margin: '0 0 2px' }}>
                        {newConnType === 'local_stdio' ? 'Command Line' : 'Endpoint URL'}
                      </label>
                      <input
                        type="text"
                        placeholder={newConnType === 'local_stdio' ? 'npx -y @modelcontextprotocol/server-filesystem .' : 'http://localhost:3000/sse'}
                        value={newConnUrl}
                        onChange={(e) => setNewConnUrl(e.target.value)}
                      />
                    </div>

                    {newConnType === 'remote_sse' && (
                      <div style={{ marginBottom: '8px' }}>
                        <label className="field-label" style={{ fontSize: '10px', margin: '0 0 2px' }}>Authorization Header (Optional)</label>
                        <input
                          type="password"
                          placeholder="Bearer ..."
                          value={newConnToken}
                          onChange={(e) => setNewConnToken(e.target.value)}
                        />
                      </div>
                    )}

                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '10px' }}>
                      {connAddedMessage ? (
                        <span style={{ fontSize: '11px', color: '#10b981', display: 'flex', alignItems: 'center', gap: '4px' }}>
                          <Check size={13} /> MCP Server added!
                        </span>
                      ) : <span />}
                      <button
                        type="button"
                        className="small-btn primary"
                        disabled={!newConnName.trim() || !newConnUrl.trim()}
                        onClick={() => {
                          const newConn: Connector = {
                            id: `mcp-${Date.now()}`,
                            name: newConnName.trim(),
                            type: newConnType,
                            url: newConnUrl.trim(),
                            command: newConnType === 'local_stdio' ? newConnUrl.trim() : undefined,
                            token: newConnToken.trim() || undefined,
                            enabled: true,
                            status: 'connected',
                          };
                          setConnectors([...connectors, newConn]);
                          setNewConnName('');
                          setNewConnUrl('');
                          setNewConnToken('');
                          setConnAddedMessage(true);
                          setTimeout(() => setConnAddedMessage(false), 2500);
                        }}
                      >
                        Add MCP Server
                      </button>
                    </div>
                  </div>
                </>
              )}

              {settingsTab === 'automations' && (
                <>
                  <label className="field-label" style={{ margin: '0 0 6px' }}>
                    Work Scheduling & Automations Engine
                  </label>
                  <p className="muted" style={{ margin: '0 0 12px', fontSize: '11px' }}>
                    DoshBot background scheduled automations and headless worker execution.
                  </p>

                  <div className="line-option-list" style={{ marginBottom: '16px' }}>
                    {state.tasks.map((task) => (
                      <div key={task.id} className="line-option-row" style={{ alignItems: 'center' }}>
                        <div className="line-option-content">
                          <div className="line-option-header">
                            <span className="line-option-title" style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                              <Clock3 size={14} style={{ color: task.status === 'running' ? '#111' : task.status === 'completed' ? '#111' : '#555' }} />
                              {task.prompt.slice(0, 50)}{task.prompt.length > 50 ? '…' : ''}
                            </span>
                            <span className="line-option-tag" style={{ textTransform: 'capitalize' }}>
                              {task.status}
                            </span>
                            {task.intervalSeconds && (
                              <span className="line-option-tag" style={{ color: 'var(--blue-dark, #111)' }}>
                                Every {Math.round(task.intervalSeconds / 60)}m
                              </span>
                            )}
                          </div>
                          <p className="line-option-desc" style={{ fontSize: '11px', marginTop: '2px' }}>
                            Created: {new Date(task.createdAt).toLocaleString()}
                            {task.nextRunAt && ` · Next run: ${new Date(task.nextRunAt).toLocaleTimeString()}`}
                          </p>
                        </div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginLeft: 'auto' }}>
                          <button
                            type="button"
                            className="icon-button"
                            title="Run automation now"
                            onClick={async () => {
                              try {
                                await mutate(`/tasks/${task.id}/actions`, 'POST', { action: 'run' });
                              } catch {}
                            }}
                          >
                            <Play size={14} />
                          </button>
                          <button
                            type="button"
                            className="icon-button"
                            title={task.status === 'paused' ? 'Resume automation' : 'Pause automation'}
                            onClick={async () => {
                              try {
                                await mutate(`/tasks/${task.id}/actions`, 'POST', {
                                  action: task.status === 'paused' ? 'run' : 'pause',
                                });
                              } catch {}
                            }}
                          >
                            <Pause size={14} />
                          </button>
                          <button
                            type="button"
                            className="icon-button"
                            title="Delete automation"
                            onClick={async () => {
                              try {
                                await mutate(`/tasks/${task.id}`, 'DELETE');
                              } catch {}
                            }}
                          >
                            <Trash2 size={14} />
                          </button>
                        </div>
                      </div>
                    ))}
                    {!state.tasks.length && (
                      <div className="sidebar-empty" style={{ padding: '16px' }}>
                        No automations scheduled yet. Create your first background workflow below.
                      </div>
                    )}
                  </div>

                  <div className="callout-card" style={{ padding: '12px 14px', borderRadius: 0, background: '#ffffff', border: '2px solid #000' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '8px' }}>
                      <Plus size={14} />
                      <strong style={{ fontSize: '12px' }}>Create Scheduled Automation</strong>
                    </div>

                    <div style={{ marginBottom: '8px' }}>
                      <label className="field-label" style={{ fontSize: '10px', margin: '0 0 2px' }}>Instruction / Prompt</label>
                      <textarea
                        rows={2}
                        placeholder="e.g. Check top HN stories and summarize in page..."
                        value={newAutoPrompt}
                        onChange={(e) => setNewAutoPrompt(e.target.value)}
                      />
                    </div>

                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px', marginBottom: '8px' }}>
                      <div>
                        <label className="field-label" style={{ fontSize: '10px', margin: '0 0 2px' }}>Repeat Interval</label>
                        <select
                          value={newAutoInterval}
                          onChange={(e) => setNewAutoInterval(e.target.value)}
                        >
                          <option value="60">Every 1 minute (testing)</option>
                          <option value="300">Every 5 minutes</option>
                          <option value="900">Every 15 minutes</option>
                          <option value="3600">Every hour</option>
                          <option value="21600">Every 6 hours</option>
                          <option value="86400">Daily (24 hours)</option>
                        </select>
                      </div>
                      <div>
                        <label className="field-label" style={{ fontSize: '10px', margin: '0 0 2px' }}>Thread</label>
                        <select
                          value={newAutoThread}
                          onChange={(e) => setNewAutoThread(e.target.value)}
                        >
                          {workspace.conversations.map((c) => (
                            <option key={c.id} value={c.id}>{c.title}</option>
                          ))}
                        </select>
                      </div>
                    </div>

                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '10px' }}>
                      {autoAddedMessage ? (
                        <span style={{ fontSize: '11px', color: '#10b981', display: 'flex', alignItems: 'center', gap: '4px' }}>
                          <Check size={13} /> Automation created!
                        </span>
                      ) : <span />}
                      <button
                        type="button"
                        className="small-btn primary"
                        disabled={!newAutoPrompt.trim() || !newAutoThread}
                        onClick={async () => {
                          const created = await mutate('/tasks', 'POST', {
                            prompt: newAutoPrompt.trim(),
                            threadId: newAutoThread,
                            intervalSeconds: Number(newAutoInterval),
                          });
                          if (created) {
                            setNewAutoPrompt('');
                            setAutoAddedMessage(true);
                            setTimeout(() => setAutoAddedMessage(false), 2500);
                          }
                        }}
                      >
                        Schedule Automation
                      </button>
                    </div>
                  </div>
                </>
              )}

              {settingsTab === 'computer' && (
                <>
                  <label className="field-label" style={{ margin: '0 0 6px' }}>
                    Computer Environment
                  </label>
                  <p className="muted" style={{ margin: '0 0 10px', fontSize: '11px' }}>
                    Select the container sandbox distribution for computer execution.
                  </p>
                  <div className="line-option-list" role="radiogroup" aria-label="Computer Environment">
                    {COMPUTER_ENVIRONMENTS.map((env) => {
                      const isSelected = computerEnv === env.id;
                      return (
                        <div
                          key={env.id}
                          role="radio"
                          tabIndex={0}
                          aria-checked={isSelected}
                          className={`line-option-row ${isSelected ? 'active' : ''}`}
                          onClick={() => setComputerEnv(env.id)}
                          onKeyDown={(e) => {
                            if (e.key === ' ' || e.key === 'Enter') {
                              e.preventDefault();
                              setComputerEnv(env.id);
                            }
                          }}
                        >
                          <div className="line-option-content">
                            <div className="line-option-header">
                              <span className="line-option-title">{env.name}</span>
                              <span className="line-option-tag">{env.tag}</span>
                            </div>
                            <p className="line-option-desc">{env.desc}</p>
                          </div>
                          <div className="line-option-radio" aria-hidden="true">
                            {isSelected && <div className="line-option-radio-dot" />}
                          </div>
                        </div>
                      );
                    })}
                  </div>

                  <div className="config-note">
                    <strong>Active Container Preserved</strong>
                    <p>
                      Your active Docker supervisor and sandboxed computer container on port 4312 are preserved and continue running without interruption.
                    </p>
                  </div>
                </>
              )}

              {settingsTab === 'voice' && (() => {
                const geminiVoices = ['Puck', 'Charon', 'Kore', 'Fenrir', 'Aoede'];
                const openaiVoices = ['marin', 'alloy', 'echo', 'shimmer', 'ash', 'ballad', 'coral', 'sage', 'verse'];
                const browserVoices = ['default'];
                const currentVoices =
                  voiceProvider === 'gemini' ? geminiVoices
                  : voiceProvider === 'openai' ? openaiVoices
                  : browserVoices;

                // ── Live model lists from Google AI Docs (October 2026) ──────
                const geminiLiveModels = [
                  { id: 'gemini-3.8-live', name: 'gemini-3.8-live', tag: 'Latest', desc: 'Flagship real-time voice model. Native speech-to-speech, async function calling, visual context, 97+ languages.' },
                  { id: 'gemini-3.8-live-extended-thinking', name: 'gemini-3.8-live-extended-thinking', tag: 'Extended Thinking', desc: 'Multi-step reasoning during live conversation. Best for complex tasks that need deliberation mid-call.' },
                  { id: 'gemini-3.1-flash-live-preview', name: 'gemini-3.1-flash-live-preview', tag: 'Preview', desc: 'Fast, lightweight live preview — lower latency than 3.8, good for quick back-and-forth.' },
                  { id: 'gemini-3.5-live-translate-preview', name: 'gemini-3.5-live-translate-preview', tag: 'Translate Preview', desc: 'Optimised for real-time multilingual translation during voice sessions.' },
                ];
                const openaiLiveModels = [
                  { id: 'gpt-4o-realtime-preview', name: 'gpt-4o-realtime-preview', tag: 'Recommended', desc: 'GPT-4o Realtime — full tool-call support, semantic VAD, best quality.' },
                  { id: 'gpt-4o-mini-realtime-preview', name: 'gpt-4o-mini-realtime-preview', tag: 'Fast', desc: 'Smaller and cheaper than the full 4o model — still supports tool calls, faster responses.' },
                ];
                const currentLiveModels =
                  voiceProvider === 'gemini' ? geminiLiveModels
                  : voiceProvider === 'openai' ? openaiLiveModels
                  : [];

                const providerDefaults: Record<string, { model: string; voice: string }> = {
                  gemini: { model: 'gemini-3.8-live', voice: 'Aoede' },
                  openai: { model: 'gpt-4o-realtime-preview', voice: 'marin' },
                  browser: { model: '', voice: 'default' },
                };

                const voiceProviders = [
                  {
                    id: 'gemini',
                    name: 'Gemini Live TTS',
                    tag: 'Free Tier',
                    desc: 'Google Gemini Live — native speech-to-speech via WebRTC. Flagship 3.8 model with extended thinking. Free quota available.',
                  },
                  {
                    id: 'openai',
                    name: 'OpenAI Realtime',
                    tag: 'Paid',
                    desc: 'GPT-4o Realtime API — high-quality voice with tool-call support. Requires API key.',
                  },
                  {
                    id: 'browser',
                    name: 'Browser WebRTC (No Server)',
                    tag: 'Free',
                    desc: 'Falls back to browser SpeechSynthesis API — no server key needed, limited voice quality.',
                  },
                ];
                const telephonyProviders = [
                  {
                    id: 'none',
                    name: 'None — browser only',
                    tag: 'Default',
                    desc: 'Voice calls work in-browser via WebRTC. No telephone number or external routing.',
                  },
                  {
                    id: 'telegram',
                    name: 'Telegram Bot Voice',
                    tag: 'Free',
                    desc: 'Route voice through a Telegram bot — free forever, no SIM card needed. Requires TELEGRAM_TOKEN.',
                  },
                  {
                    id: 'whatsapp',
                    name: 'WhatsApp Webhook',
                    tag: 'Free',
                    desc: 'Receive WhatsApp voice messages via the WhatsApp Business API webhook. Requires WA_BUSINESS_TOKEN.',
                  },
                  {
                    id: 'twilio',
                    name: 'Twilio Voice',
                    tag: '$15 Trial',
                    desc: 'Twilio PSTN / SIP calling — reach any phone number. $15–20 in free trial credits on signup.',
                  },
                  {
                    id: 'telnyx',
                    name: 'Telnyx Voice',
                    tag: 'Trial Credits',
                    desc: 'Telnyx SIP trunking and call control API — competitive pricing with free trial credits.',
                  },
                ];
                return (
                  <>
                    <label className="field-label" style={{ margin: '0 0 6px' }}>
                      Voice LLM Provider
                    </label>
                    <p className="muted" style={{ margin: '0 0 10px', fontSize: '11px' }}>
                      Choose the AI engine that powers live voice conversations.
                    </p>
                    <div className="line-option-list" role="radiogroup" aria-label="Voice LLM Provider">
                      {voiceProviders.map((vp) => {
                        const isSel = voiceProvider === vp.id;
                        return (
                          <div
                            key={vp.id}
                            role="radio"
                            tabIndex={0}
                            aria-checked={isSel}
                            className={`line-option-row ${isSel ? 'active' : ''}`}
                            onClick={() => {
                              setVoiceProvider(vp.id);
                              const d = providerDefaults[vp.id];
                              if (d) { setVoiceModel(d.model); setVoiceName(d.voice); }
                            }}
                            onKeyDown={(e) => {
                              if (e.key === ' ' || e.key === 'Enter') {
                                e.preventDefault();
                                setVoiceProvider(vp.id);
                                const d = providerDefaults[vp.id];
                                if (d) { setVoiceModel(d.model); setVoiceName(d.voice); }
                              }
                            }}
                          >
                            <div className="line-option-content">
                              <div className="line-option-header">
                                <span className="line-option-title">{vp.name}</span>
                                <span className="line-option-tag">{vp.tag}</span>
                              </div>
                              <p className="line-option-desc">{vp.desc}</p>
                            </div>
                            <div className="line-option-radio" aria-hidden="true">
                              {isSel && <div className="line-option-radio-dot" />}
                            </div>
                          </div>
                        );
                      })}
                    </div>

                    {currentLiveModels.length > 0 && (
                      <>
                        <label className="field-label" style={{ margin: '16px 0 6px' }}>
                          Live Model
                        </label>
                        <p className="muted" style={{ margin: '0 0 10px', fontSize: '11px' }}>
                          {voiceProvider === 'gemini'
                            ? 'Current Gemini Live models — source: Google AI Studio docs (Oct 2026).'
                            : 'OpenAI Realtime models available via the Realtime API.'}
                        </p>
                        <div className="line-option-list" role="radiogroup" aria-label="Live Model">
                          {currentLiveModels.map((lm) => {
                            const isSel = voiceModel === lm.id;
                            return (
                              <div
                                key={lm.id}
                                role="radio"
                                tabIndex={0}
                                aria-checked={isSel}
                                className={`line-option-row ${isSel ? 'active' : ''}`}
                                onClick={() => setVoiceModel(lm.id)}
                                onKeyDown={(e) => {
                                  if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); setVoiceModel(lm.id); }
                                }}
                              >
                                <div className="line-option-content">
                                  <div className="line-option-header">
                                    <span className="line-option-title mono">{lm.name}</span>
                                    <span className="line-option-tag">{lm.tag}</span>
                                  </div>
                                  <p className="line-option-desc">{lm.desc}</p>
                                </div>
                                <div className="line-option-radio" aria-hidden="true">
                                  {isSel && <div className="line-option-radio-dot" />}
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      </>
                    )}

                    <label className="field-label" style={{ margin: '16px 0 6px' }}>
                      Voice Persona
                    </label>
                    <p className="muted" style={{ margin: '0 0 10px', fontSize: '11px' }}>
                      {voiceProvider === 'gemini'
                        ? 'Gemini Live voices — each has a distinct character and tone.'
                        : voiceProvider === 'openai'
                          ? 'OpenAI Realtime voices — optimised for natural conversation.'
                          : 'Browser synthesis uses the system default voice.'}
                    </p>
                    <div className="line-option-list" role="radiogroup" aria-label="Voice Persona">
                      {currentVoices.map((vn) => {
                        const isSel = voiceName === vn;
                        return (
                          <div
                            key={vn}
                            role="radio"
                            tabIndex={0}
                            aria-checked={isSel}
                            className={`line-option-row ${isSel ? 'active' : ''}`}
                            onClick={() => setVoiceName(vn)}
                            onKeyDown={(e) => {
                              if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); setVoiceName(vn); }
                            }}
                          >
                            <div className="line-option-content">
                              <div className="line-option-header">
                                <span className="line-option-title mono">{vn}</span>
                              </div>
                            </div>
                            <div className="line-option-radio" aria-hidden="true">
                              {isSel && <div className="line-option-radio-dot" />}
                            </div>
                          </div>
                        );
                      })}
                    </div>

                    <label className="field-label" style={{ margin: '16px 0 6px' }}>
                      Mobile / Telephony Channel
                    </label>
                    <p className="muted" style={{ margin: '0 0 10px', fontSize: '11px' }}>
                      Optionally route voice calls through a channel reachable from a phone or messaging app.
                    </p>
                    <div className="line-option-list" role="radiogroup" aria-label="Mobile Telephony Channel">
                      {telephonyProviders.map((tp) => {
                        const isSel = voiceTelephonyProvider === tp.id;
                        return (
                          <div
                            key={tp.id}
                            role="radio"
                            tabIndex={0}
                            aria-checked={isSel}
                            className={`line-option-row ${isSel ? 'active' : ''}`}
                            onClick={() => setVoiceTelephonyProvider(tp.id)}
                            onKeyDown={(e) => {
                              if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); setVoiceTelephonyProvider(tp.id); }
                            }}
                          >
                            <div className="line-option-content">
                              <div className="line-option-header">
                                <span className="line-option-title">{tp.name}</span>
                                <span className="line-option-tag">{tp.tag}</span>
                              </div>
                              <p className="line-option-desc">{tp.desc}</p>
                            </div>
                            <div className="line-option-radio" aria-hidden="true">
                              {isSel && <div className="line-option-radio-dot" />}
                            </div>
                          </div>
                        );
                      })}
                    </div>

                    {/* Dedicated Channel Setup Forms */}
                    {voiceTelephonyProvider === 'telegram' && (
                      <div
                        style={{
                          marginTop: '12px',
                          padding: '12px',
                          border: '1px solid var(--line)',
                          borderRadius: '6px',
                          background: 'var(--surface, #fffefc)',
                        }}
                      >
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '8px' }}>
                          <span className="field-label" style={{ margin: 0, fontWeight: 600 }}>Telegram Bot Setup</span>
                          <span className="line-option-tag" style={{ color: telegramBotToken ? 'var(--blue-dark)' : '#c27b00' }}>
                            {telegramBotToken ? 'Token saved' : 'Needs Token'}
                          </span>
                        </div>
                        <p className="muted" style={{ margin: '0 0 10px', fontSize: '11px', lineHeight: '1.4' }}>
                          <strong>Quick setup:</strong> Message <strong>@BotFather</strong> on Telegram, send <code>/newbot</code>, name your bot, and copy the API token below.
                        </p>
                        <label className="field-label" htmlFor="tg-bot-token" style={{ fontSize: '11px', marginBottom: '4px' }}>
                          Telegram Bot Token
                        </label>
                        <input
                          id="tg-bot-token"
                          type="password"
                          placeholder="e.g. 7123456789:AAHk..."
                          value={telegramBotToken}
                          autoComplete="off"
                          onChange={(e) => setTelegramBotToken(e.target.value)}
                          style={{ marginBottom: '10px' }}
                        />
                        <label className="field-label" htmlFor="tg-allowed-users" style={{ fontSize: '11px', marginBottom: '4px' }}>
                          Allowed Telegram User IDs (Optional Whitelist)
                        </label>
                        <input
                          id="tg-allowed-users"
                          type="text"
                          placeholder="e.g. 987654321 (message @userinfobot to find your ID)"
                          value={telegramAllowedUsers}
                          onChange={(e) => setTelegramAllowedUsers(e.target.value)}
                        />
                        <p className="muted" style={{ margin: '6px 0 0', fontSize: '11px' }}>
                          Restricting user IDs prevents unknown Telegram users from interacting with your Dot.
                        </p>
                      </div>
                    )}

                    {voiceTelephonyProvider === 'whatsapp' && (
                      <div
                        style={{
                          marginTop: '12px',
                          padding: '12px',
                          border: '1px solid var(--line)',
                          borderRadius: '6px',
                          background: 'var(--surface, #fffefc)',
                        }}
                      >
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '8px' }}>
                          <span className="field-label" style={{ margin: 0, fontWeight: 600 }}>WhatsApp Business Cloud API Setup</span>
                          <span className="line-option-tag" style={{ color: whatsappAccessToken ? 'var(--blue-dark)' : '#c27b00' }}>
                            {whatsappAccessToken ? 'Token saved' : 'Needs Token'}
                          </span>
                        </div>
                        <p className="muted" style={{ margin: '0 0 10px', fontSize: '11px', lineHeight: '1.4' }}>
                          Receive and reply to WhatsApp voice notes via Meta's WhatsApp Business Cloud API.
                        </p>
                        <label className="field-label" htmlFor="wa-phone-id" style={{ fontSize: '11px', marginBottom: '4px' }}>
                          Phone Number ID
                        </label>
                        <input
                          id="wa-phone-id"
                          type="text"
                          placeholder="e.g. 104928172910291"
                          value={whatsappPhoneNumberId}
                          onChange={(e) => setWhatsappPhoneNumberId(e.target.value)}
                          style={{ marginBottom: '10px' }}
                        />
                        <label className="field-label" htmlFor="wa-token" style={{ fontSize: '11px', marginBottom: '4px' }}>
                          System User Permanent Access Token
                        </label>
                        <input
                          id="wa-token"
                          type="password"
                          placeholder="EAA..."
                          value={whatsappAccessToken}
                          autoComplete="off"
                          onChange={(e) => setWhatsappAccessToken(e.target.value)}
                          style={{ marginBottom: '10px' }}
                        />
                        <label className="field-label" htmlFor="wa-verify-token" style={{ fontSize: '11px', marginBottom: '4px' }}>
                          Webhook Verification Secret Token
                        </label>
                        <input
                          id="wa-verify-token"
                          type="text"
                          placeholder="Create a secret passphrase (e.g. opendots-secret-key)"
                          value={whatsappVerifyToken}
                          onChange={(e) => setWhatsappVerifyToken(e.target.value)}
                          style={{ marginBottom: '10px' }}
                        />
                        <div className="config-note" style={{ margin: 0, padding: '8px 10px' }}>
                          <span style={{ fontSize: '11px', color: 'var(--muted)' }}>Webhook Callback URL to configure in Meta Dev Portal:</span><br/>
                          <code style={{ fontSize: '11px' }}>
                            {typeof window !== 'undefined' ? `${window.location.origin}/api/webhooks/whatsapp` : '/api/webhooks/whatsapp'}
                          </code>
                        </div>
                      </div>
                    )}

                    {voiceTelephonyProvider === 'twilio' && (
                      <div
                        style={{
                          marginTop: '12px',
                          padding: '12px',
                          border: '1px solid var(--line)',
                          borderRadius: '6px',
                          background: 'var(--surface, #fffefc)',
                        }}
                      >
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '8px' }}>
                          <span className="field-label" style={{ margin: 0, fontWeight: 600 }}>Twilio Voice Setup</span>
                          <span className="line-option-tag" style={{ color: twilioAuthToken ? 'var(--blue-dark)' : '#c27b00' }}>
                            {twilioAuthToken ? 'Credentials saved' : 'Needs Credentials'}
                          </span>
                        </div>
                        <p className="muted" style={{ margin: '0 0 10px', fontSize: '11px', lineHeight: '1.4' }}>
                          Connect your Twilio number to dial out or receive inbound cellular phone calls.
                        </p>
                        <label className="field-label" htmlFor="tw-sid" style={{ fontSize: '11px', marginBottom: '4px' }}>
                          Account SID
                        </label>
                        <input
                          id="tw-sid"
                          type="text"
                          placeholder="ACXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX"
                          value={twilioAccountSid}
                          onChange={(e) => setTwilioAccountSid(e.target.value)}
                          style={{ marginBottom: '10px' }}
                        />
                        <label className="field-label" htmlFor="tw-auth" style={{ fontSize: '11px', marginBottom: '4px' }}>
                          Auth Token
                        </label>
                        <input
                          id="tw-auth"
                          type="password"
                          placeholder="Twilio Auth Token"
                          value={twilioAuthToken}
                          autoComplete="off"
                          onChange={(e) => setTwilioAuthToken(e.target.value)}
                          style={{ marginBottom: '10px' }}
                        />
                        <label className="field-label" htmlFor="tw-phone" style={{ fontSize: '11px', marginBottom: '4px' }}>
                          Twilio Phone Number (E.164)
                        </label>
                        <input
                          id="tw-phone"
                          type="text"
                          placeholder="+12345678900"
                          value={twilioPhoneNumber}
                          onChange={(e) => setTwilioPhoneNumber(e.target.value)}
                        />
                      </div>
                    )}

                    {voiceTelephonyProvider === 'telnyx' && (
                      <div
                        style={{
                          marginTop: '12px',
                          padding: '12px',
                          border: '1px solid var(--line)',
                          borderRadius: '6px',
                          background: 'var(--surface, #fffefc)',
                        }}
                      >
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '8px' }}>
                          <span className="field-label" style={{ margin: 0, fontWeight: 600 }}>Telnyx SIP Voice Setup</span>
                        </div>
                        <p className="muted" style={{ margin: '0 0 10px', fontSize: '11px', lineHeight: '1.4' }}>
                          Enter your Telnyx SIP or Call Control API credentials.
                        </p>
                        <label className="field-label" htmlFor="telnyx-key" style={{ fontSize: '11px', marginBottom: '4px' }}>
                          Telnyx API Key
                        </label>
                        <input
                          id="telnyx-key"
                          type="password"
                          placeholder="KEY..."
                          value={twilioAuthToken}
                          autoComplete="off"
                          onChange={(e) => setTwilioAuthToken(e.target.value)}
                          style={{ marginBottom: '10px' }}
                        />
                        <label className="field-label" htmlFor="telnyx-phone" style={{ fontSize: '11px', marginBottom: '4px' }}>
                          Telnyx Phone Number
                        </label>
                        <input
                          id="telnyx-phone"
                          type="text"
                          placeholder="+1..."
                          value={twilioPhoneNumber}
                          onChange={(e) => setTwilioPhoneNumber(e.target.value)}
                        />
                      </div>
                    )}

                    <label className="field-label" style={{ marginTop: '16px', marginBottom: '6px', display: 'block' }}>
                      API Keys
                    </label>
                    <p className="muted" style={{ margin: '0 0 10px', fontSize: '11px' }}>
                      Keys are tried top-to-bottom. If a key returns 401 / 403 / 429 the next one is used automatically. The <code>VOICE_API_KEY</code> in <code>.env</code> is always appended as a last-resort fallback.
                    </p>

                    {voiceKeys.length === 0 && (
                      <p className="muted" style={{ fontSize: '12px', padding: '10px 0', borderTop: '1px solid var(--line)', borderBottom: '1px solid var(--line)', margin: '0 0 12px' }}>
                        No keys saved yet. Add one below — or set <code>VOICE_API_KEY</code> in <code>.env</code>.
                      </p>
                    )}

                    {voiceKeys.length > 0 && (
                      <div className="line-option-list" style={{ marginBottom: '12px' }}>
                        {voiceKeys.map((k, idx) => (
                          <div key={k.id} className="line-option-row" style={{ cursor: 'default', alignItems: 'center' }}>
                            <div className="line-option-content" style={{ gap: '2px' }}>
                              <div className="line-option-header">
                                <span className="line-option-title">{k.label || 'Unnamed key'}</span>
                                <span className="line-option-tag">{k.provider === 'any' ? 'Any' : k.provider === 'gemini' ? 'Gemini' : 'OpenAI'}</span>
                                {idx === 0 && <span className="line-option-tag" style={{ fontStyle: 'italic' }}>Primary</span>}
                                {idx > 0 && <span className="line-option-tag" style={{ fontStyle: 'italic' }}>Fallback {idx}</span>}
                              </div>
                              <p className="line-option-desc" style={{ fontFamily: 'monospace', letterSpacing: '0.05em' }}>
                                {k.key.slice(0, 8)}{'•'.repeat(Math.min(20, Math.max(0, k.key.length - 12)))}{k.key.slice(-4)}
                              </p>
                            </div>
                            <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', alignItems: 'flex-end', flexShrink: 0 }}>
                              {idx > 0 && (
                                <button
                                  type="button"
                                  style={{ fontSize: '11px', color: 'var(--muted)', background: 'none', border: 'none', cursor: 'pointer', padding: '2px 4px' }}
                                  onClick={() => {
                                    const next = [...voiceKeys];
                                    [next[idx - 1], next[idx]] = [next[idx], next[idx - 1]];
                                    setVoiceKeys(next);
                                  }}
                                >↑ Move up</button>
                              )}
                              <button
                                type="button"
                                style={{ fontSize: '11px', color: 'var(--muted)', background: 'none', border: 'none', cursor: 'pointer', padding: '2px 4px' }}
                                onClick={() => setVoiceKeys(voiceKeys.filter((_, i) => i !== idx))}
                              >Remove</button>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}

                    <div style={{ borderTop: '1px solid var(--line)', paddingTop: '12px' }}>
                      <p className="field-label" style={{ marginBottom: '8px' }}>Add key</p>
                      <div style={{ display: 'grid', gridTemplateColumns: '1fr 100px', gap: '6px', marginBottom: '6px' }}>
                        <input
                          type="text"
                          placeholder="Label (e.g. My Gemini key)"
                          value={newKeyLabel}
                          maxLength={50}
                          onChange={(e) => setNewKeyLabel(e.target.value)}
                        />
                        <select
                          value={newKeyProvider}
                          onChange={(e) => setNewKeyProvider(e.target.value)}
                          style={{ fontSize: '12px' }}
                        >
                          <option value="gemini">Gemini</option>
                          <option value="openai">OpenAI</option>
                          <option value="any">Any</option>
                        </select>
                      </div>
                      <div style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: '6px' }}>
                        <input
                          type="password"
                          placeholder="AIza…, AQ.…, or sk-…"
                          value={newKeyValue}
                          autoComplete="off"
                          onChange={(e) => setNewKeyValue(e.target.value)}
                        />
                        <button
                          type="button"
                          className="primary"
                          style={{ padding: '0 16px', fontSize: '13px' }}
                          disabled={!newKeyValue.trim()}
                          onClick={() => {
                            if (!newKeyValue.trim()) return;
                            setVoiceKeys([
                              ...voiceKeys,
                              {
                                id: `key-${Date.now()}`,
                                label: newKeyLabel.trim() || `Key ${voiceKeys.length + 1}`,
                                key: newKeyValue.trim(),
                                provider: newKeyProvider,
                              },
                            ]);
                            setNewKeyLabel('');
                            setNewKeyValue('');
                            setKeyAddedMessage(true);
                            setTimeout(() => setKeyAddedMessage(false), 4000);
                          }}
                        >Add</button>
                      </div>
                      {keyAddedMessage && (
                        <p style={{ color: 'var(--blue-dark)', fontSize: '11px', margin: '6px 0 0', fontWeight: 500 }}>
                          ✓ Key added to the list above. Click "Save" below to apply.
                        </p>
                      )}
                      <p className="muted" style={{ fontSize: '11px', marginTop: '6px' }}>
                        Key is stored encrypted in <code>data/opendots.sqlite</code> — not sent anywhere except the chosen voice provider.
                      </p>
                    </div>
                  </>
                );
              })()}

              {settingsTab === 'general' && (
                <>
                  <label className="permission-row">
                    <input
                      type="checkbox"
                      checked={research}
                      onChange={(e) => setResearch(e.target.checked)}
                    />
                    <span>
                      <strong>Public-page research</strong>
                      <small>
                        Allow the server-side read-only browser tool. Global
                        settings always take precedence.
                      </small>
                    </span>
                  </label>
                  <label className="permission-row">
                    <input
                      type="checkbox"
                      checked={memory}
                      onChange={(e) => setMemory(e.target.checked)}
                    />
                    <span>
                      <strong>Use saved memories</strong>
                      <small>
                        Include your preferences in new turns. Changing permission
                        stops active work.
                      </small>
                    </span>
                  </label>
                </>
              )}
            </>
          )}
          {dialog.type === 'memory' && (
            <p className="muted">
              Memories are explicit preferences, not automatic learning. Avoid
              secrets; enabled memories go to your model provider.
            </p>
          )}
          {error && (
            <p className="chat-error" role="alert">
              {error}
            </p>
          )}
          <button className="primary full" disabled={busy}>
            {busy ? 'Saving…' : 'Save'}
          </button>
        </form>
      </section>
    </div>
  );
}
