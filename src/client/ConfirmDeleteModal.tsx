import { useEffect, useRef, useState } from 'react';
import { X } from 'lucide-react';

export interface ConfirmDeleteModalProps {
  isOpen: boolean;
  title: string;
  description: string;
  itemTitle?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  onConfirm: () => void | Promise<void>;
  onClose: () => void;
}

export function ConfirmDeleteModal({
  isOpen,
  title,
  description,
  itemTitle,
  confirmLabel = 'Delete',
  cancelLabel = 'Cancel',
  onConfirm,
  onClose,
}: ConfirmDeleteModalProps) {
  const [busy, setBusy] = useState(false);
  const cardRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        if (!busy) onClose();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, busy, onClose]);

  if (!isOpen) return null;

  const handleConfirm = async () => {
    try {
      setBusy(true);
      await onConfirm();
      onClose();
    } catch {
      // Keep open if failed
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      className="confirm-modal-backdrop"
      onClick={(e) => {
        if (e.target === e.currentTarget && !busy) {
          onClose();
        }
      }}
      role="dialog"
      aria-modal="true"
      aria-labelledby="confirm-modal-title"
    >
      <div className="confirm-modal-card" ref={cardRef}>
        <button
          className="confirm-modal-close"
          onClick={onClose}
          disabled={busy}
          aria-label="Close dialog"
        >
          <X size={16} />
        </button>

        <div className="confirm-modal-header">
          <h2 id="confirm-modal-title" className="confirm-modal-title">
            {title}
          </h2>
        </div>

        <p className="confirm-modal-desc">{description}</p>

        {itemTitle && (
          <div className="confirm-modal-item-preview">
            <span className="confirm-modal-item-title">{itemTitle}</span>
          </div>
        )}

        <div className="confirm-modal-actions">
          <button
            type="button"
            className="confirm-modal-btn confirm-modal-btn-cancel"
            onClick={onClose}
            disabled={busy}
          >
            {cancelLabel}
          </button>
          <button
            type="button"
            className="confirm-modal-btn confirm-modal-btn-delete"
            onClick={handleConfirm}
            disabled={busy}
          >
            {busy ? 'Deleting…' : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
