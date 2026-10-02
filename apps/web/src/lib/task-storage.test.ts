import { expect, it } from 'vitest';
import { clearTaskStorage, loadTaskJournal, retryTaskJournal, saveTaskJournal, taskStorageEpoch, validateTaskJournal } from './task-storage.ts';
import type { TaskJournal } from './task-storage.ts';

class MemoryStorage {
  values = new Map<string, string>();
  get length() { return this.values.size; }
  key(index: number) { return [...this.values.keys()][index] ?? null; }
  getItem(key: string) { return this.values.get(key) ?? null; }
  setItem(key: string, value: string) { this.values.set(key, value); }
  removeItem(key: string) { this.values.delete(key); }
}
function journal(): TaskJournal {
  return {
    version: 1, session_id: 'session-a',
    tasks: {
      'task-a': {
        drafts: { conversation: { text: 'Unsent draft' } },
        pending: {
          conversation: {
            family: 'conversation',
            command: { schema_version: 1, request_id: 'request-a', task_id: 'task-a', name: 'submit_task_message', payload: { message_id: 'message-a', content: 'Exact submitted message' } },
          },
        },
      },
    },
  };
}

it('reload preserves original submitted bytes independently of a newer draft and another Task', () => {
  const storage = new MemoryStorage(); const value = journal();
  value.tasks['task-b'] = { drafts: { conversation: { text: 'A separate Task' } }, pending: {} };
  saveTaskJournal(value, taskStorageEpoch(), storage);
  const loaded = loadTaskJournal('session-a', storage);
  expect(loaded).toEqual(value);
  const pending = loaded.tasks['task-a']?.pending.conversation;
  expect(pending?.family === 'conversation' ? pending.command.payload.content : undefined).toBe('Exact submitted message');
  expect(loaded.tasks['task-a']?.drafts.conversation?.text).toBe('Unsent draft');
});

it('logout invalidates late asynchronous persistence and preserves unrelated storage', () => {
  const storage = new MemoryStorage(); storage.setItem('unrelated', 'keep');
  const oldEpoch = taskStorageEpoch(); saveTaskJournal(journal(), oldEpoch, storage);
  clearTaskStorage(storage);
  expect(() => saveTaskJournal(journal(), oldEpoch, storage)).toThrow('Task session changed');
  expect([...storage.values]).toEqual([['unrelated', 'keep']]);
});

it('a new authenticated session cannot hydrate an old session’s pending command', () => {
  const storage = new MemoryStorage(); saveTaskJournal(journal(), taskStorageEpoch(), storage);
  expect(loadTaskJournal('session-b', storage).tasks).toEqual({});
  expect(storage.length).toBe(0);
});

it('corrupt or cross-scope recovery remains intact and is never silently replaced', () => {
  const storage = new MemoryStorage(); storage.setItem('monos:task-ui:v1:session-a', '{broken');
  expect(() => loadTaskJournal('session-a', storage)).toThrow();
  expect(storage.getItem('monos:task-ui:v1:session-a')).toBe('{broken');
  const value = journal(); const pending = value.tasks['task-a']?.pending.conversation;
  if (!pending || pending.family !== 'conversation') throw new Error('Fixture');
  pending.command.task_id = 'task-b';
  expect(() => validateTaskJournal(value, 'session-a')).toThrow('Task recovery scope mismatch');
});

it('fails closed on quota and unsupported payloads rather than dropping a pending command', () => {
  const storage = new MemoryStorage(); saveTaskJournal(journal(), taskStorageEpoch(), storage);
  const before = [...storage.values]; storage.setItem = () => { throw new Error('Quota exceeded'); };
  expect(() => saveTaskJournal(journal(), taskStorageEpoch(), storage)).toThrow('Quota exceeded');
  expect([...storage.values]).toEqual(before);
  expect(() => validateTaskJournal({ ...journal(), token: 'credential' }, 'session-a')).toThrow();
});

it('retrying an initial load preserves damaged data until a same-session valid record is readable', () => {
  const storage = new MemoryStorage(); const key = 'monos:task-ui:v1:session-a';
  storage.setItem(key, '{broken');
  const blank: TaskJournal = { version: 1, session_id: 'session-a', tasks: {} };
  expect(() => retryTaskJournal(blank, taskStorageEpoch(), true, storage)).toThrow();
  expect(storage.getItem(key)).toBe('{broken');
  storage.setItem(key, JSON.stringify(journal()));
  expect(retryTaskJournal(blank, taskStorageEpoch(), true, storage)).toEqual(journal());
  expect(storage.getItem(key)).toBe(JSON.stringify(journal()));
});

it('retrying a failed save persists the newer in-memory draft and never reloads stale disk state', () => {
  const storage = new MemoryStorage(); saveTaskJournal(journal(), taskStorageEpoch(), storage);
  const newer = journal();
  newer.tasks['task-a']!.drafts.conversation!.text = 'Newer text written while storage was full';
  const write = storage.setItem.bind(storage);
  storage.setItem = () => { throw new Error('Quota exceeded'); };
  expect(() => retryTaskJournal(newer, taskStorageEpoch(), false, storage)).toThrow('Quota exceeded');
  expect(loadTaskJournal('session-a', storage)).toEqual(journal());
  storage.setItem = write;
  expect(retryTaskJournal(newer, taskStorageEpoch(), false, storage)).toBe(newer);
  expect(loadTaskJournal('session-a', storage)).toEqual(newer);
  expect(newer.tasks['task-a']?.pending).toEqual(journal().tasks['task-a']?.pending);
});

it('a stale controller cannot retry-load or retry-save after session invalidation', () => {
  const storage = new MemoryStorage(); const previous = taskStorageEpoch();
  clearTaskStorage(storage);
  const current: TaskJournal = { version: 1, session_id: 'session-b', tasks: {} };
  storage.setItem('monos:task-ui:v1:session-b', JSON.stringify(current));
  const before = [...storage.values];
  for (const reload of [true, false]) expect(() => retryTaskJournal(journal(), previous, reload, storage)).toThrow('Task session changed');
  expect([...storage.values]).toEqual(before);
});
