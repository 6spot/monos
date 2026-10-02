import { useEffect, useState } from 'react';
import type { ConfigurationResult, ConfigurationSnapshot, InfrastructureSnapshot, RoleConfiguration } from '../../../../packages/protocol/generated/types.ts';
import { Button } from '../components/ui/button.tsx';
import { CheckField, EditorActions, Field, PageHeading } from '../components/forms.tsx';
import type { Draft, Save } from '../components/forms.tsx';
import { emptyPolicy, PolicyEditor } from './policy-editor.tsx';

export function Roles({ snapshot, infrastructure, save, disabled, committed }: { snapshot: ConfigurationSnapshot; infrastructure?: InfrastructureSnapshot; save: Save; disabled: boolean; committed?: ConfigurationResult }) {
  const [selected, setSelected] = useState<string>();
  const [drafts, setDrafts] = useState<Record<string, Draft<RoleConfiguration>>>({});
  useEffect(() => { if (committed?.entity_id) setDrafts((all) => { const next = { ...all }; delete next[committed.entity_id!]; return next; }); }, [committed]);
  const id = selected ?? snapshot.roles[0]?.id;
  const saved = snapshot.roles.find((role) => role.id === id);
  const draft = id ? drafts[id] ?? (saved ? { value: saved, basis: snapshot.control_version } : undefined) : undefined;
  function update(value: RoleConfiguration) { setDrafts((all) => ({ ...all, [value.id]: { value, basis: draft?.basis ?? snapshot.control_version } })); }
  function create() { const value = { id: crypto.randomUUID(), name: '', description: '', instructions: '', archived: false }; setDrafts((all) => ({ ...all, [value.id]: { value, basis: snapshot.control_version } })); setSelected(value.id); }
  function clear() { if (id) setDrafts((all) => { const next = { ...all }; delete next[id]; return next; }); }
  const rows = [...snapshot.roles, ...Object.values(drafts).filter((row) => !snapshot.roles.some((r) => r.id === row.value.id)).map((row) => row.value)];
  return <><PageHeading title="Roles" description="Reusable instructions for how your agents work." action={<Button disabled={disabled} onClick={create}>New role</Button>} />
    <div className="split-view"><aside className="record-list" aria-label="Role list">{rows.map((role) => <button type="button" key={role.id} aria-pressed={id === role.id} className={id === role.id ? 'record selected' : 'record'} onClick={() => setSelected(role.id)}><span>{drafts[role.id]?.value.name || role.name || 'Untitled role'}</span><small>{role.archived ? 'Hidden' : 'Available'}{drafts[role.id] ? ' · Draft' : ''}</small></button>)}{!rows.length && <p className="empty-list">Create a role to define how an agent should work.</p>}</aside>
      {draft ? <form className="editor" onSubmit={async (event) => { event.preventDefault(); if (await save('save_role', draft.value, draft.basis)) clear(); }}><fieldset disabled={disabled}><div className="section-label"><h2>Role details</h2><span className="tag">Reusable</span></div>
        <Field label="Role name" value={draft.value.name} onChange={(name) => update({ ...draft.value, name })} required maxLength={200} placeholder="e.g. Product engineer" />
        <Field label="Description" value={draft.value.description} onChange={(description) => update({ ...draft.value, description })} maxLength={4000} placeholder="When should Planner choose this role?" />
        <Field label="Instructions" multiline rows={9} value={draft.value.instructions} onChange={(instructions) => update({ ...draft.value, instructions })} maxLength={64000} hint="Describe behavior and verification habits. Keep project-specific constraints in Project context." />
        <CheckField label="Hide from new selections" checked={draft.value.archived} disabled={disabled} onCheckedChange={(archived) => update({ ...draft.value, archived })} />
        <div className="subsection"><CheckField label="Use a custom execution policy" checked={!!draft.value.execution_policy} disabled={disabled} onCheckedChange={(checked) => { const rest = { ...draft.value }; delete rest.execution_policy; update(checked ? { ...rest, execution_policy: emptyPolicy() } : rest); }} />{draft.value.execution_policy && <PolicyEditor value={draft.value.execution_policy} infrastructure={infrastructure} onChange={(execution_policy) => update({ ...draft.value, execution_policy })} />}</div>
        <EditorActions dirty={!!(id && drafts[id])} disabled={disabled} reload={() => { clear(); if (!saved) setSelected(undefined); }} />
      </fieldset></form> : <div className="empty-state"><h2>No Roles yet</h2><p>Define reusable behavior once, then select it in any Project.</p><Button disabled={disabled} onClick={create}>Create your first role</Button></div>}
    </div></>;
}
