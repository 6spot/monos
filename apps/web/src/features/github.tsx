import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { ConfigurationResult, ConfigurationSnapshot, GitHubConfigurationInput, GitHubRepositoryPage } from '../../../../packages/protocol/generated/types.ts';
import { Button } from '../components/ui/button.tsx';
import { EditorActions, Field, PageHeading } from '../components/forms.tsx';
import type { Draft, Save } from '../components/forms.tsx';
import { request } from '../lib/api.ts';

export function GitHubSettings({ snapshot, save, disabled, committed }: { snapshot: ConfigurationSnapshot; save: Save; disabled: boolean; committed?: ConfigurationResult }) {
  const [local, setLocal] = useState<Draft<GitHubConfigurationInput>>();
  useEffect(() => { if (committed?.entity_id === 'save_github') setLocal(undefined); }, [committed]);
  const draft = local ?? { value: { app_id: snapshot.github?.app_id ?? '', installation_id: snapshot.github?.installation_id ?? '' }, basis: snapshot.control_version };
  const access = useQuery({ queryKey: ['github-access', snapshot.control_version], queryFn: () => request<GitHubRepositoryPage>('/v1/owner/github/repositories?page=1', 'GitHubRepositoryPage'), enabled: false, retry: false });
  function update(value: GitHubConfigurationInput) { setLocal({ value, basis: draft.basis }); }
  return <><PageHeading title="GitHub" description="Connect the repositories your GitHub App is allowed to access." />
    <div className="settings-grid"><form className="editor" onSubmit={async (event) => { event.preventDefault(); if (await save('save_github', draft.value, draft.basis)) setLocal(undefined); }}><fieldset disabled={disabled}><div className="section-label"><h2>App installation</h2><span className="tag">{snapshot.github ? 'Configured' : 'Not configured'}</span></div>
      <div className="field-grid"><Field label="GitHub App ID" value={draft.value.app_id} onChange={(app_id) => update({ ...draft.value, app_id })} required maxLength={20} /><Field label="Installation ID" value={draft.value.installation_id} onChange={(installation_id) => update({ ...draft.value, installation_id })} required maxLength={20} /></div>
      <Field label="App private key" multiline rows={7} value={draft.value.private_key ?? ''} onChange={(value) => { const next = { ...draft.value }; if (value) next.private_key = value; else delete next.private_key; update(next); }} required={!snapshot.github || snapshot.github.app_id !== draft.value.app_id} maxLength={16384} autoComplete="off" placeholder="Paste your unencrypted RSA private key (PEM)" hint={snapshot.github ? 'Leave blank to keep the current App key. A supplied key replaces it when saved.' : 'The key is encrypted on the server and is never returned by the API.'} />
      {snapshot.github && <div className="key-status"><span className="hint">Saved public-key fingerprint</span><code>{snapshot.github.key_fingerprint}</code></div>}
      <EditorActions dirty={!!local} disabled={disabled} reload={() => setLocal(undefined)} />
    </fieldset></form><aside className="setup-note"><h2>Before you connect</h2><ol><li>Create a GitHub App and install it on the repositories you want to use.</li><li>Allow Contents and Metadata read access for repository selection.</li><li>Save the App details, then check repository access.</li></ol><p>Read access is separate from the permissions needed for future delivery and merging.</p></aside></div>
    <section className="settings-section access-check"><div><h2>Repository access</h2><p className="hint">Verify the saved installation can list its authorized repositories.</p></div><Button variant="outline" disabled={!snapshot.github || access.isFetching || disabled} onClick={() => { void access.refetch(); }}>{access.isFetching ? 'Checking…' : 'Check repository access'}</Button>{access.error && <p role="alert" className="access-result">{access.error.message}</p>}{access.data && <p role="status" className="access-result">Read access confirmed. {access.data.repositories.length} repositories on the first page{access.data.next_page ? '; more pages available' : ''}.</p>}</section>
  </>;
}
