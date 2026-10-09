import { randomUUID } from './browser-crypto.ts';
import { useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import type { TaskPreviewCommand, TaskPreviewStatus } from '../../../../packages/protocol/generated/types.ts';
import { APIError, UncertainError } from './api.ts';
import { recoverTaskPreview, submitTaskPreview } from './task-preview-api.ts';

interface LocalPreview {
  projectId?: string;
  pending?: TaskPreviewCommand;
  busy?: boolean;
  notice?: { kind: 'success' | 'error' | 'uncertain'; text: string };
}
export const previewKey = (todoId: string, proposalId: string) => JSON.stringify([todoId, proposalId]);

// Owned by the always-mounted Discussion, not by a history card. Both stages and
// the exact Project choice survive Todo switches and history-window changes.
export function useTaskPreviews(onUnauthorized: () => void) {
  const client = useQueryClient();
  const local = useRef<Record<string, LocalPreview>>({});
  const [byProposal, setByProposal] = useState(local.current);
  function update(key: string, change: Partial<LocalPreview>) {
    local.current = { ...local.current, [key]: { ...local.current[key], ...change } };
    setByProposal(local.current);
  }
  async function execute(initial: TaskPreviewCommand, recovery = false) {
    const key = previewKey(initial.todo_id, initial.payload.proposal_message_id);
    if (local.current[key]?.busy || (local.current[key]?.pending && !recovery)) return;
    let command = initial;
    update(key, { busy: true, pending: command, notice: undefined });
    try {
      const result = await (recovery ? recoverTaskPreview(command) : submitTaskPreview(command));
      if (result.outcome === 'confirmed') {
        // The API adapter verified the confirmation and exact digest. Store the
        // second immutable envelope before sending, so recovery cannot reconfirm.
        if (!result.confirmation_id || !command.payload.content_digest) throw new UncertainError();
        command = { schema_version: 1, request_id: randomUUID(), todo_id: command.todo_id, name: 'create_execution_task',
          payload: { proposal_message_id: command.payload.proposal_message_id, confirmation_id: result.confirmation_id, content_digest: command.payload.content_digest } };
        update(key, { pending: command });
        await submitTaskPreview(command);
      }
      update(key, { pending: undefined, notice: { kind: 'success', text: command.name === 'cancel_task_preview' ? 'Task proposal cancelled.' : 'Task created.' } });
      await client.invalidateQueries({ queryKey: ['todos'] });
    } catch (error) {
      if (error instanceof UncertainError) update(key, { notice: { kind: 'uncertain', text: 'The result is not confirmed. Keep this tab open and check the result; the exact Task request is retained.' } });
      else {
        update(key, { pending: undefined, notice: { kind: 'error', text: error instanceof Error ? error.message : 'Unable to update this Task proposal.' } });
        if (error instanceof APIError && error.code === 'unauthorized') onUnauthorized();
        else await client.invalidateQueries({ queryKey: ['todos'] });
      }
    } finally { update(key, { busy: false }); }
  }
  return { byProposal,
    select: (todoId: string, proposalId: string, projectId: string) => {
      const key = previewKey(todoId, proposalId);
      if (!local.current[key]?.pending) update(key, { projectId, notice: undefined });
    },
    create: (status: TaskPreviewStatus) => {
      if (status.state !== 'eligible' || !status.selected_project_id || !status.content_digest) return Promise.resolve();
      return execute({ schema_version: 1, request_id: randomUUID(), todo_id: status.todo_id, name: 'confirm_task_preview',
        payload: { proposal_message_id: status.proposal_message_id, project_id: status.selected_project_id, content_digest: status.content_digest } });
    },
    cancel: (todoId: string, proposalId: string) => execute({ schema_version: 1, request_id: randomUUID(), todo_id: todoId, name: 'cancel_task_preview', payload: { proposal_message_id: proposalId } }),
    recover: (todoId: string, proposalId: string) => {
      const pending = local.current[previewKey(todoId, proposalId)]?.pending;
      return pending ? execute(pending, true) : Promise.resolve();
    },
    dismiss: (todoId: string, proposalId: string) => update(previewKey(todoId, proposalId), { notice: undefined }),
  };
}
