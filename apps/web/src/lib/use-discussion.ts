import { useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import type { DiscussionCommand } from '../../../../packages/protocol/generated/types.ts';
import { APIError, UncertainError } from './api.ts';
import { recoverDiscussion, submitDiscussion } from './discussion-api.ts';

interface LocalDiscussion {
  draft: string;
  pending?: DiscussionCommand;
  busy?: boolean;
  notice?: { kind: 'success' | 'error' | 'uncertain'; text: string };
}

export function useDiscussion(onUnauthorized: () => void) {
  const client = useQueryClient();
  const executing = useRef(new Set<string>());
  const [byTodo, setByTodo] = useState<Record<string, LocalDiscussion>>({});
  function update(todoId: string, change: (local: LocalDiscussion) => LocalDiscussion) {
    setByTodo((all) => ({ ...all, [todoId]: change(all[todoId] ?? { draft: '' }) }));
  }
  async function execute(command: DiscussionCommand, retry = false) {
    const id = command.todo_id;
    if (executing.current.has(id) || (byTodo[id]?.pending && !retry)) return;
    executing.current.add(id);
    update(id, (local) => ({ ...local, pending: command, busy: true, notice: undefined }));
    try {
      await (retry ? recoverDiscussion(command) : submitDiscussion(command));
      update(id, (local) => ({ ...local, pending: undefined,
        draft: command.name === 'submit_discussion_message' && local.draft === command.payload.content ? '' : local.draft,
        notice: { kind: 'success', text: command.name === 'submit_discussion_message' ? 'Message saved.' : 'Request updated.' } }));
      await client.invalidateQueries({ queryKey: ['todos'] });
    } catch (error) {
      if (error instanceof UncertainError) {
        update(id, (local) => ({ ...local, notice: { kind: 'uncertain', text: 'The result is not confirmed. Keep this tab open and check the result; this Todo’s request and draft are retained.' } }));
      } else {
        update(id, (local) => ({ ...local, pending: undefined, notice: { kind: 'error', text: error instanceof Error ? error.message : 'Unable to save. Your draft is retained.' } }));
        if (error instanceof APIError && error.code === 'unauthorized') onUnauthorized();
        if (error instanceof APIError && ['version_conflict', 'unmet_precondition'].includes(error.code)) await client.invalidateQueries({ queryKey: ['todos', 'discussion', id] });
      }
    } finally {
      executing.current.delete(id);
      update(id, (local) => ({ ...local, busy: false }));
    }
  }
  return { byTodo, execute,
    setDraft: (id: string, draft: string) => update(id, (local) => ({ ...local, draft })),
    dismiss: (id: string) => update(id, (local) => ({ ...local, notice: undefined })),
    recover: (id: string) => byTodo[id]?.pending ? execute(byTodo[id].pending, true) : Promise.resolve(),
  };
}
