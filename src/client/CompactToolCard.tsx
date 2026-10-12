import { useState } from 'react';
import {
  Terminal,
  FileCode,
  FolderSearch,
  Globe,
  Cpu,
  Bot,
  Code,
  Brain,
  Clock,
  FileText,
  Wrench,
  ChevronRight,
  ChevronDown,
  Copy,
  Check,
  Loader2,
  CheckCircle2,
  AlertCircle,
} from 'lucide-react';
import { computerToolResult } from './ComputerToolCard';

export type CompactToolRenderProps = {
  name: string;
  toolCallId: string;
  args?: unknown;
  result?: unknown;
  status: string;
  running?: boolean;
};

export function getToolMeta(name: string, args: Record<string, unknown>) {
  switch (name) {
    case 'bash':
      return {
        label: 'Terminal',
        Icon: Terminal,
        summary:
          typeof args.command === 'string'
            ? `$ ${args.command}`
            : 'Shell command',
        badge: 'sh',
      };
    case 'str_replace_editor': {
      const cmd = typeof args.command === 'string' ? args.command : 'edit';
      const path =
        typeof args.path === 'string'
          ? args.path.split('/').pop() || args.path
          : '';
      return {
        label: 'File Editor',
        Icon: FileCode,
        summary: path ? `${cmd} ${path}` : cmd,
        badge: 'editor',
      };
    }
    case 'search_files':
      return {
        label: 'Search Files',
        Icon: FolderSearch,
        summary:
          typeof args.query === 'string' ? `"${args.query}"` : 'Search files',
        badge: 'files',
      };
    case 'search_web':
      return {
        label: 'Web Search',
        Icon: Globe,
        summary:
          typeof args.query === 'string' ? `"${args.query}"` : 'Browse web',
        badge: 'web',
      };
    case 'opencode_task':
      return {
        label: 'OpenCode Task',
        Icon: Cpu,
        summary:
          typeof args.task === 'string'
            ? args.task
            : typeof args.prompt === 'string'
              ? args.prompt
              : 'Coding task',
        badge: 'code',
      };
    case 'run_subagents': {
      const agents = Array.isArray(args.agents) ? args.agents : [];
      return {
        label: 'Subagent Swarm',
        Icon: Bot,
        summary: `${agents.length || 'Multi'}-agent mission`,
        badge: 'swarm',
      };
    }
    case 'code_interpreter':
      return {
        label: 'Code Interpreter',
        Icon: Code,
        summary:
          typeof args.language === 'string'
            ? args.language
            : 'Execute script',
        badge: 'eval',
      };
    case 'save_session_memory':
    case 'save_global_memory':
      return {
        label: 'Memory',
        Icon: Brain,
        summary:
          typeof args.key === 'string' ? `Saved: ${args.key}` : 'Remember',
        badge: 'memory',
      };
    case 'manage_schedule':
      return {
        label: 'Schedule',
        Icon: Clock,
        summary:
          typeof args.action === 'string'
            ? `${args.action} schedule`
            : 'Schedule task',
        badge: 'cron',
      };
    case 'read_space_page':
    case 'write_space_page':
    case 'list_authorized_spaces':
      return {
        label: 'Space Doc',
        Icon: FileText,
        summary:
          typeof args.title === 'string'
            ? args.title
            : typeof args.pageId === 'string'
              ? args.pageId
              : 'Document',
        badge: 'space',
      };
    default: {
      const readable = name
        .replace(/_/g, ' ')
        .replace(/\b\w/g, (c) => c.toUpperCase());
      const preview = Object.values(args).find((v) => typeof v === 'string') as
        | string
        | undefined;
      return {
        label: readable,
        Icon: Wrench,
        summary: preview ? String(preview).slice(0, 36) : name,
        badge: 'tool',
      };
    }
  }
}

export function CompactToolCard({
  name,
  toolCallId,
  args,
  result,
  status,
  running,
}: CompactToolRenderProps) {
  const [expanded, setExpanded] = useState(false);
  const [copied, setCopied] = useState(false);

  const parameters = computerToolResult(args);
  const data = computerToolResult(result);
  const { label, Icon, summary, badge } = getToolMeta(name, parameters);

  const hasResult = result !== undefined && result !== null;
  const isExecuting =
    status === 'inProgress' ||
    status === 'executing' ||
    (running && !hasResult);
  const failed =
    data.status === 'error' ||
    typeof data.error === 'string' ||
    (typeof data.exitCode === 'number' && data.exitCode !== 0);

  const rawOutput =
    typeof result === 'string'
      ? result
      : typeof data.output === 'string'
        ? data.output
        : typeof data.stdout === 'string' || typeof data.stderr === 'string'
          ? [data.stdout, data.stderr].filter(Boolean).join('\n')
          : typeof data.message === 'string'
            ? data.message
            : hasResult
              ? JSON.stringify(result, null, 2)
              : '';

  const copyContent = () => {
    const textToCopy = rawOutput || JSON.stringify(parameters, null, 2);
    if (!textToCopy) return;
    navigator.clipboard?.writeText(textToCopy).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  return (
    <div
      className={`compact-tool-card ${isExecuting ? 'is-executing' : ''} ${failed ? 'is-failed' : ''} ${expanded ? 'is-expanded' : ''}`}
      data-tool-id={toolCallId}
    >
      <button
        type="button"
        className="compact-tool-header"
        onClick={() => setExpanded(!expanded)}
        aria-expanded={expanded}
      >
        <div className="compact-tool-left">
          <span className={`compact-tool-icon-wrap ${badge}`}>
            <Icon size={13} aria-hidden="true" />
          </span>
          <span className="compact-tool-label">{label}</span>
          {summary && (
            <span className="compact-tool-summary" title={summary}>
              {summary}
            </span>
          )}
        </div>

        <div className="compact-tool-right">
          {isExecuting ? (
            <span className="compact-tool-status running">
              <Loader2 size={11} className="compact-tool-spin" />
              Running…
            </span>
          ) : failed ? (
            <span className="compact-tool-status failed">
              <AlertCircle size={11} />
              Failed
            </span>
          ) : (
            <span className="compact-tool-status complete">
              <CheckCircle2 size={11} />
              Done
            </span>
          )}
          <span className="compact-tool-chevron">
            {expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
          </span>
        </div>
      </button>

      {expanded && (
        <div className="compact-tool-body">
          {Object.keys(parameters).length > 0 && (
            <div className="compact-tool-section">
              <div className="compact-tool-section-head">
                <span>Input</span>
                <button
                  type="button"
                  className="compact-tool-copy"
                  onClick={copyContent}
                  title="Copy"
                >
                  {copied ? <Check size={12} /> : <Copy size={12} />}
                  <span>{copied ? 'Copied' : 'Copy'}</span>
                </button>
              </div>
              <pre className="compact-tool-code">
                {JSON.stringify(parameters, null, 2)}
              </pre>
            </div>
          )}

          {hasResult && (
            <div className="compact-tool-section">
              <div className="compact-tool-section-head">
                <span>Output</span>
                {!Object.keys(parameters).length && (
                  <button
                    type="button"
                    className="compact-tool-copy"
                    onClick={copyContent}
                    title="Copy output"
                  >
                    {copied ? <Check size={12} /> : <Copy size={12} />}
                    <span>{copied ? 'Copied' : 'Copy'}</span>
                  </button>
                )}
              </div>
              <pre className="compact-tool-code compact-tool-output">
                {rawOutput || '(Empty response)'}
              </pre>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
