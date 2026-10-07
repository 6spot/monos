import { useEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import type { OwnerSessionStatus, TaskActionBasis } from '../../../../packages/protocol/generated/types.ts';
import { APIError, request, UncertainError } from './api.ts';
import { intentTask, recoverTaskIntent, submitTaskIntent, validateTaskIntent } from './task-api.ts';
import type { TaskIntent, TaskReceipt } from './task-api.ts';
import { clearTaskStorage, loadTaskJournal, own, retryTaskJournal, saveTaskJournal, taskStorageEpoch } from './task-storage.ts';
import type { TaskDraft, TaskJournal, TaskLocal } from './task-storage.ts';

interface Notice { kind: 'success' | 'error' | 'uncertain'; text: string }
export interface TaskCommandEntry { scope: string; pending?: TaskIntent; notice?: Notice; busy: boolean }
const blank = (): TaskLocal => ({ drafts: {}, pending: {} });

export function useTaskCommands(sessionId: string, onUnauthorized: () => void) {
  const client = useQueryClient();
  const [initial] = useState(() => {
    try { return { journal: loadTaskJournal(sessionId), error: '' }; }
    catch { return { journal: { version: 1 as const, session_id: sessionId, tasks: {} }, error: 'Saved Task drafts or recovery data are unavailable. No new Task command will be sent until this is resolved.' }; }
  });
  const [journal, setJournal] = useState<TaskJournal>(initial.journal);
  const current = useRef(journal);
  const [storageError, setStorageError] = useState(initial.error);
  const corrupt = useRef(!!initial.error);
  const generation = useRef(taskStorageEpoch());
  const mounted = useRef(true);
  const inFlight = useRef(new Set<string>());
  const [notices, setNotices] = useState<Record<string, Notice>>({});
  const [, renderBusy] = useState(0);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const valid = () => mounted.current && generation.current === taskStorageEpoch();
  const key = (task: string, scope: string) => JSON.stringify([task, scope]);

  function change(taskId: string, update: (local: TaskLocal) => TaskLocal, requireSave = true) {
    if (!valid() || corrupt.current) return false;
    const local = update(own(current.current.tasks, taskId) ?? blank());
    const tasks = { ...current.current.tasks, [taskId]: local };
    if (!Object.keys(local.drafts).length && !Object.keys(local.pending).length) delete tasks[taskId];
    const next = { ...current.current, tasks };
    try { saveTaskJournal(next, generation.current); setStorageError(''); }
    catch {
      if (!valid()) return false;
      setStorageError('Task data could not be saved in this tab. Your draft stays open; free browser storage and try again before reloading.');
      if (requireSave) return false;
    }
    current.current = next; setJournal(next); return true;
  }
  function notice(task: string, scope: string, value: Notice) {
    if (valid()) setNotices((all) => ({ ...all, [key(task, scope)]: value }));
  }
  async function sessionMatches() {
    const session = await request<OwnerSessionStatus>('/v1/owner/session', 'OwnerSessionStatus');
    if (!valid()) return false;
    if (!session.authenticated || session.session_id !== sessionId) {
      clearTaskStorage();
      const transitionEpoch = taskStorageEpoch();
      await client.cancelQueries({ predicate: (query) => query.queryKey[0] !== 'session' });
      if (!mounted.current || transitionEpoch !== taskStorageEpoch()) return false;
      client.removeQueries({ predicate: (query) => query.queryKey[0] !== 'session' });
      client.setQueryData(['session'], session);
      return false;
    }
    return true;
  }
  async function run(taskId: string, scope: string, intent: TaskIntent, recover = false): Promise<TaskReceipt | undefined> {
    const id = key(taskId, scope);
    if (!valid() || corrupt.current || inFlight.current.has(id)) return;
    const prior = own(own(current.current.tasks, taskId)?.pending ?? {}, scope);
    if (prior && !recover) return;
    validateTaskIntent(intent);
    if (intentTask(intent) !== taskId || (recover && prior !== intent)) return;
    inFlight.current.add(id); renderBusy((value) => value + 1);
    let sent = false;
    try {
      if (!await sessionMatches()) return;
      if (!change(taskId, (local) => ({ ...local, pending: { ...local.pending, [scope]: intent } }))) return;
      notice(taskId, scope, { kind: 'success', text: recover ? 'Checking the original request…' : 'Saving request…' });
      sent = true;
      const receipt = await (recover ? recoverTaskIntent(intent, sessionId) : submitTaskIntent(intent, sessionId));
      if (!valid()) return;
      const saved = change(taskId, (local) => {
        const pending = { ...local.pending }; delete pending[scope];
        const drafts = { ...local.drafts };
        if (intent.family === 'conversation' && intent.command.name === 'submit_task_message' && own(drafts, 'conversation')?.text === intent.command.payload.content) delete drafts.conversation;
        return { ...local, pending, drafts };
      });
      if (!saved) { notice(taskId, scope, { kind: 'uncertain', text: 'The server saved this request, but local recovery data could not be cleared. Check the same request again; do not submit a replacement.' }); return receipt; }
      const publicationNotice = intent.family === 'publication' ? {
        retry_publication_preparation: 'Local preparation requested. Candidate and scan completion are separate.',
        prepare_publication_override: 'Exact policy override proposal saved.',
        confirm_publication_override: 'Exact policy override confirmed. Recording it is separate.',
        override_publication_findings: 'Policy override recorded. The findings remain retained.',
      }[intent.command.name] : undefined;
      notice(taskId, scope, { kind: 'success', text: intent.family === 'remote-preparation' ? 'Remote recovery requested. Publication, PR reconciliation and cancellation cleanup are separate outcomes.' : publicationNotice ?? (receipt.status === 'admitted' || ('operation_id' in receipt && receipt.operation_id) ? 'Decision saved. Execution or cleanup may still be settling.' : intent.command.name === 'submit_task_message' ? 'Message saved. Planner processing is separate.' : 'Decision saved.') });
      await Promise.all([client.invalidateQueries({ queryKey: ['tasks', taskId] }), client.invalidateQueries({ queryKey: ['board'] })]);
      return receipt;
    } catch (error) {
      if (!valid()) return;
      if (error instanceof APIError && error.code === 'unauthorized') { clearTaskStorage(); onUnauthorized(); return; }
      if (error instanceof UncertainError || (recover && !(error instanceof APIError)) || (!sent && !!prior)) {
        notice(taskId, scope, { kind: 'uncertain', text: 'The result is not confirmed. This tab retains the original request across reload. Check its result before another decision.' });
      } else {
        if (sent) change(taskId, (local) => { const pending = { ...local.pending }; delete pending[scope]; return { ...local, pending }; });
        notice(taskId, scope, { kind: 'error', text: error instanceof Error ? error.message : 'Unable to save. Your draft is retained.' });
        if (error instanceof APIError && ['version_conflict', 'unmet_precondition'].includes(error.code)) await client.invalidateQueries({ queryKey: ['tasks', taskId] });
      }
    } finally {
      inFlight.current.delete(id);
      if (valid()) renderBusy((value) => value + 1);
    }
  }
  return {
    sessionId, storageError,
    retryStorage: () => {
      if (!valid()) return;
      try {
        const next = retryTaskJournal(current.current, generation.current, corrupt.current);
        current.current = next; setJournal(next); corrupt.current = false; setStorageError('');
      } catch {
        if (valid()) setStorageError('Local Task recovery is still unavailable. No saved request was discarded. Keep this tab open and retry after browser storage is available.');
      }
    },
    getDraft: (task: string, scope: string): TaskDraft => own(own(journal.tasks, task)?.drafts ?? {}, scope) ?? { text: '' },
    setDraft: (task: string, scope: string, text: string, basis?: TaskActionBasis) => { change(task, (local) => ({ ...local, drafts: { ...local.drafts, [scope]: { text, ...(basis ? { basis } : {}) } } }), false); },
    setReviewDraft: (task: string, scope: string, text: string, review: NonNullable<TaskDraft['review']>) => { change(task, (local) => ({ ...local, drafts: { ...local.drafts, [scope]: { text, review } } }), false); },
    clearDraft: (task: string, scope: string) => { change(task, (local) => { const drafts = { ...local.drafts }; delete drafts[scope]; return { ...local, drafts }; }); },
    execute: (task: string, scope: string, intent: TaskIntent) => run(task, scope, intent),
    recover: (task: string, scope: string) => { const intent = own(own(current.current.tasks, task)?.pending ?? {}, scope); return intent ? run(task, scope, intent, true) : Promise.resolve(undefined); },
    entries: (task: string): TaskCommandEntry[] => {
      const scopes = new Set(Object.keys(own(journal.tasks, task)?.pending ?? {}));
      for (const id of Object.keys(notices)) { const [idTask, scope] = JSON.parse(id) as [string, string]; if (task === idTask) scopes.add(scope); }
      return [...scopes].map((scope) => ({ scope, pending: own(own(journal.tasks, task)?.pending ?? {}, scope), notice: own(notices, key(task, scope)), busy: inFlight.current.has(key(task, scope)) }));
    },
    dismiss: (task: string, scope: string) => { setNotices((all) => { const next = { ...all }; delete next[key(task, scope)]; return next; }); },
  };
}
export type TaskController = ReturnType<typeof useTaskCommands>;
