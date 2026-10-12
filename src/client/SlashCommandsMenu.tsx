import { useEffect, useRef } from 'react';

export interface SlashCommand {
  id: string;
  command: string;
  name: string;
  description: string;
  placeholder?: string;
  category: 'execution' | 'context' | 'automation' | 'tools';
  immediate?: boolean;
}

export const SLASH_COMMANDS: SlashCommand[] = [
  {
    id: 'goal',
    command: '/goal',
    name: 'Goal Mode',
    description:
      'Long-horizon autonomous execution with deep thinking until completion',
    placeholder: '/goal Build and verify ',
    category: 'execution',
  },
  {
    id: 'code',
    command: '/code',
    name: 'Code Mode',
    description: 'Inspect, edit, and run bash commands in local directory',
    placeholder: '/code ',
    category: 'execution',
  },
  {
    id: 'plan',
    command: '/plan',
    name: 'Plan Mode',
    description: 'Structured step-by-step breakdown with milestones and checks',
    placeholder: '/plan ',
    category: 'execution',
  },
  {
    id: 'init',
    command: '/init',
    name: 'Init Workspace',
    description:
      'Create or update an AGENTS.md instructions file for the connected workspace',
    placeholder: '/init ',
    category: 'execution',
  },
  {
    id: 'review',
    command: '/review',
    name: 'Code Review',
    description:
      'Review current changes or given files with severity-ranked findings',
    placeholder: '/review ',
    category: 'execution',
  },
  {
    id: 'undo',
    command: '/undo',
    name: 'Undo Changes',
    description:
      'Show the most recent workspace edits and revert them after approval',
    placeholder: '/undo ',
    category: 'execution',
  },
  {
    id: 'compact',
    command: '/compact',
    name: 'Compact Context',
    description:
      'Summarize past conversation turns to free token context window',
    category: 'context',
    immediate: true,
  },
  {
    id: 'memory',
    command: '/memory',
    name: 'Remember Note',
    description:
      'Save note to session or global memory (/memory [session] or /memory [global])',
    placeholder: '/memory [session] ',
    category: 'context',
  },
  {
    id: 'subagents',
    command: '/subagents',
    name: 'Subagent Swarm',
    description:
      'Hire up to 50 specialist subagents in parallel and merge results',
    category: 'tools',
  },
  {
    id: 'mcp',
    command: '/mcp',
    name: 'MCP Servers',
    description: 'Configure and inspect local stdio and remote MCP servers',
    category: 'tools',
    immediate: true,
  },
  {
    id: 'schedule',
    command: '/schedule',
    name: 'Schedule Automation',
    description: 'Run recurring task or scheduled background workflow',
    placeholder: '/schedule 3600 ',
    category: 'automation',
  },
  {
    id: 'tasks',
    command: '/tasks',
    name: 'My Tasks',
    description: 'Open the Tasks view to inspect runs, schedules, and drafts',
    category: 'automation',
    immediate: true,
  },
  {
    id: 'search',
    command: '/search',
    name: 'Web Research',
    description: 'Query live web sources with citation synthesis',
    placeholder: '/search ',
    category: 'tools',
  },
  {
    id: 'browse',
    command: '/browse',
    name: 'Browser Agent',
    description: 'Navigate to URL and interact via isolated browser container',
    placeholder: '/browse https://',
    category: 'tools',
  },
  {
    id: 'clear',
    command: '/clear',
    name: 'Clear Chat',
    description: 'Reset current chat messages and start fresh',
    category: 'context',
    immediate: true,
  },
  {
    id: 'model',
    command: '/model',
    name: 'Switch Model',
    description: 'Open model settings to change the Dot or OpenCode model',
    category: 'tools',
    immediate: true,
  },
  {
    id: 'new',
    command: '/new',
    name: 'New Chat',
    description: 'Start a fresh conversation with this Dot',
    category: 'context',
    immediate: true,
  },
  {
    id: 'help',
    command: '/help',
    name: 'Help & Commands',
    description: 'Display quick reference guide of all available commands',
    category: 'tools',
    immediate: true,
  },
];

export interface SlashCommandsMenuProps {
  filter: string;
  selectedIndex: number;
  onSelect: (command: SlashCommand) => void;
  onClose: () => void;
  commands?: SlashCommand[];
}

export function SlashCommandsMenu({
  filter,
  selectedIndex,
  onSelect,
  onClose,
  commands = SLASH_COMMANDS,
}: SlashCommandsMenuProps) {
  const menuRef = useRef<HTMLDivElement>(null);

  // Filter commands by input
  const query = filter.startsWith('/')
    ? filter.slice(1).toLowerCase()
    : filter.toLowerCase();
  const filtered = commands.filter(
    (cmd) =>
      cmd.command.toLowerCase().includes(query) ||
      cmd.name.toLowerCase().includes(query) ||
      cmd.description.toLowerCase().includes(query),
  );

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  if (filtered.length === 0) return null;

  return (
    <div
      className="slash-commands-menu"
      ref={menuRef}
      role="listbox"
      aria-label="Slash commands"
    >
      <div className="slash-menu-header">
        <span className="slash-menu-title">Commands</span>
        <span className="slash-menu-badge">DoshBot by SafarNow</span>
      </div>
      <div className="slash-menu-list">
        {filtered.map((item, index) => {
          const isSelected =
            index === Math.min(selectedIndex, filtered.length - 1);
          return (
            <div
              key={item.id}
              role="option"
              aria-selected={isSelected}
              className={`slash-menu-item ${isSelected ? 'active' : ''}`}
              onMouseDown={(e) => {
                e.preventDefault(); // keep textarea focus
                onSelect(item);
              }}
            >
              <div className="slash-item-body">
                <div className="slash-item-top">
                  <span className="slash-item-cmd">{item.command}</span>
                  <span className="slash-item-name">{item.name}</span>
                  <span className="slash-item-tag">{item.category}</span>
                </div>
                <div className="slash-item-desc">{item.description}</div>
              </div>
            </div>
          );
        })}
      </div>
      <div className="slash-menu-footer">
        <span>
          Use <kbd>↑</kbd>
          <kbd>↓</kbd> to navigate, <kbd>Enter</kbd> or <kbd>Tab</kbd> to
          select, <kbd>Esc</kbd> to close
        </span>
      </div>
    </div>
  );
}
