import { useCallback, useEffect, useRef, useState } from 'react';
import { api, authHeaders } from './api';

function resampleTo16k(
  audioData: Float32Array,
  inputSampleRate: number,
): Int16Array {
  if (inputSampleRate === 16000) {
    const pcm16 = new Int16Array(audioData.length);
    for (let i = 0; i < audioData.length; i++) {
      const s = Math.max(-1, Math.min(1, audioData[i]));
      pcm16[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
    }
    return pcm16;
  }
  const ratio = inputSampleRate / 16000;
  const newLength = Math.round(audioData.length / ratio);
  const pcm16 = new Int16Array(newLength);
  for (let i = 0; i < newLength; i++) {
    const origIndex = i * ratio;
    const index1 = Math.floor(origIndex);
    const index2 = Math.min(index1 + 1, audioData.length - 1);
    const frac = origIndex - index1;
    const interpolated =
      audioData[index1] * (1 - frac) + audioData[index2] * frac;
    const s = Math.max(-1, Math.min(1, interpolated));
    pcm16[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
  }
  return pcm16;
}

function int16ToBase64(int16Array: Int16Array): string {
  const bytes = new Uint8Array(
    int16Array.buffer,
    int16Array.byteOffset,
    int16Array.byteLength,
  );
  let binary = '';
  const chunkSize = 8192;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const chunk = bytes.subarray(i, i + chunkSize);
    binary += String.fromCharCode.apply(null, Array.from(chunk));
  }
  return btoa(binary);
}

function base64ToInt16(base64: string): Int16Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return new Int16Array(bytes.buffer);
}

function pcm16ToFloat32(int16: Int16Array): Float32Array {
  const float32 = new Float32Array(int16.length);
  for (let i = 0; i < int16.length; i++) {
    float32[i] = int16[i] / 32768.0;
  }
  return float32;
}

type SessionData =
  | {
      type: 'webrtc';
      pc: RTCPeerConnection;
      stream: MediaStream;
      audio: HTMLAudioElement;
      id?: string;
      channel: RTCDataChannel;
      transcript: string[];
      timer?: ReturnType<typeof setTimeout>;
      cancelled: boolean;
    }
  | {
      type: 'gemini-live';
      ws: WebSocket;
      stream: MediaStream;
      audioContext: AudioContext;
      processor?: ScriptProcessorNode;
      speakerGain?: GainNode;
      activeSources: AudioBufferSourceNode[];
      id?: string;
      transcript: string[];
      timer?: ReturnType<typeof setTimeout>;
      cancelled: boolean;
    };

export function useVoice(
  threadId: string,
  onSaved: () => void,
  anchorMessageId?: string,
) {
  const [status, setStatus] = useState<
    'idle' | 'connecting' | 'active' | 'ending'
  >('idle');
  const generation = useRef(0);
  const connecting = useRef(false);
  const ending = useRef(false);
  const [error, setError] = useState('');
  const [muted, setMuted] = useState(false);
  const mutedRef = useRef(false);
  const [speakerMuted, setSpeakerMuted] = useState(false);
  const speakerMutedRef = useRef(false);
  const [startedAt, setStartedAt] = useState<number>();
  const [phase, setPhase] = useState<'listening' | 'speaking' | 'thinking'>(
    'listening',
  );
  const [caption, setCaption] = useState('');
  const [userCaption, setUserCaption] = useState('');
  const session = useRef<SessionData | undefined>(undefined);
  const anchor = useRef(anchorMessageId);
  anchor.current = anchorMessageId;

  const closeMedia = useCallback(() => {
    const current = session.current;
    if (!current) return;
    current.cancelled = true;
    current.stream.getTracks().forEach((track) => track.stop());
    clearTimeout(current.timer);

    if (current.type === 'webrtc') {
      current.channel.close();
      current.pc.close();
      current.audio.pause();
      current.audio.srcObject = null;
    } else if (current.type === 'gemini-live') {
      for (const src of current.activeSources) {
        try {
          src.stop();
        } catch {}
      }
      current.activeSources = [];
      try {
        current.processor?.disconnect();
      } catch {}
      void current.audioContext.close().catch(() => {});
      if (
        current.ws.readyState === WebSocket.OPEN ||
        current.ws.readyState === WebSocket.CONNECTING
      ) {
        current.ws.close();
      }
    }
  }, []);

  const end = useCallback(async () => {
    if (ending.current) return;
    generation.current++;
    connecting.current = false;
    const current = session.current;
    if (!current) {
      setStatus('idle');
      return;
    }
    // Silence the call immediately
    current.cancelled = true;
    current.stream.getTracks().forEach((track) => {
      track.enabled = false;
    });
    if (current.type === 'webrtc') {
      current.audio.pause();
    } else if (current.type === 'gemini-live') {
      for (const src of current.activeSources) {
        try {
          src.stop();
        } catch {}
      }
      current.activeSources = [];
      if (current.ws.readyState === WebSocket.OPEN) {
        try {
          current.ws.send(JSON.stringify({ type: 'hangup' }));
        } catch {}
      }
    }
    clearTimeout(current.timer);
    ending.current = true;
    setStatus('ending');
    try {
      if (current.id)
        await api(`/voice/calls/${current.id}/end`, 'POST', {
          transcript: current.transcript.join('\n').slice(0, 20000),
          anchorMessageId: anchor.current,
        });
      onSaved();
    } catch (e) {
      setError(
        e instanceof Error
          ? e.message
          : 'Call ended, but its receipt could not be saved.',
      );
    } finally {
      closeMedia();
      session.current = undefined;
      ending.current = false;
      setStatus('idle');
    }
  }, [closeMedia, onSaved]);

  useEffect(
    () => () => {
      generation.current++;
      const current = session.current;
      closeMedia();
      if (current?.id && !ending.current)
        void fetch(`/api/voice/calls/${current.id}/end`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ...authHeaders() },
          body: JSON.stringify({
            transcript: current.transcript.join('\n').slice(0, 20000),
            anchorMessageId: anchor.current,
          }),
          keepalive: true,
        }).catch(() => {});
    },
    [closeMedia],
  );

  useEffect(() => {
    if (status !== 'active' && status !== 'connecting') return;
    const timer = setInterval(() => {
      const current = session.current;
      const id = current?.id;
      if (id)
        void api<{ endedAt: number | null }>(`/voice/calls/${id}`)
          .then((call) => {
            if (session.current === current && call.endedAt) void end();
          })
          .catch(() => {
            if (session.current !== current) return;
            setError('Call control connection was lost.');
            void end();
          });
    }, 2000);
    return () => clearInterval(timer);
  }, [status, closeMedia, onSaved, end]);

  const start = async () => {
    if (session.current || connecting.current || ending.current) return;
    connecting.current = true;
    const attempt = ++generation.current;
    setStatus('connecting');
    setError('');
    setMuted(false);
    mutedRef.current = false;
    setSpeakerMuted(false);
    speakerMutedRef.current = false;
    setStartedAt(undefined);
    setPhase('listening');
    setCaption('');
    setUserCaption('');

    let stream: MediaStream | undefined;
    try {
      // Check active voice provider from server settings
      const state = await api<{
        settings: { voiceProvider?: string | null };
      }>('/state').catch(() => null);
      const provider = state?.settings?.voiceProvider || 'openai';

      stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });

      if (attempt !== generation.current) {
        stream.getTracks().forEach((track) => track.stop());
        return;
      }

      if (provider === 'gemini') {
        // ── Gemini Live Protocol (WebSocket + Web Audio API) ───────────────────
        const AudioContextClass =
          window.AudioContext ||
          (window as unknown as { webkitAudioContext: typeof AudioContext })
            .webkitAudioContext;
        const audioContext = new AudioContextClass();
        if (audioContext.state === 'suspended') {
          await audioContext.resume().catch(() => {});
        }

        const speakerGain = audioContext.createGain();
        speakerGain.gain.value = speakerMutedRef.current ? 0 : 1;
        speakerGain.connect(audioContext.destination);

        const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
        const wsUrl = `${protocol}//${window.location.host}/api/voice/gemini-live?threadId=${encodeURIComponent(threadId)}`;
        const ws = new WebSocket(wsUrl);

        const activeSources: AudioBufferSourceNode[] = [];
        let nextPlayTime = 0;

        const current: SessionData = {
          type: 'gemini-live',
          ws,
          stream,
          audioContext,
          speakerGain,
          activeSources,
          transcript: [],
          cancelled: false,
          id: undefined,
          timer: undefined,
        };
        session.current = current;

        // Microphone capture with downsampling to 16kHz PCM
        const micSource = audioContext.createMediaStreamSource(stream);
        const processor = audioContext.createScriptProcessor(4096, 1, 1);
        const muteNode = audioContext.createGain();
        muteNode.gain.value = 0;
        micSource.connect(processor);
        processor.connect(muteNode);
        muteNode.connect(audioContext.destination);
        current.processor = processor;

        processor.onaudioprocess = (e) => {
          if (current.cancelled || ws.readyState !== WebSocket.OPEN) return;
          if (mutedRef.current) return;
          const inputData = e.inputBuffer.getChannelData(0);
          const pcm16 = resampleTo16k(inputData, audioContext.sampleRate);
          const base64 = int16ToBase64(pcm16);
          ws.send(JSON.stringify({ type: 'audio', pcm: base64 }));
        };

        ws.onmessage = (event) => {
          if (current.cancelled) return;
          let data: Record<string, unknown>;
          try {
            data = JSON.parse(String(event.data));
          } catch {
            return;
          }

          if (
            data.type === 'session_started' &&
            typeof data.callId === 'string'
          ) {
            current.id = data.callId;
            setStatus('active');
            setStartedAt((val) => val ?? Date.now());
            void api(`/voice/calls/${data.callId}/active`, 'POST', {}).catch(
              () => {},
            );
            current.timer = setTimeout(() => void end(), 15 * 60_000);
          }

          if (data.type === 'ready') {
            setPhase('listening');
          }

          if (data.type === 'audio' && typeof data.data === 'string') {
            setPhase('speaking');
            try {
              const int16 = base64ToInt16(data.data);
              const float32 = pcm16ToFloat32(int16);
              const audioBuffer = audioContext.createBuffer(
                1,
                float32.length,
                24000,
              );
              audioBuffer.getChannelData(0).set(float32);

              const bufferSource = audioContext.createBufferSource();
              bufferSource.buffer = audioBuffer;
              bufferSource.connect(speakerGain);

              activeSources.push(bufferSource);
              bufferSource.onended = () => {
                const idx = activeSources.indexOf(bufferSource);
                if (idx > -1) activeSources.splice(idx, 1);
                if (activeSources.length === 0) {
                  setPhase('listening');
                }
              };

              const now = audioContext.currentTime;
              const startTime = Math.max(now, nextPlayTime);
              bufferSource.start(startTime);
              nextPlayTime = startTime + audioBuffer.duration;
            } catch (err) {
              console.error('Audio playback error:', err);
            }
          }

          if (data.type === 'transcript' && typeof data.text === 'string') {
            if (data.role === 'assistant') {
              current.transcript.push(`Dot: ${data.text}`);
              setCaption((prev) =>
                prev ? `${prev} ${data.text}` : String(data.text),
              );
            } else if (data.role === 'user') {
              current.transcript.push(`You: ${data.text}`);
              setUserCaption(String(data.text));
            }
          }

          if (data.type === 'interrupted') {
            for (const src of activeSources) {
              try {
                src.stop();
              } catch {}
            }
            activeSources.length = 0;
            nextPlayTime = audioContext.currentTime;
            setPhase('listening');
            setCaption('');
          }

          if (data.type === 'error') {
            setError(
              typeof data.message === 'string'
                ? data.message
                : 'The voice provider reported an error.',
            );
            void end();
          }

          if (data.type === 'call_ended') {
            void end();
          }
        };

        ws.onerror = () => {
          if (!current.cancelled) {
            setError('The voice connection dropped.');
          }
        };

        ws.onclose = () => {
          if (!current.cancelled && !ending.current) {
            void end();
          }
        };
      } else {
        // ── OpenAI Realtime Protocol (WebRTC SDP) ─────────────────────────────
        const pc = new RTCPeerConnection();
        const audio = new Audio();
        audio.autoplay = true;
        const channel = pc.createDataChannel('oai-events');
        const current: SessionData = {
          type: 'webrtc',
          pc,
          audio,
          stream,
          channel,
          transcript: [] as string[],
          cancelled: false,
          id: undefined as string | undefined,
          timer: undefined as ReturnType<typeof setTimeout> | undefined,
        };
        session.current = current;
        stream.getTracks().forEach((track) => pc.addTrack(track, stream!));
        pc.ontrack = (event) => {
          if (current.cancelled) return;
          audio.srcObject = event.streams[0] ?? new MediaStream([event.track]);
          void audio.play().catch(() => {
            if (!current.cancelled)
              setError(
                'Audio playback was blocked. Check your browser audio permissions.',
              );
          });
        };
        pc.onconnectionstatechange = () => {
          if (current.cancelled) return;
          if (pc.connectionState === 'connected') {
            setStatus('active');
            setStartedAt((value) => value ?? Date.now());
            if (current.id)
              void api(`/voice/calls/${current.id}/active`, 'POST', {}).catch(
                (e) => {
                  if (!current.cancelled) setError(e.message);
                },
              );
          }
          if (['failed', 'disconnected'].includes(pc.connectionState)) {
            setError('The voice connection dropped.');
            void end();
          }
        };
        channel.onmessage = async (event) => {
          if (current.cancelled) return;
          let data: Record<string, unknown>;
          try {
            const parsed: unknown = JSON.parse(String(event.data));
            if (!parsed || typeof parsed !== 'object') return;
            data = parsed as Record<string, unknown>;
          } catch {
            return;
          }
          if (data.type === 'input_audio_buffer.speech_started') {
            setPhase('listening');
            setCaption('');
          }
          if (
            data.type === 'response.output_audio_transcript.delta' &&
            typeof data.delta === 'string'
          ) {
            setPhase('speaking');
            setCaption((text) => text + data.delta);
          }
          if (data.type === 'output_audio_buffer.stopped')
            setPhase('listening');
          if (data.type === 'response.created') {
            setCaption('');
            setPhase('thinking');
          }
          if (typeof data.transcript === 'string') {
            if (
              data.type ===
              'conversation.item.input_audio_transcription.completed'
            ) {
              current.transcript.push(`You: ${data.transcript}`);
              setUserCaption(data.transcript);
            }
            if (data.type === 'response.output_audio_transcript.done')
              current.transcript.push(`Dot: ${data.transcript}`);
          }
          if (data.type === 'error')
            setError(
              'The voice provider reported a session error. End the call and retry.',
            );
          if (
            data.type !== 'response.function_call_arguments.done' ||
            data.name !== 'ask_compute' ||
            typeof data.call_id !== 'string' ||
            !current.id
          )
            return;
          let output: string;
          setPhase('thinking');
          try {
            const args: unknown = JSON.parse(String(data.arguments));
            if (
              !args ||
              typeof args !== 'object' ||
              !('request' in args) ||
              typeof args.request !== 'string'
            )
              throw new Error('Invalid compute request.');
            const result = await api<{ text: string }>(
              `/voice/calls/${current.id}/compute`,
              'POST',
              {
                toolCallId: data.call_id,
                request: args.request,
                transcript: current.transcript.join('\n').slice(-12000),
              },
            );
            output = result.text;
          } catch (e) {
            output = `Compute failed: ${e instanceof Error ? e.message : 'Unknown error'}`;
          }
          if (!current.cancelled && channel.readyState === 'open') {
            channel.send(
              JSON.stringify({
                type: 'conversation.item.create',
                item: {
                  type: 'function_call_output',
                  call_id: data.call_id,
                  output,
                },
              }),
            );
            channel.send(JSON.stringify({ type: 'response.create' }));
          }
        };
        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);
        const response = await api<{ id: string; sdp: string }>(
          '/voice/calls',
          'POST',
          { threadId, sdp: offer.sdp },
        );
        current.id = response.id;
        if (current.cancelled) {
          await api(`/voice/calls/${response.id}/end`, 'POST', {
            transcript: '',
          });
          return;
        }
        await pc.setRemoteDescription({ type: 'answer', sdp: response.sdp });
        if (current.cancelled) return;
        current.timer = setTimeout(() => void end(), 15 * 60_000);
      }
    } catch (e) {
      if (attempt !== generation.current) {
        stream?.getTracks().forEach((track) => track.stop());
        return;
      }
      const current = session.current;
      const id = current?.id;
      if (id)
        void api(`/voice/calls/${id}/end`, 'POST', {
          transcript: '',
          anchorMessageId: anchor.current,
        }).catch(() => {});
      stream?.getTracks().forEach((track) => track.stop());
      closeMedia();
      session.current = undefined;
      setStatus('idle');
      setError(e instanceof Error ? e.message : 'Could not connect the call.');
    } finally {
      if (attempt === generation.current) connecting.current = false;
    }
  };

  const toggleMute = () => {
    const next = !muted;
    mutedRef.current = next;
    session.current?.stream.getAudioTracks().forEach((track) => {
      track.enabled = !next;
    });
    setMuted(next);
  };

  const toggleSpeaker = () => {
    const next = !speakerMuted;
    speakerMutedRef.current = next;
    if (session.current) {
      if (session.current.type === 'webrtc') {
        session.current.audio.muted = next;
      } else if (
        session.current.type === 'gemini-live' &&
        session.current.speakerGain
      ) {
        session.current.speakerGain.gain.value = next ? 0 : 1;
      }
    }
    setSpeakerMuted(next);
  };

  return {
    status,
    error,
    start,
    end,
    muted,
    speakerMuted,
    startedAt,
    phase,
    caption,
    userCaption,
    toggleMute,
    toggleSpeaker,
  };
}
