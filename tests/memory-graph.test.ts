import { afterEach, expect, it, vi } from 'vitest';
import { Store } from '../src/server/store.js';
import { fuzzyRank, fuzzyScore } from '../src/server/fuzzy.js';

const databases: Array<{ close(): void }> = [];
afterEach(() => {
  vi.restoreAllMocks();
  databases.splice(0).forEach((db) => db.close());
});

function store(): Store {
  const s = new Store(':memory:');
  databases.push(s);
  return s;
}

it('fuzzy scoring ranks exact > substring > token overlap > miss', () => {
  const exact = fuzzyScore('timesheet report', 'timesheet report');
  const substring = fuzzyScore('timesheet report', 'the timesheet report is due');
  const tokenOverlap = fuzzyScore('timesheet report', 'a report about budgets');
  const miss = fuzzyScore('timesheet report', 'weather forecast tomorrow');
  expect(exact.score).toBeGreaterThan(substring.score);
  expect(substring.score).toBeGreaterThan(tokenOverlap.score);
  expect(tokenOverlap.score).toBeGreaterThan(miss.score);
  expect(miss.strength).toBe(0);
});

it('fuzzy search survives typos and partial words', () => {
  const ranked = fuzzyRank('timeshet overtim', [
    { text: 'Employee timesheet with overtime rules', category: 'project' },
    { text: 'Favorite pizza toppings', category: 'preference' },
  ]);
  expect(ranked).toHaveLength(1);
  expect(ranked[0]!.item.text).toContain('timesheet');
});

it('links connect memories and cascade on delete', () => {
  const s = store();
  const project = s.saveMemory('Project Phoenix launches in March', undefined, 'project');
  const preference = s.saveMemory('Prefers weekly status updates', undefined, 'preference');
  const fact = s.saveMemory('Team uses SQLite for storage', undefined, 'fact');

  s.linkMemories(project.id, preference.id, 'supported-by');
  expect(s.memoryLinks(project.id)).toEqual([
    { toId: preference.id, relation: 'supported-by' },
  ]);

  // Updating an existing edge changes its relation.
  s.linkMemories(project.id, preference.id, 'needs');
  expect(s.memoryLinks(project.id)[0]!.relation).toBe('needs');

  // No self-links, no links to missing memories.
  expect(() => s.linkMemories(project.id, project.id)).toThrow(/itself/i);
  expect(() => s.linkMemories(project.id, 'missing')).toThrow(/exist/i);

  const graph = s.memoryGraph();
  expect(graph.total).toBe(3);
  expect(graph.segments.map((seg) => seg.category)).toEqual([
    'project',
    'preference',
    'fact',
  ]);
  expect(graph.edges).toEqual([
    { fromId: project.id, toId: preference.id, relation: 'needs' },
  ]);

  // Deleting a node removes its edges.
  s.deleteMemory(preference.id);
  expect(s.memoryLinks(project.id)).toEqual([]);
  expect(s.memoryGraph().edges).toEqual([]);

  // Unlink reports honestly.
  s.linkMemories(project.id, fact.id, 'uses');
  expect(s.unlinkMemories(project.id, fact.id)).toBe(true);
  expect(s.unlinkMemories(project.id, fact.id)).toBe(false);
});

it('searchMemories returns scored matches with links', () => {
  const s = store();
  const overtime = s.saveMemory(
    'Timesheet program must flag overtime over 8 hours a day',
    undefined,
    'project',
  );
  const style = s.saveMemory('Keep reports concise and skimmable', undefined, 'preference');
  const unrelated = s.saveMemory('Weather in Goa is lovely in December', undefined, 'fact');
  s.linkMemories(overtime.id, style.id, 'formatted-by');

  const results = s.searchMemories('timesheet overtime');
  expect(results[0]!.id).toBe(overtime.id);
  expect(results[0]!.strength).toBeGreaterThan(50);
  expect(results[0]!.links).toEqual([
    { toId: style.id, relation: 'formatted-by' },
  ]);
  expect(results.map((r) => r.id)).not.toContain(unrelated.id);

  expect(s.searchMemories('nothing matching xyzzy')).toEqual([]);
});
