import { recordRuntimeContinuation, failRuntimeContinuationCapture } from './runtime-continuation.ts';
import type { RuntimeSelectionContext } from './runtime-continuation-state.ts';
import {handleReviewCommand,assertReviewSource} from './task-review-sources.ts';
import type { SpecificationTask } from './task-specification-state.ts';
import { liveReplanAuthority, handleReplanCommand, requestReplan } from './task-replan-state.ts';
import { specificationFrozen } from './task-specification-state.ts';
import { handleTaskConversation } from './task-conversation-state.ts';
import { lockConfiguration } from './configuration-guards.ts';
import { randomUUID } from 'node:crypto';
import { runnerForCredential, transaction } from '../../../packages/db/src/index.ts';
import type { Database, Transaction } from '../../../packages/db/src/index.ts';
import { CommandError, guardNewCommand } from '../../../packages/domain/src/commands.ts';
import { canonicalJSON, digest, MAX_FRAME_BYTES, parseSubmission, ProtocolVersionError, validate } from '../../../packages/protocol/src/index.ts';
import type { CommandEnvelope, CommandResult, CommandSubmission, Dispatch, Frame, GitHubRepositoryAccessResult, Operation, OperationResult, RepositoryAccessRequest, RunnerInventory, RuntimeEvent } from '../../../packages/protocol/src/index.ts';
import { assertNodeSource, blockNodeSource } from './node-execution-state.ts';
import type { NodeSource } from './node-execution-state.ts';
import { finishCompletionSettlement, projectCompletion, refreshTaskState } from './node-completion.ts';
import { freezeManifest, publishArtifact, readArtifact, storeManifest } from './artifacts.ts';
import { handlePlanningCommand } from './task-planning-state.ts';
import { authenticateAttempt, issueAttemptCredential } from './auth.ts';
import type { AttemptIdentity } from './auth.ts';
import { assertCurrentNode } from './task-records.ts';
import { DispatchQueue } from './dispatch-queue.ts';
import { derivedTaskState } from './owner-execution.ts';
import { handleDiscussionCommand, lockDiscussion } from './discussion-state.ts';
import type { DiscussionControl, DiscussionContext } from './discussion-state.ts';
import { admitWorkspaceEffect, admitWorkspaceOpen, explicitLegacyAttempt, lockAttemptWorkspace, settleWorkspaceOperation } from './workspaces.ts';
import type { WorkspaceOperation } from './workspaces.ts';
import { GitHub } from './github.ts';
import type { GitHubCredentials } from './github.ts';

interface RunnerRow { id: string; incarnation: string; connected: boolean; ready: boolean; available: boolean; capacity: number; connection_instance: string | null }
interface TaskRow extends SpecificationTask { id: string; resource_id: string | null; control_version: string; project_id: string | null }
export interface AttemptRow {
  selection_context: RuntimeSelectionContext | null; runtime_chain_root_id: string | null; runtime_target_index: number | null; runtime_predecessor_id: string | null;
  planning_intent_id: string | null; specification_id: string | null; plan_id: string | null; recovery_consumed_by: string | null; end_reason: string | null;
  id: string; runner_id: string; task_id: string | null; todo_id: string | null; discussion_context: DiscussionContext | null; node_id: string | null; dispatch_id: string;
  kind: 'node' | 'planner'; fencing_generation: string; node_activation: string;
  mutation_allowed: boolean; process_released: boolean; process_absent: boolean; started: boolean; exit_observed: boolean; launch: Dispatch;
  state: 'QUEUED' | 'RUNNING' | 'SUCCEEDED' | 'FAILED' | 'CANCELLED';
}
export interface OperationRow extends WorkspaceOperation { repository_free:boolean|null; completion_manifest_digest:string|null; completion_operation_id:string|null; completion_identity_digest:string|null; completion_settlement:OperationResult['completion_settlement']|null; settlement_purpose:'correct'|'cancel_task'|'specification_change'|null; schema_version: number; resource_id: string | null; failure_kind: OperationResult['failure_kind'] | null }
interface ReceiptRow { digest: string; command_name: string; response: CommandResult; operation_id: string | null }
interface Locked { runner: RunnerRow; task: TaskRow | null; discussion: DiscussionControl | null; attempt: AttemptRow }

async function lockRunner(tx: Transaction, id: string): Promise<RunnerRow> {
  const result = await tx.query<RunnerRow>("SELECT *, (connected AND ready AND last_seen > now() - interval '15 seconds') AS available FROM runners WHERE id=$1 FOR UPDATE", [id]);
  if (!result.rows[0]) throw new CommandError('denied_scope', 'Unknown Runner');
  return result.rows[0];
}

async function lockAttempt(tx: Transaction, id: string, runnerId?: string): Promise<Locked> {
  const identity = (await tx.query<AttemptRow>('SELECT * FROM attempts WHERE id=$1', [id])).rows[0];
  if (!identity || (runnerId !== undefined && identity.runner_id !== runnerId)) throw new CommandError('denied_scope', 'Attempt is outside caller scope');
  // Every writer uses this order: Runner capacity -> Task control -> Attempt -> operation.
  const runner = await lockRunner(tx, identity.runner_id);
  const discussion = identity.todo_id ? await lockDiscussion(tx, identity.todo_id) : null;
  const task = identity.task_id ? (await tx.query<TaskRow>('SELECT * FROM tasks WHERE id=$1 FOR UPDATE', [identity.task_id])).rows[0]! : null;
  const attempt = (await tx.query<AttemptRow>('SELECT * FROM attempts WHERE id=$1 FOR UPDATE', [id])).rows[0]!;
  return { runner, task, discussion, attempt };
}

function checkChannel(runner: RunnerRow, incarnation: number): void {
  if (!runner.connected || Number(runner.incarnation) !== incarnation) throw new CommandError('stale_execution', 'Runner connection was replaced');
}

function checkIdentity(attempt: AttemptRow, identity: AttemptIdentity): void {
  if (identity.expires <= Date.now()) throw new CommandError('unauthorized', 'Attempt credential has expired');
  if (attempt.dispatch_id !== identity.dispatch_id || Number(attempt.fencing_generation) !== identity.fencing_generation) throw new CommandError('denied_scope', 'Credential does not match dispatch ownership');
}

function toDispatch(row: AttemptRow): Dispatch {
  return { ...row.launch, mutation_allowed: row.mutation_allowed, process_released: row.process_released };
}
function toOperation(row: OperationRow, attempt: Pick<AttemptRow, 'dispatch_id'>): Operation {
  return { schema_version: row.schema_version, operation_id: row.id, attempt_id: row.attempt_id, dispatch_id: attempt.dispatch_id, request_id: row.request_id, kind: row.kind, ...(row.resource_id ? { resource_id: row.resource_id } : {}), state: row.state, ...(row.repository_free ? {repository_free:true as const}:{}), ...(row.completion_manifest_digest?{completion_manifest_digest:row.completion_manifest_digest}:{}), ...(row.completion_operation_id?{completion_operation_id:row.completion_operation_id,completion_identity_digest:row.completion_identity_digest!}:{}), ...(row.result ? { result: row.result } : {}), ...(row.workspace_descriptor ? { workspace: row.workspace_descriptor, workspace_digest: row.workspace_digest! } : {}), ...(row.cancelled_by_operation_id ? { cancelled_by_operation_id: row.cancelled_by_operation_id } : {}) };
}

async function taskEvent(tx: Transaction, attempt: AttemptRow, kind: string, body: unknown, operationId: string | null = null): Promise<void> {
  if (!attempt.task_id) throw new CommandError('denied_scope', 'Todo Attempts cannot write Task events');
  const result = await tx.query<{ event_sequence: string }>('UPDATE tasks SET event_sequence=event_sequence+1 WHERE id=$1 RETURNING event_sequence', [attempt.task_id]);
  await tx.query('INSERT INTO task_events(task_id,sequence,kind,attempt_id,operation_id,body) VALUES($1,$2,$3,$4,$5,$6)', [attempt.task_id, result.rows[0]!.event_sequence, kind, attempt.id, operationId, body]);
}

async function missingFormalOutcome(tx: Transaction, attempt: AttemptRow, observation: string, exitCode?: number): Promise<void> {
  if (!attempt.mutation_allowed) return;
  if(attempt.launch.task_review_source){await tx.query("UPDATE attempts SET mutation_allowed=false,state='FAILED',end_reason='missing_formal_outcome' WHERE id=$1",[attempt.id]);await tx.query("UPDATE task_review_sources SET done=true,waiting_reason='missing_formal_outcome' WHERE id=$1",[attempt.launch.task_review_source.source_id]);await tx.query("UPDATE task_review_operations SET status='failed',reason='missing_formal_outcome' WHERE source_id=$1 AND status IN('queued','running')",[attempt.launch.task_review_source.source_id]);await admitEffect(tx,attempt,'stop',randomUUID());return;}
  if(attempt.launch.task_replan_source){await tx.query("UPDATE attempts SET mutation_allowed=false,state='FAILED',end_reason='missing_formal_outcome' WHERE id=$1",[attempt.id]);await tx.query("UPDATE replan_sources SET done=true,waiting_reason='missing_formal_outcome' WHERE id=$1",[attempt.launch.task_replan_source.source_id]);await admitEffect(tx,attempt,'stop',randomUUID());return;}
  if(attempt.launch.task_conversation_source){
    await tx.query("UPDATE attempts SET mutation_allowed=false,state='FAILED',end_reason='missing_formal_outcome' WHERE id=$1",[attempt.id]);
    await tx.query("UPDATE task_inputs SET status='failed',version=version+1 WHERE id=$1 AND status='pending'",[attempt.launch.task_conversation_source.input_id]);
    await tx.query('UPDATE tasks SET conversation_version=conversation_version+1 WHERE id=$1',[attempt.task_id]);
    await admitEffect(tx,attempt,'stop',randomUUID());return;
  }
  if (attempt.todo_id) {
    await tx.query("UPDATE attempts SET mutation_allowed=false,state='FAILED',end_reason='missing_formal_outcome' WHERE id=$1", [attempt.id]);
    await tx.query('UPDATE todo_discussion_controls SET version=version+1 WHERE todo_id=$1', [attempt.todo_id]);
    await admitEffect(tx, attempt, 'stop', randomUUID()); return;
  }
  await tx.query("UPDATE attempts SET mutation_allowed=false,state='FAILED',end_reason='missing_formal_outcome' WHERE id=$1", [attempt.id]);
  if (attempt.node_id) {
    if(attempt.launch.node_execution_source){const source=(await tx.query<NodeSource>('SELECT * FROM node_execution_outbox WHERE id=$1',[attempt.launch.node_execution_source.source_id])).rows[0]!;await blockNodeSource(tx,source,'factual','missing_formal_outcome',attempt.id);}
    else await tx.query("UPDATE nodes SET state='BLOCKED' WHERE id=$1", [attempt.node_id]);
  }
  const state = attempt.node_id ? await derivedTaskState(tx, (await tx.query<{ plan_id: string }>('SELECT plan_id FROM tasks WHERE id=$1', [attempt.task_id])).rows[0]!.plan_id) : null;
  await tx.query("UPDATE tasks SET state=CASE WHEN state='REPLAN_REQUIRED' THEN state ELSE COALESCE($2,state) END,control_version=control_version+1 WHERE id=$1", [attempt.task_id, state]);
  await admitEffect(tx, attempt, 'stop', randomUUID());
  await taskEvent(tx, attempt, 'missing_formal_outcome', { exit_code: exitCode ?? null, observation });
}

async function admitEffect(tx: Transaction, attempt: AttemptRow, kind: Operation['kind'], requestId: string): Promise<string> {
  return admitWorkspaceEffect(tx, attempt, kind, requestId);
}

async function receiptResponse(tx: Transaction, receipt: ReceiptRow): Promise<CommandResult> {
  if (!receipt.operation_id || receipt.response.status === 'committed') return receipt.response;
  const operation = (await tx.query<OperationRow>('SELECT * FROM operations WHERE id=$1', [receipt.operation_id])).rows[0]!;
  if (operation.state === 'cancelled') return { schema_version: 1, request_id: receipt.response.request_id, operation_id: operation.id, status: 'error', error: { code: 'unmet_precondition', message: operation.kind==='complete_node' ? 'Completion was cancelled by its trusted settlement; retained output remains available for correction or cancellation history.' : 'Workspace open was cancelled by Stop; no workspace was granted.' } };
  if (operation.state !== 'succeeded') return receipt.response;
  return { ...receipt.response, status: 'committed', result: operation.result ?? {} };
}

export interface ServiceOptions {
  signingKey: string;
  credentialTTL?: number;
  // Constructor injection only; no Agent-facing fault control.
  beforeAdmissionCommit?: () => void;
  afterAdmissionCommit?: () => void;
  github?: GitHub;
}

export class BoundaryService {
  readonly db: Database;
  readonly options: ServiceOptions;
  readonly instanceId = randomUUID();
  constructor(db: Database, options: ServiceOptions) {
    if (options.signingKey.length < 32) throw new Error('Attempt signing key must contain at least 32 characters');
    this.db = db; this.options = options;
  }

  async authenticateRunner(token: string): Promise<string> {
    if (token.length < 32) throw new CommandError('unauthorized', 'Invalid Runner credential');
    const id = await runnerForCredential(this.db, digest(token));
    if (!id) throw new CommandError('unauthorized', 'Invalid Runner credential');
    return id;
  }

  async repositoryAccess(runnerId: string, operationId: string, body: unknown): Promise<GitHubRepositoryAccessResult> {
    validate('Id', operationId);
    const request = validate<RepositoryAccessRequest>('RepositoryAccessRequest', body);
    const authorized = () => transaction(this.db, async (tx) => {
      await lockConfiguration(tx);
      const identity = (await tx.query<{ attempt_id: string }>('SELECT attempt_id FROM operations WHERE id=$1', [operationId])).rows[0];
      if (!identity) throw new CommandError('denied_scope', 'Unknown repository operation');
      const { runner, attempt } = await lockAttempt(tx, identity.attempt_id, runnerId);
      checkChannel(runner, request.incarnation);
      if (runner.connection_instance !== this.instanceId || attempt.process_released) throw new CommandError('stale_execution', 'Repository operation no longer owns this Runner connection');
      await lockAttemptWorkspace(tx, attempt.id);
      const operation = (await tx.query<OperationRow>('SELECT * FROM operations WHERE id=$1 FOR UPDATE', [operationId])).rows[0]!;
      const lease = (await tx.query<{ state: string; workspace_id: string; task_id: string; node_id: string; node_activation: string; generation: string; open_operation_id: string; attempt_id: string; dispatch_id: string }>('SELECT * FROM workspace_leases WHERE id=$1', [operation.workspace_lease_id])).rows[0];
      if (operation.kind !== 'open_workspace' || !['admitted', 'recovery'].includes(operation.state)
        || !operation.workspace_descriptor || operation.workspace_digest !== request.workspace_digest
        || operation.workspace_digest !== digest(canonicalJSON(operation.workspace_descriptor))
        || !lease || lease.state === 'released' || lease.open_operation_id !== operation.id
        || lease.attempt_id !== attempt.id || lease.dispatch_id !== attempt.dispatch_id
        || lease.task_id !== attempt.task_id || lease.node_id !== attempt.node_id || lease.node_activation !== attempt.node_activation
        || lease.workspace_id !== operation.workspace_descriptor.workspace_id || Number(lease.generation) !== operation.workspace_descriptor.generation
        || operation.workspace_descriptor.runner_id !== runnerId || operation.workspace_descriptor.task_id !== attempt.task_id
        || operation.workspace_descriptor.node_id !== attempt.node_id || operation.workspace_descriptor.node_activation !== Number(attempt.node_activation)) throw new CommandError('denied_scope', 'Repository access is outside the admitted workspace lease');
      const config = (await tx.query<GitHubCredentials>('SELECT app_id,installation_id,encrypted_key,key_fingerprint FROM github_configuration')).rows[0];
      return { operation, config };
    });
    const before = await authorized();
    const github = this.options.github ?? new GitHub(this.options.signingKey);
    const descriptor = before.operation.workspace_descriptor!;
    const pinnedMetadata = descriptor.basis?.provider_metadata;
    if (pinnedMetadata && descriptor.resource.provider_metadata && canonicalJSON(pinnedMetadata) !== canonicalJSON(descriptor.resource.provider_metadata)) throw new CommandError('denied_scope', 'Pinned provider identity differs from the resource');
    const access = await github.repositoryAccess({ ...descriptor.resource, ...(pinnedMetadata ? { provider_metadata: pinnedMetadata } : {}) }, before.config);
    const after = await authorized();
    if (canonicalJSON(before.config ?? null) !== canonicalJSON(after.config ?? null)) throw new CommandError('stale_execution', 'Provider configuration changed during access; reconcile this operation');
    return validate('GitHubRepositoryAccessResult', { schema_version: 1, operation_id: operationId, workspace_digest: request.workspace_digest, ...access });
  }

  async connect(runnerId: string, bootId: string): Promise<number> {
    return transaction(this.db, async (tx) => {
      await lockRunner(tx, runnerId);
      const result = await tx.query<{ incarnation: string }>('UPDATE runners SET incarnation=incarnation+1,connected=true,ready=false,boot_id=$2,last_seen=now(),connection_instance=$3 WHERE id=$1 RETURNING incarnation', [runnerId, bootId, this.instanceId]);
      return Number(result.rows[0]!.incarnation);
    });
  }
  async touch(runnerId: string, incarnation: number, ready = false, runtimes?: Frame['runtimes']): Promise<void> {
    if (runtimes !== undefined) {
      validate('Frame', { schema_version: 1, type: 'ready', incarnation, runtimes });
      if (!ready || new Set(runtimes.map((row) => row.runtime_id)).size !== runtimes.length) throw new CommandError('invalid_input', 'Runtime report must contain unique installation IDs');
    }
    await transaction(this.db, async (tx) => {
      const runner = await lockRunner(tx, runnerId);
      checkChannel(runner, incarnation);
      if (runner.connection_instance !== this.instanceId) throw new CommandError('stale_execution', 'Runner must reconnect to this backend');
      if (runtimes !== undefined) {
        await tx.query('DELETE FROM runtime_installations WHERE runner_id=$1', [runnerId]);
        for (const row of runtimes) await tx.query('INSERT INTO runtime_installations(runner_id,runtime_id,incarnation,observation) VALUES($1,$2,$3,$4)', [runnerId, row.runtime_id, incarnation, row]);
        await tx.query('UPDATE runners SET runtime_report_incarnation=$2 WHERE id=$1', [runnerId, incarnation]);
      }
      await tx.query('UPDATE runners SET last_seen=now(),ready=ready OR $2 WHERE id=$1', [runnerId, ready]);
    });
  }
  async disconnect(runnerId: string, incarnation: number): Promise<void> {
    await this.db.pool.query('UPDATE runners SET connected=false,ready=false WHERE id=$1 AND incarnation=$2', [runnerId, incarnation]);
  }

  async authorize(runnerId: string, incarnation: number, dispatchId: string): Promise<{ credential: string; expires_at: string } | null> {
    return transaction(this.db, async (tx) => {
      const row = (await tx.query<{ id: string }>('SELECT id FROM attempts WHERE dispatch_id=$1 AND runner_id=$2', [dispatchId, runnerId])).rows[0];
      if (!row) return null;
      const { runner, attempt } = await lockAttempt(tx, row.id, runnerId);
      checkChannel(runner, incarnation);
      if (!runner.available || runner.connection_instance !== this.instanceId || !attempt.mutation_allowed || attempt.process_released) return null;
      const expires = Date.now() + (this.options.credentialTTL ?? 60_000);
      return { credential: issueAttemptCredential({ attempt_id: attempt.id, dispatch_id: attempt.dispatch_id, fencing_generation: Number(attempt.fencing_generation), expires }, this.options.signingKey), expires_at: new Date(expires).toISOString() };
    });
  }

  async admit(token: string, body: unknown): Promise<CommandResult> {
    const identity = authenticateAttempt(token, this.options.signingKey);
    let request: { envelope: CommandEnvelope; submission: CommandSubmission };
    try { request = parseSubmission(body); } catch (error) { throw new CommandError(error instanceof ProtocolVersionError ? 'unsupported_version' : 'invalid_input', 'Command body, schema version or canonical digest is invalid'); }
    const { envelope: command, submission } = request;
    const result = await transaction(this.db, async (tx) => {
      await lockConfiguration(tx);
      // Specification apply may settle every Task execution owner. Discover and
      // lock the complete Runner set before taking any Task lock.
      const applyTask=command.name==='apply_specification_revision'?(await tx.query<{task_id:string}>('SELECT task_id FROM attempts WHERE id=$1',[identity.attempt_id])).rows[0]?.task_id:undefined;
      const applyRunners=applyTask?(await tx.query<{runner_id:string}>('SELECT DISTINCT runner_id FROM attempts WHERE task_id=$1 ORDER BY runner_id',[applyTask])).rows:[];
      for(const r of applyRunners)await tx.query('SELECT id FROM runners WHERE id=$1 FOR UPDATE',[r.runner_id]);
      const { runner, task, discussion, attempt } = await lockAttempt(tx, identity.attempt_id);
      if(applyTask&&canonicalJSON(applyRunners)!==canonicalJSON((await tx.query('SELECT DISTINCT runner_id FROM attempts WHERE task_id=$1 ORDER BY runner_id',[applyTask])).rows))throw new CommandError('control_unavailable','Runner ownership changed; retry exact request');
      checkIdentity(attempt, identity);
      if (command.scope_id !== (attempt.todo_id ?? attempt.task_id)) throw new CommandError('denied_scope', 'Command belongs to another scope');
      const receipt = (await tx.query<ReceiptRow>('SELECT * FROM command_receipts WHERE attempt_id=$1 AND scope_id=$2 AND request_id=$3', [attempt.id, command.scope_id, command.request_id])).rows[0];
      if (receipt) {
        if (receipt.digest !== submission.sha256 || receipt.command_name !== command.name) throw new CommandError('payload_conflict', 'Request ID already records different content');
        return receiptResponse(tx, receipt);
      }
      if (discussion) {
        guardNewCommand(command, { kind: attempt.kind, scopeId: discussion.todo_id, scopeKind: 'todo', mutationAllowed: attempt.mutation_allowed, processReleased: attempt.process_released, controlVersion: Number(discussion.version), sourceWatermark: attempt.launch.source_watermark, connectionAvailable: runner.available && runner.connection_instance === this.instanceId });
        const outcome = await handleDiscussionCommand(tx, discussion, attempt, command);
        const response: CommandResult = { schema_version: 1, request_id: command.request_id, status: 'committed', result: outcome.result, ...(outcome.operation_id ? { operation_id: outcome.operation_id } : {}) };
        await tx.query('INSERT INTO command_receipts(attempt_id,scope_id,request_id,command_name,digest,schema_version,envelope_json,response,operation_id) VALUES($1,$2,$3,$4,$5,1,$6,$7,$8)', [attempt.id, discussion.todo_id, command.request_id, command.name, submission.sha256, submission.envelope_json, response, outcome.operation_id ?? null]);
        this.options.beforeAdmissionCommit?.(); return response;
      }
      if (!task) throw new CommandError('denied_scope', 'Attempt owner is missing');
      if (command.name === 'commit_discussion_turn' || command.name === 'read_discussion' || command.name === 'update_working_requirement_state') throw new CommandError('denied_scope', 'Todo command requires Todo Planner authority');
      if(attempt.launch.task_review_source){
        guardNewCommand(command,{kind:attempt.kind,taskId:task.id,taskReview:true,mutationAllowed:attempt.mutation_allowed,processReleased:attempt.process_released,controlVersion:Number(task.control_version),sourceWatermark:0,connectionAvailable:runner.available&&runner.connection_instance===this.instanceId});
        await assertReviewSource(tx,task.id,attempt.launch.task_review_source,attempt.id,attempt.launch.prompt);
        if(command.name!=='inspect_repository'){
         const outcome=await handleReviewCommand(tx,task,attempt,command),response:CommandResult={schema_version:1,request_id:command.request_id,status:'committed',result:outcome.result,...(outcome.operation_id?{operation_id:outcome.operation_id}:{})};validate('CommandResult',response);
         await tx.query('INSERT INTO command_receipts(attempt_id,scope_id,request_id,command_name,digest,schema_version,envelope_json,response,operation_id) VALUES($1,$2,$3,$4,$5,1,$6,$7,$8)',[attempt.id,task.id,command.request_id,command.name,submission.sha256,submission.envelope_json,response,outcome.operation_id??null]);this.options.beforeAdmissionCommit?.();return response;
        }
      }
      if(attempt.launch.task_conversation_source){
        const current=(await tx.query<{conversation_version:string}>('SELECT conversation_version FROM tasks WHERE id=$1',[task.id])).rows[0]!;
        guardNewCommand(command,{kind:attempt.kind,taskId:task.id,taskConversation:true,mutationAllowed:attempt.mutation_allowed,processReleased:attempt.process_released,controlVersion:Number(current.conversation_version),sourceWatermark:attempt.launch.source_watermark,connectionAvailable:runner.available&&runner.connection_instance===this.instanceId});
        const outcome=await handleTaskConversation(tx,attempt,command);
        const response:CommandResult={schema_version:1,request_id:command.request_id,status:'committed',result:outcome.result,...(outcome.operation_id?{operation_id:outcome.operation_id}:{})};
        validate('CommandResult',response);
        await tx.query('INSERT INTO command_receipts(attempt_id,scope_id,request_id,command_name,digest,schema_version,envelope_json,response,operation_id) VALUES($1,$2,$3,$4,$5,1,$6,$7,$8)',[attempt.id,task.id,command.request_id,command.name,submission.sha256,submission.envelope_json,response,outcome.operation_id??null]);
        this.options.beforeAdmissionCommit?.();return response;
      }
      if(attempt.launch.task_replan_source){guardNewCommand(command,{kind:attempt.kind,taskId:task.id,taskReplan:true,mutationAllowed:attempt.mutation_allowed,processReleased:attempt.process_released,controlVersion:Number(task.control_version),sourceWatermark:0,connectionAvailable:runner.available&&runner.connection_instance===this.instanceId});const outcome=await handleReplanCommand(tx,task,attempt,command);const response:CommandResult={schema_version:1,request_id:command.request_id,status:'committed',result:outcome.result,operation_id:outcome.operation_id};await tx.query('INSERT INTO command_receipts(attempt_id,scope_id,request_id,command_name,digest,schema_version,envelope_json,response,operation_id) VALUES($1,$2,$3,$4,$5,1,$6,$7,$8)',[attempt.id,task.id,command.request_id,command.name,submission.sha256,submission.envelope_json,response,outcome.operation_id]);this.options.beforeAdmissionCommit?.();return response;}
      const liveReplan=await liveReplanAuthority(tx,task.id,attempt.id);
      const legacy = await explicitLegacyAttempt(tx, attempt.id);
      guardNewCommand(command, { kind: attempt.kind, taskId: attempt.task_id!, resourceId: legacy ? attempt.launch.resource_id : undefined, projectResources: !legacy, initialPlanning: !!attempt.planning_intent_id && !legacy, mutationAllowed: attempt.mutation_allowed, processReleased: attempt.process_released, controlVersion: liveReplan?attempt.launch.control_version:Number(task.control_version), sourceWatermark: attempt.launch.source_watermark, connectionAvailable: runner.available && runner.connection_instance === this.instanceId });
      if (command.name === 'publish_execution_plan' || command.name === 'raise_planning_issue') {
        const outcome = await handlePlanningCommand(tx, attempt, command);
        const response: CommandResult = { schema_version: 1, request_id: command.request_id, status: 'committed', result: outcome.result, operation_id: outcome.operation_id };
        validate('CommandResult', response);
        await tx.query('INSERT INTO command_receipts(attempt_id,scope_id,request_id,command_name,digest,schema_version,envelope_json,response,operation_id) VALUES($1,$2,$3,$4,$5,1,$6,$7,$8)', [attempt.id, task.id, command.request_id, command.name, submission.sha256, submission.envelope_json, response, outcome.operation_id]);
        this.options.beforeAdmissionCommit?.(); return response;
      }
      if(command.name==='commit_task_turn'&&(!legacy||command.payload.source_id||command.payload.input_id||command.payload.routing?.kind!=='reply_only'))throw new CommandError('denied_scope','Canonical Task reply requires its input source');
      if (!legacy && command.name === 'inspect_repository') throw new CommandError('unmet_precondition', 'Canonical Planner repository inspection is unavailable in Stage A');
      if (!legacy && !attempt.launch.workspace_reservations) throw new CommandError('denied_scope', 'Fresh canonical effects require Project workspace reservations');
      if (task.project_id && (command.name === 'open_workspace' || command.name === 'inspect_repository')) {
        if (!(await tx.query('SELECT id FROM project_resources WHERE id=$1 AND project_id=$2 AND active', [command.payload.resource_id, task.project_id])).rowCount) throw new CommandError('denied_scope', 'Resource is not available in this Project');
      }
      if (attempt.node_id) {
        const node = await assertCurrentNode(tx, { task_id: attempt.task_id!, node_id: attempt.node_id, node_activation: Number(attempt.node_activation) });
        if (node.state !== 'RUNNING') throw new CommandError('stale_execution', 'Node is no longer running');
      }
      const source = attempt.launch.node_execution_source
        ? await assertNodeSource(tx,task.id,attempt.launch.node_execution_source,attempt.id,attempt.launch.prompt) : undefined;
      if(command.name==='request_replan'){if(!source||legacy)throw new CommandError('denied_scope','Canonical Node source required');const id=await requestReplan(tx,task,attempt,command.payload.reason!,command.request_id,{node:source});const op=(await tx.query<{id:string}>("SELECT id FROM operations WHERE attempt_id=$1 AND kind='stop'",[attempt.id])).rows[0];const response:CommandResult={schema_version:1,request_id:command.request_id,status:'committed',result:{replan_outcome:{kind:'request',replan_request_id:id}},operation_id:op?.id};await tx.query('INSERT INTO command_receipts(attempt_id,scope_id,request_id,command_name,digest,schema_version,envelope_json,response,operation_id) VALUES($1,$2,$3,$4,$5,1,$6,$7,$8)',[attempt.id,task.id,command.request_id,command.name,submission.sha256,submission.envelope_json,response,op?.id]);this.options.beforeAdmissionCommit?.();return response;}
      if (['publish_artifact','read_artifact','block_node'].includes(command.name)) {
        if (!source || legacy) throw new CommandError('denied_scope','Canonical Node source is required');
        let operationId:string|undefined;
        let result:CommandResult['result'];
        if (command.name==='publish_artifact') result={artifact_id:await publishArtifact(tx,source,command)};
        else if(command.name==='read_artifact') result={artifact:await readArtifact(tx,task.id,command.payload.artifact_id!)};
        else {
          if ((await tx.query("SELECT 1 FROM operations WHERE attempt_id=$1 AND state NOT IN ('succeeded','cancelled')",[attempt.id])).rowCount) throw new CommandError('unmet_precondition','Earlier workspace effects must settle before blocking');
          const reason=command.payload.reason!;
          if(Buffer.byteLength(reason)>262144)throw new CommandError('invalid_input','Block reason exceeds budget');
          await tx.query("UPDATE attempts SET mutation_allowed=false,state='SUCCEEDED',end_reason='semantic_block' WHERE id=$1",[attempt.id]);
          operationId=await admitWorkspaceEffect(tx,attempt,'stop',command.request_id);
          result={blocker_id:await blockNodeSource(tx,source,'semantic',reason,attempt.id)};
          await tx.query('UPDATE tasks SET control_version=control_version+1 WHERE id=$1',[task.id]);
          await tx.query("UPDATE outbox SET done=true WHERE attempt_id=$1 AND kind='start'",[attempt.id]);
        }
        const response:CommandResult={schema_version:1,request_id:command.request_id,status:'committed',result,...(operationId?{operation_id:operationId}:{})};
        validate('CommandResult',response);
        await tx.query('INSERT INTO command_receipts(attempt_id,scope_id,request_id,command_name,digest,schema_version,envelope_json,response,operation_id) VALUES($1,$2,$3,$4,$5,1,$6,$7,$8)',[attempt.id,task.id,command.request_id,command.name,submission.sha256,submission.envelope_json,response,operationId??null]);
        this.options.beforeAdmissionCommit?.();return response;
      }
      const frozen = command.name==='complete_node' && source ? await freezeManifest(tx,source,command) : undefined;
      if (command.name === 'complete_node' || command.name === 'commit_task_turn') {
        const unfinished = await tx.query("SELECT id FROM operations WHERE attempt_id=$1 AND state NOT IN ('succeeded','cancelled')", [attempt.id]);
        if (unfinished.rowCount) throw new CommandError('unmet_precondition', 'Workspace operations must settle before terminal handoff');
        await tx.query('UPDATE attempts SET mutation_allowed=false WHERE id=$1', [attempt.id]);
        await tx.query('UPDATE tasks SET control_version=control_version+1 WHERE id=$1', [task.id]);
        await tx.query("UPDATE outbox SET done=true WHERE attempt_id=$1 AND kind='start'", [attempt.id]);
      }
      const operationId = !legacy && command.name === 'open_workspace'
        ? await admitWorkspaceOpen(tx, attempt, task.project_id, command.payload.resource_id!, command.request_id)
        : await admitWorkspaceEffect(tx, attempt, command.name === 'commit_task_turn' ? 'stop' : command.name as Operation['kind'], command.request_id,frozen?.hash);
      if(frozen && source)await storeManifest(tx,source,operationId,frozen);
      const response: CommandResult = command.name === 'commit_task_turn'
        ? { schema_version: 1, request_id: command.request_id, status: 'committed', operation_id: operationId, result: { reply: command.payload.reply!, source_watermark: command.payload.source_watermark! } }
        : { schema_version: 1, request_id: command.request_id, status: 'admitted', operation_id: operationId };
      await tx.query('INSERT INTO command_receipts(attempt_id,scope_id,request_id,command_name,digest,schema_version,envelope_json,response,operation_id) VALUES($1,$2,$3,$4,$5,1,$6,$7,$8)', [attempt.id, task.id, command.request_id, command.name, submission.sha256, submission.envelope_json, response, operationId]);
      if (command.name === 'commit_task_turn') await taskEvent(tx, attempt, 'task_reply_committed', response.result, operationId);
      if (command.name === 'commit_task_turn') await tx.query("UPDATE attempts SET state='SUCCEEDED' WHERE id=$1", [attempt.id]);
      this.options.beforeAdmissionCommit?.();
      return !legacy && command.name === 'open_workspace'
        ? receiptResponse(tx, { digest: submission.sha256, command_name: command.name, response, operation_id: operationId }) : response;
    });
    this.options.afterAdmissionCommit?.();
    return result;
  }

  async commandStatus(token: string, requestId: string): Promise<CommandResult> {
    const identity = authenticateAttempt(token, this.options.signingKey);
    return transaction(this.db, async (tx) => {
      const { attempt } = await lockAttempt(tx, identity.attempt_id);
      checkIdentity(attempt, identity);
      return this.lookupReceipt(tx, attempt, requestId);
    });
  }
  private async lookupReceipt(tx: Transaction, attempt: AttemptRow, requestId: string): Promise<CommandResult> {
    const receipt = (await tx.query<ReceiptRow>('SELECT * FROM command_receipts WHERE attempt_id=$1 AND scope_id=$2 AND request_id=$3', [attempt.id, attempt.todo_id ?? attempt.task_id, requestId])).rows[0];
    return receipt ? receiptResponse(tx, receipt) : { schema_version: 1, request_id: requestId, status: 'unknown' };
  }
  async recoverCommand(runnerId: string, attemptId: string, requestId: string): Promise<CommandResult> {
    return transaction(this.db, async (tx) => {
      const { attempt } = await lockAttempt(tx, attemptId, runnerId);
      return this.lookupReceipt(tx, attempt, requestId);
    });
  }
  async recoverOperation(runnerId: string, operationId: string): Promise<Operation> {
    const row = (await this.db.pool.query<OperationRow & { dispatch_id: string }>('SELECT o.*,a.dispatch_id FROM operations o JOIN attempts a ON a.id=o.attempt_id WHERE o.id=$1 AND a.runner_id=$2', [operationId, runnerId])).rows[0];
    if (!row) throw new CommandError('denied_scope', 'Operation is outside Runner recovery scope');
    return toOperation(row, row);
  }
  async inventory(runnerId: string, after?: string, snapshotId?: string): Promise<RunnerInventory> {
    let cursor: [string, string] = ['', ''];
    if ((after === undefined) !== (snapshotId === undefined)) throw new CommandError('invalid_input', 'Inventory cursor and snapshot must be supplied together');
    if (after !== undefined) {
      try {
        validate('InventoryCursor', after); validate('Id', snapshotId);
        const decoded = Buffer.from(after, 'base64url');
        if (decoded.toString('base64url') !== after) throw new Error('Noncanonical cursor');
        const value: unknown = JSON.parse(decoded.toString('utf8'));
        if (!Array.isArray(value) || value.length !== 2 || !['dispatch', 'operation'].includes(value[0])) throw new Error('Invalid cursor');
        validate('Id', value[1]); cursor = value as [string, string];
      } catch { throw new CommandError('invalid_input', 'Invalid inventory cursor'); }
    }
    return transaction(this.db, async (tx) => {
      await lockRunner(tx, runnerId);
      // All inventory writers lock this Runner first. The snapshot is based on
      // included row versions, not heartbeat time, and changes invalidate paging.
      const unresolved = "SELECT a.*,a.xmin::text AS row_version FROM attempts a WHERE a.runner_id=$1 AND (NOT a.process_released OR EXISTS (SELECT 1 FROM operations o WHERE o.attempt_id=a.id AND o.state NOT IN ('succeeded','cancelled')))";
      const snapshot = (await tx.query<{ snapshot_id: string }>(`WITH unresolved AS (${unresolved}) SELECT md5(COALESCE(string_agg(version,'|' ORDER BY version),'')) AS snapshot_id FROM (SELECT 'd:'||id||':'||row_version AS version FROM unresolved UNION ALL SELECT 'o:'||o.id||':'||o.xmin::text FROM operations o JOIN unresolved a ON a.id=o.attempt_id WHERE o.state NOT IN ('succeeded','cancelled')) versions`, [runnerId])).rows[0]!.snapshot_id;
      if (snapshotId !== undefined && snapshotId !== snapshot) throw new CommandError('version_conflict', 'Inventory changed; restart pagination from the first page');
      const records = (await tx.query<{ kind: 'dispatch' | 'operation'; id: string; body: AttemptRow | (OperationRow & { dispatch_id: string }) }>(`WITH unresolved AS (${unresolved}), records AS (SELECT 'dispatch' AS kind,a.id,to_jsonb(a) AS body FROM unresolved a UNION ALL SELECT 'operation',o.id,to_jsonb(o)||jsonb_build_object('dispatch_id',a.dispatch_id) FROM operations o JOIN unresolved a ON a.id=o.attempt_id WHERE o.state NOT IN ('succeeded','cancelled')) SELECT * FROM records WHERE (kind,id)>($2,$3) ORDER BY kind,id LIMIT 65`, [runnerId, ...cursor])).rows;
      const page: RunnerInventory = { schema_version: 1, snapshot_id: snapshot, dispatches: [], operations: [] };
      let consumed = 0;
      let last: [string, string] | undefined;
      for (const record of records.slice(0, 64)) {
        if (record.kind === 'dispatch') page.dispatches.push(validate<Dispatch>('Dispatch', toDispatch(record.body as AttemptRow)));
        else {
          const row = record.body as OperationRow & { dispatch_id: string };
          page.operations.push(validate<Operation>('Operation', toOperation(row, { dispatch_id: row.dispatch_id })));
        }
        // Reserve the largest permitted cursor plus JSON punctuation before adding
        // another record. Never split or silently omit an individual wire item.
        if (Buffer.byteLength(JSON.stringify(page)) + 280 > MAX_FRAME_BYTES) {
          if (record.kind === 'dispatch') page.dispatches.pop(); else page.operations.pop();
          break;
        }
        consumed++; last = [record.kind, record.id];
      }
      if (consumed < records.length) {
        if (!last) throw new CommandError('unmet_precondition', 'Inventory item exceeds the supported wire size');
        page.next_cursor = Buffer.from(JSON.stringify(last)).toString('base64url');
      }
      return validate<RunnerInventory>('RunnerInventory', page);
    });
  }

  async pending(runnerId: string, incarnation: number): Promise<Frame[]> {
    await new DispatchQueue(this.db).promoteNext(runnerId, this.instanceId, incarnation);
    return transaction(this.db, async (tx) => {
      const runner = await lockRunner(tx, runnerId);
      checkChannel(runner, incarnation);
      if (!runner.available) return [];
      // Recovery rows retain their durable intent, but must not consume the
      // bounded dispatch batch and starve unrelated runnable work.
      const rows = (await tx.query<{ id: string; attempt_id: string; kind: 'start' | 'effect'; operation_id: string | null }>("SELECT * FROM outbox WHERE runner_id=$1 AND NOT done AND (last_sent_at IS NULL OR last_sent_at < now()-interval '2 seconds') AND (kind='start' OR EXISTS (SELECT 1 FROM operations WHERE operations.id=outbox.operation_id AND operations.state='admitted')) ORDER BY id LIMIT 16 FOR UPDATE", [runnerId])).rows;
      const frames: Frame[] = [];
      for (const row of rows) {
        const attempt = (await tx.query<AttemptRow>('SELECT * FROM attempts WHERE id=$1', [row.attempt_id])).rows[0]!;
        if (row.kind === 'start') {
          if (!attempt.mutation_allowed || attempt.process_released || attempt.started) { await tx.query('UPDATE outbox SET done=true WHERE id=$1', [row.id]); continue; }
          frames.push({ schema_version: 1, type: 'start', incarnation, dispatch: toDispatch(attempt) });
        } else {
          const operation = (await tx.query<OperationRow>('SELECT * FROM operations WHERE id=$1', [row.operation_id])).rows[0]!;
          if (operation.state !== 'admitted') continue;
          frames.push({ schema_version: 1, type: 'effect', incarnation, operation: toOperation(operation, attempt) });
        }
        await tx.query('UPDATE outbox SET last_sent_at=now() WHERE id=$1', [row.id]);
      }
      return frames;
    });
  }

  async event(runnerId: string, incarnation: number, input: RuntimeEvent): Promise<void> {
    const event = validate<RuntimeEvent>('RuntimeEvent', input);
    if (event.sequence < 1) throw new CommandError('invalid_input', 'Stream sequences start at 1');
    await transaction(this.db, async (tx) => {
      const { runner, attempt } = await lockAttempt(tx, event.attempt_id, runnerId);
      checkChannel(runner, incarnation);
      if (attempt.dispatch_id !== event.dispatch_id) throw new CommandError('denied_scope', 'Event dispatch mismatch');
      if (attempt.state === 'QUEUED') throw new CommandError('unmet_precondition', 'Queued Attempt has not been dispatched');
      if (attempt.launch.log_mode === 'ordered_v1' && event.order_sequence === undefined) throw new CommandError('invalid_input', 'Ordered Attempt requires an Attempt sequence');
      if (event.data_base64 !== undefined && Buffer.from(event.data_base64, 'base64').toString('base64') !== event.data_base64) throw new CommandError('invalid_input', 'Output bytes must use canonical base64');
      if (attempt.launch.log_mode === 'ordered_v1' && (event.stream_id === 'stdout' || event.stream_id === 'stderr') && event.data_base64 === undefined) throw new CommandError('invalid_input', 'Ordered output requires source bytes');
      const hash = digest(canonicalJSON(event));
      const prior = (await tx.query<{ digest: string }>('SELECT digest FROM runtime_events WHERE attempt_id=$1 AND stream_id=$2 AND sequence=$3', [attempt.id, event.stream_id, event.sequence])).rows[0];
      if (prior) { if (prior.digest !== hash) throw new CommandError('payload_conflict', 'Stream sequence already has different content'); return; }
      await tx.query('INSERT INTO runtime_events(attempt_id,stream_id,sequence,digest,body) VALUES($1,$2,$3,$4,$5)', [attempt.id, event.stream_id, event.sequence, hash, event]);
      if (event.order_sequence !== undefined) {
        const occupied = (await tx.query<{ stream_id: string; stream_sequence: string; body: RuntimeEvent }>('SELECT stream_id,stream_sequence,body FROM attempt_log_entries WHERE attempt_id=$1 AND order_sequence=$2', [attempt.id, event.order_sequence])).rows[0];
        if (occupied) throw new CommandError('payload_conflict', 'Attempt sequence already belongs to another event');
        await tx.query('INSERT INTO attempt_log_entries(attempt_id,order_sequence,stream_id,stream_sequence,body) VALUES($1,$2,$3,$4,$5)', [attempt.id, event.order_sequence, event.stream_id, event.sequence, event]);
        const visible = (await tx.query<{ log_visible_sequence: string }>('SELECT log_visible_sequence FROM attempts WHERE id=$1', [attempt.id])).rows[0]!;
        const watermark = Number(visible.log_visible_sequence);
        const next = (await tx.query<{ next: string }>(`WITH numbered AS (SELECT order_sequence,row_number() OVER (ORDER BY order_sequence) AS ordinal FROM attempt_log_entries WHERE attempt_id=$1 AND order_sequence>$2),
          gap AS (SELECT min(ordinal) AS first_gap_ordinal FROM numbered WHERE order_sequence<>$2+ordinal)
          SELECT COALESCE((SELECT $2+first_gap_ordinal-1 FROM gap), (SELECT max(order_sequence) FROM numbered), $2)::text AS next`, [attempt.id, watermark])).rows[0]!;
        await tx.query('UPDATE attempts SET log_visible_sequence=$2 WHERE id=$1', [attempt.id, Number(next.next)]);
      }
      await tx.query('UPDATE attempts SET activity_at=now() WHERE id=$1', [attempt.id]);
      if (event.kind === 'started') {
        await tx.query('UPDATE attempts SET started=true WHERE id=$1', [attempt.id]);
        await tx.query("UPDATE outbox SET done=true WHERE attempt_id=$1 AND kind='start'", [attempt.id]);
        // A late start after revocation retains the admitted stop operation and reservation.
      }
      if (event.kind === 'capture_failed') await failRuntimeContinuationCapture(tx, attempt);
      if (event.kind === 'capture_failed' && !attempt.process_released) {
        const completion = (await tx.query("SELECT 1 FROM operations WHERE attempt_id=$1 AND kind='complete_node'", [attempt.id])).rowCount;
        if (!completion && attempt.mutation_allowed) {
          if(attempt.launch.task_review_source||attempt.launch.task_conversation_source||attempt.launch.task_replan_source){
            await missingFormalOutcome(tx,attempt,'capture_failed');
            await tx.query("UPDATE attempts SET end_reason='capture_failed' WHERE id=$1",[attempt.id]);
          } else if (attempt.todo_id) {
            await tx.query("UPDATE attempts SET mutation_allowed=false,state='FAILED',end_reason='capture_failed' WHERE id=$1", [attempt.id]);
            await tx.query('UPDATE todo_discussion_controls SET version=version+1 WHERE todo_id=$1', [attempt.todo_id]);
            await admitEffect(tx, attempt, 'stop', randomUUID());
          } else {
          await tx.query("UPDATE attempts SET mutation_allowed=false,state='FAILED',end_reason='capture_failed' WHERE id=$1", [attempt.id]);
          if (attempt.node_id) await tx.query("UPDATE nodes SET state='BLOCKED' WHERE id=$1 AND activation=$2", [attempt.node_id, attempt.node_activation]);
          const state = attempt.node_id ? await derivedTaskState(tx, (await tx.query<{ plan_id: string }>('SELECT plan_id FROM tasks WHERE id=$1', [attempt.task_id])).rows[0]!.plan_id) : null;
          await tx.query("UPDATE tasks SET state=CASE WHEN state='REPLAN_REQUIRED' THEN state ELSE COALESCE($2,state) END,control_version=control_version+1 WHERE id=$1", [attempt.task_id, state]);
          await admitEffect(tx, attempt, 'stop', randomUUID());
          await taskEvent(tx, attempt, 'execution_capture_failed', { observation: 'capture_failed' });
          }
        }
        // Admitted completion already revoked Agent authority and owns recovery.
        await tx.query('UPDATE attempts SET mutation_allowed=false WHERE id=$1', [attempt.id]);
      }
      if (event.kind === 'exited' || event.kind === 'process_absent') {
        await tx.query('UPDATE attempts SET exit_observed=true WHERE id=$1', [attempt.id]);
        const pendingCompletion = (await tx.query("SELECT 1 FROM operations WHERE attempt_id=$1 AND kind='complete_node' AND state NOT IN ('succeeded','cancelled')", [attempt.id])).rowCount;
        if (!pendingCompletion && !await recordRuntimeContinuation(tx, attempt, event)) await missingFormalOutcome(tx, attempt, event.kind, event.exit_code);
        if (event.kind === 'process_absent' && pendingCompletion) {
          const recovering = (await tx.query("SELECT id FROM operations WHERE attempt_id=$1 AND kind='complete_node' AND state='recovery' AND failure_kind IN ('capture_hard_limit','invalid_finalization')", [attempt.id])).rows[0];
          if (recovering) {
            const changed = await tx.query("UPDATE nodes SET state='BLOCKED' WHERE id=$1 AND activation=$2 AND state='RUNNING'", [attempt.node_id, attempt.node_activation]);
            if (changed.rowCount) {
              const plan = (await tx.query<{ plan_id: string }>('SELECT plan_id FROM tasks WHERE id=$1', [attempt.task_id])).rows[0]!.plan_id;
              await tx.query("UPDATE tasks SET state=CASE WHEN state='REPLAN_REQUIRED' THEN state ELSE $2 END,control_version=control_version+1 WHERE id=$1", [attempt.task_id, await derivedTaskState(tx, plan)]);
              await taskEvent(tx, attempt, 'node_capture_blocked', { node_id: attempt.node_id, observation: 'completion_recovery_after_absence' }, recovering.id);
            }
          }
        }
      }
      if (event.kind === 'process_absent') {
        await tx.query('UPDATE attempts SET process_absent=true WHERE id=$1', [attempt.id]);
        // An absence fact alone cannot settle an admitted Git operation or release its claim.
      }
    });
  }

  async finishOperation(runnerId: string, incarnation: number, input: OperationResult): Promise<void> {
    const message = validate<OperationResult>('OperationResult', input);
    await transaction(this.db, async (tx) => {
      const configurationVersion = await lockConfiguration(tx);
      const { runner, attempt } = await lockAttempt(tx, message.attempt_id, runnerId);
      checkChannel(runner, incarnation);
      if (runner.connection_instance !== this.instanceId) throw new CommandError('stale_execution', 'Runner must reconnect to this backend');
      await lockAttemptWorkspace(tx, attempt.id);
      const operation = (await tx.query<OperationRow>('SELECT * FROM operations WHERE id=$1 AND attempt_id=$2 FOR UPDATE', [message.operation_id, attempt.id])).rows[0];
      if (!operation) throw new CommandError('denied_scope', 'Operation is outside Attempt scope');
      if (attempt.todo_id && operation.kind !== 'stop') throw new CommandError('denied_scope', 'Todo cannot settle repository fixture effects');
      if(operation.kind==='settle_completion') {
        await finishCompletionSettlement(tx,attempt,operation,message,configurationVersion);return;
      }
      if(message.completion_settlement)throw new CommandError('denied_scope','Only the admitted settlement may submit a pair');
      if (operation.state === 'cancelled') {
        if (message.success || message.cancelled_by_operation_id !== operation.cancelled_by_operation_id || canonicalJSON(operation.result) !== canonicalJSON(message.result)) throw new CommandError('payload_conflict', 'Cancelled operation result cannot change');
        return;
      }
      if(operation.kind==='complete_node' && message.cancelled_by_operation_id)throw new CommandError('unmet_precondition','Completion cancellation requires the exported atomic settlement pair');
      if (operation.state === 'succeeded') {
        if (!message.success || canonicalJSON(operation.result) !== canonicalJSON(message.result)) throw new CommandError('payload_conflict', 'Settled operation result cannot change');
        return;
      }
      const captureBlocked = message.failure_kind === 'capture_hard_limit' || message.failure_kind === 'invalid_finalization';
      if (captureBlocked && operation.kind !== 'complete_node') throw new CommandError('invalid_input', 'Capture failure classification requires a completion operation');
      if (await settleWorkspaceOperation(tx, attempt, operation, message)) return;
      if (message.success) {
        const terminal = operation.kind === 'complete_node' || operation.kind === 'stop';
        if (terminal && message.result.writer_absent !== true) throw new CommandError('unmet_precondition', 'Whole-tree absence is required');
        if (terminal && (await tx.query("SELECT id FROM operations WHERE attempt_id=$1 AND id<>$2 AND state NOT IN ('succeeded','cancelled')", [attempt.id, operation.id])).rowCount) throw new CommandError('unmet_precondition', 'Other admitted workspace operations must reconcile before releasing ownership');
        if (operation.kind === 'complete_node' && !operation.repository_free && (!message.result.git_commit || !message.result.git_tree)) throw new CommandError('unmet_precondition', 'Exact finalized Git result is required');
        if ((operation.kind === 'open_workspace' || operation.kind === 'inspect_repository') && (!message.result.workspace_id || !message.result.path)) throw new CommandError('unmet_precondition', 'Workspace identity and Runner-local locator are required');
        await tx.query("UPDATE operations SET state='succeeded',result=$2 WHERE id=$1", [operation.id, message.result]);
        await tx.query('UPDATE outbox SET done=true WHERE operation_id=$1', [operation.id]);
        if (terminal) await tx.query("UPDATE attempts SET mutation_allowed=false,process_absent=true,process_released=true,state=CASE WHEN $2::boolean THEN 'SUCCEEDED' WHEN state='RUNNING' THEN 'CANCELLED' ELSE state END WHERE id=$1", [attempt.id, operation.kind === 'complete_node']);
        if (operation.kind === 'complete_node') await projectCompletion(tx,attempt,operation,message);
        else if(operation.kind==='stop' && attempt.task_id) await refreshTaskState(tx,attempt.task_id);
      } else {
        if (message.result.writer_absent === true) await tx.query('UPDATE attempts SET process_absent=true WHERE id=$1', [attempt.id]);
        await tx.query("UPDATE operations SET state='recovery',result=$2,failure_kind=CASE WHEN failure_kind IN ('capture_hard_limit','invalid_finalization') THEN failure_kind ELSE COALESCE($3,failure_kind) END WHERE id=$1", [operation.id, message.result, message.failure_kind ?? null]);
        if (captureBlocked && !(await specificationFrozen(tx,attempt.task_id!)) && (await tx.query("SELECT 1 FROM tasks WHERE id=$1 AND state IN ('RUNNING','BLOCKED')",[attempt.task_id])).rowCount) {
          const node = (await tx.query<{ activation: string; state: string }>('SELECT activation,state FROM nodes WHERE id=$1 FOR UPDATE', [attempt.node_id])).rows[0];
          if (!node || Number(node.activation) !== Number(attempt.node_activation) || !['RUNNING', 'BLOCKED'].includes(node.state) || attempt.process_released) throw new CommandError('stale_execution', 'Capture failure activation is no longer current');
          if (node.state === 'RUNNING') {
            await tx.query("UPDATE nodes SET state='BLOCKED' WHERE id=$1", [attempt.node_id]);
            const plan = (await tx.query<{ plan_id: string }>('SELECT plan_id FROM tasks WHERE id=$1', [attempt.task_id])).rows[0]!.plan_id;
            await tx.query("UPDATE tasks SET state=CASE WHEN state='REPLAN_REQUIRED' THEN state ELSE $2 END,control_version=control_version+1 WHERE id=$1", [attempt.task_id, await derivedTaskState(tx, plan)]);
            await taskEvent(tx, attempt, 'node_capture_blocked', { node_id: attempt.node_id, node_activation: Number(attempt.node_activation), failure_kind: message.failure_kind }, operation.id);
          }
        }
        // Preserve the reservation and admitted identity; explicit repair/retry resumes this operation.
      }
    });
  }
}
