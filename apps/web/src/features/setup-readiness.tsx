import { useRef } from 'react';
import type { SetupPolicyStatus, SetupPolicyStatusReason, SetupReport, StorageHealth, Unverified } from '../../../../packages/protocol/generated/types.ts';
import { Button } from '../components/ui/button.tsx';

const reasons: Record<SetupPolicyStatusReason, string> = {
  policy_missing: 'No execution policy is configured.',
  role_missing: 'The selected Role is missing or hidden.',
  unsupported_runtime: 'The configured Runtime is unsupported.',
  unsupported_model: 'The target needs an explicit supported model.',
  unsupported_thinking: 'The configured thinking level is unsupported.',
  runner_missing: 'The pinned Runner is not registered.',
  runner_offline: 'The selected Runner is offline.',
  installation_stale: 'The installation report belongs to an earlier connection.',
  installation_unavailable: 'The coding tool is unavailable on the Runner.',
  model_control_unavailable: 'The installation cannot accept the configured model.',
  thinking_control_unavailable: 'The installation cannot accept a thinking level.',
  ambiguous_auto_placement: 'More than one Runner is eligible. Pin the intended Runner.',
  unsupported_runner_transfer: 'This target would require an unsupported Runner transfer.',
  runtime_targets_exhausted: 'No remaining policy target is available.',
  runner_storage_attention: 'Runner storage needs attention before new work can start.',
  database_storage_attention: 'Database storage needs attention before new work can start.',
};
const unverifiedLabels: Record<Unverified, string> = {
  storage: 'Storage durability and host recovery',
  cli_authentication: 'Coding tool login',
  model_execution: 'Actual model execution',
  git_read: 'Git read access',
  git_write: 'Git write access',
};

function focusPolicies() {
  const heading = document.getElementById('execution-policies');
  heading?.scrollIntoView({ block: 'start' });
  heading?.focus({ preventScroll: true });
}

function PolicyStatus({ policy, openHostSetup, openStorageSetup }: { policy: SetupPolicyStatus; openHostSetup: () => void; openStorageSetup: () => void }) {
  const hostAction = policy.action === 'enroll_runner' || policy.action === 'start_runner' || policy.action === 'refresh_runtime';
  return <div className="setup-policy">
    <p>{policy.status === 'available' ? 'Policy target available in this observation.' : policy.reason ? reasons[policy.reason] : 'Policy target unavailable.'}</p>
    <p className="hint">Policy source: {policy.source}{policy.target && <> · Runtime: {policy.target.runtime_id} · Model: {policy.target.model_id ?? 'Not configured'}</>}{policy.runner_id && <> · Runner: {policy.runner_id}</>}</p>
    {policy.action && <div className="button-row">
      {policy.action === 'restore_storage' ? <Button type="button" variant="outline" onClick={openStorageSetup}>Restore storage</Button> : hostAction ? <Button type="button" variant="outline" onClick={openHostSetup}>{policy.action === 'enroll_runner' ? 'Enroll a Runner' : policy.action === 'start_runner' ? 'Start or reconnect Runner' : 'Restore coding tool report'}</Button>
        : policy.action === 'configure_role' ? <><a className="task-link" href="#roles">Configure Roles</a><a className="task-link" href="#projects">Select Project Roles</a></>
          : policy.source === 'role' ? <a className="task-link" href="#roles">Edit Role policy</a>
            : <Button type="button" variant="outline" onClick={focusPolicies}>{policy.action === 'select_runner' ? 'Choose a Runner in policy' : 'Edit execution policy'}</Button>}
    </div>}
  </div>;
}

function bytes(value: number) {
  return value >= 1024 ** 3 ? `${(value / 1024 ** 3).toFixed(1)} GiB` : `${(value / 1024 ** 2).toFixed(1)} MiB`;
}

function StorageFacts({ observation }: { observation: StorageHealth }) {
  const labels: Record<StorageHealth['scope'], string> = { database: 'Database', journal: 'Runner journal', logs: 'Execution logs', cache: 'Repository cache', workspaces: 'Workspaces', inspection: 'Repository inspection' };
  return <p><strong>{labels[observation.scope]}</strong> · {observation.status === 'ok' ? 'Space above threshold' : observation.status === 'low' ? 'Low space' : 'Space unknown'}{observation.free_bytes !== undefined && <> · {bytes(observation.free_bytes)} free</>}{observation.total_bytes !== undefined && <> of {bytes(observation.total_bytes)}</>} · Minimum {bytes(observation.min_free_bytes)}</p>;
}

export function SetupReadiness({ report, error, busy, refresh }: { report?: SetupReport; error?: Error | null; busy: boolean; refresh: () => void }) {
  const hostSetup = useRef<HTMLDetailsElement>(null);
  const storageSetup = useRef<HTMLDetailsElement>(null);
  function openHostSetup() {
    if (!hostSetup.current) return;
    hostSetup.current.open = true;
    hostSetup.current.scrollIntoView({ block: 'start' });
    hostSetup.current.querySelector('summary')?.focus({ preventScroll: true });
  }
  function openStorageSetup() {
    if (!storageSetup.current) return;
    storageSetup.current.open = true;
    storageSetup.current.scrollIntoView({ block: 'start' });
    storageSetup.current.querySelector('summary')?.focus({ preventScroll: true });
  }
  return <section className="settings-section setup-readiness" aria-label="Setup status">
    <div className="section-label"><h2>Setup status</h2><Button type="button" variant="outline" disabled={busy} onClick={refresh}>{busy ? 'Checking setup…' : error ? 'Retry setup check' : 'Refresh setup'}</Button></div>
    <p className="hint">Configuration and connection observations for saved settings. These checks do not run a model or prove that a Task will execute.</p>
    {error && <p className="notice error" role="alert">{error.message}{report ? ' Showing the last successful observation.' : ''}</p>}
    {!report && !error && <p role="status">Loading setup status…</p>}
    {report && <>
      <p className="hint">Observed {new Date(report.observed_at).toLocaleString()} · Configuration {report.configuration_version}</p>
      {report.schema.status === 'mismatch' && <p className="notice error" role="alert">Database schema {report.schema.current_version} does not match server schema {report.schema.expected_version}. Use the matching current server build and run its database initialization command on the backend host.</p>}
      <article className="setup-item"><h3>Planner</h3><PolicyStatus policy={report.planner} openHostSetup={openHostSetup} openStorageSetup={openStorageSetup} /></article>
      {!report.projects.length && <p className="inline-note">Create a reusable <a href="#roles">Role</a> and a <a href="#projects">Project</a> with its selected Roles before creating an execution Task.</p>}
      {report.projects.map((project) => <article className="setup-item" key={project.project_id}><h3>{project.name || 'Untitled Project'}</h3>
        {project.status === 'missing_roles' && <p>This Project needs available Roles. <a className="task-link" href="#roles">Create or restore Roles</a> · <a className="task-link" href="#projects">Select Project Roles</a></p>}
        {project.roles.map((role) => <div className="setup-role" key={role.role_id}><h4>{role.name || 'Unavailable Role'}</h4><PolicyStatus policy={role.policy} openHostSetup={openHostSetup} openStorageSetup={openStorageSetup} /></div>)}
      </article>)}
      <div className="setup-item"><h3>Storage and execution limits</h3>
        <p className="hint">Free-space measurements describe one observation. Missing or old reports leave current storage unverified.</p>
        {report.database_storage ? <div className="setup-role"><StorageFacts observation={report.database_storage.observation} /><p className="hint">{report.database_storage.current ? 'Current observation' : 'Previous or expired observation'} · {new Date(report.database_storage.observed_at).toLocaleString()}</p></div> : <p>Database storage has not been reported.</p>}
        {report.runners.map((runner) => <div className="setup-role" key={runner.runner_id}><h4>Runner {runner.runner_id}</h4>
          {runner.credential_revoked && <p>Runner credential revoked. Use local Runner administration to restore access before reconnecting.</p>}
          {runner.resources ? <>
            <p className="hint">{runner.resources.current && runner.online ? 'Current observation' : 'Previous or expired observation'} · {new Date(runner.resources.observed_at).toLocaleString()}</p>
            {runner.resources.observation.storage.map((observation) => <StorageFacts key={observation.scope} observation={observation} />)}
            <p className="hint">Execution limits: CPU {runner.resources.observation.execution_limits.cpu_quota_percent}% · Memory {bytes(runner.resources.observation.execution_limits.memory_max_bytes)} · Processes {runner.resources.observation.execution_limits.tasks_max}</p>
            <p className="hint">Retention: logs {runner.resources.observation.log_retention_hours} hours · Inspection snapshots {runner.resources.observation.inspection_retention_hours} hours</p>
          </> : <p>Runner storage and execution limits have not been reported.</p>}
        </div>)}
        <Button type="button" variant="outline" onClick={openStorageSetup}>Storage recovery steps</Button>
      </div>
      <div className="setup-item"><h3>Still unverified</h3><ul>{report.unverified.map((item) => <li key={item}>{unverifiedLabels[item]}</li>)}</ul><p className="hint">Verify these on the host through actual tool and repository operations. A connected Runner or an available policy does not establish them.</p></div>
    </>}
    <details className="setup-help" ref={storageSetup}><summary>Storage recovery</summary>
      <p>Inspect the affected volume on the backend or Runner host. Restore free space above the reported threshold or repair its mount and permissions. Preserve the database, Runner identity, journal and active workspaces.</p>
      <p>After repair, refresh setup. Reconnect the Runner if its report is missing or from an earlier connection. Retry affected work through its existing Task controls once the current report has recovered.</p>
    </details>
    <details className="setup-help" ref={hostSetup}><summary>Runner enrollment and recovery</summary>
      <p>For a fresh single-host installation, follow <code>infra/install/README.md</code> in the monos checkout. Its installer combines backend setup, Owner bootstrap, private Runner configuration, enrollment and service startup.</p>
      <p>On the backend host, issue a temporary enrollment grant using the local administrative command. Keep the grant in a private file and pass it to the Runner through stdin.</p>
      <pre><code>{'umask 077\npnpm runner:enroll-token < enrollment-options.json > enrollment-grant.json'}</code></pre>
      <p><code>enrollment-options.json</code> contains <code>{'{ "schema_version": 1, "capacity": 2, "ttl_seconds": 900 }'}</code>. Use the backend’s configured database environment.</p>
      <p>After provisioning the Runner service account and its trusted configuration, run on the Runner host:</p>
      <pre><code>{'sudo -u monos-probe /usr/local/libexec/monos-runner enroll --config /etc/monos-probe/runner.json < enrollment-grant.json\nsystemctl start monos-probe-runner.service'}</code></pre>
      <p>For interrupted enrollment, repeat the same enroll command with <code>&lt; /dev/null</code> to recover its original request. Preserve the identity and journal; an existing Runner reconnects with its saved identity.</p>
      <p>For an offline Runner, inspect <code>systemctl status monos-probe-runner.service</code> and restore its backend connection. For a missing tool report, install or repair the coding CLI under the execution account and reconnect the Runner. Tool login stays on the Runner host.</p>
      <p>Complete host prerequisites and private file permissions are in <code>infra/runner/README.md</code> and <code>infra/runner/enrollment.md</code> in the monos checkout.</p>
    </details>
    <details className="setup-help"><summary>Run setup diagnosis from a terminal</summary>
      <p>In the monos checkout, prepare a private <code>doctor-input.json</code> containing your backend origin and Owner password, plus <code>ca_file</code> only for a custom CA. Pass it through stdin:</p>
      <pre><code>{'pnpm doctor < doctor-input.json'}</code></pre>
      <p>The input fields are <code>endpoint</code>, <code>password</code>, and optional <code>ca_file</code>. The command reads the same setup report and closes its temporary Owner session.</p>
    </details>
  </section>;
}
