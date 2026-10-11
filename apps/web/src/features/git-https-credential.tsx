import { useEffect, useState } from 'react';
import type { ConfigurationResult, GitHTTPSCredentialStatus } from '../../../../packages/protocol/generated/types.ts';
import { Field } from '../components/forms.tsx';
import type { Save } from '../components/forms.tsx';
import { Button } from '../components/ui/button.tsx';

export function GitHTTPSCredential({ resourceId, status, version, save, disabled, committed }: {
  resourceId: string; status?: GitHTTPSCredentialStatus; version: number; save: Save; disabled: boolean; committed?: ConfigurationResult;
}) {
  const [draft, setDraft] = useState<{ username: string; token: string; basis: number }>();
  useEffect(() => {
    if (committed?.credential_change?.resource_id === resourceId) setDraft(undefined);
  }, [committed, resourceId]);
  const value = draft ?? { username: status?.username ?? '', token: '', basis: version };
  async function persist() {
    if (!value.username || !value.token || disabled) return;
    if (await save('save_git_https_credential', { resource_id: resourceId, username: value.username, token: value.token }, value.basis)) setDraft(undefined);
  }
  return <section className="mt-5 space-y-3" aria-label="HTTPS Git credential">
    <h4 className="font-medium">Repository access</h4>
    <p className="hint">{status ? `Credential configured for ${status.username}. Replace the token to renew access.` : 'Public repositories can be read without a credential. Configure a repository token for private reads and delivery branch pushes.'}</p>
    <Field label="Git username" value={value.username} maxLength={256} autoComplete="off" disabled={disabled} onChange={username => setDraft({ ...value, username })} />
    <Field label="Git access token" type="password" value={value.token} maxLength={4096} autoComplete="new-password" disabled={disabled} onChange={token => setDraft({ ...value, token })} hint="The saved token is encrypted and never returned. These fields stay only in this tab until saved." />
    <div className="button-row">
      <Button className="max-sm:min-h-11" type="button" variant="outline" disabled={disabled || !value.username || !value.token} onClick={() => { void persist(); }}>{status ? 'Replace Git credential' : 'Save Git credential'}</Button>
      {status && <Button className="max-sm:min-h-11" type="button" variant="ghost" disabled={disabled} onClick={() => { void save('clear_git_https_credential', { resource_id: resourceId }, version); }}>Clear Git credential</Button>}
    </div>
  </section>;
}
