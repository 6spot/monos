import type { Transaction } from '../../../packages/db/src/index.ts';
import { CommandError } from '../../../packages/domain/src/commands.ts';
import { validate } from '../../../packages/protocol/src/index.ts';
import type { RunnerConfiguration, RunnerResources } from '../../../packages/protocol/src/index.ts';

export function runnerResources(input: unknown): RunnerResources {
  const resources = validate<RunnerResources>('RunnerResources', input);
  const scopes = new Set(resources.storage.map(item => item.scope));
  if (scopes.size !== 5 || scopes.has('database'))
    throw new CommandError('invalid_input', 'Runner storage report must contain each local scope once');
  for (const item of resources.storage) {
    if (item.status === 'unknown') continue;
    if (item.free_bytes! > item.total_bytes! || (item.status === 'ok') !== (item.free_bytes! >= item.min_free_bytes))
      throw new CommandError('invalid_input', 'Storage status differs from its observed threshold');
  }
  return resources;
}

export async function readRunnerConfigurations(tx: Transaction, instanceId: string, observedAt?: string): Promise<RunnerConfiguration[]> {
  const rows = (await tx.query<Omit<RunnerConfiguration, 'resources'> & { resources: RunnerConfiguration['resources'] | null }>(`SELECT r.id AS runner_id,r.capacity,r.credential_revoked,
    (r.connected AND r.ready AND r.connection_instance=$1 AND r.last_seen>COALESCE($2::timestamptz,clock_timestamp())-interval '15 seconds') AS online,
    COALESCE((SELECT jsonb_agg(jsonb_build_object('installation',i.observation,
      'observed_at',to_char(i.observed_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
      'current',i.incarnation=r.incarnation) ORDER BY i.runtime_id) FROM runtime_installations i WHERE i.runner_id=r.id),'[]'::jsonb) AS runtimes,
    CASE WHEN r.resource_observation IS NOT NULL THEN jsonb_build_object('observation',r.resource_observation,
      'observed_at',to_char(r.resource_observed_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
      'current',r.connected AND r.ready AND r.connection_instance=$1 AND r.resource_incarnation=r.incarnation
        AND r.resource_observed_at>COALESCE($2::timestamptz,clock_timestamp())-interval '15 seconds') END AS resources
    FROM runners r ORDER BY r.id`, [instanceId, observedAt ?? null])).rows;
  return rows.map(({ resources, ...runner }) => ({ ...runner, ...(resources ? { resources } : {}) }));
}
