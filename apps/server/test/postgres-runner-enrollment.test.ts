import { randomBytes, randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { database } from '../../../packages/db/src/index.ts';
import type { Database } from '../../../packages/db/src/index.ts';
import { migrate } from '../../../packages/db/src/migrate.ts';
import { canonicalJSON, digest, validate } from '../../../packages/protocol/src/index.ts';
import type { RunnerEnrollmentGrant, RunnerEnrollmentRequest, RunnerEnrollmentResponse } from '../../../packages/protocol/src/index.ts';
import { createApp } from '../src/app.ts';
import { BoundaryService } from '../src/service.ts';
import { createAttemptFixture } from '../src/fixtures.ts';
import { issueRunnerEnrollment, redeemRunnerEnrollment, verifyRunnerEnrollment } from '../src/runner-enrollment.ts';

const secret = () => randomBytes(32).toString('base64url');
const fault = (code: string) => ({ detail: { code } });
const signingKey = 'synthetic-runner-enrollment-signing-key';

describe.skipIf(process.env.MONOS_TEST_DATABASE !== '1')('one-use local administrator Runner enrollment', { timeout: 20000 }, () => {
  const namespace = 'runner_enrollment_' + randomUUID().replaceAll('-', '');
  let db: Database, admin: Database, databaseUrl: string;
  beforeAll(async () => {
    if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL required');
    admin = database(process.env.DATABASE_URL); await admin.pool.query(`CREATE SCHEMA ${namespace}`);
    const url = new URL(process.env.DATABASE_URL); url.searchParams.set('options', `-c search_path=${namespace} -c statement_timeout=10000`);
    databaseUrl = url.toString(); db = database(databaseUrl); await migrate(db);
  });
  afterAll(async () => { if (db) await db.pool.end(); if (admin) { await admin.pool.query(`DROP SCHEMA ${namespace} CASCADE`); await admin.pool.end(); } });
  const issue = (capacity = 2) => issueRunnerEnrollment(db, { schema_version: 1, capacity, ttl_seconds: 60 });
  const request = (grant: RunnerEnrollmentGrant): RunnerEnrollmentRequest => ({ schema_version: 1, request_id: randomUUID(), enrollment_token: grant.enrollment_token, credential: secret() });
  const record = async (grant: RunnerEnrollmentGrant) => (await db.pool.query('SELECT * FROM runner_enrollments WHERE id=$1', [grant.enrollment_id])).rows[0];
  const runners = async () => Number((await db.pool.query('SELECT count(*) FROM runners')).rows[0].count);

  // A historical issue fixture lets expiry be tested without waiting the
  // production minimum TTL. Its stored grant still has an exact 60-second TTL.
  async function historicalGrant(expiresInMs: number): Promise<RunnerEnrollmentGrant> {
    const enrollment_id = randomUUID(), enrollment_token = secret();
    const row = (await db.pool.query<{ expires_at: Date }>(`WITH stamp AS (SELECT statement_timestamp()+$3*interval '1 millisecond' AS expiry)
      INSERT INTO runner_enrollments(id,token_hash,capacity,created_at,expires_at)
      SELECT $1,$2,2,expiry-interval '60 seconds',expiry FROM stamp RETURNING expires_at`,
    [enrollment_id, digest(enrollment_token), expiresInMs])).rows[0]!;
    return { schema_version: 1, enrollment_id, enrollment_token, expires_at: row.expires_at.toISOString(), capacity: 2 };
  }
  async function expired(grant: RunnerEnrollmentGrant) {
    await expect.poll(async () => (await db.pool.query('SELECT expires_at<=clock_timestamp() expired FROM runner_enrollments WHERE id=$1', [grant.enrollment_id])).rows[0].expired,
      { timeout: 3000, interval: 10 }).toBe(true);
  }
  async function race(grant: RunnerEnrollmentGrant, requests: RunnerEnrollmentRequest[]) {
    const barrier = await db.pool.connect(), peers = requests.map(() => database(databaseUrl));
    const pending: Promise<PromiseSettledResult<RunnerEnrollmentResponse>>[] = [];
    try {
      const pids = await Promise.all(peers.map(async peer => Number((await peer.pool.query('SELECT pg_backend_pid() pid')).rows[0].pid)));
      expect(new Set(pids).size).toBe(requests.length);
      await barrier.query('BEGIN');
      await barrier.query('SELECT id FROM runner_enrollments WHERE id=$1 FOR UPDATE', [grant.enrollment_id]);
      for (const [index, peer] of peers.entries()) pending.push(redeemRunnerEnrollment(peer, requests[index]).then(
        value => ({ status: 'fulfilled' as const, value }), reason => ({ status: 'rejected' as const, reason })));
      await expect.poll(async () => (await admin.pool.query("SELECT count(*)::int waiting FROM pg_stat_activity WHERE pid=ANY($1::int[]) AND wait_event_type='Lock'", [pids])).rows[0].waiting,
        { timeout: 3000, interval: 10 }).toBe(requests.length);
      await barrier.query('COMMIT');
      return await Promise.all(pending);
    } finally {
      await barrier.query('ROLLBACK'); barrier.release();
      await Promise.all(pending); await Promise.all(peers.map(peer => peer.pool.end()));
    }
  }

  it('issues bounded grants and persists only hashes and an immutable safe consumption receipt', async () => {
    const before = Date.now(), grant = await issue(7), input = request(grant), count = await runners();
    expect(validate('RunnerEnrollmentGrant', grant)).toEqual(grant);
    expect(grant.enrollment_token).toHaveLength(43);
    expect(Date.parse(grant.expires_at)).toBeGreaterThanOrEqual(before + 59_000);
    expect(Date.parse(grant.expires_at)).toBeLessThanOrEqual(Date.now() + 60_000);
    const output = await redeemRunnerEnrollment(db, input), row = await record(grant);
    expect(output).toEqual({ schema_version: 1, request_id: input.request_id, runner_id: row.runner_id });
    expect(row).toMatchObject({ token_hash: digest(grant.enrollment_token), request_id: input.request_id,
      request_digest: digest(canonicalJSON(input)), credential_hash: digest(input.credential), capacity: 7 });
    const runner = (await db.pool.query('SELECT * FROM runners WHERE id=$1', [output.runner_id])).rows[0];
    expect(runner).toMatchObject({ capacity: 7, credential_hash: digest(input.credential), incarnation: '0', connected: false, ready: false });
    expect(await runners()).toBe(count + 1);
    for (const value of [row, runner, output]) for (const sensitive of [grant.enrollment_token, input.credential]) expect(JSON.stringify(value)).not.toContain(sensitive);
    await expect(db.pool.query('UPDATE runner_enrollments SET capacity=8 WHERE id=$1', [grant.enrollment_id])).rejects.toMatchObject({ code: '23514' });
    await expect(db.pool.query('UPDATE runner_enrollments SET request_id=$2 WHERE id=$1', [grant.enrollment_id, randomUUID()])).rejects.toMatchObject({ code: '23514' });
    await expect(db.pool.query('DELETE FROM runner_enrollments WHERE id=$1', [grant.enrollment_id])).rejects.toMatchObject({ code: '23514' });
  });

  it('returns one Runner for concurrent identical requests on distinct database connections', async () => {
    const grant = await issue(), input = request(grant), before = await runners();
    const results = await race(grant, [input, input]);
    expect(results[0]!.status).toBe('fulfilled'); expect(results[1]).toEqual(results[0]);
    expect(await runners()).toBe(before + 1);
    expect((await record(grant)).request_id).toBe(input.request_id);
  });

  it('lets only one distinct claimant consume a token and rejects changed requests or credentials', async () => {
    const grant = await issue(), inputs = [request(grant), request(grant)], before = await runners();
    const results = await race(grant, inputs);
    expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1);
    const denied = results.find(result => result.status === 'rejected');
    expect(denied).toMatchObject({ status: 'rejected', reason: fault('payload_conflict') });
    const winner = inputs[results.findIndex(result => result.status === 'fulfilled')]!;
    await expect(redeemRunnerEnrollment(db, { ...winner, credential: secret() })).rejects.toMatchObject(fault('payload_conflict'));
    await expect(redeemRunnerEnrollment(db, { ...winner, request_id: randomUUID() })).rejects.toMatchObject(fault('payload_conflict'));
    expect(await runners()).toBe(before + 1);
  });

  it('denies unknown and expired grants, including expiry while the redemption waits for its lock', async () => {
    const before = await runners(), missing = request(await issue()); missing.enrollment_token = secret();
    await expect(redeemRunnerEnrollment(db, missing)).rejects.toMatchObject(fault('unauthorized'));
    const old = await historicalGrant(-1);
    await expect(redeemRunnerEnrollment(db, request(old))).rejects.toMatchObject(fault('unauthorized'));
    const grant = await historicalGrant(500), input = request(grant), barrier = await db.pool.connect(), peer = database(databaseUrl);
    let pending: Promise<PromiseSettledResult<RunnerEnrollmentResponse>> | undefined;
    try {
      const pid = Number((await peer.pool.query('SELECT pg_backend_pid() pid')).rows[0].pid);
      await barrier.query('BEGIN'); await barrier.query('SELECT id FROM runner_enrollments WHERE id=$1 FOR UPDATE', [grant.enrollment_id]);
      pending = redeemRunnerEnrollment(peer, input).then(value => ({ status: 'fulfilled', value }), reason => ({ status: 'rejected', reason }));
      await expect.poll(async () => (await admin.pool.query('SELECT wait_event_type FROM pg_stat_activity WHERE pid=$1', [pid])).rows[0]?.wait_event_type,
        { timeout: 3000, interval: 10 }).toBe('Lock');
      await expired(grant); await barrier.query('COMMIT');
      expect(await pending).toMatchObject({ status: 'rejected', reason: fault('unauthorized') });
      expect((await record(grant)).request_id).toBeNull(); expect(await runners()).toBe(before);
    } finally { await barrier.query('ROLLBACK'); barrier.release(); await pending; await peer.pool.end(); }
  });

  it('replays the original safe response after expiry without restoring a rotated Runner credential', async () => {
    const grant = await historicalGrant(500), input = request(grant), first = await redeemRunnerEnrollment(db, input);
    const nextCredential = secret(), service = new BoundaryService(db, { signingKey });
    const proof = { schema_version: 1, enrollment_id: grant.enrollment_id, runner_id: first.runner_id, credential_hash: digest(input.credential) };
    expect(await verifyRunnerEnrollment(db, proof)).toEqual(first);
    await db.pool.query('UPDATE runners SET credential_hash=$2 WHERE id=$1', [first.runner_id, digest(nextCredential)]);
    await expired(grant);
    expect(await redeemRunnerEnrollment(db, input)).toEqual(first);
    await expect(service.authenticateRunner(input.credential)).rejects.toMatchObject(fault('unauthorized'));
    expect(await service.authenticateRunner(nextCredential)).toBe(first.runner_id);
    await expect(verifyRunnerEnrollment(db, proof)).rejects.toMatchObject(fault('unmet_precondition'));
    await expect(verifyRunnerEnrollment(db, { ...proof, credential_hash: digest(nextCredential) })).rejects.toMatchObject(fault('unmet_precondition'));
  });

  it('rolls back Runner creation and token consumption together when commit fails', async () => {
    const grant = await issue(), input = request(grant), before = await runners();
    await db.pool.query(`CREATE FUNCTION reject_test_enrollment() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN RAISE EXCEPTION 'synthetic enrollment commit failure'; END; $$`);
    await db.pool.query(`CREATE CONSTRAINT TRIGGER reject_test_enrollment AFTER UPDATE ON runner_enrollments
      DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION reject_test_enrollment()`);
    try { await expect(redeemRunnerEnrollment(db, input)).rejects.toMatchObject({ code: 'P0001' }); }
    finally { await db.pool.query('DROP TRIGGER reject_test_enrollment ON runner_enrollments'); await db.pool.query('DROP FUNCTION reject_test_enrollment()'); }
    expect(await runners()).toBe(before); expect((await record(grant)).request_id).toBeNull();
    expect((await redeemRunnerEnrollment(db, input)).request_id).toBe(input.request_id);
    expect(await runners()).toBe(before + 1);
  });

  it('cannot reuse another Runner credential or a request ID on a different enrollment', async () => {
    const firstGrant = await issue(), firstRequest = request(firstGrant), first = await redeemRunnerEnrollment(db, firstRequest);
    const nextGrant = await issue(), nextRequest = request(nextGrant), before = await runners();
    await expect(redeemRunnerEnrollment(db, { ...nextRequest, credential: firstRequest.credential })).rejects.toMatchObject(fault('payload_conflict'));
    await expect(redeemRunnerEnrollment(db, { ...nextRequest, request_id: firstRequest.request_id })).rejects.toMatchObject(fault('payload_conflict'));
    await expect(redeemRunnerEnrollment(db, { ...nextRequest, credential: nextGrant.enrollment_token })).rejects.toMatchObject(fault('invalid_input'));
    expect((await record(nextGrant)).request_id).toBeNull(); expect(await runners()).toBe(before);
    expect((await db.pool.query('SELECT credential_hash FROM runners WHERE id=$1', [first.runner_id])).rows[0].credential_hash).toBe(digest(firstRequest.credential));
    expect((await redeemRunnerEnrollment(db, nextRequest)).runner_id).not.toBe(first.runner_id);
  });

  it('uses actual HTTP enrollment validation and preserves unresolved ownership across same-Runner reconnects', async () => {
    const service = new BoundaryService(db, { signingKey }), app = createApp(service), grant = await issue(), input = request(grant);
    const send = (payload: unknown) => app.inject({ method: 'POST', url: '/v1/runner/enroll',
      headers: { 'content-type': 'application/json' }, payload: JSON.stringify(payload) });
    try {
      for (const payload of [{ ...input, enrollment_token: secret() }, request(await historicalGrant(-1))]) {
        const denied = await send(payload); expect(denied.statusCode).toBe(401);
        expect(denied.headers['cache-control']).toBe('no-store'); expect(denied.body).not.toContain(input.credential);
      }
      for (const payload of [{ ...input, runner_id: 'caller-selected' }, { ...input, capacity: 32 }, { ...input, credential: input.enrollment_token }]) {
        const denied = await send(payload); expect(denied.statusCode).toBe(409); expect(denied.json().error.code).toBe('invalid_input'); expect(denied.body).not.toContain(input.enrollment_token);
      }
      const huge = await send({ ...input, extra: 'x'.repeat(5000) }); expect(huge.statusCode).toBe(409); expect(huge.json().error.code).toBe('invalid_input');
      const response = await send(input); expect(response.statusCode).toBe(200);
      expect(response.headers['cache-control']).toBe('no-store'); expect(response.headers['x-content-type-options']).toBe('nosniff');
      const identity = validate<RunnerEnrollmentResponse>('RunnerEnrollmentResponse', response.json());
      expect(identity.request_id).toBe(input.request_id); expect(Object.keys(identity).sort()).toEqual(['request_id', 'runner_id', 'schema_version']);
      expect(await service.authenticateRunner(input.credential)).toBe(identity.runner_id);
      const firstIncarnation = await service.connect(identity.runner_id, 'first-enrollment-boot');
      await service.touch(identity.runner_id, firstIncarnation, true);
      const launch = await createAttemptFixture(db, { runner_id: identity.runner_id, attempt_id: randomUUID(), task_id: randomUUID(),
        resource_id: randomUUID(), kind: 'node', prompt: 'synthetic unresolved enrollment ownership' });
      const ownership = (await db.pool.query('SELECT to_jsonb(a) attempt FROM attempts a WHERE id=$1', [launch.attempt_id])).rows[0].attempt;
      const restarted = new BoundaryService(db, { signingKey });
      const nextIncarnation = await restarted.connect(identity.runner_id, 'same-runner-restart');
      expect(nextIncarnation).toBe(firstIncarnation + 1);
      await expect(service.touch(identity.runner_id, firstIncarnation)).rejects.toMatchObject(fault('stale_execution'));
      expect((await restarted.inventory(identity.runner_id)).dispatches.map(dispatch => dispatch.attempt_id)).toContain(launch.attempt_id);
      expect((await send(input)).json()).toEqual(identity);
      expect((await db.pool.query('SELECT to_jsonb(a) attempt FROM attempts a WHERE id=$1', [launch.attempt_id])).rows[0].attempt).toEqual(ownership);
    } finally { await app.close(); }
  });

  it('issues through bounded native stdin and emits no grant or secret-bearing error on invalid input', async () => {
    const command = fileURLToPath(new URL('../src/runner-enrollment-admin.ts', import.meta.url));
    const run = (input: string, verify = false) => spawnSync(process.execPath, ['--experimental-strip-types', command, ...(verify ? ['--verify'] : [])], { input, encoding: 'utf8', timeout: 10000,
      env: { ...process.env, DATABASE_URL: databaseUrl, MONOS_DATABASE_URL_FILE: '' } });
    const issued = run(JSON.stringify({ schema_version: 1, capacity: 3, ttl_seconds: 60 }));
    expect(issued.status).toBe(0); expect(issued.stderr).toBe('');
    const grant = validate<RunnerEnrollmentGrant>('RunnerEnrollmentGrant', JSON.parse(issued.stdout));
    expect((await record(grant)).token_hash).toBe(digest(grant.enrollment_token));
    const input = request(grant), identity = await redeemRunnerEnrollment(db, input), before = await runners();
    const proof = { schema_version: 1, enrollment_id: grant.enrollment_id, runner_id: identity.runner_id, credential_hash: digest(input.credential) };
    const verified = run(JSON.stringify(proof), true);
    expect(verified.status).toBe(0); expect(verified.stderr).toBe(''); expect(JSON.parse(verified.stdout)).toEqual(identity);
    for (const mismatch of [{ ...proof, enrollment_id: randomUUID() }, { ...proof, credential_hash: digest(secret()) }]) {
      const denied = run(JSON.stringify(mismatch), true); expect(denied.status).toBe(1); expect(denied.stdout).toBe('');
    }
    await db.pool.query('UPDATE runners SET credential_revoked=true WHERE id=$1', [identity.runner_id]);
    expect(run(JSON.stringify(proof), true).status).toBe(1);
    expect(await runners()).toBe(before);
    for (const input of [JSON.stringify({ schema_version: 1, capacity: 0, ttl_seconds: 60, token: 'synthetic-private-value' }), 'x'.repeat(5000)]) {
      const denied = run(input); expect(denied.status).toBe(1); expect(denied.stdout).toBe('');
      expect(denied.stderr).not.toContain('synthetic-private-value'); expect(denied.stderr).not.toContain(databaseUrl);
      expect(denied.stderr).toBe('Runner enrollment administration failed; check database configuration and bounded command JSON on stdin.\n');
    }
  });
});
