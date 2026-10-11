import { useEffect, useState } from 'react';
import type { CleanupAttentionReason, ConfigurationResult, ConfigurationSnapshot, InfrastructureSnapshot, PolicyConfiguration, SetupReport } from '../../../../packages/protocol/generated/types.ts';
import { Button } from '../components/ui/button.tsx';
import { CheckField, EditorActions, Field, PageHeading } from '../components/forms.tsx';
import type { Draft, Save } from '../components/forms.tsx';
import { emptyPolicy, PolicyEditor } from './policy-editor.tsx';
import { SetupReadiness } from './setup-readiness.tsx';

const cleanupReasons: Record<CleanupAttentionReason, string> = {
  ownership_unresolved: 'Workspace ownership is still unresolved. Files have been preserved.',
  storage_identity_mismatch: 'The Runner storage identity changed. Restore the original storage before cleanup can continue.',
  result_unavailable: 'The retained result could not be verified. Private work has been preserved.',
  cleanup_failed: 'Cleanup failed. Inspect Runner storage and reconnect after repairing it.',
  request_too_large: 'This Task exceeds the cleanup request limit. Its private work has been retained.',
};

export function Execution({ snapshot, infrastructure, infrastructureError, setup, setupError, setupBusy, refresh, save, disabled, committed }: { snapshot: ConfigurationSnapshot; infrastructure?: InfrastructureSnapshot; infrastructureError?: Error | null; setup?: SetupReport; setupError?: Error | null; setupBusy: boolean; refresh: () => void; save: Save; disabled: boolean; committed?: ConfigurationResult }) {
  const [local, setLocal] = useState<Draft<PolicyConfiguration>>();
  const [guidance, setGuidance] = useState<Draft<string>>();
  const [retention, setRetention] = useState<Draft<{ enabled: boolean; days: string }>>();
  useEffect(() => { if (committed?.entity_id === 'save_policies') setLocal(undefined); }, [committed]);
  useEffect(() => { if (committed?.entity_id === 'save_planner_guidance') setGuidance(undefined); }, [committed]);
  useEffect(() => { if (committed?.entity_id === 'save_retention') setRetention(undefined); }, [committed]);
  const draft = local ?? { value: snapshot.policies, basis: snapshot.control_version };
  const guidanceDraft = guidance ?? { value: snapshot.planner_guidance ?? '', basis: snapshot.control_version };
  const retentionDraft = retention ?? { value: { enabled: snapshot.retention?.enabled ?? true, days: String(snapshot.retention?.completed_task_days ?? 7) }, basis: snapshot.control_version };
  function update(value: PolicyConfiguration) { setLocal({ value, basis: draft.basis }); }
  return <><PageHeading title="Execution" description="Choose how future work runs and inspect your connected Runners." />
    <SetupReadiness report={setup} error={setupError} busy={setupBusy} refresh={refresh} />
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
    <form className="settings-section editor" onSubmit={async (event) => { event.preventDefault(); if (await save('save_policies', draft.value, draft.basis)) setLocal(undefined); }}><fieldset disabled={disabled}><h2 id="execution-policies" tabIndex={-1}>Execution policies</h2><p className="hint">The Role or Planner policy takes priority over the global default. Changes apply to future executions.</p>
      {(['global', 'planner'] as const).map((scope) => <section className="subsection" key={scope}><CheckField label={scope === 'global' ? 'Set a global default policy' : 'Set a Planner policy'} checked={!!draft.value[scope]} disabled={disabled} onCheckedChange={(checked) => { const value = { ...draft.value }; if (checked) value[scope] = emptyPolicy(); else delete value[scope]; update(value); }} />{draft.value[scope] && <PolicyEditor value={draft.value[scope]} infrastructure={infrastructure} onChange={(value) => update({ ...draft.value, [scope]: value })} />}</section>)}
      <EditorActions dirty={!!local} disabled={disabled} reload={() => setLocal(undefined)} />
    </fieldset></form>
    <form className="settings-section editor" aria-label="Completed Task cleanup settings" onSubmit={async (event) => {
      event.preventDefault();
      if (await save('save_retention', { enabled: retentionDraft.value.enabled, completed_task_days: Number(retentionDraft.value.days) }, retentionDraft.basis)) setRetention(undefined);
    }}><fieldset disabled={disabled}>
      <h2>Completed Task cleanup</h2>
      <p className="hint">Remove disposable worktrees and dependencies after completed Tasks reach the selected age. Formal Artifacts, results and history remain available. Cancelled Tasks keep their private work.</p>
      <p className="hint">Changes apply to new cleanup operations. Cleanup already queued or running keeps its original settings.</p>
      <CheckField label="Automatically clean up completed Tasks" checked={retentionDraft.value.enabled} disabled={disabled} onCheckedChange={(enabled) => setRetention({ value: { ...retentionDraft.value, enabled }, basis: retentionDraft.basis })} />
      <Field type="number" label="Days after Task completion" value={retentionDraft.value.days} min={1} max={3650} step={1} required hint="1–3650 days. The saved interval is retained when automatic cleanup is disabled." onChange={(days) => setRetention({ value: { ...retentionDraft.value, days }, basis: retentionDraft.basis })} />
      {setup?.cleanup && <p className="hint">Cleanup operations: {setup.cleanup.pending} pending · {setup.cleanup.completed} completed · {setup.cleanup.attention} need attention. Refresh setup for the latest observations.</p>}
      {setup?.cleanup?.attention_items?.map((item) => <div className="setup-item" key={`${item.task_id}:${item.runner_id}`}>
        <p>{cleanupReasons[item.reason]}</p><p className="hint">Task {item.task_id} · Runner {item.runner_id}</p>
        <a className="task-link" href={`#task?${new URLSearchParams({ task_id: item.task_id, section: 'execution' })}`}>View Task execution details</a>
      </div>)}
      {!!setup?.cleanup && setup.cleanup.attention > (setup.cleanup.attention_items?.length ?? 0) && <p className="hint">Showing {setup.cleanup.attention_items?.length ?? 0} of {setup.cleanup.attention} cleanup items needing attention.</p>}
      <div className="button-row"><Button type="submit">Save cleanup settings</Button><Button type="button" variant="outline" onClick={() => setRetention(undefined)}>Reload cleanup settings</Button></div>
      {retention && <p className="hint">Unsaved cleanup settings</p>}
    </fieldset></form>
  </>;
}
