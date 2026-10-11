import { useEffect, useId, useRef, useState } from 'react';
import { useInfiniteQuery, useQuery, useQueryClient } from '@tanstack/react-query';
import type { InfiniteData } from '@tanstack/react-query';
import type { TaskLocalResult, TaskLocalGitResult, TaskResultPage, ResultReadResponse, ResultReadRequest } from '../../../../packages/protocol/generated/types.ts';
import { Button } from '../components/ui/button.tsx';
import { APIError } from '../lib/api.ts';
import { resultRead } from '../lib/task-api.ts';
import { human, ReadProblem, unique } from './task-shared.tsx';
import type { TaskViewProps } from './task-shared.tsx';

const statuses: Partial<Record<ResultReadResponse['status'], string>> = {
  offline: 'The Runner is offline. The exact local result remains recorded. Retry when it reconnects.',
  unsupported: 'This Runner does not support local result inspection. Update the Runner and retry.',
  unavailable: 'The retained local result storage is unavailable. No other workspace has been substituted.',
  identity_mismatch: 'The retained result identity could not be verified. Refresh results or retry after storage reconciliation.',
  busy: 'The Runner is handling other result reads. Retry shortly.',
  timeout: 'The result read timed out. Retry this read.',
  binary: 'Binary or unsupported text encoding. Content is not displayed.',
  oversized: 'Content exceeds the 64 KiB inspection limit. No partial file or patch is shown.',
  scan_limit: 'The change collection exceeds the inspection scan limit (8192 files or 8 MiB). A complete list cannot be displayed.',
  unsupported_path: 'The change collection contains an unsupported filename. A complete list cannot be displayed.',
  absent: 'This file does not exist on the selected side.',
  no_git: 'This result has no Git content.',
};
const changeLabels = { A: 'Added', D: 'Deleted', M: 'Modified', T: 'Type changed' } as const;
function Outcome({ value, retry }: { value: ResultReadResponse | undefined; retry: () => unknown }) {
  if (!value || value.status === 'available') return null;
  return <div className="task-notice" role="status"><p>{statuses[value.status] ?? human(value.status)}</p>
    {['offline', 'unsupported', 'unavailable', 'identity_mismatch', 'busy', 'timeout'].includes(value.status) &&
      <Button variant="outline" size="sm" onClick={() => { void retry(); }}>Retry read</Button>}
  </div>;
}

export function ResultInspector({ props, result, git }: { props: TaskViewProps; result: TaskLocalResult; git: TaskLocalGitResult }) {
  const [open, setOpen] = useState(false), id = useId();
  return <div className="result-inspector">
    <Button variant="outline" size="sm" aria-expanded={open} aria-controls={id} onClick={() => setOpen(value => !value)}>{open ? 'Close inspection' : 'Inspect changes'}</Button>
    {open && <Inspection key={`${props.commands.sessionId}:${props.task.task_id}:${result.manifest.operation_id}:${git.identity_digest}`} id={id} props={props} result={result} git={git} />}
  </div>;
}

function Inspection({ id, props, result, git }: { id: string; props: TaskViewProps; result: TaskLocalResult; git: TaskLocalGitResult }) {
  const [path, setPath] = useState<string>(), [mode, setMode] = useState<'diff' | 'file'>('diff'), [side, setSide] = useState<ResultReadRequest['side']>('result');
  const task = props.task.task_id, op = result.manifest.operation_id, session = props.commands.sessionId, client = useQueryClient();
  const key = ['result-content', session, task, op, git.identity_digest];
  const changes = useInfiniteQuery({
    queryKey: [...key, 'changes'], initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam, signal }) => resultRead(task, op, git.resource_id, git.identity_digest, 'changes', { cursor: pageParam }, session, signal),
    getNextPageParam: page => page.status === 'available' ? page.next_cursor : undefined,
    retry: false, gcTime: 0, staleTime: Infinity, refetchOnWindowFocus: false,
  });
  const content = useQuery({
    queryKey: [...key, mode, path, mode === 'file' ? side : undefined],
    queryFn: ({ signal }) => resultRead(task, op, git.resource_id, git.identity_digest, mode, { path, side: mode === 'file' ? side : undefined }, session, signal),
    enabled: path !== undefined, retry: false, gcTime: 0, staleTime: Infinity, refetchOnWindowFocus: false,
  });
  const onUnauthorized = props.onUnauthorized;
  useEffect(() => {
    if ([changes.error, content.error].some(error => error instanceof APIError && error.code === 'unauthorized')) onUnauthorized();
  }, [changes.error, content.error, onUnauthorized]);
  // The backend re-resolves applicability after the read. Update the matching
  // metadata immediately; keep this immutable completion selected.
  const lastApplied = useRef(0), observed = useRef<{ content?: ResultReadResponse; changes?: ResultReadResponse }>({});
  const latestChanges = changes.data?.pages.at(-1);
  useEffect(() => {
    const fresh = [
      ...(content.data !== observed.current.content && content.data ? [{ value: content.data, at: content.dataUpdatedAt }] : []),
      ...(latestChanges !== observed.current.changes && latestChanges ? [{ value: latestChanges, at: changes.dataUpdatedAt }] : []),
    ].sort((a, b) => b.at - a.at)[0];
    observed.current = { content: content.data, changes: latestChanges };
    if (!fresh || fresh.at < lastApplied.current || fresh.value.current === undefined) return;
    lastApplied.current = fresh.at;
    const current = fresh.value.current;
    client.setQueriesData<InfiniteData<TaskResultPage>>({ queryKey: ['tasks', task, '/results'] }, previous => previous && ({
      ...previous, pages: previous.pages.map(page => ({ ...page, items: page.items.map(item => item.manifest.operation_id === op && item.git_results.some(value => value.resource_id === git.resource_id && value.identity_digest === git.identity_digest) ? { ...item, current } : item) })),
    }));
  }, [content.data, content.dataUpdatedAt, latestChanges, changes.dataUpdatedAt, client, task, op, git.resource_id, git.identity_digest]);
  const files = unique(changes.data?.pages.flatMap(page => page.changes ?? []) ?? [], file => file.path), value = content.data;
  return <section id={id} className="result-inspection-body" aria-label="Local result inspection">
    <p className="task-muted">Fixed base → exact local result · {result.current ? 'Current' : 'Historical'} completion. Renames appear as deletion and addition.</p>
    <ReadProblem error={changes.error} retry={changes.refetch} />
    {changes.isPending && <p role="status">Loading changed files…</p>}
    <Outcome value={changes.data?.pages.at(-1)} retry={changes.refetch} />
    {changes.data?.pages[0]?.status === 'available' && files.length === 0 && <p className="task-muted">No changes from the fixed base.</p>}
    {files.length > 0 && <p className="task-muted">Changed files · {files.length} of {changes.data?.pages[0]?.total_changes} loaded</p>}
    {files.length > 0 && <div className="result-file-layout">
      <div className="result-files" role="group" aria-label="Changed files">
        {files.map(file => <Button key={file.path} variant={path === file.path ? 'secondary' : 'ghost'} size="sm" aria-label={`${changeLabels[file.status]} ${file.path}`} aria-pressed={path === file.path} onClick={() => setPath(file.path)}>
          <span className="result-file-status" aria-hidden="true">{file.status}</span><span className="result-file-name">{file.path}</span>
        </Button>)}
        {changes.hasNextPage && <Button variant="outline" size="sm" disabled={changes.isFetchingNextPage} onClick={() => { void changes.fetchNextPage(); }}>{changes.isFetchingNextPage ? 'Loading changes…' : 'Load more changes'}</Button>}
      </div>
      <section className="result-file-content" aria-label="Selected file content">
        {path === undefined ? <p className="task-muted">Select a changed file to inspect its diff or either version.</p> : <>
          <h4>{path}</h4><div className="result-read-controls" role="group" aria-label="File view">
            <Button variant={mode === 'diff' ? 'secondary' : 'outline'} size="sm" aria-pressed={mode === 'diff'} onClick={() => setMode('diff')}>Diff</Button>
            <Button variant={mode === 'file' && side === 'result' ? 'secondary' : 'outline'} size="sm" aria-pressed={mode === 'file' && side === 'result'} onClick={() => { setMode('file'); setSide('result'); }}>Result file</Button>
            <Button variant={mode === 'file' && side === 'base' ? 'secondary' : 'outline'} size="sm" aria-pressed={mode === 'file' && side === 'base'} onClick={() => { setMode('file'); setSide('base'); }}>Base file</Button>
          </div>
          <ReadProblem error={content.error} retry={content.refetch} />
          {content.isPending && <p role="status">Loading exact content…</p>}
          <Outcome value={value} retry={content.refetch} />
          {value?.object && <p className="task-muted">{value.object.mode === '120000' ? 'Symlink target (not followed)' : value.object.mode === '160000' ? 'Git submodule reference (not fetched)' : 'File'} · {value.object.size !== undefined ? `${value.object.size} bytes · ` : ''}<code>{value.object.oid}</code></p>}
          {value?.status === 'available' && value.text !== undefined && (value.text === '' ? <p className="task-muted">{mode === 'file' ? 'Empty file.' : 'No textual diff.'}</p> :
            <pre className="result-code" tabIndex={0} aria-label={mode === 'diff' ? 'Exact file diff' : 'Exact file text'}><code>{value.text}</code></pre>)}
        </>}
      </section>
    </div>}
  </section>;
}
