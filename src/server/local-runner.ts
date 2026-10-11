import {
  InMemoryAgentRunner,
  type InMemoryThread,
  ɵGLOBAL_STORE,
} from '@copilotkit/runtime/v2';
import type { WorkspaceStore } from './workspace.js';

export class PersistentLocalRunner extends InMemoryAgentRunner {
  private static storeHooked = false;

  constructor(private workspace: WorkspaceStore) {
    super();
    this.initializePersistence();
  }

  private initializePersistence() {
    // 1. Hook appendRun on the global store singleton once so all completed runs persist to SQLite
    if (!PersistentLocalRunner.storeHooked) {
      PersistentLocalRunner.storeHooked = true;
      const origAppendRun = ɵGLOBAL_STORE.appendRun.bind(ɵGLOBAL_STORE);
      ɵGLOBAL_STORE.appendRun = (threadId, run) => {
        const messagesToSave =
          Array.isArray(run.messages) && run.messages.length > 0
            ? [...run.messages]
            : (ɵGLOBAL_STORE.peek(threadId)?.messagesSnapshot ?? []);
        origAppendRun(threadId, run);
        try {
          const eventsToSave = Array.isArray(run.events)
            ? run.events.filter((e) => e?.type !== 'RUN_ERROR')
            : [];
          this.workspace.saveThreadRun({
            id: run.runId || `${threadId}-${Date.now()}`,
            threadId,
            agentId: run.agentId ?? 'default',
            parentRunId: run.parentRunId ?? null,
            events: JSON.stringify(eventsToSave),
            messages: JSON.stringify(messagesToSave),
            createdAt: run.createdAt ?? Date.now(),
          });
        } catch (err) {
          console.error('[OpenDots] Failed to save thread run to SQLite:', err);
        }
      };
    }

    // 2. Restore all existing conversation threads and past runs from SQLite into ɵGLOBAL_STORE
    try {
      const convs = this.workspace.conversations();
      for (const conv of convs) {
        const store = ɵGLOBAL_STORE.getOrCreate(conv.id);
        if (store.createdAt === null) {
          store.createdAt = conv.createdAt;
        }
      }

      const runs = this.workspace.threadRuns();
      for (const row of runs) {
        try {
          const rawEvents = JSON.parse(row.events);
          const messages = JSON.parse(row.messages);
          const store = ɵGLOBAL_STORE.getOrCreate(row.threadId);
          if (store.createdAt === null) {
            store.createdAt = row.createdAt;
          }
          if (Array.isArray(messages) && messages.length > 0) {
            store.messagesSnapshot = messages;
          }
          // Do not replay past RUN_ERROR events when connecting to a thread
          const events = Array.isArray(rawEvents)
            ? rawEvents.filter((e) => e?.type !== 'RUN_ERROR')
            : [];
          store.historicRuns.push({
            threadId: row.threadId,
            runId: row.id,
            agentId: row.agentId,
            parentRunId: row.parentRunId,
            events,
            messages: [],
            createdAt: row.createdAt,
          });
        } catch (e) {
          console.error('[OpenDots] Failed to parse thread run row:', e);
        }
      }
    } catch (err) {
      console.error('[OpenDots] Failed to restore threads from SQLite:', err);
    }
  }

  override listThreads(): InMemoryThread[] {
    const convs = this.workspace.conversations();
    return convs.map((c) => ({
      id: c.id,
      name: c.title,
      agentId: c.dotId,
      organizationId: '' as const,
      createdById: '' as const,
      archived: false as const,
      createdAt: new Date(c.createdAt).toISOString(),
      updatedAt: new Date(c.createdAt).toISOString(),
    }));
  }
}
