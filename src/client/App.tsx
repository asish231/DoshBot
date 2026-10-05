import { openPageLink } from './page-navigation';
import { SpaceNav } from './SpaceNav';
import { SpaceWorkspace } from './SpaceWorkspace';
import { useCallback, useEffect, useState, useRef } from 'react';
import { CopilotKitProvider } from '@copilotkit/react-core/v2';
import {
  ArrowUp,
  ArrowUpRight,
  BookOpen,
  Clock3,
  Code2,
  Folder,
  FolderOpen,
  FolderGit2,
  Menu,
  MessageCircle,
  Monitor,
  MoreHorizontal,
  Pause,
  PanelLeft,
  Play,
  Plus,
  Search,
  Settings2,
  Trash2,
  X,
  BarChart2,
  Mic,
  AudioLines,
  ChevronDown,
  Lightbulb,
  FileText,
  CalendarClock,
  Sparkles,
} from 'lucide-react';

function formatModelName(model: string): string {
  if (model.includes('sonnet')) return 'Sonnet 3.7';
  if (model.includes('gpt-4o')) return 'GPT-4o';
  if (model.includes('gemini-2.5-pro')) return 'Gemini 2.5 Pro';
  if (model.includes('gemini-3.8-live')) return 'Gemini 3.8 Live';
  if (model.includes('deepseek-reasoner')) return 'DeepSeek R1';
  if (model.includes('deepseek-chat')) return 'DeepSeek V3';
  if (model === 'auto-code') return 'Auto Code';
  if (model === 'auto-complex') return 'Auto Complex';
  return model.replace(/^models\//, '');
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
  { id: 'low', label: 'Low', desc: 'Fast answers, minimal thinking tokens' },
  { id: 'default', label: 'Medium', desc: 'Balanced analytical reasoning (default)' },
  { id: 'high', label: 'High', desc: 'Deep thorough step-by-step thinking' },
  { id: 'xhigh', label: 'Extra High', desc: 'Intensive reasoning for tough problems' },
  { id: 'max', label: 'Max', desc: 'Maximum possible thinking budget' },
];

import { useSpeechToText, STT_MODELS } from './useSpeechToText';
import type {
  Conversation,
  Detail,
  Dot,
  Memory,
  Result,
  State,
  Task,
  WorkspaceState,
} from '../shared/types';
import { api, ApiError, authHeaders, setToken } from './api';
import { Mascot } from './Mascot';
import { Chat } from './Chat';
import { ThreadList } from './ThreadList';
import { ResultPane } from './ResultPane';
import { TaskRow } from './TaskPresentation';
import { TaskActions } from './TaskActions';
import { WorkspaceDialog, type Dialog } from './WorkspaceDialog';
import { ConfirmDeleteModal } from './ConfirmDeleteModal';

export function App() {
  const [state, setState] = useState<State>();
  const [workspace, setWorkspace] = useState<WorkspaceState>();
  const [selectedDot, setSelectedDot] = useState('');
  const [selectedThread, setSelectedThread] = useState<string>();
  const [view, rawSetView] = useState<'chat' | 'tasks' | 'memories' | 'space'>(
    'chat',
  );
  const dirtyPage = useRef(false);
  const [spaceId, setSpaceId] = useState('');
  const [pageId, setPageId] = useState<string>();
  const [taskToDelete, setTaskToDelete] = useState<Task | null>(null);
  const [memoryToDelete, setMemoryToDelete] = useState<Memory | null>(null);
  const setDirtyPage = useCallback((value: boolean) => {
    dirtyPage.current = value;
  }, []);
  const setView = (next: typeof view) => {
    if (dirtyPage.current && !window.confirm('Leave your unsaved page draft?'))
      return;
    dirtyPage.current = false;
    if (next !== 'space')
      history.replaceState(null, '', location.pathname + location.search);
    rawSetView(next);
  };
  useEffect(() => {
    let acceptedHash = location.hash;
    const navigate = () => {
      const match = location.hash.match(
        /^#\/spaces\/([^/]+)(?:\/pages\/([^/]+))?$/,
      );
      if (!match) return;
      if (dirtyPage.current && location.hash === acceptedHash) return;
      if (
        dirtyPage.current &&
        !window.confirm('Leave your unsaved page draft?')
      ) {
        history.replaceState(null, '', acceptedHash || location.pathname);
        return;
      }
      acceptedHash = location.hash;
      dirtyPage.current = false;
      setSpaceId(match[1]);
      setPageId(match[2]);
      rawSetView('space');
      setMobile(false);
    };
    navigate();
    window.addEventListener('hashchange', navigate);
    return () => window.removeEventListener('hashchange', navigate);
  }, []);
  const openPage = (space: string, page?: string) => {
    openPageLink(`#/spaces/${space}${page ? `/pages/${page}` : ''}`);
  };

  const [error, setError] = useState('');
  const [auth, setAuth] = useState('');
  const [needsAuth, setNeedsAuth] = useState(false);
  const [dialog, setDialog] = useState<Dialog>();
  const [mobile, setMobile] = useState(false);
  const [navCollapsed, setNavCollapsed] = useState(false);
  const [pane, setPane] = useState(false);
  const [capture, setCapture] = useState<Result>();
  const [prompt, setPrompt] = useState('');
  const [pendingPrompt, setPendingPrompt] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [search, setSearch] = useState('');
  const [taskDetail, setTaskDetail] = useState<Detail>();
  const [homeModelOpen, setHomeModelOpen] = useState(false);
  const [homeEffortOpen, setHomeEffortOpen] = useState(false);
  const [homeAudioOpen, setHomeAudioOpen] = useState(false);
  const [homeModelSearch, setHomeModelSearch] = useState('');
  const homeModelPopoverRef = useRef<HTMLDivElement>(null);
  const homeEffortPopoverRef = useRef<HTMLDivElement>(null);
  const homeAudioPopoverRef = useRef<HTMLDivElement>(null);

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

  useEffect(() => {
    fetch('/api/models')
      .then((res) => res.json())
      .then((data) => {
        if (data && Array.isArray(data.models) && data.models.length > 0) {
          setModelOptions(data.models);
        }
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (
        homeModelPopoverRef.current &&
        !homeModelPopoverRef.current.contains(e.target as Node)
      ) {
        setHomeModelOpen(false);
      }
      if (
        homeEffortPopoverRef.current &&
        !homeEffortPopoverRef.current.contains(e.target as Node)
      ) {
        setHomeEffortOpen(false);
      }
      if (
        homeAudioPopoverRef.current &&
        !homeAudioPopoverRef.current.contains(e.target as Node)
      ) {
        setHomeAudioOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const stt = useSpeechToText((text) => {
    setPrompt((prev) => (prev ? `${prev} ${text}` : text));
  });
  const refresh = useCallback(async () => {
    try {
      const [s, w] = await Promise.all([
        api<State>('/state'),
        api<WorkspaceState>('/workspace'),
      ]);
      setState(s);
      setWorkspace(w);
      setNeedsAuth(false);
      setSelectedDot((previous) => previous || w.dots[0]?.id || '');
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) setNeedsAuth(true);
      else
        setError(
          e instanceof Error ? e.message : 'Could not connect to the server.',
        );
    }
  }, []);
  useEffect(() => {
    void refresh();
    const timer = setInterval(() => void refresh(), 3000);
    return () => clearInterval(timer);
  }, [refresh]);
  useEffect(() => {
    setCapture(undefined);
    if (!selectedThread) return;
    let active = true;
    const load = () =>
      void api<Result | null>(`/conversations/${selectedThread}/capture`)
        .then((result) => {
          if (active) setCapture(result ?? undefined);
        })
        .catch((e) => {
          if (active) setError(e.message);
        });
    load();
    const timer = setInterval(load, 3000);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [selectedThread]);
  const mutate = async (path: string, method: string, body?: unknown) => {
    setError('');
    try {
      await api(path, method, body);
      await refresh();
      if (taskDetail)
        setTaskDetail(await api<Detail>(`/tasks/${taskDetail.task.id}`));
      return true;
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save.');
      return false;
    }
  };
  const dot =
    workspace?.dots.find((item) => item.id === selectedDot) ??
    workspace?.dots[0];
  const thread = workspace?.conversations.find(
    (item) => item.id === selectedThread && item.dotId === dot?.id,
  );
  const configured = !!workspace && workspace.setup.missing.length === 0;
  const chooseDot = (next: Dot) => {
    setSelectedDot(next.id);
    setSelectedThread(
      workspace?.conversations.find((item) => item.dotId === next.id)?.id,
    );
    setView('chat');
    setMobile(false);
    setPendingPrompt(undefined);
  };
  const newConversation = async (text?: string) => {
    if (!dot || !configured || busy) return;
    setBusy(true);
    setError('');
    try {
      const next = await api<Conversation>('/conversations', 'POST', {
        dotId: dot.id,
        title: text?.slice(0, 80) || 'A new thought',
      });
      await refresh();
      setSelectedThread(next.id);
      setPendingPrompt(text);
      setPrompt('');
      setView('chat');
      setMobile(false);
    } catch (e) {
      setError(
        e instanceof Error ? e.message : 'Could not create the conversation.',
      );
    } finally {
      setBusy(false);
    }
  };

  const updateDotModel = async (newModel: string) => {
    if (!dot) return;
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
        reasoningEffort: dot.reasoningEffort || 'default',
      });
      await refresh();
    } catch {}
  };

  const updateDotEffort = async (newEffort: string) => {
    if (!dot) return;
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
        model: dot.model || 'auto-code',
        reasoningEffort: newEffort,
      });
      await refresh();
    } catch {}
  };

  const deleteConversation = async (id: string) => {
    try {
      await api(`/conversations/${id}`, 'DELETE');
      if (selectedThread === id) {
        setSelectedThread(undefined);
      }
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not delete conversation.');
    }
  };

  const clearAllConversations = async () => {
    try {
      await api('/conversations', 'DELETE');
      setSelectedThread(undefined);
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not clear conversations.');
    }
  };

  if (needsAuth)
    return (
      <main className="unlock">
        <Mascot />
        <h1>Your own little corner.</h1>
        <p>
          Enter the owner access token configured on this template’s server.
        </p>
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            setToken(auth);
            try {
              await api('/state');
              setError('');
              await refresh();
            } catch (err) {
              setError(
                err instanceof Error
                  ? err.message
                  : 'Access token was not accepted.',
              );
            }
          }}
        >
          <input
            type="password"
            aria-label="Owner access token"
            autoComplete="current-password"
            value={auth}
            onChange={(e) => setAuth(e.target.value)}
            required
          />
          <button className="primary">Unlock DoshBot</button>
        </form>
        {error && (
          <p className="chat-error" role="alert">
            {error}
          </p>
        )}
        <p className="muted">The token stays in this tab’s session storage.</p>
      </main>
    );
  if (!state || !workspace || !dot)
    return (
      <main className="unlock">
        <Mascot state="working" />
        <h1>Finding your dots…</h1>
        {error && (
          <>
            <p className="chat-error">{error}</p>
            <button onClick={() => void refresh()}>Retry</button>
          </>
        )}
      </main>
    );
  const content = (
    <div className={`app template-app ${navCollapsed ? 'nav-collapsed' : ''}`}>
      <nav className="icon-rail" aria-label="Workspace navigation">
        <button
          className="rail-brand"
          aria-label="DoshBot by SafarNow home"
          onClick={() => {
            setView('chat');
            setSelectedThread(undefined);
          }}
        >
          D<span>·</span>
        </button>
        <button
          aria-label={navCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          onClick={() => setNavCollapsed(!navCollapsed)}
        >
          <PanelLeft size={18} />
        </button>
        <button
          aria-label="New chat"
          disabled={!configured}
          onClick={() => void newConversation()}
        >
          <Plus size={19} />
        </button>
        <button
          aria-label="Open Spaces"
          onClick={() => {
            if (workspace.spaces[0]) openPage(workspace.spaces[0].id);
          }}
        >
          <Folder size={18} />
        </button>
        <button aria-label="Open activity" onClick={() => setView('tasks')}>
          <Clock3 size={18} />
        </button>
        <button
          className="rail-settings"
          aria-label="Open settings"
          onClick={() => setDialog({ type: 'settings' })}
        >
          <Settings2 size={18} />
        </button>
      </nav>
      <button
        className="mobile-menu icon-button"
        aria-label="Open navigation"
        aria-expanded={mobile}
        aria-controls="workspace-sidebar"
        onClick={() => setMobile(true)}
      >
        <Menu size={21} />
      </button>
      {mobile && (
        <button
          className="nav-scrim"
          aria-label="Close navigation"
          onClick={() => setMobile(false)}
        />
      )}
      <aside
        id="workspace-sidebar"
        className={`sidebar ${mobile ? 'open' : ''}`}
      >
        <button
          className="wordmark"
          onClick={() => {
            setView('chat');
            setSelectedThread(undefined);
          }}
        >
          <span className="dotted-logo">
            <i />
            <i />
            <i />
            <i />
          </span>
          <div className="wordmark-text">
            <span className="wordmark-main">DoshBot</span>
            <span className="wordmark-by">by SafarNow</span>
          </div>
        </button>
        <button
          className="new-chat nav-item"
          disabled={!configured}
          onClick={() => void newConversation()}
        >
          <Plus size={17} />
          <span>New chat</span>
        </button>
        <div className="spaces-heading nav-label">
          DOTS
          <button
            className="icon-button"
            aria-label="Create Dot"
            onClick={() =>
              setDialog({ type: 'dot', spaceId: workspace.spaces[0].id })
            }
          >
            <Plus size={14} />
          </button>
        </div>
        <nav className="dots-nav" aria-label="Dots">
          {workspace.dots.map((item) => (
            <div className="dot-nav-row" key={item.id}>
              <button
                className={`dot-nav ${dot.id === item.id && view === 'chat' ? 'active' : ''}`}
                aria-current={
                  dot.id === item.id && view === 'chat' ? 'page' : undefined
                }
                onClick={() => chooseDot(item)}
              >
                <Mascot identity={item.id} name={item.name} small decorative />
                <span>{item.name}</span>
              </button>
              <button
                className="icon-button dot-settings"
                aria-label={`Edit ${item.name} settings`}
                onClick={() =>
                  setDialog({ type: 'dot', dot: item, spaceId: item.spaceId })
                }
              >
                <MoreHorizontal size={15} />
              </button>
            </div>
          ))}
        </nav>
        <div className="spaces-heading nav-label">
          SPACES
          <button
            className="icon-button"
            aria-label="Create Space"
            onClick={() => setDialog({ type: 'space' })}
          >
            <Plus size={14} />
          </button>
        </div>
        <nav className="spaces-nav" aria-label="Spaces">
          {workspace.spaces.map((space) => (
            <SpaceNav
              key={space.id}
              space={space}
              active={view === 'space' && spaceId === space.id}
              pageId={pageId}
              onOpen={(id) => openPage(space.id, id)}
            />
          ))}
        </nav>
        {configured ? (
          <ThreadList
            dotId={dot.id}
            dots={workspace.dots}
            local={workspace.conversations}
            selected={view === 'chat' ? selectedThread : undefined}
            onSelect={(id) => {
              const conversation = workspace.conversations.find(
                (item) => item.id === id,
              );
              if (conversation) setSelectedDot(conversation.dotId);
              setSelectedThread(id);
              setView('chat');
              setMobile(false);
            }}
            onNew={() => void newConversation()}
            onDelete={(id) => void deleteConversation(id)}
            onClearAll={() => void clearAllConversations()}
          />
        ) : (
          <div className="sidebar-empty">
            Set up text chat to begin a persistent conversation.
          </div>
        )}
        <div className="sidebar-bottom">
          <button
            className={`nav-item ${view === 'tasks' ? 'active' : ''}`}
            onClick={() => {
              setView('tasks');
              setMobile(false);
            }}
          >
            <Clock3 size={17} />
            <span>Scheduled & activity</span>
            <small>{state.tasks.length}</small>
          </button>
          <button
            className={`nav-item ${view === 'memories' ? 'active' : ''}`}
            onClick={() => {
              setView('memories');
              setMobile(false);
            }}
          >
            <BookOpen size={17} />
            <span>Memories</span>
            <small>{state.memories.length}</small>
          </button>
          <button
            className="nav-item"
            onClick={() => setDialog({ type: 'settings' })}
          >
            <Settings2 size={17} />
            <span>Settings & setup</span>
          </button>
          <a
            className="nav-item"
            href="https://github.com/asish231/DoshBot"
            target="_blank"
            rel="noreferrer"
          >
            <Code2 size={17} />
            <span>DoshBot on GitHub</span>
            <ArrowUpRight size={13} />
          </a>
          <div className="version">
            DOSHBOT <span>v0.2</span>
          </div>
        </div>
      </aside>
      <div className="workspace">
        <header className="topbar">
          <button
            className="desktop-nav-toggle document-icon"
            aria-label={navCollapsed ? 'Show navigation' : 'Hide navigation'}
            onClick={() => setNavCollapsed(!navCollapsed)}
          >
            <PanelLeft size={18} />
          </button>
          <div className="breadcrumbs">
            <span>
              {view === 'space'
                ? workspace.spaces.find((space) => space.id === spaceId)?.name
                : 'Dots'}
            </span>
            <span>/</span>
            <strong>
              {view === 'chat'
                ? dot.name
                : view === 'tasks'
                  ? 'Activity'
                  : view === 'space'
                    ? 'Pages'
                    : 'Memories'}
            </strong>
          </div>
          <div className="top-actions">
            <span className="mode-badge">
              {configured ? 'SELF-HOSTED' : 'SETUP REQUIRED'}
            </span>
            <button
              className="pause-button"
              aria-label={
                state.settings.paused ? 'Resume all Dots' : 'Pause all Dots'
              }
              onClick={() =>
                void mutate('/settings', 'PATCH', {
                  paused: !state.settings.paused,
                })
              }
            >
              {state.settings.paused ? <Play size={14} /> : <Pause size={14} />}
              <span>{state.settings.paused ? 'Resume' : 'Pause'}</span>
            </button>
            <button
              className="icon-button"
              aria-label={pane ? 'Hide computer' : 'Show computer'}
              aria-expanded={pane}
              onClick={() => setPane(!pane)}
            >
              <Monitor size={18} />
            </button>
          </div>
        </header>
        {error && (
          <div className="error-banner" role="alert">
            <span>{error}</span>
            <button
              className="icon-button"
              aria-label="Dismiss error"
              onClick={() => setError('')}
            >
              <X size={16} />
            </button>
          </div>
        )}
        {state.settings.paused && (
          <div className="notice">
            All Dots are paused. Active compute stops and scheduled tasks wait.
          </div>
        )}
        {view === 'space' ? (
          <SpaceWorkspace
            key={spaceId}
            space={
              workspace.spaces.find((s) => s.id === spaceId) ??
              workspace.spaces[0]
            }
            pageId={pageId}
            workspace={workspace}
            paused={state.settings.paused}
            onPage={(id) => openPage(spaceId, id)}
            onSettings={() => setDialog({ type: 'settings' })}
            onCreateDot={() => setDialog({ type: 'dot', spaceId })}
            onDirty={setDirtyPage}
            onRefresh={refresh}
            onSchedule={(threadId) => setDialog({ type: 'schedule', threadId })}
            onThread={(id) => {
              const target = workspace.conversations.find((t) => t.id === id);
              if (target) {
                setView('chat');
                setSelectedDot(target.dotId);
                setSelectedThread(id);
              }
            }}
          />
        ) : view === 'chat' ? (
          <div className={`chat-workspace ${pane ? 'split' : ''}`}>
            <div className="chat-column">
              {thread && configured ? (
                <Chat
                  key={thread.id}
                  thread={thread}
                  dot={dot}
                  initialPrompt={pendingPrompt}
                  onConsumed={() => setPendingPrompt(undefined)}
                  voiceReady={workspace.setup.voice}
                  calls={workspace.calls.filter(
                    (call) => call.threadId === thread.id,
                  )}
                  paused={state.settings.paused}
                  onSaved={refresh}
                  onComputer={() => setPane(true)}
                  onSchedule={() =>
                    setDialog({ type: 'schedule', threadId: thread.id })
                  }
                  onDeleteConversation={() => void deleteConversation(thread.id)}
                  onOpenSettings={(tab) =>
                    setDialog({ type: 'settings', initialTab: tab })
                  }
                />
              ) : (
                <div className="new-conversation doshbot-hero">
                  <div className="empty-chat-persona modern-hero">
                    <div className="hero-badge">
                      <Sparkles size={13} />
                      <span>DoshBot · Always-on coding coworker</span>
                    </div>
                    <Mascot
                      identity={dot.id}
                      name={dot.name}
                      state={state.settings.paused ? 'paused' : 'idle'}
                    />
                    <h2>What should {dot.name} build today?</h2>
                    <p className="hero-sub">{dot.instructions}</p>
                    <div className="hero-actions">
                      <button
                        className="hero-btn primary-hero"
                        onClick={() => setPrompt('/code Audit this workspace and propose a safe first edit ')}
                        disabled={!configured}
                      >
                        <Code2 size={15} />
                        <span>Code in local folder</span>
                      </button>
                      <button
                        className="hero-btn"
                        onClick={() => setPrompt('/plan Design a 24/7 automation for ')}
                        disabled={!configured}
                      >
                        <CalendarClock size={15} />
                        <span>Schedule 24/7 work</span>
                      </button>
                      <button
                        className="text-button"
                        onClick={() =>
                          setDialog({ type: 'dot', dot, spaceId: dot.spaceId })
                        }
                      >
                        Edit specialist <MoreHorizontal size={14} />
                      </button>
                    </div>
                    <button
                      className="folder-connect-card"
                      onClick={() => setDialog({ type: 'settings', initialTab: 'coding' })}
                      title="Connect a local directory like Claude / DeepSeek Harness — code, run bash, edit files natively"
                    >
                      <span className="folder-icon">
                        <FolderGit2 size={18} />
                      </span>
                      <span className="folder-text">
                        <strong>{state.settings.codingDirectory || 'Connect a local folder to code in'}</strong>
                        <small>Claude-style directory · str_replace_editor + bash + OpenCode engine</small>
                      </span>
                      <span className="folder-cta">
                        <FolderOpen size={14} />
                        {state.settings.codingDirectory ? 'Change' : 'Connect'}
                      </span>
                    </button>
                  </div>
                  {!configured && (
                    <div className="setup-card">
                      <span className="setup-icon">
                        <Settings2 size={20} />
                      </span>
                      <div>
                        <strong>Connect your Dot</strong>
                        <p>
                          Connect your model and conversation service in
                          Settings to start chatting. Your Spaces and Dot
                          preferences are ready to use.
                        </p>
                        <a
                          href="https://github.com/CopilotKit/OpenDots/blob/main/docs/SETUP.md"
                          target="_blank"
                          rel="noreferrer"
                        >
                          Open the setup guide <ArrowUpRight size={12} />
                        </a>
                      </div>
                    </div>
                  )}
                  <form
                    className="chat-composer-box"
                    onSubmit={(e) => {
                      e.preventDefault();
                      void newConversation(prompt);
                    }}
                  >
                    <textarea
                      aria-label="Start a conversation"
                      placeholder={
                        configured
                          ? `Message ${dot.name}…`
                          : 'Your first conversation starts after setup.'
                      }
                      value={prompt}
                      maxLength={4000}
                      onChange={(e) => setPrompt(e.target.value)}
                      disabled={!configured}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' && !e.shiftKey) {
                          e.preventDefault();
                          e.currentTarget.form?.requestSubmit();
                        }
                      }}
                    />
                    <div className="chat-composer-footer">
                      <div className="chat-composer-left">
                        <button
                          type="submit"
                          className="composer-send-btn"
                          aria-label="Start conversation"
                          disabled={!configured || busy || !prompt.trim()}
                        >
                          <ArrowUp size={18} strokeWidth={2.5} />
                        </button>
                        <button
                          type="button"
                          className="composer-icon-btn"
                          aria-label="Attach link"
                          onClick={() => {
                            const url = window.prompt('Enter source URL:');
                            if (url) setPrompt((p) => `From ${url}:\n\n${p}`);
                          }}
                        >
                          <Plus size={18} strokeWidth={2} />
                        </button>
                      </div>

                      <div className="chat-composer-right">
                        {/* Model Dropdown */}
                        <div className="chat-popover-container" ref={homeModelPopoverRef}>
                          <button
                            type="button"
                            className={`composer-pill-btn ${homeModelOpen ? 'open' : ''}`}
                            onClick={() => {
                              setHomeModelOpen(!homeModelOpen);
                              setHomeEffortOpen(false);
                              setHomeAudioOpen(false);
                            }}
                            title="Select Model"
                            aria-label="Select Model"
                          >
                            <span>{formatModelName(dot.model || 'auto-code')}</span>
                            <ChevronDown
                              size={14}
                              className={`pill-chevron ${homeModelOpen ? 'rotated' : ''}`}
                            />
                          </button>
                          {homeModelOpen && (
                            <div className="chat-popover-menu model-menu">
                              <div className="chat-popover-header">
                                <span>Model</span>
                                <small>{modelOptions.length} available</small>
                              </div>
                              <div className="chat-popover-search">
                                <Search size={14} />
                                <input
                                  type="text"
                                  placeholder="Search models..."
                                  value={homeModelSearch}
                                  onChange={(e) => setHomeModelSearch(e.target.value)}
                                  autoFocus
                                />
                              </div>
                              <div className="chat-popover-list">
                                {modelOptions
                                  .filter(
                                    (m) =>
                                      !homeModelSearch.trim() ||
                                      m
                                        .toLowerCase()
                                        .includes(homeModelSearch.trim().toLowerCase()),
                                  )
                                  .map((m) => (
                                    <button
                                      key={m}
                                      type="button"
                                      className={`chat-popover-item ${dot.model === m ? 'active' : ''}`}
                                      onClick={() => {
                                        void updateDotModel(m);
                                        setHomeModelOpen(false);
                                        setHomeModelSearch('');
                                      }}
                                    >
                                      <span className="chat-item-name">{formatModelName(m)}</span>
                                      <span className="chat-item-id">{m}</span>
                                      {dot.model === m && (
                                        <span className="chat-item-check">✓</span>
                                      )}
                                    </button>
                                  ))}
                              </div>
                            </div>
                          )}
                        </div>

                        {/* Effort Dropdown */}
                        <div className="chat-popover-container" ref={homeEffortPopoverRef}>
                          <button
                            type="button"
                            className={`composer-pill-btn ${homeEffortOpen ? 'open' : ''}`}
                            onClick={() => {
                              setHomeEffortOpen(!homeEffortOpen);
                              setHomeModelOpen(false);
                              setHomeAudioOpen(false);
                            }}
                            title="Reasoning Effort"
                            aria-label="Reasoning Effort"
                          >
                            <BarChart2 size={15} strokeWidth={2.2} />
                            <span>{formatEffortName(dot.reasoningEffort || 'default')}</span>
                            <ChevronDown
                              size={14}
                              className={`pill-chevron ${homeEffortOpen ? 'rotated' : ''}`}
                            />
                          </button>
                          {homeEffortOpen && (
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
                                    className={`chat-popover-item ${(dot.reasoningEffort || 'default') === eff.id ? 'active' : ''}`}
                                    onClick={() => {
                                      void updateDotEffort(eff.id);
                                      setHomeEffortOpen(false);
                                    }}
                                  >
                                    <div className="chat-effort-col">
                                      <span className="chat-item-name">{eff.label}</span>
                                      <span className="chat-item-desc">{eff.desc}</span>
                                    </div>
                                    {(dot.reasoningEffort || 'default') === eff.id && (
                                      <span className="chat-item-check">✓</span>
                                    )}
                                  </button>
                                ))}
                              </div>
                            </div>
                          )}
                        </div>

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
                        <div className="chat-popover-container" ref={homeAudioPopoverRef}>
                          <button
                            type="button"
                            className={`composer-audio-btn ${homeAudioOpen ? 'open' : ''}`}
                            aria-label="Voice options and models"
                            title="Voice options & STT models"
                            onClick={() => {
                              setHomeAudioOpen(!homeAudioOpen);
                              setHomeModelOpen(false);
                              setHomeEffortOpen(false);
                            }}
                          >
                            <AudioLines size={18} />
                            <ChevronDown
                              size={14}
                              className={`pill-chevron ${homeAudioOpen ? 'rotated' : ''}`}
                            />
                          </button>
                          {homeAudioOpen && (
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
                                    background: '#242633',
                                    color: '#fff',
                                    borderRadius: '8px',
                                    justifyContent: 'center',
                                    gap: '8px',
                                  }}
                                  onClick={() => {
                                    setHomeAudioOpen(false);
                                    void newConversation(prompt || 'Hello Dot!');
                                  }}
                                >
                                  <AudioLines size={16} />
                                  <span style={{ color: '#fff', fontWeight: 600 }}>
                                    Start Live Voice Call
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
                                      setHomeAudioOpen(false);
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
                  </form>
                  <div className="composer-suggestions">
                    <button
                      type="button"
                      disabled={!configured}
                      onClick={() => setPrompt('Help me think this through')}
                    >
                      <Lightbulb size={16} />
                      <span>Help me think this through</span>
                      <ArrowUpRight size={14} />
                    </button>
                    <button
                      type="button"
                      disabled={!configured}
                      onClick={() => setPrompt('Research a public page')}
                    >
                      <Search size={16} />
                      <span>Research a public page</span>
                      <ArrowUpRight size={14} />
                    </button>
                    <button
                      type="button"
                      disabled={!configured}
                      onClick={() => setPrompt('Make a plan I can follow')}
                    >
                      <FileText size={16} />
                      <span>Make a plan I can follow</span>
                      <ArrowUpRight size={14} />
                    </button>
                  </div>
                  <div className="connection-note">
                    <span
                      className={`online-dot ${workspace.setup.slack === 'online' ? '' : 'off'}`}
                    />
                    Slack · {workspace.setup.slack.replaceAll('_', ' ')}
                    <button
                      className="text-button"
                      onClick={() => setDialog({ type: 'settings' })}
                    >
                      Setup details
                    </button>
                  </div>
                </div>
              )}
            </div>
            {pane && (
              <ResultPane
                key={dot.id}
                dots={workspace.dots}
                defaultDotId={dot.id}
                latest={capture}
                dotState="idle"
                onClose={() => setPane(false)}
              />
            )}
          </div>
        ) : (
          <main className="main-content">
            <div className="page-heading">
              <div>
                <span className="eyebrow">YOUR WORKSPACE</span>
                <h1>
                  {view === 'memories'
                    ? 'Memories'
                    : 'A little follow-through.'}
                </h1>
                <p>
                  {view === 'memories'
                    ? 'Preferences you choose to share with your Dots.'
                    : 'Scheduled turns run on the server in their original conversation.'}
                </p>
              </div>
              {view === 'memories' && (
                <button
                  className="primary"
                  onClick={() => setDialog({ type: 'memory' })}
                >
                  <Plus size={15} />
                  Add memory
                </button>
              )}
            </div>
            {view === 'memories' ? (
              <>
                <div className="memory-grid">
                  {state.memories.map((memory) => (
                    <article className="memory-card" key={memory.id}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', width: '100%', marginBottom: '4px' }}>
                        <BookOpen size={18} />
                        <span className={`memory-category-badge category-${memory.category || 'general'}`}>
                          {memory.category || 'general'}
                        </span>
                      </div>
                      <p>{memory.text}</p>
                      <div>
                        <small>
                          {state.settings.memoryAllowed
                            ? 'Available to permitted Dots'
                            : 'Memory use disabled'}
                        </small>
                        <button
                          className="icon-button"
                          aria-label="Edit memory"
                          onClick={() => setDialog({ type: 'memory', memory })}
                        >
                          <MoreHorizontal size={17} />
                        </button>
                        <button
                          className="icon-button"
                          aria-label="Delete memory"
                          onClick={() => setMemoryToDelete(memory)}
                        >
                          <Trash2 size={15} />
                        </button>
                      </div>
                    </article>
                  ))}
                </div>
                {!state.memories.length && (
                  <div className="large-empty">
                    <Mascot />
                    <h2>A little context goes a long way.</h2>
                    <p>
                      Add a preference like “Keep my research briefs short.” You
                      can change or remove it anytime.
                    </p>
                  </div>
                )}
              </>
            ) : (
              <>
                <label className="search-box">
                  <Search size={16} />
                  <input
                    aria-label="Search tasks"
                    placeholder="Find a task…"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                  />
                </label>
                <div className="task-list">
                  {state.tasks
                    .filter((task) =>
                      task.prompt.toLowerCase().includes(search.toLowerCase()),
                    )
                    .map((task) => (
                      <TaskRow
                        key={task.id}
                        task={task}
                        onClick={() =>
                          void api<Detail>(`/tasks/${task.id}`)
                            .then(setTaskDetail)
                            .catch((e) => setError(e.message))
                        }
                      />
                    ))}
                </div>
                {!state.tasks.length && (
                  <div className="large-empty">
                    <Clock3 size={32} />
                    <h2>Let a thought come back around.</h2>
                    <p>
                      Open a conversation and use the clock button to schedule a
                      server-side task.
                    </p>
                  </div>
                )}
                {taskDetail && (
                  <section className="task-detail-card">
                    <h2>{taskDetail.task.prompt}</h2>
                    <TaskActions
                      task={taskDetail.task}
                      busy={busy}
                      settings={state.settings}
                      onAction={(action) =>
                        void mutate(
                          `/tasks/${taskDetail.task.id}/actions`,
                          'POST',
                          { action },
                        )
                      }
                      onSchedule={async () => {
                        const raw = window.prompt(
                          'Repeat interval in minutes (0 removes the schedule)',
                          String((taskDetail.task.intervalSeconds ?? 0) / 60),
                        );
                        if (raw === null) return;
                        const value = Number(raw);
                        if (!Number.isFinite(value) || value < 0) {
                          setError('Enter a valid number of minutes.');
                          return;
                        }
                        await mutate(
                          `/tasks/${taskDetail.task.id}/schedule`,
                          'PUT',
                          {
                            intervalSeconds: value
                              ? Math.round(value * 60)
                              : null,
                          },
                        );
                      }}
                      onDelete={() => setTaskToDelete(taskDetail.task)}
                    />
                    {taskDetail.task.error && (
                      <p className="chat-error">{taskDetail.task.error}</p>
                    )}
                    {taskDetail.events.slice(-6).map((event) => (
                      <p className="muted" key={event.id}>
                        {event.text}
                      </p>
                    ))}
                    <small>{taskDetail.runs.length} saved runs</small>
                  </section>
                )}
              </>
            )}
          </main>
        )}
        {pane && view !== 'chat' && (
          <div className="computer-overlay">
            <ResultPane
              key={view === 'space' ? spaceId : dot.id}
              dots={workspace.dots}
              defaultDotId={
                view === 'space'
                  ? (workspace.dots.find((candidate) =>
                      candidate.spaceIds.includes(spaceId),
                    )?.id ?? dot.id)
                  : dot.id
              }
              dotState="idle"
              onClose={() => setPane(false)}
            />
          </div>
        )}
      </div>
      {dialog && (
        <WorkspaceDialog
          dialog={dialog}
          state={state}
          workspace={workspace}
          onClose={() => setDialog(undefined)}
          mutate={mutate}
        />
      )}

      {/* Delete Task Confirmation Modal */}
      <ConfirmDeleteModal
        isOpen={!!taskToDelete}
        title="Delete task?"
        description="This will permanently remove this scheduled task and all its recorded runs."
        itemTitle={taskToDelete?.prompt}
        confirmLabel="Delete task"
        cancelLabel="Cancel"
        onClose={() => setTaskToDelete(null)}
        onConfirm={async () => {
          if (!taskToDelete) return;
          try {
            await mutate(`/tasks/${taskToDelete.id}`, 'DELETE', {});
            setTaskDetail(undefined);
          } catch (err: any) {
            setError(err?.message || 'Could not delete task.');
          }
        }}
      />

      {/* Delete Memory Confirmation Modal */}
      <ConfirmDeleteModal
        isOpen={!!memoryToDelete}
        title="Delete memory?"
        description="This will remove this memory from your Dots' context."
        itemTitle={memoryToDelete?.text}
        confirmLabel="Delete"
        cancelLabel="Cancel"
        onClose={() => setMemoryToDelete(null)}
        onConfirm={async () => {
          if (!memoryToDelete) return;
          await mutate(`/memories/${memoryToDelete.id}`, 'DELETE', {});
        }}
      />
    </div>
  );
  return configured ? (
    <CopilotKitProvider
      runtimeUrl="/api/copilotkit"
      headers={authHeaders()}
      enableInspector={false}
      showDevConsole={false}
    >
      {content}
    </CopilotKitProvider>
  ) : (
    content
  );
}
