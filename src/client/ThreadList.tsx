import { useState } from 'react';
import { useThreads } from '@copilotkit/react-core/v2';
import { MessageCircle, Plus, Trash2 } from 'lucide-react';
import type { Conversation, Dot } from '../shared/types';
import { ConfirmDeleteModal } from './ConfirmDeleteModal';

export function ThreadList({
  dots,
  dotId,
  local,
  selected,
  onSelect,
  onNew,
  onDelete,
  onClearAll,
}: {
  dots: Dot[];
  dotId: string;
  local: Conversation[];
  selected?: string;
  onSelect: (id: string) => void;
  onNew: () => void;
  onDelete?: (id: string) => void;
  onClearAll?: () => void;
}) {
  const [deleteTarget, setDeleteTarget] = useState<{ id: string; title: string } | null>(null);
  const [confirmClearAll, setConfirmClearAll] = useState(false);

  const threads = useThreads({
    agentId: dotId,
    enabled: true,
    includeArchived: false,
    limit: 20,
  });

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
        return (
          <div
            key={thread.id}
            className={`thread-row ${isActive ? 'active' : ''}`}
          >
            <button
              className={`nav-item thread-main-btn ${isActive ? 'active' : ''}`}
              onClick={() => onSelect(thread.id)}
            >
              <MessageCircle size={15} />
              <span className="thread-summary">
                <span>{remote?.name || thread.title}</span>
                <small>{dots.find((dot) => dot.id === thread.dotId)?.name}</small>
              </span>
            </button>
            {onDelete && (
              <button
                type="button"
                className="thread-delete-btn"
                title="Delete this session"
                aria-label="Delete this session"
                onClick={(e) => {
                  e.stopPropagation();
                  setDeleteTarget({ id: thread.id, title: thread.title });
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
