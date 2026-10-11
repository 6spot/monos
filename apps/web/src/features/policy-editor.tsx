import type { ExecutionPolicy, ExecutionTarget, InfrastructureSnapshot } from '../../../../packages/protocol/generated/types.ts';
import { Button } from '../components/ui/button.tsx';
import { Field, Select } from '../components/forms.tsx';

export const emptyPolicy = (): ExecutionPolicy => ({ default_target: { runtime_id: 'opencode' }, fallback_targets: [] });
export function PolicyEditor({ value, onChange, infrastructure }: { value: ExecutionPolicy; onChange: (policy: ExecutionPolicy) => void; infrastructure?: InfrastructureSnapshot }) {
  function targetEditor(target: ExecutionTarget, change: (value: ExecutionTarget) => void, label: string) {
    const runtimes = [...new Set(['opencode', 'codex', target.runtime_id])];
    const supported = target.runtime_id === 'opencode' || target.runtime_id === 'codex';
    const runners = infrastructure?.runners.filter((runner) => !target.runner_id || runner.runner_id === target.runner_id) ?? [];
    const thinkingLevels = [...new Set(['none', 'minimal', 'low', 'medium', 'high', 'xhigh', ...(target.thinking_level ? [target.thinking_level] : [])])];
    return <div className="target-fields"><h4>{label}</h4><div className="field-grid">
      <Select label={`${label} Runtime`} value={target.runtime_id} onChange={(event) => change({ runtime_id: event.target.value })}>{runtimes.map((id) => <option key={id}>{id}</option>)}</Select>
      <Select label={`${label} Runner`} value={target.runner_id ?? ''} onChange={(event) => { const rest = { ...target }; delete rest.runner_id; change(event.target.value ? { ...rest, runner_id: event.target.value } : rest); }}><option value="">Auto placement</option>{[...new Set([...(target.runner_id ? [target.runner_id] : []), ...(infrastructure?.runners.map((r) => r.runner_id) ?? [])])].map((id) => <option key={id}>{id}</option>)}</Select>
      {supported && <Field label={`${label} model`} value={target.model_id ?? ''} required maxLength={256} placeholder="Enter an explicit model identifier" hint={target.runtime_id === 'opencode' ? 'Required. Current OpenCode targets: opencode/longcat-2.5-preview-free or volcengine/deepseek-v4-flash-ga-260731. Manual entry stays available.' : 'Required. Enter the model identifier to pass to Codex, including models not yet discovered on the Runner.'} onChange={(model) => { const rest = { ...target }; delete rest.model_id; change(model ? { ...rest, model_id: model } : rest); }} />}
      {target.runtime_id === 'codex' && <Select label={`${label} thinking level`} value={target.thinking_level ?? ''} onChange={(event) => { const rest = { ...target }; delete rest.thinking_level; change(event.target.value ? { ...rest, thinking_level: event.target.value } : rest); }}><option value="">Use CLI default</option>{thinkingLevels.map((level) => <option key={level} value={level}>{level}</option>)}</Select>}
    </div>
      {!supported && <p className="inline-note">This Runtime is not supported by the current product. Select OpenCode or Codex to configure this target.</p>}
      <div className="policy-observations" aria-label={`${label} Runner observations`}>
        <p className="hint">{target.runner_id ? 'Pinned Runner observations' : 'Auto placement observations by Runner'}. Installation reports do not verify model access. You can edit supported fields before a Runner reports.</p>
        {!runners.length && <p className="hint">{target.runner_id ? 'The pinned Runner has no registry entry in the current snapshot.' : 'No Runner observations available.'}</p>}
        {runners.map((runner) => {
          const observation = runner.runtimes.find((runtime) => runtime.installation.runtime_id === target.runtime_id);
          return <p key={runner.runner_id} className="hint"><strong>{runner.runner_id}</strong> · {runner.online ? 'Online' : 'Offline'} · {observation ? <>{observation.current ? 'Current connection' : 'Previous connection'} · {observation.installation.availability === 'detected' ? 'Installation detected' : observation.installation.availability === 'not_found' ? 'Not found' : 'Installation unavailable'} · Model control: {observation.installation.supports_model ? 'reported' : 'not reported'} · Thinking control: {observation.installation.supports_thinking ? 'reported' : 'not reported'} · {new Date(observation.observed_at).toLocaleString()}</> : 'No installation report for this Runtime.'}</p>;
        })}
      </div>
    </div>;
  }
  return <div className="policy-editor">
    {targetEditor(value.default_target, (target) => onChange({ ...value, default_target: target }), 'Default')}
    {value.fallback_targets.map((target, index) => <div className="fallback" key={index}>{targetEditor(target, (updated) => onChange({ ...value, fallback_targets: value.fallback_targets.map((row, i) => i === index ? updated : row) }), `Fallback ${index + 1}`)}<Button type="button" variant="ghost" onClick={() => onChange({ ...value, fallback_targets: value.fallback_targets.filter((_, i) => i !== index) })}>Remove fallback {index + 1}</Button></div>)}
    <Button type="button" variant="outline" disabled={value.fallback_targets.length >= 16} onClick={() => onChange({ ...value, fallback_targets: [...value.fallback_targets, { runtime_id: 'opencode' }] })}>Add fallback target</Button>
    <Field type="number" min={1} max={604800} step={1} label="Attention after (seconds)" value={value.duration_budget?.toString() ?? ''} placeholder="No threshold" hint="Raises attention only. It never stops work or triggers a fallback." onChange={(text) => { const rest = { ...value }; delete rest.duration_budget; onChange(text ? { ...rest, duration_budget: Number(text) } : rest); }} />
  </div>;
}
