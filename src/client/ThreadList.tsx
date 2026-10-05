import { useEffect, useState } from 'react';
import { useThreads } from '@copilotkit/react-core/v2';
import { MessageCircle, Pencil, Plus, Trash2 } from 'lucide-react';
import type { Conversation, Dot } from '../shared/types';
import { ConfirmDeleteModal } from './ConfirmDeleteModal';

export function ThreadList({
  dots,
  dotId,
  local,
  selected,
  onSelect,
  onNew,
  onRename,
  onDelete,
  onClearAll,
}: {
  dots: Dot[];
  dotId: string;
  local: Conversation[];
  selected?: string;
  onSelect: (id: string) => void;
  onNew: () => void;
  onRename?: (id: string, title: string) => void;
  onDelete?: (id: string) => void;
  onClearAll?: () => void;
}) {
  const [deleteTarget, setDeleteTarget] = useState<{ id: string; title: string } | null>(null);
  const [confirmClearAll, setConfirmClearAll] = useState(false);
  const [menu, setMenu] = useState<{ id: string; title: string; x: number; y: number } | null>(null);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameDraft, setRenameDraft] = useState('');

  const threads = useThreads({
    agentId: dotId,
    enabled: true,
    includeArchived: false,
    limit: 20,
  });

  useEffect(() => {
    if (!menu) return;
    const close = () => setMenu(null);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setMenu(null);
    };
    document.addEventListener('click', close);
    window.addEventListener('blur', close);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('click', close);
      window.removeEventListener('blur', close);
      document.removeEventListener('keydown', onKey);
    };
  }, [menu]);

  const startRename = (id: string, title: string) => {
    setMenu(null);
    setRenamingId(id);
    setRenameDraft(title);
  };

  const commitRename = (id: string, original: string) => {
    const title = renameDraft.trim();
    setRenamingId(null);
    if (title && title !== original && onRename) onRename(id, title);
  };

  return (
    <section className="thread-list">
      <div className="nav-label" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <span>RECENT CHATS</span>
        <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
          {local.length > 0 && onClearAll && (
            <button
              className="icon-button"
              onClick={() => setConfirmClearAll(true)}
              title="Clear all conversations"
              aria-label="Clear all conversations"
            >
              <Trash2 size={13} />
            </button>
          )}
          <button
            className="icon-button"
            onClick={onNew}
            title="New conversation"
            aria-label="New conversation"
          >
            <Plus size={14} />
          </button>
        </div>
      </div>
      {threads.error && (
        <p className="sidebar-error">
          Conversation sync unavailable. Check your runtime connection.
        </p>
      )}
      {local.map((thread) => {
        const remote = threads.threads.find((item) => item.id === thread.id);
        const isActive = selected === thread.id;
        const title = remote?.name || thread.title;
        const renaming = renamingId === thread.id;
        return (
          <div
            key={thread.id}
            className={`thread-row ${isActive ? 'active' : ''}`}
            onContextMenu={(e) => {
              e.preventDefault();
              e.stopPropagation();
              setMenu({
                id: thread.id,
                title,
                x: Math.min(e.clientX, window.innerWidth - 180),
                y: Math.min(e.clientY, window.innerHeight - 110),
              });
            }}
          >
            <button
              className={`nav-item thread-main-btn ${isActive ? 'active' : ''}`}
              onClick={() => onSelect(thread.id)}
            >
              <MessageCircle size={15} />
              <span className="thread-summary">
                {renaming ? (
                  <input
                    autoFocus
                    value={renameDraft}
                    maxLength={120}
                    aria-label="Rename conversation"
                    onChange={(e) => setRenameDraft(e.target.value)}
                    onClick={(e) => e.stopPropagation()}
                    onKeyDown={(e) => {
                      e.stopPropagation();
                      if (e.key === 'Enter') commitRename(thread.id, title);
                      if (e.key === 'Escape') setRenamingId(null);
                    }}
                    onBlur={() => commitRename(thread.id, title)}
                    style={{ font: 'inherit', width: '100%', padding: '2px 6px' }}
                  />
                ) : (
                  <span>{title}</span>
                )}
                <small>{dots.find((dot) => dot.id === thread.dotId)?.name}</small>
              </span>
            </button>
            {onDelete && !renaming && (
              <button
                type="button"
                className="thread-delete-btn"
                title="Delete this session"
                aria-label="Delete this session"
                onClick={(e) => {
                  e.stopPropagation();
                  setDeleteTarget({ id: thread.id, title });
                }}
              >
                <Trash2 size={13} />
              </button>
            )}
          </div>
        );
      })}
      {!local.length && (
        <p className="sidebar-empty">Your first conversation will live here.</p>
      )}
      {threads.hasMoreThreads && (
        <button
          className="text-button"
          disabled={threads.isFetchingMoreThreads}
          onClick={() => void threads.fetchMoreThreads()}
        >
          Load more conversations
        </button>
      )}

      {menu && (
        <div
          className="thread-context-menu"
          role="menu"
          aria-label="Session options"
          style={{ left: menu.x, top: menu.y }}
          onClick={(e) => e.stopPropagation()}
          onContextMenu={(e) => e.preventDefault()}
        >
          {onRename && (
            <button type="button" role="menuitem" onClick={() => startRename(menu.id, menu.title)}>
              <Pencil size={13} /> Rename
            </button>
          )}
          {onDelete && (
            <button
              type="button"
              role="menuitem"
              className="danger"
              onClick={() => {
                setMenu(null);
                setDeleteTarget({ id: menu.id, title: menu.title });
              }}
            >
              <Trash2 size={13} /> Delete
            </button>
          )}
        </div>
      )}

      {/* Delete Single Chat Modal */}
      <ConfirmDeleteModal
        isOpen={!!deleteTarget}
        title="Delete chat?"
        description="This will permanently delete this conversation and its history. This action cannot be undone."
        itemTitle={deleteTarget?.title}
        confirmLabel="Delete"
        cancelLabel="Cancel"
        onClose={() => setDeleteTarget(null)}
        onConfirm={() => {
          if (deleteTarget && onDelete) {
            onDelete(deleteTarget.id);
          }
        }}
      />

      {/* Clear All Chats Modal */}
      <ConfirmDeleteModal
        isOpen={confirmClearAll}
        title="Clear all chats?"
        description="This will permanently delete all chat conversations in this workspace. This action cannot be undone."
        confirmLabel="Clear all"
        cancelLabel="Cancel"
        onClose={() => setConfirmClearAll(false)}
        onConfirm={() => {
          if (onClearAll) {
            onClearAll();
          }
        }}
      />
    </section>
  );
}
