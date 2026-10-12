import { expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
vi.mock('../src/client/api', () => ({ api: vi.fn() }));
import {
  CompactToolCard,
  getToolMeta,
} from '../src/client/CompactToolCard';

it('maps tool names to human-friendly labels and icons', () => {
  const bashMeta = getToolMeta('bash', { command: 'npm test' });
  expect(bashMeta.label).toBe('Terminal');
  expect(bashMeta.summary).toBe('$ npm test');

  const editorMeta = getToolMeta('str_replace_editor', {
    command: 'str_replace',
    path: '/path/to/src/client/Chat.tsx',
  });
  expect(editorMeta.label).toBe('File Editor');
  expect(editorMeta.summary).toBe('str_replace Chat.tsx');

  const webMeta = getToolMeta('search_web', { query: 'test query' });
  expect(webMeta.label).toBe('Web Search');
  expect(webMeta.summary).toBe('"test query"');

  const filesMeta = getToolMeta('search_files', { query: 'CompactToolCard' });
  expect(filesMeta.label).toBe('Search Files');
  expect(filesMeta.summary).toBe('"CompactToolCard"');

  const swarmMeta = getToolMeta('run_subagents', {
    mission: 'audit and test',
    agents: [{ task: 'audit' }, { task: 'test' }],
  });
  expect(swarmMeta.label).toBe('Subagent Swarm');
  expect(swarmMeta.summary).toBe('2-agent mission');
});

it('renders compact tool card with running and completed states', () => {
  const runningHtml = renderToStaticMarkup(
    <CompactToolCard
      name="bash"
      toolCallId="call-1"
      status="inProgress"
      args={{ command: 'git status' }}
      running
    />,
  );
  expect(runningHtml).toContain('Terminal');
  expect(runningHtml).toContain('$ git status');
  expect(runningHtml).toContain('Running…');

  const doneHtml = renderToStaticMarkup(
    <CompactToolCard
      name="bash"
      toolCallId="call-2"
      status="complete"
      args={{ command: 'git status' }}
      result={{ exitCode: 0, stdout: 'On branch main' }}
      running={false}
    />,
  );
  expect(doneHtml).toContain('Terminal');
  expect(doneHtml).toContain('Done');
});

it('marks tool as failed when error or nonzero exitCode occurs', () => {
  const failedHtml = renderToStaticMarkup(
    <CompactToolCard
      name="bash"
      toolCallId="call-3"
      status="complete"
      args={{ command: 'npm run fail' }}
      result={{ exitCode: 1, stderr: 'Command failed' }}
      running={false}
    />,
  );
  expect(failedHtml).toContain('Failed');
  expect(failedHtml).toContain('is-failed');
});
