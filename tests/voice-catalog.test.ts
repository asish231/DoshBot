import { describe, expect, it } from 'vitest';
import {
  resolveVoiceProvider,
  supportsLiveVoiceChange,
  voiceCapabilityPrompt,
  voicesForProvider,
} from '../src/shared/voice-catalog.js';

describe('voicesForProvider', () => {
  it('lists voices for each provider', () => {
    expect(voicesForProvider('openai')).toContain('marin');
    expect(voicesForProvider('gemini')).toContain('Aoede');
    expect(voicesForProvider('gemini')).toContain('Puck');
  });

  it('falls back to openai for unknown providers', () => {
    expect(voicesForProvider('skype')).toEqual(voicesForProvider('openai'));
    expect(voicesForProvider(null)).toEqual(voicesForProvider('openai'));
    expect(voicesForProvider(undefined)).toEqual(voicesForProvider('openai'));
  });

  it('is case-insensitive', () => {
    expect(voicesForProvider('GEMINI')).toEqual(voicesForProvider('gemini'));
  });
});

describe('resolveVoiceProvider', () => {
  it('prefers an explicitly configured provider', () => {
    expect(resolveVoiceProvider('openai', 'gemini-3.8-live')).toBe('openai');
    expect(resolveVoiceProvider('gemini', 'gpt-4o-realtime-preview')).toBe(
      'gemini',
    );
  });

  it('infers gemini from a gemini voice model', () => {
    expect(resolveVoiceProvider(null, 'gemini-3.8-live')).toBe('gemini');
    expect(resolveVoiceProvider('', 'gemini-3.1-flash-live-preview')).toBe(
      'gemini',
    );
  });

  it('infers openai from an openai realtime model', () => {
    expect(resolveVoiceProvider(null, 'gpt-4o-realtime-preview')).toBe(
      'openai',
    );
  });

  it('falls back to openai when nothing is configured', () => {
    expect(resolveVoiceProvider(null, null)).toBe('openai');
    expect(resolveVoiceProvider(undefined, undefined)).toBe('openai');
  });
});

describe('supportsLiveVoiceChange', () => {
  it('allows live switching on openai and blocks it on gemini', () => {
    expect(supportsLiveVoiceChange('openai')).toBe(true);
    expect(supportsLiveVoiceChange('gemini')).toBe(false);
    // Default provider is openai.
    expect(supportsLiveVoiceChange(null)).toBe(true);
  });
});

describe('voiceCapabilityPrompt', () => {
  it('always carries the screen-command awareness', () => {
    for (const hasComputeTool of [true, false]) {
      const prompt = voiceCapabilityPrompt({ hasComputeTool });
      expect(prompt).toContain('minimize the screen');
      expect(prompt).toContain('minimize yourself');
      expect(prompt).toContain('move left/right');
      expect(prompt).toContain('confirm briefly');
      expect(prompt).toContain('Keep spoken responses short');
    }
  });

  it('mentions the compute tool only when the session has one', () => {
    expect(voiceCapabilityPrompt({ hasComputeTool: true })).toContain(
      'ask_compute',
    );
    expect(voiceCapabilityPrompt({ hasComputeTool: false })).not.toContain(
      'ask_compute',
    );
  });
});
