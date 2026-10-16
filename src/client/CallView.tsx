import { useEffect, useRef, useState } from 'react';
import type {
  KeyboardEvent as ReactKeyboardEvent,
  PointerEvent as ReactPointerEvent,
} from 'react';
import {
  ChevronDown,
  Mic,
  MicOff,
  PhoneOff,
  Volume2,
  VolumeX,
  Maximize2,
  AudioLines,
  Check,
} from 'lucide-react';
import { Mascot } from './Mascot';
import { matchScreenCommand } from './voice-screen-commands';
import {
  supportsLiveVoiceChange,
  voicesForProvider,
} from '../shared/voice-catalog';
import type { Dot } from '../shared/types';
import type { useVoice } from './useVoice';

const CALL_POS_KEY = 'opendots:call-view-pos';
const EDGE_MARGIN = 12;
const DRAG_THRESHOLD = 4;

type CallPos = { x: number; y: number };

function loadPos(): CallPos | null {
  try {
    const raw = localStorage.getItem(CALL_POS_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<CallPos>;
    if (typeof parsed.x !== 'number' || typeof parsed.y !== 'number')
      return null;
    return { x: parsed.x, y: parsed.y };
  } catch {
    return null;
  }
}

function savePos(pos: CallPos) {
  try {
    localStorage.setItem(CALL_POS_KEY, JSON.stringify(pos));
  } catch {
    /* storage unavailable — the position just won't persist */
  }
}

export function CallView({
  dot,
  voice,
}: {
  dot: Dot;
  voice: ReturnType<typeof useVoice>;
}) {
  const [minimized, setMinimized] = useState(false);
  const [now, setNow] = useState(Date.now());
  const [pos, setPos] = useState<CallPos | null>(loadPos);
  const panelRef = useRef<HTMLElement | null>(null);
  const handledCaptionRef = useRef('');
  const [voiceMenuOpen, setVoiceMenuOpen] = useState(false);
  const voiceMenuRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!voiceMenuOpen) return;
    const outside = (e: PointerEvent) => {
      if (
        voiceMenuRef.current &&
        !voiceMenuRef.current.contains(e.target as Node)
      )
        setVoiceMenuOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setVoiceMenuOpen(false);
    };
    document.addEventListener('pointerdown', outside);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', outside);
      document.removeEventListener('keydown', onKey);
    };
  }, [voiceMenuOpen]);
  const dragRef = useRef<{
    pointerId: number;
    startX: number;
    startY: number;
    originLeft: number;
    originTop: number;
    width: number;
    height: number;
    moved: boolean;
  } | null>(null);
  useEffect(() => {
    if (voice.status !== 'active') return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [voice.status]);
  // Spoken screen commands: the user's caption arrives per utterance
  // (Gemini's can grow in chunks), so act once it settles. Each caption is
  // handled at most once — repeats of the same text don't re-fire.
  useEffect(() => {
    if (voice.status === 'idle') return;
    const text = voice.userCaption.trim();
    if (!text) return;
    const timer = setTimeout(() => {
      if (handledCaptionRef.current === text) return;
      handledCaptionRef.current = text;
      const command = matchScreenCommand(text);
      if (!command) return;
      if (command === 'minimize') setMinimized(true);
      else if (command === 'expand') setMinimized(false);
      else if (minimized) {
        const rect = panelRef.current?.getBoundingClientRect();
        const width = rect?.width ?? 300;
        const height = rect?.height ?? 180;
        const next = {
          x:
            command === 'left'
              ? EDGE_MARGIN
              : Math.max(EDGE_MARGIN, window.innerWidth - width - EDGE_MARGIN),
          y: Math.min(
            Math.max(pos?.y ?? rect?.top ?? 0, EDGE_MARGIN),
            Math.max(EDGE_MARGIN, window.innerHeight - height - EDGE_MARGIN),
          ),
        };
        setPos(next);
        savePos(next);
      }
    }, 450);
    return () => clearTimeout(timer);
  }, [voice.status, voice.userCaption, minimized, pos]);
  // Keep the floating pill inside the viewport if the window shrinks.
  useEffect(() => {
    if (!minimized || !pos) return;
    const onResize = () => {
      const panel = panelRef.current;
      if (!panel) return;
      const rect = panel.getBoundingClientRect();
      const x = Math.min(
        Math.max(pos.x, EDGE_MARGIN),
        Math.max(EDGE_MARGIN, window.innerWidth - rect.width - EDGE_MARGIN),
      );
      const y = Math.min(
        Math.max(pos.y, EDGE_MARGIN),
        Math.max(EDGE_MARGIN, window.innerHeight - rect.height - EDGE_MARGIN),
      );
      if (x !== pos.x || y !== pos.y) {
        const next = { x, y };
        setPos(next);
        savePos(next);
      }
    };
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, [minimized, pos]);
  if (voice.status === 'idle') return null;
  const seconds = voice.startedAt
    ? Math.max(0, Math.floor((now - voice.startedAt) / 1000))
    : 0;
  const duration = `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
  const label =
    voice.status === 'connecting'
      ? 'Connecting…'
      : voice.status === 'ending'
        ? 'Saving call…'
        : voice.muted
          ? 'Microphone muted'
          : voice.phase === 'speaking'
            ? `${dot.name} is speaking`
            : voice.phase === 'thinking'
              ? 'Working on it…'
              : 'Listening';

  const onHandlePointerDown = (event: ReactPointerEvent) => {
    if (!minimized || event.button !== 0) return;
    const panel = panelRef.current;
    if (!panel) return;
    const rect = panel.getBoundingClientRect();
    dragRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      originLeft: pos?.x ?? rect.left,
      originTop: pos?.y ?? rect.top,
      width: rect.width,
      height: rect.height,
      moved: false,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
  };
  const onHandlePointerMove = (event: ReactPointerEvent) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    const dx = event.clientX - drag.startX;
    const dy = event.clientY - drag.startY;
    if (!drag.moved && Math.hypot(dx, dy) < DRAG_THRESHOLD) return;
    drag.moved = true;
    setPos({
      x: Math.min(
        Math.max(drag.originLeft + dx, EDGE_MARGIN),
        Math.max(EDGE_MARGIN, window.innerWidth - drag.width - EDGE_MARGIN),
      ),
      y: Math.min(
        Math.max(drag.originTop + dy, EDGE_MARGIN),
        Math.max(EDGE_MARGIN, window.innerHeight - drag.height - EDGE_MARGIN),
      ),
    });
  };
  const onHandlePointerUp = (event: ReactPointerEvent) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    dragRef.current = null;
    if (!drag.moved) return;
    // Snap to the nearest horizontal edge so the pill rests left or right.
    const draggedX = drag.originLeft + (event.clientX - drag.startX);
    const draggedY = drag.originTop + (event.clientY - drag.startY);
    const left =
      draggedX + drag.width / 2 < window.innerWidth / 2
        ? EDGE_MARGIN
        : window.innerWidth - drag.width - EDGE_MARGIN;
    const next = {
      x: left,
      y: Math.min(
        Math.max(draggedY, EDGE_MARGIN),
        Math.max(EDGE_MARGIN, window.innerHeight - drag.height - EDGE_MARGIN),
      ),
    };
    setPos(next);
    savePos(next);
  };
  const onHandlePointerCancel = () => {
    dragRef.current = null;
    const panel = panelRef.current;
    if (!panel) return;
    const rect = panel.getBoundingClientRect();
    const next = {
      x: Math.min(
        Math.max(rect.left, EDGE_MARGIN),
        Math.max(EDGE_MARGIN, window.innerWidth - rect.width - EDGE_MARGIN),
      ),
      y: Math.min(
        Math.max(rect.top, EDGE_MARGIN),
        Math.max(EDGE_MARGIN, window.innerHeight - rect.height - EDGE_MARGIN),
      ),
    };
    setPos(next);
    savePos(next);
  };
  const onHandleKeyDown = (event: ReactKeyboardEvent) => {
    if (!minimized) return;
    const panel = panelRef.current;
    if (!panel) return;
    const rect = panel.getBoundingClientRect();
    const current = pos ?? { x: rect.left, y: rect.top };
    let next: CallPos | null = null;
    if (event.key === 'ArrowLeft')
      next = {
        x: EDGE_MARGIN,
        y: Math.min(
          Math.max(current.y, EDGE_MARGIN),
          Math.max(EDGE_MARGIN, window.innerHeight - rect.height - EDGE_MARGIN),
        ),
      };
    else if (event.key === 'ArrowRight')
      next = {
        x: Math.max(
          EDGE_MARGIN,
          window.innerWidth - rect.width - EDGE_MARGIN,
        ),
        y: Math.min(
          Math.max(current.y, EDGE_MARGIN),
          Math.max(EDGE_MARGIN, window.innerHeight - rect.height - EDGE_MARGIN),
        ),
      };
    else if (event.key === 'ArrowUp')
      next = {
        x: current.x,
        y: Math.max(EDGE_MARGIN, current.y - 40),
      };
    else if (event.key === 'ArrowDown')
      next = {
        x: current.x,
        y: Math.min(
          Math.max(EDGE_MARGIN, current.y + 40),
          Math.max(EDGE_MARGIN, window.innerHeight - rect.height - EDGE_MARGIN),
        ),
      };
    if (!next) return;
    event.preventDefault();
    setPos(next);
    savePos(next);
  };

  return (
    <section
      ref={panelRef}
      className={`call-view ${minimized ? 'minimized' : ''}`}
      aria-label={`Voice call with ${dot.name}`}
      style={
        minimized && pos
          ? { left: pos.x, top: pos.y, right: 'auto', bottom: 'auto' }
          : undefined
      }
    >
      <div className="call-heading">
        <span>
          <span className="call-live-dot" /> Voice call
        </span>
        <span className="call-heading-actions">
          <div className="call-voice-picker" ref={voiceMenuRef}>
            <button
              className="call-voice-button"
              aria-label="Change voice"
              aria-expanded={voiceMenuOpen}
              title={
                voice.voiceName
                  ? `Voice: ${voice.voiceName}`
                  : 'Change voice'
              }
              onClick={() => setVoiceMenuOpen((open) => !open)}
            >
              <AudioLines size={16} />
              {voice.voiceName && (
                <span className="call-voice-name">{voice.voiceName}</span>
              )}
            </button>
            {voiceMenuOpen && (
              <div className="call-voice-menu" role="menu">
                <p className="call-voice-menu-title">Voice</p>
                {voicesForProvider(voice.provider).map((name) => (
                  <button
                    key={name}
                    role="menuitemradio"
                    aria-checked={name === voice.voiceName}
                    className={name === voice.voiceName ? 'current' : ''}
                    onClick={() => {
                      setVoiceMenuOpen(false);
                      if (name !== voice.voiceName)
                        void voice.changeVoice(name);
                    }}
                  >
                    <span>{name}</span>
                    {name === voice.voiceName && <Check size={14} />}
                  </button>
                ))}
                <p className="call-voice-menu-note">
                  {supportsLiveVoiceChange(voice.provider)
                    ? 'Switches instantly during the call.'
                    : 'Applies on your next call.'}
                </p>
              </div>
            )}
          </div>
          <button
            className="call-minimize"
            aria-label={minimized ? 'Expand call view' : 'Minimize call view'}
            onClick={() => setMinimized(!minimized)}
          >
            {minimized ? <Maximize2 size={18} /> : <ChevronDown size={20} />}
          </button>
        </span>
      </div>
      <div
        className={`call-persona ${voice.phase}`}
        {...(minimized
          ? {
              tabIndex: 0,
              role: 'button',
              'aria-label':
                'Drag to move the call. Arrow keys move it left, right, up, or down.',
              onPointerDown: onHandlePointerDown,
              onPointerMove: onHandlePointerMove,
              onPointerUp: onHandlePointerUp,
              onPointerCancel: onHandlePointerCancel,
              onKeyDown: onHandleKeyDown,
            }
          : {})}
      >
        <Mascot identity={dot.id} name={dot.name} />
        <h2>{dot.name}</h2>
        <span className="call-timer" aria-label="Call duration">
          {duration}
        </span>
        <p role="status">{label}</p>
      </div>
      {!minimized && (
        <div className="call-caption" aria-live="polite">
          {voice.userCaption && (
            <p className="call-user-caption">
              <small>You</small>
              {voice.userCaption}
            </p>
          )}
          <p>
            <small>{dot.name}</small>
            {voice.caption || 'Speak naturally. Your Dot is here with you.'}
          </p>
        </div>
      )}
      {voice.error && (
        <p className="call-warning" role="alert">
          {voice.error}
        </p>
      )}
      <div className="call-controls">
        <button
          aria-label={
            voice.speakerMuted ? 'Enable call audio' : 'Mute call audio'
          }
          aria-pressed={voice.speakerMuted}
          onClick={voice.toggleSpeaker}
          disabled={voice.status !== 'active'}
        >
          <span>{voice.speakerMuted ? <VolumeX /> : <Volume2 />}</span>
          <small>Speaker</small>
        </button>
        <button
          className="call-end"
          aria-label="End voice call"
          onClick={() => void voice.end()}
          disabled={voice.status === 'ending'}
        >
          <span>
            <PhoneOff />
          </span>
          <small>End</small>
        </button>
        <button
          aria-label={voice.muted ? 'Unmute microphone' : 'Mute microphone'}
          aria-pressed={voice.muted}
          onClick={voice.toggleMute}
          disabled={voice.status !== 'active'}
        >
          <span>{voice.muted ? <MicOff /> : <Mic />}</span>
          <small>{voice.muted ? 'Unmute' : 'Mute'}</small>
        </button>
      </div>
      {!minimized && (
        <p className="call-footer">Text and voice share this conversation</p>
      )}
    </section>
  );
}
