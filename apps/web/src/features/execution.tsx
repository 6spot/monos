import { useEffect, useState } from 'react';
import type { ConfigurationResult, ConfigurationSnapshot, InfrastructureSnapshot, PolicyConfiguration } from '../../../../packages/protocol/generated/types.ts';
import { Button } from '../components/ui/button.tsx';
import { CheckField, EditorActions, Field, PageHeading } from '../components/forms.tsx';
import type { Draft, Save } from '../components/forms.tsx';
import { emptyPolicy, PolicyEditor } from './policy-editor.tsx';

export function Execution({ snapshot, infrastructure, infrastructureError, refresh, save, disabled, committed }: { snapshot: ConfigurationSnapshot; infrastructure?: InfrastructureSnapshot; infrastructureError?: Error | null; refresh: () => void; save: Save; disabled: boolean; committed?: ConfigurationResult }) {
  const [local, setLocal] = useState<Draft<PolicyConfiguration>>();
  const [guidance, setGuidance] = useState<Draft<string>>();
  useEffect(() => { if (committed?.entity_id === 'save_policies') setLocal(undefined); }, [committed]);
  useEffect(() => { if (committed?.entity_id === 'save_planner_guidance') setGuidance(undefined); }, [committed]);
  const draft = local ?? { value: snapshot.policies, basis: snapshot.control_version };
  const guidanceDraft = guidance ?? { value: snapshot.planner_guidance ?? '', basis: snapshot.control_version };
  function update(value: PolicyConfiguration) { setLocal({ value, basis: draft.basis }); }
  return <><PageHeading title="Execution" description="Choose how future work runs and inspect your connected Runners." />
    <form className="settings-section editor" aria-label="Planner guidance settings" onSubmit={async (event) => { event.preventDefault(); if (await save('save_planner_guidance', { guidance: guidanceDraft.value }, guidanceDraft.basis)) setGuidance(undefined); }}><fieldset disabled={disabled}>
      <h2>Planner guidance</h2><Field label="Planner guidance" multiline rows={4} maxLength={65536} value={guidanceDraft.value} onChange={(value) => setGuidance({ value, basis: guidanceDraft.basis })} hint="Your instructions for future Planner discussions. Each Todo also keeps its own capture, history and current Project context." />
      <div className="button-row"><Button type="submit">Save Planner guidance</Button><Button type="button" variant="outline" onClick={() => setGuidance(undefined)}>Reload saved guidance</Button></div>{guidance && <p className="hint">Unsaved Planner guidance</p>}
    </fieldset></form>
    <section className="settings-section runner-section"><div className="section-label"><h2>Runners & installed tools</h2><Button variant="outline" onClick={refresh}>Refresh status</Button></div>
      {infrastructureError && <p role="alert">{infrastructureError.message}</p>}
      {!infrastructure && !infrastructureError && <p>Loading Runner status…</p>}
      {infrastructure?.runners.length === 0 && <p className="inline-note">No Runner enrolled yet. Complete the host setup to connect an execution machine.</p>}
      {infrastructure?.runners.map((runner) => <article className="runner" key={runner.runner_id}><div className="section-label"><strong>{runner.runner_id}</strong><span className={runner.online ? 'tag positive' : 'tag'}>{runner.online ? 'Online' : 'Offline'}</span></div><p className="hint">{runner.capacity} execution slots</p>{!runner.runtimes.length && <p>No installation report received.</p>}{runner.runtimes.map(({ installation, observed_at, current }) => <div className="runtime-row" key={installation.runtime_id}><div><strong>{installation.runtime_id}</strong><span>{installation.version ?? 'Version unavailable'}</span></div><div><span className="tag">{installation.availability === 'detected' ? 'Installation detected' : installation.availability === 'not_found' ? 'Not found' : 'Unavailable'}</span><small>{current ? 'Observed' : 'Previous connection'} · {new Date(observed_at).toLocaleString()}</small></div></div>)}</article>)}
      <p className="hint">Installation checks do not verify CLI login or model access. Install and sign in to coding tools on the Runner yourself.</p>
    </section>
    <form className="settings-section editor" onSubmit={async (event) => { event.preventDefault(); if (await save('save_policies', draft.value, draft.basis)) setLocal(undefined); }}><fieldset disabled={disabled}><h2>Execution policies</h2><p className="hint">A one-off choice takes priority, then the Role or Planner policy, then the global default. Changes apply to future executions.</p>
      {(['global', 'planner'] as const).map((scope) => <section className="subsection" key={scope}><CheckField label={scope === 'global' ? 'Set a global default policy' : 'Set a Planner policy'} checked={!!draft.value[scope]} disabled={disabled} onCheckedChange={(checked) => { const value = { ...draft.value }; if (checked) value[scope] = emptyPolicy(); else delete value[scope]; update(value); }} />{draft.value[scope] && <PolicyEditor value={draft.value[scope]} infrastructure={infrastructure} onChange={(value) => update({ ...draft.value, [scope]: value })} />}</section>)}
      <EditorActions dirty={!!local} disabled={disabled} reload={() => setLocal(undefined)} />
    </fieldset></form>
  </>;
}
