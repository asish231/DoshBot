import { randomUUID } from 'node:crypto';
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
import {
  parseSkillMarkdown,
  serializeSkillMarkdown,
  skillInputSchema,
  type Skill,
  type SkillInput,
  type SkillSummary,
} from '../shared/skills.js';

/**
 * File-based skill storage. Each skill is a directory containing a SKILL.md
 * with YAML frontmatter (name, description) and the instruction body. Writes
 * are atomic (temp file + rename) so a crash never leaves a half-written
 * skill behind, and deletes only remove the skill's own directory.
 */
export class SkillsStore {
  constructor(private readonly dir: string) {
    mkdirSync(dir, { recursive: true });
  }

  private skillPath(name: string): string {
    return join(this.dir, name, 'SKILL.md');
  }

  private safeName(name: string): string | null {
    return skillInputSchema.shape.name.safeParse(name).success ? name : null;
  }

  list(): SkillSummary[] {
    const summaries: SkillSummary[] = [];
    for (const entry of readdirSync(this.dir, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const skill = this.get(entry.name);
      if (skill) summaries.push({ name: skill.name, description: skill.description, updatedAt: skill.updatedAt });
    }
    return summaries.sort((a, b) => a.name.localeCompare(b.name));
  }

  get(name: string): Skill | null {
    if (!this.safeName(name)) return null;
    const path = this.skillPath(name);
    if (!existsSync(path)) return null;
    const skill = parseSkillMarkdown(readFileSync(path, 'utf8'));
    if (!skill) return null;
    return { ...skill, updatedAt: statSync(path).mtimeMs };
  }

  create(input: SkillInput | { name: string; description: string; instructions: string }): Skill {
    const parsed = skillInputSchema.parse(input);
    if (this.get(parsed.name))
      throw new Error(`A skill named "${parsed.name}" already exists.`);
    this.write(parsed);
    return this.get(parsed.name)!;
  }

  update(name: string, patch: Partial<SkillInput>): Skill {
    const existing = this.get(name);
    if (!existing) throw new Error(`Skill not found: ${name}`);
    const parsed = skillInputSchema.parse({
      name: patch.name ?? existing.name,
      description: patch.description ?? existing.description,
      instructions: patch.instructions ?? existing.instructions,
    });
    if (parsed.name !== name) {
      if (this.get(parsed.name))
        throw new Error(`A skill named "${parsed.name}" already exists.`);
    }
    this.write(parsed);
    // Only remove the old directory after the new one is safely on disk.
    if (parsed.name !== name) {
      rmSync(join(this.dir, name), { recursive: true, force: true });
    }
    return this.get(parsed.name)!;
  }

  delete(name: string): boolean {
    if (!this.get(name)) return false;
    rmSync(join(this.dir, name), { recursive: true, force: true });
    return true;
  }

  private write(skill: SkillInput): void {
    const skillDir = join(this.dir, skill.name);
    mkdirSync(skillDir, { recursive: true });
    const target = this.skillPath(skill.name);
    const temp = `${target}.${randomUUID()}.tmp`;
    writeFileSync(temp, serializeSkillMarkdown(skill), 'utf8');
    renameSync(temp, target);
  }
}
