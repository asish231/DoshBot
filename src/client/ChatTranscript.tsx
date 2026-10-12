import { openPageLink } from './page-navigation';
import { useRef, useState, type ReactNode } from 'react';
import { PhoneOff } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import type { AssistantMessage, Message } from '@ag-ui/core';
import type { CallReceipt } from '../shared/types';
import { voiceReceiptMessagePrefix } from '../shared/voice-receipt';
// These markers only control rendering; they do not confer trust or permissions.
export function isInternalVoiceReceipt(message: Message): boolean {
  const metadata = message.metadata;
  return (
    message.role === 'user' &&
    (message.id.startsWith(voiceReceiptMessagePrefix) ||
      (!!metadata &&
        typeof metadata === 'object' &&
        'opendotsSource' in metadata &&
        metadata.opendotsSource === 'voice_receipt'))
  );
}
function Receipt({ call }: { call: CallReceipt }) {
  return (
    <div className="call-receipt">
      <PhoneOff size={13} />
      <span>
        {call.status === 'failed'
          ? 'Call failed'
          : call.endedAt
            ? `${Math.round((call.endedAt - call.startedAt) / 1000)}s · Call ended`
            : 'Call in progress'}
      </span>
      {call.error && <small>{call.error}</small>}
    </div>
  );
}
export function ChatTranscript({
  messages,
  calls,
  renderTools,
  onFork,
  onEdit,
  onRevert,
}: {
  messages: Message[];
  calls: CallReceipt[];
  renderTools?: (message: AssistantMessage) => ReactNode;
  onFork?: (messageId: string) => void;
  onEdit?: (messageId: string, content: string) => void;
  onRevert?: (messageId: string) => void;
}) {
  const ids = new Set(messages.map((message) => message.id));
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState('');
  const editing = useRef<{
    id: string;
    onEdit: (messageId: string, content: string) => void;
  } | null>(null);
  const copy = async (message: Message) => {
    const text = typeof message.content === 'string' ? message.content : '';
    try {
      await navigator.clipboard.writeText(text);
      setCopiedId(message.id);
      setTimeout(() => setCopiedId((id) => (id === message.id ? null : id)), 1800);
    } catch {
      /* clipboard unavailable (permissions/insecure context) */
    }
  };
  const startEdit = (
    message: Message,
    handler: (messageId: string, content: string) => void,
  ) => {
    setEditingId(message.id);
    setEditDraft(typeof message.content === 'string' ? message.content : '');
    editing.current = { id: message.id, onEdit: handler };
  };
  const submitEdit = () => {
    const current = editing.current;
    if (current && editDraft.trim()) {
      current.onEdit(current.id, editDraft.trim());
    }
    editing.current = null;
    setEditingId(null);
    setEditDraft('');
  };
  const cancelEdit = () => {
    editing.current = null;
    setEditingId(null);
    setEditDraft('');
  };
  return (
    <>
      {calls
        .filter(
          (call) => !call.anchorMessageId || !ids.has(call.anchorMessageId),
        )
        .map((call) => (
          <Receipt key={call.id} call={call} />
        ))}
      {messages.map((message) => {
        const text = typeof message.content === 'string' ? message.content : '';
        if (editingId === message.id) {
          return (
            <div key={message.id} className={`chat-bubble ${message.role} editing`}>
              <textarea
                className="chat-edit-input"
                value={editDraft}
                rows={Math.min(12, Math.max(2, editDraft.split('\n').length))}
                onChange={(e) => setEditDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Escape') {
                    e.preventDefault();
                    cancelEdit();
                  }
                  if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                    e.preventDefault();
                    submitEdit();
                  }
                }}
                aria-label="Edit message"
              />
              <div className="chat-edit-actions">
                <button
                  type="button"
                  className="chat-edit-save"
                  onClick={submitEdit}
                  disabled={!editDraft.trim()}
                >
                  Save &amp; resend
                </button>
                <button type="button" className="chat-edit-cancel" onClick={cancelEdit}>
                  Cancel
                </button>
                <small className="chat-edit-hint">
                  Turns after this message will be removed — fork first to keep them.
                </small>
              </div>
            </div>
          );
        }
        return (
          <div key={message.id} className="chat-message-wrap">
            {text.trim() && (
              <div className={`chat-bubble ${message.role}`}>
                <ReactMarkdown
                  remarkPlugins={[remarkGfm]}
                  components={{
                    img: ({ alt }) => <span>{alt}</span>,
                    a: ({ href, children }) => (
                      <a
                        onClick={(event) => {
                          if (href?.startsWith('/#/spaces/')) {
                            event.preventDefault();
                            openPageLink(href);
                          }
                        }}
                        href={href}
                        target={
                          href?.startsWith('/#/spaces/') ? undefined : '_blank'
                        }
                        rel="noreferrer"
                      >
                        {children}
                      </a>
                    ),
                    table: ({ children }) => (
                      <div className="table-container">
                        <table>{children}</table>
                      </div>
                    ),
                  }}
                >
                  {text}
                </ReactMarkdown>
              </div>
            )}
            {text.trim() && (
              <div className="chat-message-actions" data-role={message.role}>
                <button
                  type="button"
                  aria-label="Copy message"
                  title="Copy"
                  onClick={() => void copy(message)}
                >
                  {copiedId === message.id ? 'Copied!' : '⧉'}
                </button>
                {message.role === 'user' && onEdit && (
                  <button
                    type="button"
                    aria-label="Edit message"
                    title="Edit (drops turns after it)"
                    onClick={() => startEdit(message, onEdit)}
                  >
                    ✎
                  </button>
                )}
                {onFork && (
                  <button
                    type="button"
                    aria-label={`Fork conversation from this message`}
                    title={`Fork from here — new chat carrying history up to this message${
                      message.role === 'user' ? ' (safe before editing)' : ''
                    }`}
                    onClick={() => onFork(message.id)}
                  >
                    ⑂
                  </button>
                )}
                {onRevert && (
                  <button
                    type="button"
                    aria-label="Revert conversation to this message"
                    title="Revert to here — drops later turns in THIS chat (fork first to keep them)"
                    onClick={() => onRevert(message.id)}
                  >
                    ↩
                  </button>
                )}
              </div>
            )}
            {message.role === 'assistant' && renderTools?.(message)}
            {calls
              .filter((call) => call.anchorMessageId === message.id)
              .map((call) => (
                <Receipt key={call.id} call={call} />
              ))}
          </div>
        );
      })}
    </>
  );
}
