import { cleanupSummary } from './task-cleanup.ts';
import { readRunnerConfigurations } from './runner-observations.ts';
import { transaction } from '../../../packages/db/src/index.ts';
import type { Database } from '../../../packages/db/src/index.ts';
import { latestSchemaVersion } from '../../../packages/db/src/migrate.ts';
import { CommandError } from '../../../packages/domain/src/commands.ts';
import { canonicalJSON, MAX_BODY_BYTES, validate } from '../../../packages/protocol/src/index.ts';
import type { ExecutionPolicy, BackendStorageObservation, PolicyConfiguration, SetupPolicyStatus, SetupProjectStatus, SetupReport } from '../../../packages/protocol/src/index.ts';
import { authenticateOwner } from './owner-commands.ts';
import { diagnoseRuntimePolicy } from './runtime-scheduling.ts';
import type { RuntimePolicyDiagnosis, SelectionReason } from './runtime-scheduling.ts';

const actions: Record<SelectionReason, NonNullable<SetupPolicyStatus['action']>> = {
  policy_missing: 'configure_policy', role_missing: 'configure_role', runner_missing: 'select_runner', runner_offline: 'start_runner',
  installation_stale: 'refresh_runtime', installation_unavailable: 'refresh_runtime', ambiguous_auto_placement: 'select_runner',
  unsupported_runtime: 'review_target', unsupported_model: 'review_target', unsupported_thinking: 'review_target',
  model_control_unavailable: 'review_target', thinking_control_unavailable: 'review_target',
  unsupported_runner_transfer: 'select_runner', runtime_targets_exhausted: 'review_target',
  runner_storage_attention: 'restore_storage', database_storage_attention: 'restore_storage',
};

function policyStatus(diagnosis: RuntimePolicyDiagnosis, hasRunners: boolean): SetupPolicyStatus {
  return diagnosis.status === 'available' ? diagnosis : { ...diagnosis,
    action: !hasRunners && (diagnosis.reason === 'installation_unavailable' || diagnosis.reason === 'runner_missing') ? 'enroll_runner' : actions[diagnosis.reason] };
}

// This authenticated snapshot is a setup diagnosis, never queue admission or a
// reservation. Unverified host/provider facts remain explicit even when every
// currently configured policy has a compatible Runner.
export async function setupReadiness(db: Database, token: string, instanceId: string): Promise<SetupReport> {
  return transaction(db, async tx => {
    // Authentication holds its ordinary session SHARE lock. All remaining data
    // reads use this snapshot; no configuration or Runner locks are requested.
    await tx.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ');
    await authenticateOwner(tx, token);
    const observedAt = (await tx.query<{ observed_at: Date }>('SELECT clock_timestamp() observed_at')).rows[0]!.observed_at.toISOString();
    const configuration = (await tx.query<{ version: string }>('SELECT version FROM configuration_control')).rows[0]!;
    const schema = (await tx.query<{ first: number | null; current: number; count: number }>(
      'SELECT min(version) first,COALESCE(max(version),0) current,count(*)::int count FROM schema_migrations')).rows[0]!;
    const runners = await readRunnerConfigurations(tx, instanceId, observedAt);
    const storage = (await tx.query<BackendStorageObservation>(`SELECT observation,
      to_char(observed_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') observed_at,
      observed_at>$2::timestamptz-interval '15 seconds' AS current FROM backend_storage_observations WHERE instance_id=$1`, [instanceId, observedAt])).rows[0];
    const projects = (await tx.query<{ id: string; name: string }>('SELECT id,name FROM projects WHERE NOT archived ORDER BY id')).rows;
    const roles = (await tx.query<{ project_id: string; role_id: string; name: string; execution_policy: ExecutionPolicy | null }>(`SELECT pr.project_id,r.id role_id,r.name,r.execution_policy
      FROM project_roles pr JOIN roles r ON r.id=pr.role_id JOIN projects p ON p.id=pr.project_id
      WHERE NOT r.archived AND NOT p.archived ORDER BY pr.project_id,r.id`)).rows;
    const policies = (await tx.query<{ policies: PolicyConfiguration }>('SELECT policies FROM execution_policies')).rows[0]!.policies;
    const planner = policyStatus(await diagnoseRuntimePolicy(tx, instanceId, { kind: 'planner', policies }, observedAt), runners.length > 0);
    // Shared Role policies are diagnosed once per snapshot, including the
    // common Global fallback used by many Projects and Roles.
    const diagnoses = new Map<string, SetupPolicyStatus>();
    const projectRows: SetupProjectStatus[] = [];
    for (const project of projects) {
      const selected: SetupProjectStatus['roles'] = [];
      for (const role of roles.filter(role => role.project_id === project.id)) {
        const key = canonicalJSON(role.execution_policy);
        let policy = diagnoses.get(key);
        if (!policy) {
          policy = policyStatus(await diagnoseRuntimePolicy(tx, instanceId, { kind: 'node', policies, role_policy: role.execution_policy }, observedAt), runners.length > 0);
          diagnoses.set(key, policy);
        }
        selected.push({ role_id: role.role_id, name: role.name, policy });
      }
      projectRows.push({ project_id: project.id, name: project.name,
        status: selected.length === 0 ? 'missing_roles' : selected.some(role => role.policy.status === 'unavailable') ? 'runtime_unavailable' : 'configured', roles: selected });
    }
    const report: SetupReport = { schema_version: 1, observed_at: observedAt, configuration_version: Number(configuration.version),
      schema: { status: schema.first === 1 && schema.current === latestSchemaVersion && schema.count === latestSchemaVersion ? 'current' : 'mismatch',
        current_version: schema.current, expected_version: latestSchemaVersion },
      planner, projects: projectRows, runners, cleanup: await cleanupSummary(tx), ...(storage ? { database_storage: storage } : {}), unverified: ['storage', 'cli_authentication', 'model_execution', 'git_read', 'git_write'] };
    if (Buffer.byteLength(JSON.stringify(report)) > MAX_BODY_BYTES) throw new CommandError('unmet_precondition', 'Setup report exceeds the current 2 MiB response limit');
    return validate('SetupReport', report);
  });
}
