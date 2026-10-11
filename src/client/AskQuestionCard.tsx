import { useState } from 'react';
import { askQuestionSchema } from '../shared/ask-question';

export interface AskQuestionCardProps {
  args: unknown;
  status: string;
  result?: unknown;
  respond?: (result: unknown) => Promise<void>;
  toolCallId?: string;
}

export function AskQuestionCard({
  args,
  status,
  result,
  respond,
}: AskQuestionCardProps) {
  const parsed = askQuestionSchema.safeParse(args);
  const isComplete = status === 'complete' || Boolean(result);

  const [selected, setSelected] = useState<string[]>([]);
  const [customInput, setCustomInput] = useState('');
  const [busy, setBusy] = useState(false);

  if (!parsed.success) {
    return (
      <div className="ask-question-card">
        <div className="ask-question-header">
          <span className="ask-question-label">Question</span>
        </div>
        <p className="ask-question-text">Invalid question parameters.</p>
      </div>
    );
  }

  const { question, options, is_multi_select, context } = parsed.data;

  // If completed, read saved result
  let recordedAnswer = '';
  if (result) {
    if (typeof result === 'string') {
      recordedAnswer = result;
    } else if (typeof result === 'object' && result !== null) {
      const record = result as Record<string, unknown>;
      recordedAnswer =
        (typeof record.answer === 'string' && record.answer) ||
        (Array.isArray(record.selected)
          ? record.selected.join(', ')
          : JSON.stringify(result));
    }
  }

  const handleToggleOption = (opt: string) => {
    if (isComplete || busy) return;
    if (is_multi_select) {
      if (selected.includes(opt)) {
        setSelected(selected.filter((item) => item !== opt));
      } else {
        setSelected([...selected, opt]);
      }
    } else {
      setSelected([opt]);
    }
  };

  const handleSubmit = async () => {
    if (!respond || isComplete || busy) return;
    if (selected.length === 0 && !customInput.trim()) return;

    setBusy(true);
    try {
      const parts: string[] = [];
      if (selected.length > 0) {
        parts.push(selected.join(', '));
      }
      if (customInput.trim()) {
        parts.push(`Note: ${customInput.trim()}`);
      }
      const finalAnswer = parts.join('; ');

      await respond({
        question,
        selected,
        customAnswer: customInput.trim() || undefined,
        answer: finalAnswer,
      });
    } catch {
      // Keep open if error
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      className="ask-question-card"
      role="region"
      aria-label="Question from agent"
    >
      <div className="ask-question-header">
        <span className="ask-question-label">Question</span>
        <span className="ask-question-badge">
          {isComplete
            ? 'Answered'
            : is_multi_select
              ? 'Multi-choice'
              : 'Select one'}
        </span>
      </div>

      <div className="ask-question-body">
        <h3 className="ask-question-text">{question}</h3>
        {context && <p className="ask-question-context">{context}</p>}

        {isComplete ? (
          <div className="ask-question-completed">
            <span className="ask-question-completed-label">Your decision:</span>
            <div className="ask-question-completed-answer">
              {recordedAnswer ||
                selected.join(', ') ||
                customInput ||
                'Answer submitted'}
            </div>
          </div>
        ) : (
          <>
            <div className="ask-question-options">
              {options.map((opt, idx) => {
                const isChecked = selected.includes(opt);
                return (
                  <button
                    key={idx}
                    type="button"
                    className={`ask-question-option ${isChecked ? 'active' : ''}`}
                    onClick={() => handleToggleOption(opt)}
                    disabled={busy}
                  >
                    <span className="ask-question-option-indicator">
                      {is_multi_select ? (
                        <span
                          className={`ask-question-box ${isChecked ? 'checked' : ''}`}
                        />
                      ) : (
                        <span
                          className={`ask-question-radio ${isChecked ? 'checked' : ''}`}
                        />
                      )}
                    </span>
                    <span className="ask-question-option-text">{opt}</span>
                  </button>
                );
              })}
            </div>

            <div className="ask-question-custom">
              <input
                type="text"
                className="ask-question-input"
                placeholder="Or type custom response…"
                value={customInput}
                onChange={(e) => setCustomInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    void handleSubmit();
                  }
                }}
                disabled={busy}
              />
            </div>

            <div className="ask-question-actions">
              <button
                type="button"
                className="ask-question-submit"
                onClick={() => void handleSubmit()}
                disabled={
                  busy || (selected.length === 0 && !customInput.trim())
                }
              >
                {busy ? 'Submitting…' : 'Submit Answer'}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
