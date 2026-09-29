import { useCallback, useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Folder, GitBranch, Inbox, Layers, LogOut, Settings2 } from 'lucide-react';
import type { ConfigurationSnapshot, InfrastructureSnapshot, OwnerSessionStatus } from '../../../../packages/protocol/generated/types.ts';
import { Button } from '../components/ui/button.tsx';
import { Field } from '../components/forms.tsx';
import type { Save } from '../components/forms.tsx';
import { APIError, logout, request } from '../lib/api.ts';
import { useCommand } from '../lib/use-command.ts';
import { Todos } from '../features/todos.tsx';
import { Projects } from '../features/projects.tsx';
import { Roles } from '../features/roles.tsx';
import { Execution } from '../features/execution.tsx';
import { GitHubSettings } from '../features/github.tsx';

const views = [{ id: 'todos', label: 'Todos', icon: Inbox }, { id: 'projects', label: 'Projects', icon: Folder }, { id: 'roles', label: 'Roles', icon: Layers }, { id: 'execution', label: 'Execution', icon: Settings2 }, { id: 'github', label: 'GitHub', icon: GitBranch }] as const;
function currentView() { const id = location.hash.slice(1).split('?')[0]; return views.find((view) => view.id === id)?.id ?? 'todos'; }
function Brand() { return <div className="brand"><span className="brand-mark" aria-hidden="true">m</span><span>monos</span></div>; }
function Login({ refresh }: { refresh: () => Promise<unknown> }) {
  const [password, setPassword] = useState(''); const [busy, setBusy] = useState(false); const [error, setError] = useState('');
  return <main className="login-layout"><section className="login-intro"><Brand /><div><p className="eyebrow">YOUR PERSONAL DEVELOPMENT WORKSPACE</p><h1>A little context.<br />A lot of possibility.</h1><p>Bring your ideas, repositories, and agents together in one place.</p></div><span className="login-footer">Built around your work.</span></section><section className="login-main"><form className="login-form" onSubmit={async (event) => { event.preventDefault(); setBusy(true); setError(''); try { await request('/v1/owner/login', 'OwnerSessionStatus', { schema_version: 1, password }); setPassword(''); await refresh(); } catch (error) { setError(error instanceof Error ? error.message : 'Unable to sign in.'); } finally { setBusy(false); } }}><p className="eyebrow">WELCOME BACK</p><h2>Sign in to monos</h2><p>Use your Owner password to open your workspace.</p><Field label="Password" type="password" value={password} onChange={setPassword} required minLength={12} maxLength={1024} autoComplete="current-password" disabled={busy} />{error && <p className="form-error" role="alert">{error}</p>}<Button type="submit" disabled={busy}>{busy ? 'Signing in…' : 'Sign in'}</Button><p className="hint">First time here? Initialize the Owner password using the local setup command on your server.</p></form></section></main>;
}
function Workspace({ onUnauthorized }: { onUnauthorized: () => void }) {
  const [view, setView] = useState(currentView); const [logoutError, setLogoutError] = useState(''); const [signingOut, setSigningOut] = useState(false);
  useEffect(() => { const change = () => setView(currentView()); addEventListener('hashchange', change); return () => removeEventListener('hashchange', change); }, []);
  const configuration = useQuery({ queryKey: ['configuration'], queryFn: () => request<ConfigurationSnapshot>('/v1/owner/configuration', 'ConfigurationSnapshot'), retry: false });
  const infrastructure = useQuery({ queryKey: ['infrastructure'], queryFn: () => request<InfrastructureSnapshot>('/v1/owner/infrastructure', 'InfrastructureSnapshot'), retry: false, refetchInterval: 15000 });
  const command = useCommand(onUnauthorized);
  useEffect(() => { if ([configuration.error, infrastructure.error].some((error) => error instanceof APIError && error.code === 'unauthorized')) onUnauthorized(); }, [configuration.error, infrastructure.error, onUnauthorized]);
  const save: Save = (name, payload, basis) => command.execute({ schema_version: 1, request_id: crypto.randomUUID(), expected_control_version: basis, name, payload });
  const disabled = command.busy || !!command.pending;
  return <div className="workspace"><a className="skip-link" href="#main" onClick={(event) => { event.preventDefault(); document.getElementById('main')?.focus(); }}>Skip to content</a><aside className="sidebar"><Brand /><p className="nav-label">YOUR WORKSPACE</p><nav aria-label="Workspace navigation">{views.map(({ id, label, icon: Icon }) => <a key={id} href={`#${id}`} onClick={() => setView(id)} aria-current={view === id ? 'page' : undefined}><Icon size={18} strokeWidth={1.7} /><span>{label}</span></a>)}</nav><div className="sidebar-bottom"><span className="owner-avatar">O</span><div><strong>Owner</strong><small>Personal workspace</small></div><button type="button" aria-label="Sign out" title="Sign out" disabled={signingOut} onClick={async () => { setSigningOut(true); setLogoutError(''); try { await logout(); onUnauthorized(); } catch (error) { setLogoutError(error instanceof Error ? error.message : 'Sign out failed.'); } finally { setSigningOut(false); } }}><LogOut size={18} /></button></div></aside>
    <main id="main" tabIndex={-1} className="workspace-main"><div className="topbar"><span>Workspace / {view === 'todos' ? 'Todos' : 'Settings'}</span><span className="private-label"><span />Private workspace</span></div><div className="page-content">
      {logoutError && <p className="notice error" role="alert">{logoutError}</p>}
      {command.notice && <div className={`notice ${command.notice.kind}`} role={command.notice.kind === 'success' ? 'status' : 'alert'}><span>{command.notice.text}</span>{command.notice.kind === 'uncertain' ? <Button disabled={command.busy} variant="outline" onClick={() => { void command.recover(); }}>Check save result</Button> : <Button variant="ghost" onClick={command.dismiss}>Dismiss</Button>}</div>}
      {command.busy && <p className="save-progress" role="status">Saving changes…</p>}
      {configuration.isPending && <div className="loading-state" role="status">Loading your workspace…</div>}
      {configuration.error && <div className="card"><h1>Workspace unavailable</h1><p role="alert">{configuration.error.message}</p><Button onClick={() => { void configuration.refetch(); }}>Retry</Button></div>}
      {configuration.data && <><section hidden={view !== 'todos'}><Todos snapshot={configuration.data} onUnauthorized={onUnauthorized} /></section><section hidden={view !== 'projects'}><Projects snapshot={configuration.data} save={save} disabled={disabled} committed={command.committed} /></section><section hidden={view !== 'roles'}><Roles snapshot={configuration.data} infrastructure={infrastructure.data} save={save} disabled={disabled} committed={command.committed} /></section><section hidden={view !== 'execution'}><Execution snapshot={configuration.data} infrastructure={infrastructure.data} infrastructureError={infrastructure.error} refresh={() => { void infrastructure.refetch(); }} save={save} disabled={disabled} committed={command.committed} /></section><section hidden={view !== 'github'}><GitHubSettings snapshot={configuration.data} save={save} disabled={disabled} committed={command.committed} /></section></>}
      <footer className="page-footer">Your work stays with your workspace.</footer>
    </div></main></div>;
}
export function App() {
  const client = useQueryClient(); const session = useQuery({ queryKey: ['session'], queryFn: () => request<OwnerSessionStatus>('/v1/owner/session', 'OwnerSessionStatus'), retry: false, refetchOnWindowFocus: 'always' });
  const onUnauthorized = useCallback(() => {
    void client.cancelQueries();
    client.setQueryData(['session'], { schema_version: 1, authenticated: false });
    client.removeQueries({ predicate: (query) => query.queryKey[0] !== 'session' });
  }, [client]);
  const expired = session.error instanceof APIError && session.error.code === 'unauthorized';
  useEffect(() => { if (expired) onUnauthorized(); }, [expired, onUnauthorized]);
  if (session.isPending) return <main className="boot-screen" role="status"><Brand /><p>Opening your workspace…</p></main>;
  if (session.error && !expired && !session.data?.authenticated) return <main className="boot-screen"><Brand /><p role="alert">{session.error.message}</p><Button onClick={() => { void session.refetch(); }}>Retry connection</Button></main>;
  return session.data?.authenticated && !expired ? <Workspace onUnauthorized={onUnauthorized} /> : <Login refresh={() => session.refetch()} />;
}
