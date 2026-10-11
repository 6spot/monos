import { randomBytes, randomUUID } from 'node:crypto';
import { transaction } from '../../../packages/db/src/index.ts';
import type { Database } from '../../../packages/db/src/index.ts';
import { CommandError } from '../../../packages/domain/src/commands.ts';
import { canonicalJSON, digest, validate } from '../../../packages/protocol/src/index.ts';
import type { RunnerEnrollmentGrant, RunnerEnrollmentIssue, RunnerEnrollmentProof, RunnerEnrollmentRequest, RunnerEnrollmentResponse } from '../../../packages/protocol/src/index.ts';

interface Enrollment {
  id: string;
  capacity: number;
  request_id: string | null;
  request_digest: string | null;
  runner_id: string | null;
}

// Local read-only recovery proof for an installer that lost the successful
// enrollment process output. Existence alone cannot bind an identity to a grant.
export async function verifyRunnerEnrollment(db: Database, input: unknown): Promise<RunnerEnrollmentResponse> {
  const proof = validate<RunnerEnrollmentProof>('RunnerEnrollmentProof', input);
  const row = (await db.pool.query<{ request_id: string; runner_id: string }>(`SELECT e.request_id,e.runner_id
    FROM runner_enrollments e JOIN runners r ON r.id=e.runner_id
    WHERE e.id=$1 AND e.runner_id=$2 AND e.credential_hash=$3 AND e.request_id IS NOT NULL
      AND r.credential_hash=e.credential_hash AND NOT r.credential_revoked`,
  [proof.enrollment_id, proof.runner_id, proof.credential_hash])).rows[0];
  if (!row) throw new CommandError('unmet_precondition', 'Runner identity does not match the consumed enrollment');
  return validate('RunnerEnrollmentResponse', { schema_version: 1, ...row });
}

// Local administrative authority only. No unauthenticated minting HTTP route.
export async function issueRunnerEnrollment(db: Database, input: unknown): Promise<RunnerEnrollmentGrant> {
  const request = validate<RunnerEnrollmentIssue>('RunnerEnrollmentIssue', input);
  const enrollment_id = randomUUID(), enrollment_token = randomBytes(32).toString('base64url');
  return transaction(db, async tx => {
    const row = (await tx.query<{ expires_at: Date }>(`INSERT INTO runner_enrollments(id,token_hash,capacity,created_at,expires_at)
      VALUES($1,$2,$3,statement_timestamp(),statement_timestamp()+$4*interval '1 second') RETURNING expires_at`,
    [enrollment_id, digest(enrollment_token), request.capacity, request.ttl_seconds])).rows[0]!;
    return validate('RunnerEnrollmentGrant', { schema_version: 1, enrollment_id, enrollment_token,
      expires_at: row.expires_at.toISOString(), capacity: request.capacity });
  });
}

export async function redeemRunnerEnrollment(db: Database, input: unknown): Promise<RunnerEnrollmentResponse> {
  const request = validate<RunnerEnrollmentRequest>('RunnerEnrollmentRequest', input);
  if (request.credential === request.enrollment_token)
    throw new CommandError('invalid_input', 'Runner credential must differ from its enrollment token');
  const requestDigest = digest(canonicalJSON(request));
  try {
    return await transaction(db, async tx => {
      const row = (await tx.query<Enrollment>('SELECT * FROM runner_enrollments WHERE token_hash=$1 FOR UPDATE',
        [digest(request.enrollment_token)])).rows[0];
      if (!row) throw new CommandError('unauthorized', 'Runner enrollment is unavailable or expired');
      if (row.request_id !== null) {
        if (row.request_id !== request.request_id || row.request_digest !== requestDigest)
          throw new CommandError('payload_conflict', 'Runner enrollment was consumed by a different request');
        // Receipt replay never restores a credential that was later rotated or revoked.
        return validate('RunnerEnrollmentResponse', { schema_version: 1, request_id: row.request_id, runner_id: row.runner_id });
      }
      const runner_id = randomUUID(), credentialHash = digest(request.credential);
      const inserted = await tx.query(`INSERT INTO runners(id,credential_hash,capacity)
        SELECT $1,$2,capacity FROM runner_enrollments WHERE id=$3 AND expires_at>clock_timestamp() RETURNING id`,
      [runner_id, credentialHash, row.id]);
      if (inserted.rowCount !== 1) throw new CommandError('unauthorized', 'Runner enrollment is unavailable or expired');
      // Use database wall-clock time after acquiring the token lock. A queued
      // request cannot redeem with a timestamp from before its lock wait.
      const consumed = await tx.query(`WITH stamp AS MATERIALIZED (SELECT clock_timestamp() AS current_time)
        UPDATE runner_enrollments SET request_id=$2,request_digest=$3,credential_hash=$4,
        runner_id=$5,redeemed_at=stamp.current_time FROM stamp WHERE id=$1 AND expires_at>stamp.current_time RETURNING id`,
      [row.id, request.request_id, requestDigest, credentialHash, runner_id]);
      if (consumed.rowCount !== 1) throw new CommandError('unauthorized', 'Runner enrollment is unavailable or expired');
      return validate('RunnerEnrollmentResponse', { schema_version: 1, request_id: request.request_id, runner_id });
    });
  } catch (error) {
    if (error && typeof error === 'object' && 'code' in error && error.code === '23505')
      throw new CommandError('payload_conflict', 'Runner enrollment request or credential is already bound');
    throw error;
  }
}
