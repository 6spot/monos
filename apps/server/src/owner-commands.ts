import { eligibleRequirement, requirementProposal } from './task-specification-state.ts';
import type { SpecificationTask } from './task-specification-state.ts';
import { randomBytes, randomUUID } from 'node:crypto';
import { transaction } from '../../../packages/db/src/index.ts';
import type { Database, Transaction } from '../../../packages/db/src/index.ts';
import { canonicalJSON, digest, MAX_BODY_BYTES, validate } from '../../../packages/protocol/src/index.ts';
import type { OwnerCommand, OwnerCommandResult, OwnerConfirmProposalCommand, TaskProposalAction } from '../../../packages/protocol/src/index.ts';
import { CommandError } from '../../../packages/domain/src/commands.ts';
import { executeOwnerAction, ownerOperationStatus } from './owner-execution.ts';

interface TaskBasis { control_version: number; specification_id: string; plan_id: string | null }
interface Proposal { id: string; task_id: string; action: TaskProposalAction; content_digest: string; basis: TaskBasis; eligible: boolean }
export interface ConfirmationBinding { scope_id: string; action: TaskProposalAction; content_digest: string }

function lifetime(milliseconds: number) {
  if (!Number.isSafeInteger(milliseconds) || milliseconds < 1 || milliseconds > 86400000) throw new CommandError('invalid_input', 'Lifetime must be within one day');
  return new Date(Date.now() + milliseconds);
}

// Internal login/bootstrap primitive. No public unauthenticated issuer exists.
export async function issueOwnerSession(db: Database, ttl = 8 * 60 * 60 * 1000) {
  return transaction(db, (tx) => issueOwnerSessionInTransaction(tx, ttl));
}

export async function issueOwnerSessionInTransaction(tx: Transaction, ttl = 8 * 60 * 60 * 1000) {
  const expires = lifetime(ttl); const sessionId = randomUUID();
  const token = `owner.v1.${randomBytes(32).toString('hex')}`;
  await tx.query('INSERT INTO owner_sessions(id,token_digest,expires_at) VALUES($1,$2,$3)', [sessionId, digest(token), expires]);
  return { token, session_id: sessionId, expires_at: expires.toISOString() };
}

export async function revokeOwnerSession(db: Database, sessionId: string) {
  validate('Id', sessionId);
  await db.pool.query('UPDATE owner_sessions SET revoked=true WHERE id=$1', [sessionId]);
}

export async function authenticateOwner(tx: Transaction, token: string): Promise<void> {
  if (!/^owner\.v1\.[0-9a-f]{64}$/.test(token)) throw new CommandError('unauthorized', 'Owner session required');
  const row = await tx.query('SELECT id FROM owner_sessions WHERE token_digest=$1 AND NOT revoked AND expires_at>clock_timestamp() FOR SHARE', [digest(token)]);
  if (!row.rowCount) throw new CommandError('unauthorized', 'Owner session expired or revoked');
}

async function taskBasis(tx: Transaction, taskId: string): Promise<TaskBasis> {
  const row = (await tx.query<{ control_version: string; specification_id: string; plan_id: string | null }>('SELECT control_version,specification_id,plan_id FROM tasks WHERE id=$1 FOR UPDATE', [taskId])).rows[0];
  if (!row) throw new CommandError('denied_scope', 'Unknown Task scope');
  return { ...row, control_version: Number(row.control_version) };
}

async function proposal(tx: Transaction, proposalId: string): Promise<Proposal> {
  const row = (await tx.query<Proposal>('SELECT *, (NOT revoked AND expires_at>clock_timestamp()) AS eligible FROM task_command_proposals WHERE id=$1 FOR UPDATE', [proposalId])).rows[0];
  if (!row) throw new CommandError('denied_scope', 'Unknown proposal');
  return row;
}

function current(row: Proposal, scopeId: string, contentDigest: string, basis: TaskBasis) {
  if (row.task_id !== scopeId) throw new CommandError('denied_scope', 'Proposal belongs to another Task');
  if (row.content_digest !== contentDigest) throw new CommandError('payload_conflict', 'Confirmation content differs from proposal');
  if (!row.eligible) throw new CommandError('unmet_precondition', 'Proposal expired or revoked');
  if (canonicalJSON(row.basis) !== canonicalJSON(basis)) throw new CommandError('version_conflict', 'Proposal basis is stale', basis.control_version);
}

// Called by the owning module in its transaction, never by an untrusted HTTP body.
export async function prepareTaskProposal(tx: Transaction, input: { id: string; task_id: string; action: TaskProposalAction; content: unknown; ttl?: number }) {
  validate('Id', input.id); validate('Id', input.task_id); validate('TaskProposalAction', input.action);
  let content: string;
  try { content = canonicalJSON(input.content); } catch { throw new CommandError('invalid_input', 'Proposal must contain valid canonical JSON'); }
  if (Buffer.byteLength(content) > MAX_BODY_BYTES) throw new CommandError('invalid_input', 'Proposal exceeds content limit');
  const basis = await taskBasis(tx, input.task_id); const contentDigest = digest(content);
  await tx.query('INSERT INTO task_command_proposals(id,task_id,action,content,content_digest,basis,expires_at) VALUES($1,$2,$3,$4,$5,$6,$7) ON CONFLICT(id) DO NOTHING', [input.id, input.task_id, input.action, content, contentDigest, basis, lifetime(input.ttl ?? 3600000)]);
  const existing = (await tx.query<Proposal>('SELECT * FROM task_command_proposals WHERE id=$1', [input.id])).rows[0];
  if (!existing) throw new Error('Prepared proposal missing');
  if (existing.task_id !== input.task_id || existing.action !== input.action || existing.content_digest !== contentDigest || canonicalJSON(existing.basis) !== canonicalJSON(basis)) throw new CommandError('payload_conflict', 'Proposal identity is immutable');
  return { proposal_id: input.id, content_digest: contentDigest, basis };
}

export class OwnerCommands {
  readonly db: Database;
  constructor(db: Database) { this.db = db; }
  async confirm(token: string, body: unknown): Promise<OwnerCommandResult> {
    const command = validate<OwnerCommand>('OwnerCommand', body);
    if (command.name !== 'confirm_proposal') return executeOwnerAction(this.db, token, command);
    const confirmationCommand = command as OwnerConfirmProposalCommand;
    const envelope = canonicalJSON(command); const hash = digest(envelope);
    return transaction(this.db, async (tx) => {
      await authenticateOwner(tx, token);
      const basis = await taskBasis(tx, command.scope_id);
      const prior = (await tx.query<{ digest: string; response: OwnerCommandResult }>('SELECT digest,response FROM owner_command_receipts WHERE scope_id=$1 AND request_id=$2', [command.scope_id, command.request_id])).rows[0];
      if (prior) {
        if (prior.digest !== hash) throw new CommandError('payload_conflict', 'Request ID has different immutable content');
        return prior.response;
      }
      if (basis.control_version !== command.expected_control_version) throw new CommandError('version_conflict', 'Task control basis changed', basis.control_version);
      const row = await proposal(tx, confirmationCommand.payload.proposal_id);
      current(row, command.scope_id, confirmationCommand.payload.content_digest, basis);
      if((await tx.query('SELECT 1 FROM requirement_proposals WHERE id=$1',[row.id])).rowCount){const task=(await tx.query<SpecificationTask>('SELECT * FROM tasks WHERE id=$1',[command.scope_id])).rows[0]!;await eligibleRequirement(tx,task,await requirementProposal(tx,row.id,task.id));}
      if(row.action==='publish_replan')throw new CommandError('denied_scope','Use dedicated exact Replan confirmation');
      if(row.action==='accept_delivery')throw new CommandError('denied_scope','Use dedicated exact Delivery confirmation');
      const existing = (await tx.query<{ id: string }>('SELECT id FROM authorization_receipts WHERE proposal_id=$1', [row.id])).rows[0];
      const confirmation = existing?.id ?? randomUUID();
      if (!existing) await tx.query('INSERT INTO authorization_receipts(id,proposal_id) VALUES($1,$2)', [confirmation, row.id]);
      if(!existing && (await tx.query('SELECT 1 FROM requirement_proposals WHERE id=$1',[row.id])).rowCount)await tx.query('INSERT INTO requirement_authorization_commands(authorization_id,task_id,request_id) VALUES($1,$2,$3)',[confirmation,command.scope_id,command.request_id]);
      const response: OwnerCommandResult = { schema_version: 1, request_id: command.request_id, status: 'committed', confirmation_id: confirmation, proposal_id: row.id };
      validate('OwnerCommandResult', response);
      await tx.query('INSERT INTO owner_command_receipts(scope_id,request_id,digest,envelope_json,response) VALUES($1,$2,$3,$4,$5)', [command.scope_id, command.request_id, hash, envelope, response]);
      return response;
    });
  }
  async operation(token: string, taskId: string, operationId: string) {
    return ownerOperationStatus(this.db, token, taskId, operationId);
  }
  async status(token: string, scopeId: string, requestId: string): Promise<OwnerCommandResult> {
    validate('Id', scopeId); validate('Id', requestId);
    return transaction(this.db, async (tx) => {
      await authenticateOwner(tx, token);
      const row = (await tx.query<{ response: OwnerCommandResult }>('SELECT response FROM owner_command_receipts WHERE scope_id=$1 AND request_id=$2', [scopeId, requestId])).rows[0];
      return row?.response ?? { schema_version: 1, request_id: requestId, status: 'unknown' };
    });
  }
}

// Caller must perform its domain mutation and write its command receipt in this
// same transaction, checking its prior receipt before calling this helper on replay.
// Session -> Task -> proposal -> authorization is the lock order.
export async function consumeTaskConfirmation(tx: Transaction, token: string, confirmationId: string, requestId: string, binding: ConfirmationBinding): Promise<void> {
  validate('Id', confirmationId); validate('Id', requestId); validate('Id', binding.scope_id);
  validate('TaskProposalAction', binding.action);
  await authenticateOwner(tx, token); const basis = await taskBasis(tx, binding.scope_id);
  const identity = (await tx.query<{ proposal_id: string }>('SELECT proposal_id FROM authorization_receipts WHERE id=$1', [confirmationId])).rows[0];
  if (!identity) throw new CommandError('denied_scope', 'Unknown Owner confirmation');
  const row = await proposal(tx, identity.proposal_id);
  current(row, binding.scope_id, binding.content_digest, basis);
  if (row.action !== binding.action) throw new CommandError('denied_scope', 'Confirmation action differs');
  const receipt = (await tx.query<{ consumed_by: string | null }>('SELECT consumed_by FROM authorization_receipts WHERE id=$1 FOR UPDATE', [confirmationId])).rows[0]!;
  if (receipt.consumed_by !== null && receipt.consumed_by !== requestId) throw new CommandError('payload_conflict', 'Confirmation already consumed by another command');
  await tx.query('UPDATE authorization_receipts SET consumed_by=$2 WHERE id=$1', [confirmationId, requestId]);
}
