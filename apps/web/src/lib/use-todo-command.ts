import { useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import type { TodoCommand, TodoRecord } from '../../../../packages/protocol/generated/types.ts';
import { APIError, UncertainError } from './api.ts';
import { recoverTodo, submitTodo } from './todo-api.ts';

export function useTodoCommand(onUnauthorized: () => void) {
  const client = useQueryClient();
  const executing = useRef(false);
  const [pending, setPending] = useState<TodoCommand>();
  const [busy, setBusy] = useState(false);
  const [committed, setCommitted] = useState<{ command: TodoCommand; todo: TodoRecord }>();
  const [notice, setNotice] = useState<{ kind: 'success' | 'error' | 'uncertain'; text: string }>();

  async function execute(command: TodoCommand, retry = false) {
    if (executing.current || (pending && !retry)) return;
    executing.current = true;
    setBusy(true); setPending(command); setNotice(undefined);
    try {
      const todo = retry ? await recoverTodo(command) : await submitTodo(command);
      // Receipts describe the original commit. Refetch current detail rather than
      // overwriting it with a recovered receipt after another tab's later edit.
      await client.invalidateQueries({ queryKey: ['todos'] });
      setPending(undefined); setCommitted({ command, todo });
      setNotice({ kind: 'success', text: command.name === 'capture_todo' ? 'Todo captured.' : 'Todo updated.' });
    } catch (error) {
      if (error instanceof UncertainError) {
        setNotice({ kind: 'uncertain', text: 'The result is not confirmed. Keep this tab open and check the result; your original request and draft are retained.' });
      } else {
        setPending(undefined);
        if (error instanceof APIError && error.code === 'unauthorized') onUnauthorized();
        if (error instanceof APIError && (error.code === 'version_conflict' || error.code === 'unmet_precondition')) {
          await Promise.all([client.invalidateQueries({ queryKey: ['todos'] }), client.invalidateQueries({ queryKey: ['configuration'] })]);
        }
        setNotice({ kind: 'error', text: error instanceof Error ? error.message : 'Unable to save. Your draft has been kept.' });
      }
    } finally { setBusy(false); executing.current = false; }
  }

  return { busy, pending, committed, notice, execute, recover: () => pending ? execute(pending, true) : Promise.resolve(), dismiss: () => setNotice(undefined) };
}
