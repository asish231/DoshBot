import { describe, expect, it } from 'vitest';
import {
  HERO_MAX_FILE_MB,
  stageHeroFiles,
} from '../src/client/hero-attach.js';

function file(name: string, sizeBytes: number): File {
  return new File(['x'.repeat(Math.min(sizeBytes, 1024))], name, {
    type: 'application/octet-stream',
  });
}

describe('stageHeroFiles', () => {
  it('accepts picked files', () => {
    const picked = [file('notes.txt', 10), file('app.png', 1024)];
    const result = stageHeroFiles(picked);
    expect(result.accepted).toHaveLength(2);
    expect(result.errors).toEqual([]);
  });

  it('skips files over the 50MB cap with a clear error', () => {
    const big = file('huge.zip', 1024);
    Object.defineProperty(big, 'size', {
      value: (HERO_MAX_FILE_MB + 1) * 1024 * 1024,
    });
    const result = stageHeroFiles([big, file('small.txt', 10)]);
    expect(result.accepted.map((f) => f.name)).toEqual(['small.txt']);
    expect(result.errors[0]).toContain('huge.zip');
    expect(result.errors[0]).toContain('50MB');
  });

  it('caps the stage at 64 files and handles empty input', () => {
    const many = Array.from({ length: 80 }, (_, i) =>
      file(`f${i}.txt`, 10),
    );
    expect(stageHeroFiles(many).accepted).toHaveLength(64);
    expect(stageHeroFiles(null)).toEqual({ accepted: [], errors: [] });
    expect(stageHeroFiles([]).accepted).toEqual([]);
  });
});
