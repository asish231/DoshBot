import { afterEach, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { type RunAgentInput } from '@ag-ui/core';
import { lastValueFrom, toArray } from 'rxjs';
import { DotAgent } from '../src/server/dot-agent.js';
import { SkillsStore } from '../src/server/skills-store.js';
import { Store } from '../src/server/store.js';
import { WorkspaceStore } from '../src/server/workspace.js';
import { completion } from './fixtures/model-stream.js';
import {
  parseSkillMarkdown,
  serializeSkillMarkdown,
} from '../src/shared/skills.js';

const databases: Array<{ close(): void }> = [];
const tempDirs: string[] = [];
afterEach(() => {
  vi.restoreAllMocks();
  databases.splice(0).forEach((db) => db.close());
  tempDirs.splice(0).forEach((dir) => rmSync(dir, { recursive: true, force: true }));
});

function tempSkillsDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'opendots-skills-'));
  tempDirs.push(dir);
  return dir;
}

it('serializes and parses SKILL.md frontmatter round-trip', () => {
  const markdown = serializeSkillMarkdown({
    name: 'deploy-checklist',
    description: 'Steps to deploy safely',
    instructions: '# Deploy\n\n1. Run tests.\n2. Ship it.',
  });
  const parsed = parseSkillMarkdown(markdown);
  expect(parsed).not.toBeNull();
  expect(parsed!.name).toBe('deploy-checklist');
  expect(parsed!.description).toBe('Steps to deploy safely');
  expect(parsed!.instructions).toContain('# Deploy');
  expect(parsed!.instructions).toContain('2. Ship it.');
  expect(parseSkillMarkdown('no frontmatter here')).toBeNull();
});

it('SkillsStore creates, reads, lists, updates, and deletes skills', () => {
  const store = new SkillsStore(tempSkillsDir());
  const created = store.create({
    name: 'research-brief',
    description: 'How the owner wants research briefs written',
    instructions: 'Keep briefs under 300 words with citations.',
  });
  expect(created.name).toBe('research-brief');

  const read = store.get('research-brief');
  expect(read?.instructions).toBe('Keep briefs under 300 words with citations.');

  expect(store.list().map((s) => s.name)).toEqual(['research-brief']);

  expect(() =>
    store.create({
      name: 'research-brief',
      description: 'duplicate',
      instructions: 'x',
    }),
  ).toThrow(/already exists/i);

  const updated = store.update('research-brief', {
    description: 'Updated description',
    instructions: 'Keep briefs tight. Cite everything.',
  });
  expect(updated.description).toBe('Updated description');
  expect(store.get('research-brief')?.instructions).toBe(
    'Keep briefs tight. Cite everything.',
  );

  expect(store.delete('research-brief')).toBe(true);
  expect(store.get('research-brief')).toBeNull();
  expect(store.delete('research-brief')).toBe(false);
});

it('SkillsStore rejects unsafe names and edits keep a single skill', () => {
  const store = new SkillsStore(tempSkillsDir());
  store.create({
    name: 'safe-name',
    description: 'desc',
    instructions: 'body',
  });
  expect(store.get('../escape')).toBeNull();
  expect(() => store.update('safe-name', { name: 'bad name!' })).toThrow();
  store.update('safe-name', { name: 'renamed-skill' });
  expect(store.get('safe-name')).toBeNull();
  expect(store.get('renamed-skill')).not.toBeNull();
  expect(store.list()).toHaveLength(1);
});

function fixture(skillsDir?: string) {
  const store = new Store(':memory:', skillsDir ? { skillsDir } : undefined);
  const workspace = new WorkspaceStore(':memory:', 'owner');
  databases.push(store, workspace);
  const dot = workspace.dots()[0];
  workspace.bindThread('thread', dot.id, 'TanStack');
  const agent = new DotAgent(
    store,
    workspace,
    {
      intelligenceKey: 'fixture',
      apiKey: 'fixture',
      model: 'custom-model',
      baseUrl: 'https://unused.invalid/v1',
      runtimeUrl: '',
      voiceName: 'marin',
      slackUsers: [],
    },
    dot.id,
  );
  const input: RunAgentInput = {
    threadId: 'thread',
    runId: 'run',
    state: {},
    context: [],
    messages: [{ id: 'user', role: 'user', content: 'Hi' }],
    tools: [],
    forwardedProps: {},
  };
  return { store, workspace, dot, agent, input };
}

it('exposes skills tools and prompt guidance when skills storage is configured', async () => {
  const f = fixture(tempSkillsDir());
  const network = vi
    .spyOn(globalThis, 'fetch')
    .mockResolvedValueOnce(completion({ role: 'assistant', content: 'ok' }));
  await lastValueFrom(f.agent.run(f.input).pipe(toArray()));
  const request = JSON.parse(String(network.mock.calls[0][1]?.body));
  const names = (request.tools ?? []).map(
    (t: { function?: { name?: string } }) => t.function?.name,
  );
  for (const name of [
    'list_skills',
    'read_skill',
    'create_skill',
    'update_skill',
    'delete_skill',
    'search_memory',
    'link_memories',
    'memory_graph',
  ]) {
    expect(names).toContain(name);
  }
  const system = JSON.stringify(request.messages ?? []);
  expect(system).toContain('SKILLS: you have a workspace skill library');
  expect(system).toContain('create_skill on your own initiative');
  expect(system).toContain('SUPER MEMORY');
  expect(system).toContain('completely YOUR decision');
  expect(system).toContain('YOUR ALPINE COMPUTER IS YOUR OWN MACHINE');
});

it('omits skills tools when skills storage is not configured', async () => {
  const f = fixture();
  const network = vi
    .spyOn(globalThis, 'fetch')
    .mockResolvedValueOnce(completion({ role: 'assistant', content: 'ok' }));
  await lastValueFrom(f.agent.run(f.input).pipe(toArray()));
  const request = JSON.parse(String(network.mock.calls[0][1]?.body));
  const names = (request.tools ?? []).map(
    (t: { function?: { name?: string } }) => t.function?.name,
  );
  expect(names).not.toContain('list_skills');
  expect(names).toContain('search_memory');
  const system = JSON.stringify(request.messages ?? []);
  expect(system).toContain('Skills storage is not configured');
});

it('an agent-created skill lands in the store the owner can see', () => {
  const dir = tempSkillsDir();
  const store = new Store(':memory:', { skillsDir: dir });
  databases.push(store);
  store.skills!.create({
    name: 'timesheet-analysis',
    description: 'Analyze timesheet CSVs: totals per employee/site, overtime, report',
    instructions: '1. Parse the CSV. 2. Compute totals. 3. Flag overtime >8h/day.',
  });
  const restStore = new Store(':memory:', { skillsDir: dir });
  databases.push(restStore);
  expect(restStore.skills!.list().map((s) => s.name)).toEqual([
    'timesheet-analysis',
  ]);
});
