/** Hero (pre-chat) file staging: the + button opens the native OS file
 *  picker and the picked files wait as chips until the conversation is
 *  created. Mirrors the in-chat 50MB per-file cap so nothing silently
 *  fails later when the chat ingests them. */

export const HERO_MAX_FILE_MB = 50;
export const HERO_MAX_FILES = 64;

export interface HeroStageResult {
  accepted: File[];
  errors: string[];
}

export function stageHeroFiles(
  files: FileList | File[] | null,
): HeroStageResult {
  if (!files) return { accepted: [], errors: [] };
  const accepted: File[] = [];
  const errors: string[] = [];
  for (const file of Array.from(files).slice(0, HERO_MAX_FILES)) {
    if (file.size > HERO_MAX_FILE_MB * 1024 * 1024) {
      errors.push(`"${file.name}" exceeds 50MB and was skipped.`);
      continue;
    }
    accepted.push(file);
  }
  return { accepted, errors };
}
