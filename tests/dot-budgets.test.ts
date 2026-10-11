import { beforeEach, describe, expect, it } from 'vitest';
import { WorkspaceStore } from '../src/server/workspace.js';

let nextId = 0;
const store = () => new WorkspaceStore(':memory:', `owner-${++nextId}`);

describe('Dot budgets and usage accounting', () => {
  let workspace: WorkspaceStore;
  let dotId: string;
  beforeEach(() => {
    workspace = store();
    const space = workspace.createSpace('S', 's');
    const dot = workspace.createDot(space.id, 'D', 'Do things.', true, true);
    dotId = dot.id;
  });

  it('starts with zero monthly usage', () => {
    expect(workspace.monthlyUsage(dotId)).toBe(0);
  });

  it('records usage and sums it for the month', () => {
    workspace.recordUsage(dotId, 100);
    workspace.recordUsage(dotId, 250.7);
    expect(workspace.monthlyUsage(dotId)).toBe(351);
  });

  it('ignores invalid usage rows', () => {
    workspace.recordUsage(dotId, 0);
    workspace.recordUsage(dotId, -5);
    workspace.recordUsage(dotId, Number.NaN);
    expect(workspace.monthlyUsage(dotId)).toBe(0);
  });

  it('resets usage for one Dot without touching others', () => {
    const other = workspace.createDot(
      workspace.spaces()[0]!.id,
      'D2',
      'More things.',
      true,
      true,
    );
    workspace.recordUsage(dotId, 500);
    workspace.recordUsage(other.id, 700);
    workspace.resetUsage(dotId);
    expect(workspace.monthlyUsage(dotId)).toBe(0);
    expect(workspace.monthlyUsage(other.id)).toBe(700);
  });

  it('persists and clears the budget through updateDot', () => {
    const withBudget = workspace.updateDot(dotId, {
      name: 'D',
      instructions: 'Do things.',
      researchAllowed: true,
      memoryAllowed: true,
      budgetTokens: 50_000,
    });
    expect(withBudget.budgetTokens).toBe(50_000);
    const raised = workspace.updateDot(dotId, {
      name: 'D',
      instructions: 'Do things.',
      researchAllowed: true,
      memoryAllowed: true,
      budgetTokens: 120_000,
    });
    expect(raised.budgetTokens).toBe(120_000);
    const unlimited = workspace.updateDot(dotId, {
      name: 'D',
      instructions: 'Do things.',
      researchAllowed: true,
      memoryAllowed: true,
      budgetTokens: null,
    });
    expect(unlimited.budgetTokens).toBeNull();
  });

  it('normalizes non-positive budgets to unlimited', () => {
    const dot = workspace.updateDot(dotId, {
      name: 'D',
      instructions: 'Do things.',
      researchAllowed: true,
      memoryAllowed: true,
      budgetTokens: 0,
    });
    expect(dot.budgetTokens).toBeNull();
  });

  it('carries budgetTokens on createDot', () => {
    const dot = workspace.createDot(
      workspace.spaces()[0]!.id,
      'Budgeted',
      'Careful.',
      true,
      true,
      undefined,
      null,
      false,
      null,
      null,
      25_000,
    );
    expect(dot.budgetTokens).toBe(25_000);
  });
});
