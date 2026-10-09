import { randomUUID } from '../lib/browser-crypto.ts';
import { useCallback, useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Folder, GitBranch, Inbox, Layers, LogOut, Settings2, Columns3, Menu } from 'lucide-react';
import type { ConfigurationSnapshot, InfrastructureSnapshot, OwnerSessionStatus } from '../../../../packages/protocol/generated/types.ts';
import { Button } from '../components/ui/button.tsx';
import { Field } from '../components/forms.tsx';
import type { Save } from '../components/forms.tsx';
import { APIError, logout, request } from '../lib/api.ts';
import { useCommand } from '../lib/use-command.ts';
import { Dialog, DialogContent, DialogTitle, DialogTrigger } from '../components/ui/dialog.tsx';
import { useTaskCommands } from '../lib/use-task-command.ts';
import { clearTaskStorage } from '../lib/task-storage.ts';
import { ExecutionBoard } from '../features/execution-board.tsx';
import { TaskDetail } from '../features/task-detail.tsx';
import { Todos } from '../features/todos.tsx';
import { Projects } from '../features/projects.tsx';
import { Roles } from '../features/roles.tsx';
import { Execution } from '../features/execution.tsx';
import { GitHubSettings } from '../features/github.tsx';

const views = [{ id: 'todos', label: 'Todos', icon: Inbox }, { id: 'board', label: 'Execution Board', icon: Columns3 }, { id: 'projects', label: 'Projects', icon: Folder }, { id: 'roles', label: 'Roles', icon: Layers }, { id: 'execution', label: 'Execution', icon: Settings2 }, { id: 'github', label: 'GitHub', icon: GitBranch }] as const;
function currentView() { const id = location.hash.slice(1).split('?')[0]; return id === 'task' ? 'task' : views.find((view) => view.id === id)?.id ?? 'todos'; }
function Brand() { return <div className="brand"><span className="brand-mark" aria-hidden="true">m</span><span>monos</span></div>; }
function Login({ refresh }: { refresh: () => Promise<unknown> }) {
  const [password, setPassword] = useState(''); const [busy, setBusy] = useState(false); const [error, setError] = useState('');
  return <main className="login-layout"><div className="login-main"><Brand /><form className="login-form" aria-label="Sign in" onSubmit={async (event) => { event.preventDefault(); setBusy(true); setError(''); try { await request('/v1/owner/login', 'OwnerSessionStatus', { schema_version: 1, password }); setPassword(''); await refresh(); } catch (error) { setError(error instanceof Error ? error.message : 'Unable to sign in.'); } finally { setBusy(false); } }}>
    <h1>Sign in to monos</h1><p className="login-description">Use your Owner password to open your workspace.</p>
    <Field label="Password" type="password" value={password} onChange={setPassword} required minLength={12} maxLength={1024} autoComplete="current-password" disabled={busy} error={error || undefined} />
    <Button type="submit" disabled={busy}>{busy ? 'Signing in…' : 'Sign in'}</Button>
    <p className="hint login-setup">First time here? Initialize the Owner password using the local setup command on your server.</p>
  </form></div></main>;
}
function Workspace({ sessionId, onUnauthorized }: { sessionId: string; onUnauthorized: () => void }) {
  const [menuOpen, setMenuOpen] = useState(false);
  const taskCommands = useTaskCommands(sessionId, onUnauthorized);
  const [view, setView] = useState(currentView); const [taskId, setTaskId] = useState(() => new URLSearchParams(location.hash.split('?')[1]).get('task_id') ?? ''); const [logoutError, setLogoutError] = useState(''); const [signingOut, setSigningOut] = useState(false);
  useEffect(() => { const change = () => { setView(currentView()); setTaskId(new URLSearchParams(location.hash.split('?')[1]).get('task_id') ?? ''); }; addEventListener('hashchange', change); return () => removeEventListener('hashchange', change); }, []);
  const configuration = useQuery({ queryKey: ['configuration'], queryFn: () => request<ConfigurationSnapshot>('/v1/owner/configuration', 'ConfigurationSnapshot'), retry: false, refetchInterval: 30000 });
  const infrastructure = useQuery({ queryKey: ['infrastructure'], queryFn: () => request<InfrastructureSnapshot>('/v1/owner/infrastructure', 'InfrastructureSnapshot'), retry: false, refetchInterval: 15000 });
  const refreshConfiguration = configuration.refetch;
  useEffect(() => { if (view === 'board' || view === 'task') void refreshConfiguration(); }, [view, taskId, refreshConfiguration]);
  const command = useCommand(onUnauthorized);
  useEffect(() => { if ([configuration.error, infrastructure.error].some((error) => error instanceof APIError && error.code === 'unauthorized')) onUnauthorized(); }, [configuration.error, infrastructure.error, onUnauthorized]);
  const save: Save = (name, payload, basis) => command.execute({ schema_version: 1, request_id: randomUUID(), expected_control_version: basis, name, payload });
  const disabled = command.busy || !!command.pending;
  const navigate = (id: ReturnType<typeof currentView>) => { setView(id); setMenuOpen(false); };
  const navigation = <nav className="workspace-nav" aria-label="Workspace navigation">{views.map(({ id, label, icon: Icon }) => <a key={id} href={`#${id}`} onClick={() => navigate(id)} aria-current={view === id || (id === 'board' && view === 'task') ? 'page' : undefined}><Icon size={17} strokeWidth={1.7} /><span>{label}</span></a>)}</nav>;
  const signOut = <Button type="button" variant="ghost" size="icon" aria-label="Sign out" title="Sign out" disabled={signingOut} onClick={async () => { setSigningOut(true); setLogoutError(''); try { await logout(); clearTaskStorage(); onUnauthorized(); } catch (error) { setLogoutError(error instanceof Error ? error.message : 'Sign out failed.'); } finally { setSigningOut(false); } }}><LogOut size={18} /></Button>;
  const footer = <div className="sidebar-bottom"><span className="owner-avatar">O</span><div><strong>Owner</strong><small>Personal workspace</small></div>{signOut}</div>;
  return <div className="workspace"><a className="skip-link" href="#main" onClick={(event) => { event.preventDefault(); document.getElementById('main')?.focus(); }}>Skip to content</a>
    <aside className="sidebar desktop-sidebar"><Brand /><p className="nav-label">Workspace</p>{navigation}{footer}</aside>
    <main id="main" tabIndex={-1} className="workspace-main"><div className="topbar">
      <Dialog open={menuOpen} onOpenChange={setMenuOpen}><DialogTrigger render={<Button variant="ghost" size="icon" className="mobile-menu-trigger" aria-label="Open navigation" />}><Menu size={19} /></DialogTrigger><DialogContent side="left" className="navigation-sheet"><DialogTitle className="sr-only">Workspace navigation</DialogTitle><Brand /><p className="nav-label">Workspace</p>{navigation}{footer}</DialogContent></Dialog>
      <span>Workspace / {view === 'todos' ? 'Todos' : view === 'task' ? 'Task' : view === 'board' ? 'Execution Board' : 'Settings'}</span><span className="private-label">Private workspace</span>
    </div><div className={`page-content ${view === 'board' || view === 'task' ? 'execution-page' : 'workspace-page'}`}>
      {logoutError && <p className="notice error" role="alert">{logoutError}</p>}
      {command.notice && <div className={`notice ${command.notice.kind}`} role={command.notice.kind === 'success' ? 'status' : 'alert'}><span>{command.notice.text}</span>{command.notice.kind === 'uncertain' ? <Button disabled={command.busy} variant="outline" onClick={() => { void command.recover(); }}>Check save result</Button> : <Button variant="ghost" onClick={command.dismiss}>Dismiss</Button>}</div>}
      {command.busy && <p className="save-progress" role="status">Saving changes…</p>}
      {configuration.isPending && <div className="loading-state" role="status">Loading your workspace…</div>}
      {configuration.error && <div className="card"><h1>Workspace unavailable</h1><p role="alert">{configuration.error.message}</p><Button onClick={() => { void configuration.refetch(); }}>Retry</Button></div>}
      {configuration.data && <>
        {(view === 'task' || view === 'board') && taskCommands.storageError && <div className="notice error" role="alert"><div><p>{taskCommands.storageError}</p><p>Signing out clears this tab’s drafts and recovery data; messages already saved remain on the server.</p></div><Button variant="outline" onClick={taskCommands.retryStorage}>Retry local recovery</Button></div>}
        {view === 'task' && <TaskDetail taskId={taskId} snapshot={configuration.data} onUnauthorized={onUnauthorized} commands={taskCommands} />}
        {view === 'board' && <ExecutionBoard snapshot={configuration.data} onUnauthorized={onUnauthorized} commands={taskCommands} />}
        <section className="todos-page" hidden={view !== 'todos'}><Todos snapshot={configuration.data} onUnauthorized={onUnauthorized} /></section>
        <section className="settings-page" hidden={view !== 'projects'}><Projects snapshot={configuration.data} save={save} disabled={disabled} committed={command.committed} /></section>
        <section className="settings-page" hidden={view !== 'roles'}><Roles snapshot={configuration.data} infrastructure={infrastructure.data} save={save} disabled={disabled} committed={command.committed} /></section>
        <section className="settings-page" hidden={view !== 'execution'}><Execution snapshot={configuration.data} infrastructure={infrastructure.data} infrastructureError={infrastructure.error} refresh={() => { void infrastructure.refetch(); }} save={save} disabled={disabled} committed={command.committed} /></section>
        <section className="settings-page" hidden={view !== 'github'}><GitHubSettings snapshot={configuration.data} save={save} disabled={disabled} committed={command.committed} /></section>
      </>}
    </div></main></div>;
}

export function App() {
  const [boundSession, setBoundSession] = useState<string | null>(null);
  const client = useQueryClient(); const session = useQuery({ queryKey: ['session'], queryFn: () => request<OwnerSessionStatus>('/v1/owner/session', 'OwnerSessionStatus'), retry: false, refetchOnWindowFocus: 'always' });
  const onUnauthorized = useCallback(() => {
    clearTaskStorage();
    void client.cancelQueries();
    client.setQueryData(['session'], { schema_version: 1, authenticated: false });
    client.removeQueries({ predicate: (query) => query.queryKey[0] !== 'session' });
  }, [client]);
  useEffect(() => {
    const id = session.data?.authenticated ? session.data.session_id : undefined;
    if (!id) { setBoundSession(null); return; }
    if (boundSession === id) return;
    if (boundSession !== null) {
      clearTaskStorage();
      void client.cancelQueries({ predicate: (query) => query.queryKey[0] !== 'session' });
      client.removeQueries({ predicate: (query) => query.queryKey[0] !== 'session' });
    }
    setBoundSession(id);
  }, [session.data, boundSession, client]);
  const expired = session.error instanceof APIError && session.error.code === 'unauthorized';
  useEffect(() => { if (expired) onUnauthorized(); }, [expired, onUnauthorized]);
  if (session.isPending) return <main className="boot-screen" role="status"><Brand /><p>Opening your workspace…</p></main>;
  if (session.error && !expired && !session.data?.authenticated) return <main className="boot-screen"><Brand /><p role="alert">{session.error.message}</p><Button onClick={() => { void session.refetch(); }}>Retry connection</Button></main>;
  if (session.data?.authenticated && !expired) {
    if (!session.data.session_id) return <main className="boot-screen"><p role="alert">The server session is incompatible. Update monos and reconnect.</p></main>;
    if (boundSession !== session.data.session_id) return <main className="boot-screen" role="status"><p>Opening your workspace…</p></main>;
    return <Workspace key={boundSession} sessionId={boundSession} onUnauthorized={onUnauthorized} />;
  }
  return <Login refresh={() => session.refetch()} />;
}
