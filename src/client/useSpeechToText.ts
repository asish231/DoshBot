import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from './api';

export interface SpeechToTextModel {
  id: string;
  name: string;
  provider: 'gemini' | 'tokenmaxxing' | 'browser';
  description: string;
  badge?: string;
}

export const STT_MODELS: SpeechToTextModel[] = [
  {
    id: 'gemini-2.5-flash',
    name: 'Gemini 2.5 Flash',
    provider: 'gemini',
    description: 'Fast, accurate cloud speech recognition',
    badge: 'Recommended',
  },
  {
    id: 'gemini-3.5-transcribe',
    name: 'Gemini 3.5 Transcribe',
    provider: 'gemini',
    description: 'Specialized speech-to-text model',
    badge: 'Gemini',
  },
  {
    id: 'gemini-2.5-flash-lite',
    name: 'Gemini 2.5 Flash Lite',
    provider: 'gemini',
    description: 'Ultra-lightweight fast transcription',
    badge: 'Lite',
  },
  {
    id: 'tokenmaxxing-auto',
    name: 'Token Maxxing Voice',
    provider: 'tokenmaxxing',
    description: 'Token Maxxing multimodal speech recognition',
    badge: 'TokenMaxxing',
  },
  {
    id: 'browser-native',
    name: 'Browser Speech Recognition',
    provider: 'browser',
    description: 'Zero-latency on-device live dictation',
    badge: 'Local',
  },
];

interface BrowserSpeechRecognition {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  onstart: ((event: Event) => void) | null;
  onresult: ((event: SpeechRecognitionEvent) => void) | null;
  onerror: ((event: SpeechRecognitionErrorEvent) => void) | null;
  onend: ((event: Event) => void) | null;
  start(): void;
  stop(): void;
}

export function useSpeechToText(onTranscript: (text: string) => void) {
  const [isRecording, setIsRecording] = useState(false);
  const [isTranscribing, setIsTranscribing] = useState(false);
  const [sttModel, setSttModelState] = useState<string>(() => {
    try {
      return localStorage.getItem('opendots_stt_model') || 'gemini-2.5-flash';
    } catch {
      return 'gemini-2.5-flash';
    }
  });
  const [sttMenuOpen, setSttMenuOpen] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const recognitionRef = useRef<BrowserSpeechRecognition | null>(null);

  const setSttModel = useCallback((modelId: string) => {
    setSttModelState(modelId);
    try {
      localStorage.setItem('opendots_stt_model', modelId);
    } catch {
      // localStorage unavailable (private mode/quota); keep in-memory value only
    }
  }, []);

  const stopRecording = useCallback(() => {
    if (recognitionRef.current) {
      try {
        recognitionRef.current.stop();
      } catch {
        // recognition already stopped or failed to start; nothing to recover
      }
      recognitionRef.current = null;
      setIsRecording(false);
      return;
    }

    if (
      mediaRecorderRef.current &&
      mediaRecorderRef.current.state !== 'inactive'
    ) {
      try {
        mediaRecorderRef.current.stop();
      } catch {
        // recorder already stopped; state update below still applies
      }
      setIsRecording(false);
    }
  }, []);

  const startRecording = useCallback(async () => {
    setErrorMessage(null);

    // 1. Browser Native Speech Recognition
    if (sttModel === 'browser-native') {
      const speechWindow = window as Window & {
        SpeechRecognition?: new () => BrowserSpeechRecognition;
        webkitSpeechRecognition?: new () => BrowserSpeechRecognition;
      };
      const SpeechRecognitionClass =
        speechWindow.SpeechRecognition || speechWindow.webkitSpeechRecognition;

      if (SpeechRecognitionClass) {
        try {
          const recognition = new SpeechRecognitionClass();
          recognition.continuous = true;
          recognition.interimResults = true;
          recognition.lang = 'en-US';

          recognition.onstart = () => {
            setIsRecording(true);
          };

          recognition.onresult = (event) => {
            let fullText = '';
            for (let i = event.resultIndex; i < event.results.length; i++) {
              fullText += event.results[i][0].transcript;
            }
            if (fullText.trim()) {
              onTranscript(fullText.trim());
            }
          };

          recognition.onerror = (err) => {
            if (err.error !== 'no-speech') {
              setErrorMessage(`Speech recognition error: ${err.error}`);
            }
            setIsRecording(false);
          };

          recognition.onend = () => {
            setIsRecording(false);
          };

          recognitionRef.current = recognition;
          recognition.start();
          return;
        } catch (err) {
          console.warn(
            'SpeechRecognition failed, falling back to MediaRecorder',
            err,
          );
        }
      }
    }

    // 2. MediaRecorder + Server Transcribe (Gemini / TokenMaxxing)
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      mediaStreamRef.current = stream;
      chunksRef.current = [];

      let mimeType = 'audio/webm;codecs=opus';
      if (!MediaRecorder.isTypeSupported(mimeType)) {
        if (MediaRecorder.isTypeSupported('audio/webm')) {
          mimeType = 'audio/webm';
        } else if (MediaRecorder.isTypeSupported('audio/mp4')) {
          mimeType = 'audio/mp4';
        } else {
          mimeType = '';
        }
      }

      const recorder = mimeType
        ? new MediaRecorder(stream, { mimeType })
        : new MediaRecorder(stream);

      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          chunksRef.current.push(event.data);
        }
      };

      recorder.onstop = async () => {
        setIsRecording(false);
        if (mediaStreamRef.current) {
          mediaStreamRef.current.getTracks().forEach((track) => track.stop());
          mediaStreamRef.current = null;
        }

        const audioBlob = new Blob(chunksRef.current, {
          type: recorder.mimeType || 'audio/webm',
        });

        if (audioBlob.size < 500) {
          // Empty or virtually silent audio
          return;
        }

        setIsTranscribing(true);
        try {
          const reader = new FileReader();
          reader.onloadend = async () => {
            const dataUrl = reader.result as string;
            const base64Audio = dataUrl.split(',')[1];
            try {
              const res = await api<{ text: string }>(
                '/voice/transcribe',
                'POST',
                {
                  audio: base64Audio,
                  mimeType: audioBlob.type || 'audio/webm',
                  model: sttModel,
                },
              );

              if (res.text && res.text.trim()) {
                onTranscript(res.text.trim());
              }
            } catch (err) {
              setErrorMessage(
                err instanceof Error && err.message
                  ? err.message
                  : 'Failed to transcribe audio. Check API key.',
              );
            } finally {
              setIsTranscribing(false);
            }
          };
          reader.readAsDataURL(audioBlob);
        } catch (err) {
          setIsTranscribing(false);
          setErrorMessage(
            err instanceof Error && err.message
              ? err.message
              : 'Audio processing error.',
          );
        }
      };

      mediaRecorderRef.current = recorder;
      recorder.start(250);
      setIsRecording(true);
    } catch (err) {
      setIsRecording(false);
      setErrorMessage(
        err instanceof Error && err.message
          ? err.message
          : 'Microphone access denied or unavailable.',
      );
    }
  }, [sttModel, onTranscript]);

  const toggleRecording = useCallback(async () => {
    if (isRecording) {
      stopRecording();
    } else {
      await startRecording();
    }
  }, [isRecording, startRecording, stopRecording]);

  useEffect(() => {
    return () => {
      if (recognitionRef.current) {
        try {
          recognitionRef.current.stop();
        } catch {
          // recognition already stopped or failed to start
        }
      }
      if (
        mediaRecorderRef.current &&
        mediaRecorderRef.current.state !== 'inactive'
      ) {
        try {
          mediaRecorderRef.current.stop();
        } catch {
          // recorder already stopped; tracks are still torn down below
        }
      }
      if (mediaStreamRef.current) {
        mediaStreamRef.current.getTracks().forEach((track) => track.stop());
      }
    };
  }, []);

  return {
    isRecording,
    isTranscribing,
    sttModel,
    setSttModel,
    sttMenuOpen,
    setSttMenuOpen,
    toggleRecording,
    startRecording,
    stopRecording,
    errorMessage,
  };
}
