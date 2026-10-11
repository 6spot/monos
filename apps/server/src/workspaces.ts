import { canonicalWorkspaceSource, workspaceConflictSource } from './workspace-sources.ts';
import { assertCompletionBoundaryAvailable } from './completion-boundary.ts';
export { assertCompletionBoundaryAvailable } from './completion-boundary.ts';
import type { WorkspaceTransfer } from '../../../packages/protocol/src/index.ts';
import { workspaceTransfer, hasUnadoptedReplanCheckpoint } from './task-replan-workspaces.ts';
import { serialWorkspaceTransfer } from './workspace-serial-transfer.ts';
import { reworkWorkspaceTransfer, workspaceReworkHistory } from './workspace-rework-transfer.ts';
import { randomUUID } from 'node:crypto';
import type { Transaction } from '../../../packages/db/src/index.ts';
import { CommandError } from '../../../packages/domain/src/commands.ts';
import { repositoryIdentity, validateGitRef } from '../../../packages/domain/src/repositories.ts';
import { canonicalJSON, digest, validate, workspaceId, MAX_BODY_BYTES } from '../../../packages/protocol/src/index.ts';
import type { Dispatch, EffectResult, Operation, OperationResult, WorkspaceBasis, WorkspaceCompletionInput, WorkspaceDescriptor, WorkspaceEffectResult, WorkspaceIntegration, WorkspaceMetadata, WorkspaceResource } from '../../../packages/protocol/src/index.ts';

export interface WorkspaceAttempt {
  id: string; runner_id: string; task_id: string | null; node_id: string | null; dispatch_id: string;
  node_activation: string; mutation_allowed: boolean; process_released: boolean; launch: Dispatch;
}
export interface WorkspaceOperation {
  id: string; attempt_id: string; kind: Operation['kind']; state: Operation['state']; request_id: string;
  workspace_descriptor: WorkspaceDescriptor | null; workspace_digest: string | null; workspace_lease_id: string | null;
  cancelled_by_operation_id: string | null; result: EffectResult | null;
  integration?: WorkspaceIntegration | null;
  workspaces?: WorkspaceCompletionInput[] | null;
  completion_operation_id?:string|null; completion_identity_digest?:string|null;
}
interface Workspace {
  id: string; task_id: string; project_id: string; resource_id: string; runner_id: string; generation: string;
  resource: WorkspaceResource; repository_identity: string; ever_materialized: boolean;
  storage_id: string | null; provider_metadata: WorkspaceMetadata['provider_metadata'] | null;
  base_commit: string | null; target_branch: string | null; finalized_commit: string | null;
}
interface Lease {
  id: string; workspace_id: string; task_id: string; node_id: string; node_activation: string; attempt_id: string;
  allocation_id: string | null; start_commit: string | null;
  dispatch_id: string; generation: string; open_operation_id: string; state: string; target_commit: string | null;
  settle_operation_id: string | null; checkpoint: WorkspaceMetadata['checkpoint'] | null;
  recovered_by_stop_operation_id: string | null; target_observation_lease_id: string | null;
}

export async function explicitLegacyAttempt(tx: Transaction, attemptId: string): Promise<boolean> {
  return !!(await tx.query('SELECT 1 FROM legacy_probe_attempts WHERE attempt_id=$1', [attemptId])).rowCount;
}

export async function lockAttemptWorkspace(tx: Transaction, attemptId: string): Promise<void> {
  await tx.query('SELECT w.id FROM task_workspaces w JOIN workspace_leases l ON l.workspace_id=w.id WHERE l.attempt_id=$1 ORDER BY w.resource_id,w.id FOR UPDATE OF w', [attemptId]);
  await tx.query('SELECT id FROM workspace_leases WHERE attempt_id=$1 ORDER BY id FOR UPDATE', [attemptId]);
}

export function resourceSnapshot(row: { id: string; repository_identity: string; remote_url: string; settings: Record<string, unknown> }): WorkspaceResource {
  const settings = row.settings;
  const resource: WorkspaceResource = { resource_id: row.id, repository_identity: row.repository_identity, remote_url: row.remote_url };
  if (repositoryIdentity(row.remote_url) !== row.repository_identity) throw new CommandError('denied_scope', 'Repository identity differs from its configured remote');
  for (const field of ['default_ref', 'default_branch'] as const) {
    if (settings[field] !== undefined) { validateGitRef(String(settings[field])); resource[field] = String(settings[field]); }
  }
  if (settings.provider === 'github' && settings.provider_repo_id !== undefined) {
    const id = String(settings.provider_repo_id);
    if (!/^[1-9][0-9]{0,15}$/.test(id) || !Number.isSafeInteger(Number(id))) throw new CommandError('invalid_input', 'GitHub repository ID must be a safe positive number');
    resource.provider_metadata = { github: { repository_id: id } };
  }
  return validate('WorkspaceResource', resource);
}

function basis(workspace: Workspace): WorkspaceBasis | undefined {
  if (!workspace.ever_materialized) return undefined;
  return { storage_id: workspace.storage_id!, repository_identity: workspace.repository_identity,
    ...(workspace.provider_metadata ? { provider_metadata: workspace.provider_metadata } : {}),
    base_commit: workspace.base_commit!, target_branch: workspace.target_branch!, finalized_commit: workspace.finalized_commit! };
}

async function insertOperation(tx: Transaction, attempt: WorkspaceAttempt, kind: Operation['kind'], requestId: string,
  id: string, resourceId?: string, descriptor?: WorkspaceDescriptor): Promise<string> {
  const hash = descriptor ? digest(canonicalJSON(descriptor)) : null;
  await tx.query(`INSERT INTO operations(id,attempt_id,schema_version,kind,request_id,state,resource_id,workspace_descriptor,workspace_digest,workspace_lease_id)
    VALUES($1,$2,1,$3,$4,'admitted',$5,$6,$7,$8)`, [id, attempt.id, kind, requestId, resourceId ?? null, descriptor ?? null, hash, descriptor?.lease_id ?? null]);
  await tx.query("INSERT INTO outbox(id,runner_id,attempt_id,kind,operation_id) VALUES($1,$2,$3,'effect',$4)", [randomUUID(), attempt.runner_id, attempt.id, id]);
  return id;
}

export async function admitWorkspaceOpen(tx: Transaction, attempt: WorkspaceAttempt, projectId: string | null, resourceId: string, requestId: string): Promise<string> {
  const reservations = attempt.launch.workspace_reservations;
  if (!projectId || !attempt.task_id || !attempt.node_id || !reservations || reservations.project_id !== projectId) throw new CommandError('denied_scope', 'Canonical Node workspace reservations are required');
  const reservation = reservations.resources.find((row) => row.resource_id === resourceId);
  if (!reservation || reservation.workspace_id !== workspaceId(attempt.task_id, resourceId)) throw new CommandError('denied_scope', 'Resource was not reserved for this Attempt');
  await assertCompletionBoundaryAvailable(tx, attempt.task_id);
  const resource = (await tx.query<{ id: string; repository_identity: string; remote_url: string; settings: Record<string, unknown> }>('SELECT id,repository_identity,remote_url,settings FROM project_resources WHERE id=$1 AND project_id=$2 AND active', [resourceId, projectId])).rows[0];
  if (!resource) throw new CommandError('denied_scope', 'Resource is no longer active in this Project');
  let workspace = (await tx.query<Workspace>('SELECT * FROM task_workspaces WHERE task_id=$1 AND resource_id=$2 FOR UPDATE', [attempt.task_id, resourceId])).rows[0];
  if (workspace && workspace.runner_id !== attempt.runner_id) throw new CommandError('unmet_precondition', 'Workspace belongs to another Runner; transfer is unsupported');
  const allocationId = reservation.isolation?.allocation_id ?? null;
  if (workspace && !workspace.ever_materialized && (await tx.query("SELECT 1 FROM workspace_leases WHERE workspace_id=$1 AND state<>'released' AND attempt_id<>$2", [workspace.id, attempt.id])).rowCount) throw new CommandError('unmet_precondition', 'Canonical workspace initialization must settle before another open');
  if (workspace && (await tx.query("SELECT 1 FROM workspace_leases WHERE workspace_id=$1 AND state<>'released' AND attempt_id<>$2 AND ($3::text IS NULL OR allocation_id IS NULL)", [workspace.id, attempt.id, allocationId])).rowCount) throw new CommandError('unmet_precondition', 'Direct workspace ownership is exclusive');
  const held = workspace ? (await tx.query<Lease>("SELECT * FROM workspace_leases WHERE workspace_id=$1 AND allocation_id IS NOT DISTINCT FROM $2::text AND state<>'released' FOR UPDATE", [workspace.id, allocationId])).rows[0] : undefined;
  if (held) {
    if (held.attempt_id !== attempt.id || held.node_id !== attempt.node_id || held.node_activation !== attempt.node_activation || held.state !== 'held') throw new CommandError('unmet_precondition', 'ownership_unresolved: prior workspace lease must settle');
    return held.open_operation_id;
  }
  let transfer: WorkspaceTransfer|undefined;
  let hasAllocationPredecessor = false;
  const reworkHistory = workspace ? await workspaceReworkHistory(tx, attempt, workspace.id) : [];
  if (workspace) {
    const interrupted = (await tx.query<Lease>('SELECT * FROM workspace_leases WHERE workspace_id=$1 AND allocation_id IS NOT DISTINCT FROM $2::text ORDER BY created_at DESC,id DESC LIMIT 1', [workspace.id, allocationId])).rows[0];
    hasAllocationPredecessor = !!interrupted;
    if (interrupted) transfer = await workspaceTransfer(tx, attempt, workspace.id, interrupted.id);
    if (interrupted && !transfer && (interrupted.node_id !== attempt.node_id || interrupted.node_activation !== attempt.node_activation)) {
      transfer = reworkWorkspaceTransfer(attempt, workspace, interrupted.id, reworkHistory)
        ?? await serialWorkspaceTransfer(tx, attempt, workspace.id, interrupted.id);
      if (!transfer && workspace.ever_materialized) throw new CommandError('unmet_precondition', 'Interrupted workspace requires explicit activation disposition');
    }
  }
  const id = randomUUID(), leaseId = randomUUID();
  const snapshot = workspace?.ever_materialized ? workspace.resource : resourceSnapshot(resource);
  if (!workspace) {
    workspace = (await tx.query<Workspace>(`INSERT INTO task_workspaces(id,task_id,project_id,resource_id,runner_id,resource,repository_identity,created_by_operation_id)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`, [reservation.workspace_id, attempt.task_id, projectId, resourceId, attempt.runner_id, snapshot, resource.repository_identity, id])).rows[0]!;
  } else if (!workspace.ever_materialized) {
    await tx.query("UPDATE task_workspaces SET resource=$2,state='reserved' WHERE id=$1", [workspace.id, snapshot]);
  }
  const priorBasis = basis(workspace);
  const canonicalSource = reservation.isolation && priorBasis ? await canonicalWorkspaceSource(tx, workspace.id) : undefined;
  const conflictSource = reservation.isolation && priorBasis ? await workspaceConflictSource(tx, workspace.id, attempt.node_id, attempt.node_activation) : undefined;
  if (!transfer && !hasAllocationPredecessor && canonicalSource && canonicalSource.kind === 'complete_node') {
    transfer = await workspaceTransfer(tx, attempt, workspace.id, canonicalSource.metadata.lease_id);
  }
  await tx.query(`INSERT INTO workspace_leases(id,workspace_id,task_id,node_id,node_activation,attempt_id,dispatch_id,generation,open_operation_id,allocation_id)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`, [leaseId, workspace.id, attempt.task_id, attempt.node_id, attempt.node_activation, attempt.id, attempt.dispatch_id, workspace.generation, id, allocationId]);
  const descriptor = validate<WorkspaceDescriptor>('WorkspaceDescriptor', { schema_version: 1, workspace_id: workspace.id, task_id: attempt.task_id,
    project_id: projectId, resource_id: resourceId, runner_id: attempt.runner_id, generation: Number(workspace.generation),
    lease_id: leaseId, node_id: attempt.node_id, node_activation: Number(attempt.node_activation), open_operation_id: id,
    resource: snapshot, ...(reservation.isolation ? { isolation: reservation.isolation } : {}),
    ...(canonicalSource ? { canonical_source: canonicalSource } : {}), ...(conflictSource ? { conflict_source: conflictSource } : {}), ...(transfer?{transfer}:{}), ...(priorBasis ? { basis: priorBasis } : {}),
    ...(reworkHistory.length ? { rework_history: reworkHistory } : {}) });
  await assertWorkspaceSetBudget(tx, attempt.id, descriptor);
  return insertOperation(tx, attempt, 'open_workspace', requestId, id, resourceId, descriptor);
}

async function assertWorkspaceSetBudget(tx: Transaction, attemptId: string, next: WorkspaceDescriptor): Promise<void> {
  const descriptors = (await tx.query<{ workspace_descriptor: WorkspaceDescriptor }>(`SELECT o.workspace_descriptor FROM workspace_leases l
    JOIN operations o ON o.id=l.open_operation_id WHERE l.attempt_id=$1 AND l.state<>'released' ORDER BY o.resource_id`, [attemptId])).rows.map(row => row.workspace_descriptor);
  descriptors.push(next);
  const inputs = descriptors.map(workspace => ({ workspace, workspace_digest: '0'.repeat(64),
    ...(workspace.isolation ? { integration: { expected_task_commit: '0'.repeat(64) } } : {}) }));
  // Reserve bounded metadata/checkpoint/capture/proof fields for every member,
  // including a maximal target ref and storage identity not known until open.
  const resultBytes = descriptors.reduce((bytes, workspace) => bytes + 16384 + Buffer.byteLength(JSON.stringify(workspace.resource.repository_identity)), 16384);
  if (descriptors.length > 64 || Buffer.byteLength(canonicalJSON(inputs)) + 16384 > MAX_BODY_BYTES || resultBytes > MAX_BODY_BYTES)
    throw new CommandError('unmet_precondition', 'workspace_set_budget_exceeded: completion and cancellation must fit before another workspace opens');
}

export async function admitWorkspaceStops(tx: Transaction, attempt: WorkspaceAttempt, requestId: string): Promise<string[]> {
  await lockAttemptWorkspace(tx, attempt.id);
  if ((await tx.query("SELECT 1 FROM operations WHERE attempt_id=$1 AND kind='complete_node'", [attempt.id])).rowCount)
    throw new CommandError('unmet_precondition', 'An admitted completion requires its aggregate settlement');
  const prior = (await tx.query<{ id: string }>("SELECT id FROM operations WHERE attempt_id=$1 AND kind='stop' ORDER BY resource_id NULLS FIRST,id", [attempt.id])).rows;
  if (prior.length) return prior.map(row => row.id);
  const leases = (await tx.query<Lease & { workspace_descriptor: WorkspaceDescriptor }>(`SELECT l.*,o.workspace_descriptor FROM workspace_leases l
    JOIN operations o ON o.id=l.open_operation_id WHERE l.attempt_id=$1 AND l.state<>'released' ORDER BY o.resource_id,l.id`, [attempt.id])).rows;
  if (!leases.length) return [await insertOperation(tx, attempt, 'stop', requestId, randomUUID())];
  const ids: string[] = [];
  for (const lease of leases) {
    const id = await insertOperation(tx, attempt, 'stop', requestId, randomUUID(), lease.workspace_descriptor.resource_id, lease.workspace_descriptor);
    await tx.query("UPDATE workspace_leases SET state='settling',settle_operation_id=$2 WHERE id=$1", [lease.id, id]);
    ids.push(id);
  }
  return ids;
}

export async function admitWorkspaceEffect(tx: Transaction, attempt: WorkspaceAttempt, kind: Operation['kind'], requestId: string, manifestDigest?: string): Promise<string> {
  if (kind === 'stop') return (await admitWorkspaceStops(tx, attempt, requestId))[0]!;
  if (kind !== 'complete_node') return insertOperation(tx, attempt, kind, requestId, randomUUID(), attempt.launch.resource_id);
  await assertCompletionBoundaryAvailable(tx, attempt.task_id!, attempt.id);
  await lockAttemptWorkspace(tx, attempt.id);
  const leases = (await tx.query<Lease & { workspace_descriptor: WorkspaceDescriptor; workspace_digest: string; open_state: string; finalized_commit: string }>(
    `SELECT l.*,o.workspace_descriptor,o.workspace_digest,o.state open_state,w.finalized_commit FROM workspace_leases l
      JOIN operations o ON o.id=l.open_operation_id JOIN task_workspaces w ON w.id=l.workspace_id
      WHERE l.attempt_id=$1 AND l.state<>'released' ORDER BY w.resource_id,l.id`, [attempt.id])).rows;
  if (leases.some(lease => lease.state !== 'held' || lease.open_state !== 'succeeded'))
    throw new CommandError('unmet_precondition', 'Every workspace open must succeed before completion');
  if (await hasUnadoptedReplanCheckpoint(tx, attempt))
    throw new CommandError('unmet_precondition', 'Open and finalize every approved inherited private workspace before completion');
  if ((await tx.query(`WITH conflict AS (SELECT o.id FROM operations o JOIN attempts a ON a.id=o.attempt_id
    WHERE a.task_id=$1 AND a.node_id=$2 AND a.node_activation=$3 AND o.kind='complete_node' AND o.state='succeeded'
      AND o.result->>'completion_outcome'='conflict' ORDER BY o.created_at DESC,o.id DESC LIMIT 1)
    SELECT 1 FROM conflict c JOIN operation_workspaces member ON member.operation_id=c.id
    WHERE NOT EXISTS(SELECT 1 FROM workspace_leases current JOIN operations opened ON opened.id=current.open_operation_id
      WHERE current.attempt_id=$4 AND current.workspace_id=member.workspace_id AND current.state='held' AND opened.state='succeeded') LIMIT 1`,
  [attempt.task_id, attempt.node_id, attempt.node_activation, attempt.id])).rowCount)
    throw new CommandError('unmet_precondition', 'Open and reconcile every captured resource from the preserved conflicting completion');
  if ((await tx.query(`SELECT 1 FROM workspace_leases l WHERE l.task_id=$1 AND l.node_id=$2 AND l.node_activation=$3 AND l.checkpoint IS NOT NULL
    AND NOT EXISTS(SELECT 1 FROM tasks t JOIN replan_publications p ON p.task_id=t.id AND p.new_plan_id=t.plan_id
      JOIN replan_proposals proposal ON proposal.id=p.proposal_id CROSS JOIN LATERAL jsonb_array_elements(proposal.content->'impact'->'workspaces') w
      WHERE t.id=l.task_id AND w.value->'input'->>'from_lease_id'=l.id AND w.value->'input'->>'kind'='checkpoint')
    AND NOT EXISTS(SELECT 1 FROM workspace_leases later WHERE later.workspace_id=l.workspace_id
      AND later.allocation_id IS NOT DISTINCT FROM l.allocation_id AND (later.created_at,later.id)>(l.created_at,l.id)) LIMIT 1`,
  [attempt.task_id, attempt.node_id, attempt.node_activation])).rowCount)
    throw new CommandError('unmet_precondition', 'Reopen and finalize all retained private workspace work before completion');
  const id = randomUUID();
  await tx.query(`INSERT INTO operations(id,attempt_id,schema_version,kind,request_id,state,completion_manifest_digest)
    VALUES($1,$2,1,'complete_node',$3,'admitted',$4)`, [id, attempt.id, requestId, manifestDigest ?? null]);
  for (const lease of leases) {
    const integration = lease.allocation_id ? { expected_task_commit: lease.finalized_commit } : null;
    await tx.query(`INSERT INTO operation_workspaces(operation_id,resource_id,workspace_id,lease_id,workspace_descriptor,workspace_digest,integration)
      VALUES($1,$2,$3,$4,$5,$6,$7)`, [id, lease.workspace_descriptor.resource_id, lease.workspace_id, lease.id, lease.workspace_descriptor, lease.workspace_digest, integration]);
    await tx.query("UPDATE workspace_leases SET state='settling',settle_operation_id=$2 WHERE id=$1", [lease.id, id]);
  }
  await tx.query("INSERT INTO outbox(id,runner_id,attempt_id,kind,operation_id) VALUES($1,$2,$3,'effect',$4)", [randomUUID(), attempt.runner_id, attempt.id, id]);
  return id;
}

/** A member Stop may finish independently. Whole Attempt ownership only leaves
 * after every admitted effect and every lease has durably settled. */
export async function releaseStoppedAttempt(tx: Transaction, attemptId: string): Promise<boolean> {
  const released = await tx.query(`UPDATE attempts a SET mutation_allowed=false,process_released=true,
    state=CASE WHEN state='RUNNING' THEN 'CANCELLED' ELSE state END
    WHERE a.id=$1 AND a.process_absent AND NOT a.mutation_allowed AND NOT a.process_released
      AND EXISTS(SELECT 1 FROM operations o WHERE o.attempt_id=a.id AND o.kind='stop' AND o.state='succeeded')
      AND NOT EXISTS(SELECT 1 FROM operations o WHERE o.attempt_id=a.id AND o.state NOT IN ('succeeded','cancelled'))
      AND NOT EXISTS(SELECT 1 FROM workspace_leases l WHERE l.attempt_id=a.id AND l.state<>'released') RETURNING id`, [attemptId]);
  return !!released.rowCount;
}

function equal(left: unknown, right: unknown): boolean { return canonicalJSON(left ?? null) === canonicalJSON(right ?? null); }

export async function settleWorkspaceOperation(tx: Transaction, attempt: WorkspaceAttempt, operation: WorkspaceOperation, message: OperationResult): Promise<boolean> {
  if (!['complete_node', 'settle_completion'].includes(operation.kind)) return settleWorkspaceItem(tx, attempt, operation, message);
  if (!message.success) return false;
  const members = operation.workspaces;
  const results = message.result.workspace_results;
  if (message.result.workspace_id || message.result.workspace_metadata || message.result.git_commit ||
      message.result.git_tree || message.result.path || message.result.instruction_files)
    throw new CommandError('denied_scope', 'Aggregate workspace results cannot carry singular workspace fields');
  if (!members || !results || members.length !== results.length || message.result.writer_absent !== true)
    throw new CommandError('denied_scope', 'Workspace settlement requires its complete admitted member set');
  const conflict = message.result.completion_outcome === 'conflict';
  if (operation.kind === 'complete_node' && (!['finalized', 'conflict'].includes(message.result.completion_outcome ?? '') ||
      (conflict && !results.some(result => result.integration?.outcome === 'conflict'))))
    throw new CommandError('denied_scope', 'Completion requires an exact aggregate outcome');
  for (let index = 0; index < members.length; index++) {
    const member = members[index]!, result = results[index]!;
    if (result.resource_id !== member.workspace.resource_id || result.workspace_id !== member.workspace.workspace_id ||
        (index > 0 && members[index - 1]!.workspace.resource_id >= member.workspace.resource_id))
      throw new CommandError('denied_scope', 'Workspace result membership or resource order differs');
    await settleWorkspaceItem(tx, attempt, { ...operation, workspace_descriptor: member.workspace,
      workspace_digest: member.workspace_digest, workspace_lease_id: member.workspace.lease_id, integration: member.integration },
    { ...message, result: { ...result, writer_absent: true } }, conflict);
  }
  return false;
}

type WorkspaceItemMessage = Omit<OperationResult, 'result'> & { result: EffectResult & Partial<WorkspaceEffectResult> };

async function settleWorkspaceItem(tx: Transaction, attempt: WorkspaceAttempt, operation: WorkspaceOperation, message: WorkspaceItemMessage, unpublished = false): Promise<boolean> {
  const descriptor = operation.workspace_descriptor;
  if (!descriptor) {
    if (message.cancelled_by_operation_id || message.result.workspace_metadata || message.result.integration) throw new CommandError('denied_scope', 'Workspace result requires canonical admitted ownership');
    if (attempt.launch.workspace_reservations) {
      if (operation.kind !== 'stop' || message.result.workspace_id || message.result.path || message.result.instruction_files
        || message.result.git_commit || message.result.git_tree) throw new CommandError('denied_scope', 'Repository-free Stop cannot claim a workspace result');
      if ((await tx.query("SELECT 1 FROM workspace_leases WHERE attempt_id=$1 AND state<>'released'", [attempt.id])).rowCount) throw new CommandError('unmet_precondition', 'A held workspace requires its admitted settlement descriptor');
    }
    return false;
  }
  if (operation.workspace_digest !== digest(canonicalJSON(descriptor))) throw new CommandError('denied_scope', 'Stored workspace descriptor digest differs');
  const workspace = (await tx.query<Workspace>('SELECT * FROM task_workspaces WHERE id=$1 FOR UPDATE', [descriptor.workspace_id])).rows[0];
  const lease = (await tx.query<Lease>('SELECT * FROM workspace_leases WHERE id=$1 FOR UPDATE', [descriptor.lease_id])).rows[0];
  if (!workspace || !lease || lease.workspace_id !== workspace.id || lease.task_id !== attempt.task_id
    || lease.node_id !== attempt.node_id || lease.node_activation !== attempt.node_activation
    || lease.attempt_id !== attempt.id || lease.dispatch_id !== attempt.dispatch_id
    || (descriptor.isolation?.allocation_id ?? null) !== lease.allocation_id
    || lease.state === 'released' || descriptor.runner_id !== attempt.runner_id || descriptor.task_id !== attempt.task_id
    || descriptor.node_id !== attempt.node_id || descriptor.node_activation !== Number(attempt.node_activation)
    || descriptor.generation !== Number(workspace.generation) || lease.open_operation_id !== descriptor.open_operation_id) throw new CommandError('denied_scope', 'Workspace lease ownership differs');
  if (message.cancelled_by_operation_id) {
    const stop = (await tx.query<WorkspaceOperation>('SELECT * FROM operations WHERE id=$1', [message.cancelled_by_operation_id])).rows[0];
    const initializedAllocation = !descriptor.isolation ? workspace.ever_materialized : lease.start_commit !== null || !!(await tx.query('SELECT 1 FROM workspace_leases WHERE workspace_id=$1 AND allocation_id=$2 AND start_commit IS NOT NULL', [workspace.id, lease.allocation_id])).rowCount;
    if (operation.kind !== 'open_workspace' || attempt.mutation_allowed || attempt.process_released || initializedAllocation
      || !stop || stop.kind !== 'stop' || !['admitted', 'recovery'].includes(stop.state) || stop.attempt_id !== attempt.id
      || stop.workspace_lease_id !== lease.id || lease.settle_operation_id !== stop.id
      || stop.workspace_digest !== operation.workspace_digest || operation.state === 'succeeded') throw new CommandError('unmet_precondition', 'Only the matching admitted Stop can cancel an unexposed open');
    await tx.query("UPDATE operations SET state='cancelled',result=$2,cancelled_by_operation_id=$3,failure_kind=NULL WHERE id=$1", [operation.id, message.result, stop.id]);
    await tx.query('UPDATE outbox SET done=true WHERE operation_id=$1', [operation.id]);
    await tx.query('UPDATE attempts SET process_absent=true WHERE id=$1', [attempt.id]);
    return true;
  }
  if (!message.success) return false;
  const open = (await tx.query<WorkspaceOperation>('SELECT * FROM operations WHERE id=$1', [lease.open_operation_id])).rows[0]!;
  if (operation.kind === 'stop' && open.state === 'cancelled') {
    if (open.cancelled_by_operation_id !== operation.id || message.result.writer_absent !== true
      || message.result.workspace_metadata || message.result.workspace_id || message.result.path) throw new CommandError('unmet_precondition', 'Cancelled workspace Stop result differs');
    await tx.query("UPDATE workspace_leases SET state='released' WHERE id=$1", [lease.id]);
    return false;
  }
  const metadata = message.result.workspace_metadata;
  if (!metadata || message.result.workspace_id !== workspace.id || metadata.lease_id !== lease.id
    || metadata.generation !== Number(workspace.generation) || metadata.repository_identity !== workspace.repository_identity) throw new CommandError('denied_scope', 'Workspace result identity differs');
  validate('WorkspaceMetadata', metadata); validateGitRef(metadata.target_branch);
  if ((metadata.isolation?.allocation_id ?? null) !== lease.allocation_id || (lease.start_commit && metadata.isolation && metadata.isolation.start_commit !== lease.start_commit)) throw new CommandError('denied_scope', 'Allocation or immutable start revision differs');
  if (!descriptor.isolation && message.result.integration) throw new CommandError('denied_scope', 'Direct work cannot claim isolated integration');
  if (workspace.repository_identity.startsWith('github.com/') && (!metadata.provider_metadata?.github
    || !Number.isSafeInteger(Number(metadata.provider_metadata.github.repository_id)))) throw new CommandError('denied_scope', 'Verified GitHub repository identity is required');
  if (descriptor.resource.provider_metadata && !equal(descriptor.resource.provider_metadata, metadata.provider_metadata)) throw new CommandError('denied_scope', 'Provider repository identity differs');
  if (workspace.ever_materialized && (metadata.storage_id !== workspace.storage_id || metadata.base_commit !== workspace.base_commit
    || metadata.target_branch !== workspace.target_branch || !equal(metadata.provider_metadata, workspace.provider_metadata))) throw new CommandError('payload_conflict', 'Fixed workspace lineage differs');
  if (operation.kind === 'open_workspace') {
    if (metadata.recovered_by_stop_operation_id) {
      const stop = (await tx.query<WorkspaceOperation>('SELECT * FROM operations WHERE id=$1', [metadata.recovered_by_stop_operation_id])).rows[0];
      const observation = (await tx.query<Lease>('SELECT * FROM workspace_leases WHERE id=$1', [metadata.target_observation_lease_id])).rows[0];
      if (!workspace.ever_materialized || attempt.mutation_allowed || attempt.process_released || lease.state !== 'settling'
        || !stop || stop.kind !== 'stop' || !['admitted', 'recovery'].includes(stop.state) || stop.attempt_id !== attempt.id
        || stop.workspace_lease_id !== lease.id || stop.id !== lease.settle_operation_id || stop.workspace_digest !== operation.workspace_digest
        || !observation || observation.id === lease.id || observation.state !== 'released' || observation.workspace_id !== workspace.id
        || observation.target_observation_lease_id || observation.target_commit !== metadata.target_commit) throw new CommandError('unmet_precondition', 'Stop recovery requires the exact prior verified target observation');
    }
    const previous = descriptor.isolation ? (await tx.query<{ start_commit: string; finalized_commit: string }>(`SELECT l.start_commit,item.result->'workspace_metadata'->>'finalized_commit' finalized_commit
      FROM workspace_leases l JOIN operations op ON op.id=COALESCE(l.checkpoint->>'operation_id',l.settle_operation_id)
      CROSS JOIN LATERAL operation_workspace_results(op.id) item
      WHERE l.workspace_id=$1 AND l.allocation_id=$2 AND (l.created_at,l.id)<(SELECT created_at,id FROM workspace_leases WHERE id=$3)
        AND item.lease_id=l.id
      ORDER BY l.created_at DESC,l.id DESC LIMIT 1`, [workspace.id, lease.allocation_id, lease.id])).rows[0] : undefined;
    const openedRevision = previous?.finalized_commit ?? descriptor.basis?.finalized_commit ?? metadata.base_commit;
    if (!message.result.path || !message.result.instruction_files || metadata.checkpoint || message.result.integration
      || metadata.finalized_commit !== (descriptor.isolation ? openedRevision : workspace.ever_materialized ? workspace.finalized_commit : metadata.base_commit)
      || (metadata.isolation && metadata.isolation.start_commit !== (previous?.start_commit ?? descriptor.basis?.finalized_commit ?? metadata.base_commit))) throw new CommandError('unmet_precondition', 'Exact opened workspace and instruction files are required');
    if (!workspace.ever_materialized && descriptor.resource.default_branch && metadata.target_branch !== descriptor.resource.default_branch) throw new CommandError('payload_conflict', 'Target branch differs from admitted resource defaults');
    if (!workspace.ever_materialized) await tx.query(`UPDATE task_workspaces SET ever_materialized=true,state='ready',storage_id=$2,
      provider_metadata=$3,base_commit=$4,target_branch=$5,finalized_commit=$4,materialized_by_operation_id=$6 WHERE id=$1`,
      [workspace.id, metadata.storage_id, metadata.provider_metadata ?? null, metadata.base_commit, metadata.target_branch, operation.id]);
    await tx.query('UPDATE workspace_leases SET target_commit=$2,recovered_by_stop_operation_id=$3,target_observation_lease_id=$4,start_commit=$5 WHERE id=$1',
      [lease.id, metadata.target_commit, metadata.recovered_by_stop_operation_id ?? null, metadata.target_observation_lease_id ?? null, metadata.isolation?.start_commit ?? null]);
  } else {
    if (lease.settle_operation_id !== (operation.kind==='settle_completion' ? operation.completion_operation_id : operation.id) || lease.state !== 'settling' || open.state !== 'succeeded'
      || metadata.target_commit !== lease.target_commit || message.result.writer_absent !== true
      || (metadata.recovered_by_stop_operation_id ?? null) !== lease.recovered_by_stop_operation_id
      || (metadata.target_observation_lease_id ?? null) !== lease.target_observation_lease_id) throw new CommandError('unmet_precondition', 'Workspace settlement does not match its lease');
    if (operation.kind === 'stop' || operation.kind==='settle_completion') {
      if(operation.kind==='settle_completion' && (metadata.checkpoint?.completion_operation_id!==operation.completion_operation_id || metadata.checkpoint?.completion_identity_digest!==operation.completion_identity_digest)) throw new CommandError('denied_scope','Recovery checkpoint target differs');
      if(operation.kind==='stop' && metadata.checkpoint?.completion_operation_id) throw new CommandError('denied_scope','Ordinary Stop cannot assert correction checkpoint');
      if (!metadata.checkpoint || metadata.checkpoint.operation_id !== operation.id || metadata.finalized_commit !== (descriptor.isolation ? (open.result?.workspace_metadata?.finalized_commit ?? lease.start_commit) : workspace.finalized_commit) || message.result.integration) throw new CommandError('unmet_precondition', 'Stopped workspace requires an attributed private checkpoint');
      await tx.query("UPDATE workspace_leases SET checkpoint=$2,state='released' WHERE id=$1", [lease.id, metadata.checkpoint]);
    } else if (operation.kind === 'complete_node') {
      const capture = message.result.capture;
      if (!capture || capture.start_commit !== (descriptor.isolation ? lease.start_commit : open.result?.workspace_metadata?.finalized_commit))
        throw new CommandError('denied_scope', 'Captured result differs from its exact opened revision');
      if (unpublished) {
        const integration = message.result.integration;
        if (metadata.checkpoint || message.result.git_commit || message.result.git_tree ||
            metadata.finalized_commit !== open.result?.workspace_metadata?.finalized_commit ||
            (integration && (!descriptor.isolation || !operation.integration || integration.outcome !== 'conflict' ||
              integration.start_commit !== capture.start_commit || integration.node_commit !== capture.node_commit || integration.node_tree !== capture.node_tree ||
              integration.expected_task_commit !== operation.integration.expected_task_commit || integration.task_commit !== integration.expected_task_commit ||
              workspace.finalized_commit !== integration.expected_task_commit)))
          throw new CommandError('denied_scope', 'Unpublished capture cannot advance a Task workspace');
        await tx.query("UPDATE workspace_leases SET state='released' WHERE id=$1", [lease.id]);
        return false;
      }
      if (descriptor.isolation) {
        const integration = message.result.integration;
        if (!operation.integration || !integration || metadata.checkpoint || integration.start_commit !== lease.start_commit
          || integration.node_commit !== capture.node_commit || integration.node_tree !== capture.node_tree
          || integration.expected_task_commit !== operation.integration.expected_task_commit
          || workspace.finalized_commit !== integration.expected_task_commit) throw new CommandError('payload_conflict', 'Isolated completion differs from its frozen integration basis');
        if (integration.outcome !== 'integrated' || integration.task_commit !== message.result.git_commit || integration.task_tree !== message.result.git_tree
          || metadata.finalized_commit !== integration.task_commit) throw new CommandError('denied_scope', 'Integrated Task result differs from its exact proof');
      } else if (capture.node_commit !== message.result.git_commit || capture.node_tree !== message.result.git_tree) {
        throw new CommandError('denied_scope', 'Direct completion differs from its exact captured result');
      }
      if (metadata.checkpoint || !message.result.git_commit || metadata.finalized_commit !== message.result.git_commit) throw new CommandError('unmet_precondition', 'Completion must retain its exact finalized revision');
      await tx.query('UPDATE task_workspaces SET finalized_commit=$2 WHERE id=$1', [workspace.id, metadata.finalized_commit]);
      await tx.query("UPDATE workspace_leases SET state='released' WHERE id=$1", [lease.id]);
    } else throw new CommandError('denied_scope', 'Unknown canonical workspace effect');
  }
  return false;
}
