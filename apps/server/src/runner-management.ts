import { randomBytes, randomUUID } from 'node:crypto';
import { transaction } from '../../../packages/db/src/index.ts';
import type { Database } from '../../../packages/db/src/index.ts';
import { CommandError } from '../../../packages/domain/src/commands.ts';
import { canonicalJSON, digest, validate } from '../../../packages/protocol/src/index.ts';
import type { RunnerManageCommand, RunnerManageResult, RunnerRotationGrant, RunnerRotationRequest, RunnerRotationResponse } from '../../../packages/protocol/src/index.ts';

interface Runner { id: string; capacity: number; credential_generation: string; credential_revoked: boolean; credential_hash: string }
interface Rotation { id: string; runner_id: string; credential_generation: string; request_id: string | null; request_digest: string | null }

// Local administrative authority only, like Owner bootstrap and enrollment issue.
// A lower capacity changes future admission; it never evicts current writers.
export async function manageRunner(db: Database, input: unknown): Promise<RunnerManageResult | RunnerRotationGrant> {
  const command = validate<RunnerManageCommand>('RunnerManageCommand', input);
  return transaction(db, async tx => {
    const runner = (await tx.query<Runner>('SELECT * FROM runners WHERE id=$1 FOR UPDATE', [command.runner_id])).rows[0];
    if (!runner) throw new CommandError('denied_scope', 'Runner is not registered');
    if (command.action === 'rotate') {
      const rotation_id = randomUUID(), rotation_token = randomBytes(32).toString('base64url');
      const row = (await tx.query<{ expires_at: Date }>(`INSERT INTO runner_credential_rotations(id,runner_id,credential_generation,token_hash,created_at,expires_at)
        VALUES($1,$2,$3,$4,clock_timestamp(),clock_timestamp()+$5*interval '1 second') RETURNING expires_at`,
      [rotation_id, runner.id, runner.credential_generation, digest(rotation_token), command.ttl_seconds])).rows[0]!;
      return validate('RunnerRotationGrant', { schema_version: 1, runner_id: runner.id, rotation_id, rotation_token, expires_at: row.expires_at.toISOString() });
    }
    if (command.action === 'revoke' && !runner.credential_revoked) {
      await tx.query(`UPDATE runners SET credential_revoked=true,credential_generation=credential_generation+1,
        incarnation=incarnation+1,connected=false,ready=false,connection_instance=NULL WHERE id=$1`, [runner.id]);
      runner.credential_revoked = true;
    }
    if (command.action === 'set_capacity') {
      await tx.query('UPDATE runners SET capacity=$2 WHERE id=$1', [runner.id, command.capacity]);
      runner.capacity = command.capacity!;
    }
    return validate('RunnerManageResult', { schema_version: 1, runner_id: runner.id, capacity: runner.capacity, credential_revoked: runner.credential_revoked });
  });
}

export async function redeemRunnerRotation(db: Database, input: unknown): Promise<RunnerRotationResponse> {
  const request = validate<RunnerRotationRequest>('RunnerRotationRequest', input);
  if (request.credential === request.rotation_token) throw new CommandError('invalid_input', 'Runner credential must differ from its rotation grant');
  const requestDigest = digest(canonicalJSON(request));
  try {
    return await transaction(db, async tx => {
      // Runner-first locking is shared with connect, all admissions and admin.
      const runner = (await tx.query<Runner>('SELECT * FROM runners WHERE id=$1 FOR UPDATE', [request.runner_id])).rows[0];
      const grant = (await tx.query<Rotation>('SELECT * FROM runner_credential_rotations WHERE token_hash=$1 AND runner_id=$2 FOR UPDATE',
        [digest(request.rotation_token), request.runner_id])).rows[0];
      if (!runner || !grant) throw new CommandError('unauthorized', 'Runner rotation is unavailable or expired');
      if (grant.request_id !== null) {
        if (grant.request_id !== request.request_id || grant.request_digest !== requestDigest)
          throw new CommandError('payload_conflict', 'Runner rotation was consumed by a different request');
        // Exact lost-response replay does not restore a later revoked credential.
        return validate('RunnerRotationResponse', { schema_version: 1, runner_id: runner.id, request_id: grant.request_id });
      }
      const credentialHash = digest(request.credential);
      if (credentialHash === runner.credential_hash) throw new CommandError('invalid_input', 'Rotation requires a new Runner credential');
      const consumed = await tx.query(`UPDATE runner_credential_rotations SET request_id=$2,request_digest=$3,credential_hash=$4,redeemed_at=clock_timestamp()
        WHERE id=$1 AND credential_generation=$5 AND expires_at>clock_timestamp() RETURNING id`,
      [grant.id, request.request_id, requestDigest, credentialHash, runner.credential_generation]);
      if (consumed.rowCount !== 1) throw new CommandError('unauthorized', 'Runner rotation is unavailable or expired');
      await tx.query(`UPDATE runners SET credential_hash=$2,credential_revoked=false,credential_generation=credential_generation+1,
        incarnation=incarnation+1,connected=false,ready=false,connection_instance=NULL WHERE id=$1`, [runner.id, credentialHash]);
      return validate('RunnerRotationResponse', { schema_version: 1, runner_id: runner.id, request_id: request.request_id });
    });
  } catch (error) {
    if (error && typeof error === 'object' && 'code' in error && error.code === '23505')
      throw new CommandError('payload_conflict', 'Rotation request or credential is already bound');
    throw error;
  }
}
