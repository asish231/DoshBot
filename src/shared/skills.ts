import { z } from 'zod';

/**
 * Skills are markdown instruction files (SKILL.md) with YAML frontmatter.
 * The same file format works for hand-written skills and skills a Dot
 * creates for its owner: a name, a short description used for matching,
 * and the instruction body the agent loads on demand.
 */

export const skillNameSchema = z
  .string()
  .trim()
  .min(1)
  .max(60)
  .regex(
    /^[a-z0-9]+(?:-[a-z0-9]+)*$/,
    'Skill names use 1-60 lowercase letters, numbers, and single hyphens.',
  );

export const skillDescriptionSchema = z
  .string()
  .trim()
  .min(1)
  .max(400);

export const skillInstructionsSchema = z.string().trim().min(1).max(100_000);

export const skillInputSchema = z
  .object({
    name: skillNameSchema,
    description: skillDescriptionSchema,
    instructions: skillInstructionsSchema,
  })
  .strict();

export type SkillInput = z.infer<typeof skillInputSchema>;

export interface Skill {
  name: string;
  description: string;
  /** Raw instruction body without the frontmatter. */
  instructions: string;
  createdAt?: number;
  updatedAt?: number;
}

export interface SkillSummary {
  name: string;
  description: string;
  updatedAt?: number;
}

const FRONTMATTER_DELIMITER = '---';

/** Parses `---\nname: ...\ndescription: ...\n---\nbody` into a Skill. */
export function parseSkillMarkdown(markdown: string): Skill | null {
  const text = markdown.replace(/\r\n/g, '\n');
  if (!text.startsWith(FRONTMATTER_DELIMITER)) return null;
  const end = text.indexOf(`\n${FRONTMATTER_DELIMITER}`, FRONTMATTER_DELIMITER.length);
  if (end === -1) return null;
  const header = text.slice(FRONTMATTER_DELIMITER.length, end);
  const instructions = text
    .slice(end + 1 + FRONTMATTER_DELIMITER.length)
    .replace(/^\n+/, '')
    .trimEnd();
  const nameMatch = header.match(/^name:\s*(.+)$/m);
  const descriptionMatch = header.match(/^description:\s*(.+)$/m);
  const name = nameMatch?.[1]?.trim();
  const description = descriptionMatch?.[1]?.trim();
  if (!name || !description) return null;
  return { name, description, instructions };
}

/** Serializes a Skill back to SKILL.md markdown with frontmatter. */
export function serializeSkillMarkdown(skill: SkillInput | Skill): string {
  const instructions = skill.instructions.replace(/\r\n/g, '\n').trim();
  return [
    FRONTMATTER_DELIMITER,
    `name: ${skill.name}`,
    `description: ${skill.description}`,
    FRONTMATTER_DELIMITER,
    '',
    instructions,
    '',
  ].join('\n');
}
