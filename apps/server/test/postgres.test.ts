import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { database } from '../../../packages/db/src/index.ts';
import type { Database } from '../../../packages/db/src/index.ts';
import { migrate } from '../../../packages/db/src/migrate.ts';
import { MAX_FRAME_BYTES, submission } from '../../../packages/protocol/src/index.ts';
import type { CommandEnvelope, Dispatch, RuntimeEvent } from '../../../packages/protocol/src/index.ts';
import { BoundaryService } from '../src/service.ts';
import { createAttemptFixture, enrollFixture, retryOperationFixture, revokeFixture } from '../src/fixtures.ts';
import { issueAttemptCredential } from '../src/auth.ts';
import { createApp } from '../src/app.ts';
import { WebSocket } from 'ws';
import { once } from 'node:events';
import type { AddressInfo } from 'node:net';
import type { Frame } from '../../../packages/protocol/src/index.ts';

const enabled = process.env.MONOS_TEST_DATABASE === '1';
const signingKey = 'test-only-signing-key-never-for-deployment';
describe.skipIf(!enabled)('real PostgreSQL boundary admission', () => {
  let db: Database;
  let admin: Database;
  const namespace = `probe_test_${randomUUID().replaceAll('-', '')}`;
  beforeAll(async () => {
    if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL required for real PostgreSQL tests');
    admin = database(process.env.DATABASE_URL);
    await admin.pool.query(`CREATE SCHEMA ${namespace}`);
    const url = new URL(process.env.DATABASE_URL);
    url.searchParams.set('options', `-c search_path=${namespace}`);
    db = database(url.toString());
    await migrate(db);
    await migrate(db);
  });
  afterAll(async () => { if (db) await db.pool.end(); if (admin) { await admin.pool.query(`DROP SCHEMA ${namespace} CASCADE`); await admin.pool.end(); } });

  async function fixture(kind: 'node' | 'planner' = 'node', capacity = 2) {
    const runnerId = randomUUID();
    const runnerToken = randomUUID();
    await enrollFixture(db, runnerId, runnerToken, capacity);
    const service = new BoundaryService(db, { signingKey });
    const incarnation = await service.connect(runnerId, 'boot-test');
    await service.touch(runnerId, incarnation, true);
    const launch = await createAttemptFixture(db, { runner_id: runnerId, attempt_id: randomUUID(), task_id: randomUUID(), kind, resource_id: 'fixture-repo', prompt: 'probe' });
    const grant = await service.authorize(runnerId, incarnation, launch.dispatch_id);
    expect(grant).not.toBeNull();
    return { runnerId, runnerToken, service, incarnation, launch, token: grant!.credential };
  }
  function complete(launch: Dispatch & { task_id: string }): CommandEnvelope {
    return { schema_version: 1, request_id: randomUUID(), scope_id: launch.task_id, expected_control_version: launch.control_version, name: 'complete_node', payload: { summary: 'complete' } };
  }

  it('serializes concurrent receipt replay and defers completion until physical settlement', async () => {
    const f = await fixture(); const command = complete(f.launch); const body = submission(command);
    const [a, b] = await Promise.all([f.service.admit(f.token, body), f.service.admit(f.token, body)]);
    expect(a.operation_id).toBe(b.operation_id); expect(a.status).toBe('admitted');
    expect((await db.pool.query('SELECT state FROM nodes WHERE id=$1', [f.launch.node_id])).rows[0].state).toBe('RUNNING');
    await expect(f.service.admit(f.token, submission({ ...command, request_id: randomUUID() }))).rejects.toMatchObject({ detail: { code: 'stale_execution' } });
    await expect(f.service.admit(f.token, submission({ ...command, payload: { summary: 'changed' } }))).rejects.toMatchObject({ detail: { code: 'payload_conflict' } });
    await expect(f.service.finishOperation(f.runnerId, f.incarnation, { operation_id: a.operation_id!, attempt_id: f.launch.attempt_id, success: true, result: { git_commit: 'a'.repeat(40), git_tree: 'b'.repeat(40) } })).rejects.toThrow('Whole-tree');
    const settled = { operation_id: a.operation_id!, attempt_id: f.launch.attempt_id, success: true, result: { writer_absent: true, git_commit: 'a'.repeat(40), git_tree: 'b'.repeat(40) } };
    await f.service.finishOperation(f.runnerId, f.incarnation, settled);
    await f.service.finishOperation(f.runnerId, f.incarnation, settled);
    expect((await f.service.admit(f.token, body)).status).toBe('committed');
    expect((await db.pool.query('SELECT count(*) FROM task_events WHERE attempt_id=$1', [f.launch.attempt_id])).rows[0].count).toBe('1');
    expect((await db.pool.query('SELECT state FROM tasks WHERE id=$1', [f.launch.task_id])).rows[0].state).toBe('REVIEW');
  });

  it('lets an admitted completion settle after an exit observation without inventing failure', async () => {
    const f = await fixture();
    const admitted = await f.service.admit(f.token, submission(complete(f.launch)));
    await f.service.event(f.runnerId, f.incarnation, { attempt_id: f.launch.attempt_id, dispatch_id: f.launch.dispatch_id,
      stream_id: 'runtime', sequence: 1, kind: 'process_absent', text: 'verified whole-tree absence' });
    expect((await db.pool.query('SELECT state,exit_observed FROM attempts WHERE id=$1', [f.launch.attempt_id])).rows[0]).toEqual({ state: 'RUNNING', exit_observed: true });
    await f.service.finishOperation(f.runnerId, f.incarnation, { operation_id: admitted.operation_id!, attempt_id: f.launch.attempt_id,
      success: true, result: { writer_absent: true, git_commit: 'a'.repeat(40), git_tree: 'b'.repeat(40) } });
    expect((await db.pool.query('SELECT state FROM nodes WHERE id=$1', [f.launch.node_id])).rows[0].state).toBe('COMPLETED');
    expect((await db.pool.query("SELECT count(*) FROM task_events WHERE attempt_id=$1 AND kind='missing_formal_outcome'", [f.launch.attempt_id])).rows[0].count).toBe('0');
  });

  it('capture failure revokes authority while Stop is unresolved and preserves reservations', async () => {
    const f = await fixture();
    const fact: RuntimeEvent = { attempt_id: f.launch.attempt_id, dispatch_id: f.launch.dispatch_id, stream_id: 'runtime', sequence: 1, kind: 'capture_failed', text: 'spool write failed' };
    await f.service.event(f.runnerId, f.incarnation, fact);
    await f.service.event(f.runnerId, f.incarnation, fact);
    await expect(f.service.admit(f.token, submission(complete(f.launch)))).rejects.toMatchObject({ detail: { code: 'stale_execution' } });
    expect((await db.pool.query('SELECT state,mutation_allowed,process_released FROM attempts WHERE id=$1', [f.launch.attempt_id])).rows[0]).toEqual({ state: 'FAILED', mutation_allowed: false, process_released: false });
    const stop = (await db.pool.query("SELECT id FROM operations WHERE attempt_id=$1 AND kind='stop'", [f.launch.attempt_id])).rows;
    expect(stop).toHaveLength(1);
    await f.service.finishOperation(f.runnerId, f.incarnation, { attempt_id: f.launch.attempt_id, operation_id: stop[0].id, success: false, failure_kind: 'recoverable', result: { message: 'writer remains' } });
    expect((await db.pool.query('SELECT process_released FROM attempts WHERE id=$1', [f.launch.attempt_id])).rows[0].process_released).toBe(false);
    expect((await db.pool.query('SELECT state FROM nodes WHERE id=$1', [f.launch.node_id])).rows[0].state).toBe('BLOCKED');
  });

  for (const failureFirst of [true, false]) it(`retains completion recovery after capture failure and absence (failure first: ${failureFirst})`, async () => {
    const f = await fixture();
    const admitted = await f.service.admit(f.token, submission(complete(f.launch)));
    await f.service.event(f.runnerId, f.incarnation, { attempt_id: f.launch.attempt_id, dispatch_id: f.launch.dispatch_id, stream_id: 'runtime', sequence: 1, kind: 'capture_failed', text: 'spool failed' });
    expect((await db.pool.query("SELECT count(*) FROM operations WHERE attempt_id=$1 AND kind='stop'", [f.launch.attempt_id])).rows[0].count).toBe('0');
    const failure = () => f.service.finishOperation(f.runnerId, f.incarnation, { attempt_id: f.launch.attempt_id, operation_id: admitted.operation_id!, success: false, failure_kind: 'recoverable', result: { message: 'Git repair required' } });
    const absence = () => f.service.event(f.runnerId, f.incarnation, { attempt_id: f.launch.attempt_id, dispatch_id: f.launch.dispatch_id, stream_id: 'runtime', sequence: 2, kind: 'process_absent', text: 'verified absence' });
    if (failureFirst) { await failure(); await absence(); } else { await absence(); await failure(); }
    expect((await db.pool.query('SELECT state FROM nodes WHERE id=$1', [f.launch.node_id])).rows[0].state).toBe('BLOCKED');
    expect((await db.pool.query('SELECT process_released FROM attempts WHERE id=$1', [f.launch.attempt_id])).rows[0].process_released).toBe(false);
    await retryOperationFixture(db, admitted.operation_id!);
    await f.service.finishOperation(f.runnerId, f.incarnation, { attempt_id: f.launch.attempt_id, operation_id: admitted.operation_id!, success: true, result: { writer_absent: true, git_commit: 'a'.repeat(40), git_tree: 'b'.repeat(40) } });
    expect((await db.pool.query('SELECT state FROM nodes WHERE id=$1', [f.launch.node_id])).rows[0].state).toBe('COMPLETED');
  });

  it('rolls back a crash before commit and recovers admission after a lost reply/restart', async () => {
    const f = await fixture(); const command = complete(f.launch);
    const before = new BoundaryService(db, { signingKey, beforeAdmissionCommit: () => { throw new Error('injected before commit'); } });
    const beforeIncarnation = await before.connect(f.runnerId, 'boot-test'); await before.touch(f.runnerId, beforeIncarnation, true);
    await expect(before.admit(f.token, submission(command))).rejects.toThrow('injected');
    expect((await f.service.commandStatus(f.token, command.request_id)).status).toBe('unknown');
    const after = new BoundaryService(db, { signingKey, afterAdmissionCommit: () => { throw new Error('injected lost reply'); } });
    const afterIncarnation = await after.connect(f.runnerId, 'boot-test'); await after.touch(f.runnerId, afterIncarnation, true);
    await expect(after.admit(f.token, submission(command))).rejects.toThrow('lost reply');
    const restarted = new BoundaryService(db, { signingKey });
    const recovered = await restarted.recoverCommand(f.runnerId, f.launch.attempt_id, command.request_id);
    expect(recovered.status).toBe('admitted');
    expect((await restarted.admit(f.token, submission(command))).operation_id).toBe(recovered.operation_id);
    const expired = issueAttemptCredential({ attempt_id: f.launch.attempt_id, dispatch_id: f.launch.dispatch_id, fencing_generation: 1, expires: Date.now() - 1 }, signingKey);
    await expect(restarted.admit(expired, submission(command))).rejects.toMatchObject({ detail: { code: 'unauthorized' } });
    expect((await restarted.recoverOperation(f.runnerId, recovered.operation_id!)).state).toBe('admitted');
    await expect(restarted.recoverCommand('another-runner', f.launch.attempt_id, command.request_id)).rejects.toMatchObject({ detail: { code: 'denied_scope' } });
    expect(await after.authorize(f.runnerId, afterIncarnation, f.launch.dispatch_id)).toBeNull();
  });

  it('requires reconnect after backend restart even while old heartbeat is fresh', async () => {
    const f = await fixture(); const restarted = new BoundaryService(db, { signingKey });
    const body = submission(complete(f.launch));
    await expect(restarted.admit(f.token, body)).rejects.toMatchObject({ detail: { code: 'control_unavailable' } });
    const current = await restarted.connect(f.runnerId, 'boot-test'); await restarted.touch(f.runnerId, current, true);
    expect((await restarted.admit(f.token, body)).status).toBe('admitted');
  });

  it('fences replaced channels and deduplicates reordered events without conflating ACK with completion', async () => {
    const f = await fixture();
    const second = await f.service.connect(f.runnerId, 'boot-test'); await f.service.touch(f.runnerId, second, true);
    const event: RuntimeEvent = { attempt_id: f.launch.attempt_id, dispatch_id: f.launch.dispatch_id, stream_id: 'stdout', sequence: 2, kind: 'output', text: 'second' };
    await expect(f.service.event(f.runnerId, f.incarnation, event)).rejects.toThrow('replaced');
    await f.service.event(f.runnerId, second, event);
    const first = { ...event, sequence: 1, text: 'first' };
    await f.service.event(f.runnerId, second, first); await f.service.event(f.runnerId, second, first);
    await expect(f.service.event(f.runnerId, second, { ...first, text: 'different' })).rejects.toThrow('different content');
    expect((await db.pool.query('SELECT count(*) FROM runtime_events WHERE attempt_id=$1', [f.launch.attempt_id])).rows[0].count).toBe('2');
    expect((await db.pool.query('SELECT state FROM nodes WHERE id=$1', [f.launch.node_id])).rows[0].state).toBe('RUNNING');
    await f.service.disconnect(f.runnerId, f.incarnation);
    expect(await f.service.authorize(f.runnerId, second, f.launch.dispatch_id)).not.toBeNull();
  });

  it('reserves capacity for revoked dispatch until physical stop and replays lost start ACK identity', async () => {
    const f = await fixture('node', 1);
    const first = await f.service.pending(f.runnerId, f.incarnation);
    await db.pool.query('UPDATE outbox SET last_sent_at=NULL WHERE attempt_id=$1', [f.launch.attempt_id]);
    const repeated = await f.service.pending(f.runnerId, f.incarnation);
    expect(first[0]!.dispatch!.dispatch_id).toBe(repeated[0]!.dispatch!.dispatch_id);
    await revokeFixture(db, f.launch.attempt_id);
    expect(await f.service.authorize(f.runnerId, f.incarnation, f.launch.dispatch_id)).toBeNull();
    const next = { runner_id: f.runnerId, attempt_id: randomUUID(), task_id: randomUUID(), kind: 'node' as const, resource_id: 'fixture-repo', prompt: 'next' };
    await expect(createAttemptFixture(db, next)).rejects.toThrow('capacity');
    const inventory = await f.service.inventory(f.runnerId);
    expect(inventory.dispatches[0]!.mutation_allowed).toBe(false);
    await f.service.finishOperation(f.runnerId, f.incarnation, { attempt_id: f.launch.attempt_id, operation_id: inventory.operations[0]!.operation_id, success: true, result: { writer_absent: true } });
    await createAttemptFixture(db, next);
  });

  it('recovers cancellation before Start delivery without releasing capacity on an absence event alone', async () => {
    const f = await fixture('node', 1);
    await revokeFixture(db, f.launch.attempt_id);
    await revokeFixture(db, f.launch.attempt_id);
    const restarted = new BoundaryService(db, { signingKey });
    const incarnation = await restarted.connect(f.runnerId, 'boot-test');
    const inventory = await restarted.inventory(f.runnerId);
    expect(inventory.dispatches).toEqual([{ ...f.launch, mutation_allowed: false }]);
    expect(inventory.operations).toHaveLength(1);
    const stop = inventory.operations[0]!;
    expect(stop.kind).toBe('stop');
    await restarted.touch(f.runnerId, incarnation, true);
    expect(await restarted.authorize(f.runnerId, incarnation, f.launch.dispatch_id)).toBeNull();
    await expect(restarted.admit(f.token, submission(complete(f.launch)))).rejects.toMatchObject({ detail: { code: 'stale_execution' } });
    expect(await restarted.pending(f.runnerId, incarnation)).toEqual([{ schema_version: 1, type: 'effect', incarnation, operation: stop }]);

    const next = { runner_id: f.runnerId, attempt_id: randomUUID(), task_id: randomUUID(), kind: 'node' as const, resource_id: 'fixture-repo', prompt: 'next' };
    await restarted.event(f.runnerId, incarnation, { attempt_id: f.launch.attempt_id, dispatch_id: f.launch.dispatch_id, stream_id: 'runtime', sequence: 1, kind: 'process_absent', text: 'never-launched tombstone verified', boot_id: 'boot-test' });
    await expect(createAttemptFixture(db, next)).rejects.toThrow('capacity');
    await expect(restarted.finishOperation(f.runnerId, incarnation, { attempt_id: f.launch.attempt_id, operation_id: stop.operation_id, success: true, result: {} })).rejects.toThrow('Whole-tree');
    expect((await restarted.inventory(f.runnerId)).operations).toEqual([stop]);

    const result = { attempt_id: f.launch.attempt_id, operation_id: stop.operation_id, success: true, result: { writer_absent: true } };
    await restarted.finishOperation(f.runnerId, incarnation, result);
    await restarted.finishOperation(f.runnerId, incarnation, result);
    expect((await restarted.inventory(f.runnerId)).dispatches).toEqual([]);
    expect((await restarted.inventory(f.runnerId)).operations).toEqual([]);
    expect(await restarted.pending(f.runnerId, incarnation)).toEqual([]);
    expect((await db.pool.query('SELECT started,process_absent,process_released FROM attempts WHERE id=$1', [f.launch.attempt_id])).rows[0]).toEqual({ started: false, process_absent: true, process_released: true });
    await createAttemptFixture(db, next);
  });

  it('allows exactly one independent claimant for the final capacity slot', async () => {
    const runnerId = randomUUID(); await enrollFixture(db, runnerId, randomUUID(), 1);
    const attempts = await Promise.allSettled([0, 1].map(() => createAttemptFixture(db, { runner_id: runnerId, attempt_id: randomUUID(), task_id: randomUUID(), kind: 'node', resource_id: 'repo', prompt: 'race' })));
    expect(attempts.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect(attempts.filter((result) => result.status === 'rejected')).toHaveLength(1);
  });

  it('does not let retained recovery outbox rows starve runnable effects', async () => {
    const f = await fixture();
    await f.service.event(f.runnerId, f.incarnation, { attempt_id: f.launch.attempt_id, dispatch_id: f.launch.dispatch_id, stream_id: 'runtime', sequence: 1, kind: 'started', text: 'started' });
    const command: CommandEnvelope = { schema_version: 1, request_id: 'workspace', scope_id: f.launch.task_id, expected_control_version: 1, name: 'open_workspace', payload: { resource_id: 'fixture-repo' } };
    for (let index = 0; index < 16; index++) {
      if (index % 4 === 0) await f.service.touch(f.runnerId, f.incarnation);
      const admitted = await f.service.admit(f.token, submission({ ...command, request_id: `recovery-${index}` }));
      await f.service.finishOperation(f.runnerId, f.incarnation, { attempt_id: f.launch.attempt_id, operation_id: admitted.operation_id!, success: false, result: { message: 'repair needed' } });
      // Stable early ordering reproduces the LIMIT-before-filter starvation.
      await db.pool.query('UPDATE outbox SET id=$2 WHERE operation_id=$1', [admitted.operation_id, `a-${f.launch.attempt_id}-${index}`]);
    }
    await f.service.touch(f.runnerId, f.incarnation);
    const next = await f.service.admit(f.token, submission(command));
    await db.pool.query('UPDATE outbox SET id=$2 WHERE operation_id=$1', [next.operation_id, `z-${f.launch.attempt_id}`]);
    const frames = await f.service.pending(f.runnerId, f.incarnation);
    expect(frames.map((frame) => frame.operation?.operation_id)).toEqual([next.operation_id]);
    expect((await db.pool.query('SELECT process_released FROM attempts WHERE id=$1', [f.launch.attempt_id])).rows[0].process_released).toBe(false);
  });

  it('paginates long Unicode inventory without losing ownership, and rejects stale snapshots', async () => {
    const f = await fixture('node', 5);
    for (let index = 0; index < 3; index++) await createAttemptFixture(db, { runner_id: f.runnerId, attempt_id: `unicode-${index}-${randomUUID()}`, task_id: randomUUID(), kind: 'node', resource_id: 'repo', prompt: '😀'.repeat(100_000) });
    const first = await f.service.inventory(f.runnerId);
    expect(first.next_cursor).toBeDefined();
    await f.service.touch(f.runnerId, f.incarnation); // heartbeat is not inventory content.
    let page = first;
    const dispatches = [...page.dispatches];
    while (page.next_cursor) {
      expect(Buffer.byteLength(JSON.stringify(page))).toBeLessThanOrEqual(MAX_FRAME_BYTES);
      page = await f.service.inventory(f.runnerId, page.next_cursor, first.snapshot_id);
      expect(page.snapshot_id).toBe(first.snapshot_id);
      dispatches.push(...page.dispatches);
    }
    expect(new Set(dispatches.map((dispatch) => dispatch.attempt_id)).size).toBe(4);
    expect(dispatches).toHaveLength(4);
    await expect(createAttemptFixture(db, { runner_id: f.runnerId, attempt_id: randomUUID(), task_id: randomUUID(), kind: 'node', resource_id: 'repo', prompt: '😀'.repeat(262_144) })).rejects.toThrow('wire byte limit');
    await expect(f.service.inventory(f.runnerId, first.next_cursor)).rejects.toMatchObject({ detail: { code: 'invalid_input' } });
    await revokeFixture(db, f.launch.attempt_id);
    await expect(f.service.inventory(f.runnerId, first.next_cursor, first.snapshot_id)).rejects.toMatchObject({ detail: { code: 'version_conflict' } });
    expect((await f.service.inventory(f.runnerId)).snapshot_id).not.toBe(first.snapshot_id);
  });

  it('splits operation pages and excludes settled history while retaining scoped receipt reads', async () => {
    const f = await fixture();
    for (let index = 0; index < 70; index++) {
      // Integration databases may be remote; model the connected Runner's heartbeat.
      if (index % 10 === 0) await f.service.touch(f.runnerId, f.incarnation);
      await f.service.admit(f.token, submission({ schema_version: 1, request_id: `workspace-${index}`, scope_id: f.launch.task_id, expected_control_version: 1, name: 'open_workspace', payload: { resource_id: 'fixture-repo' } }));
    }
    const first = await f.service.inventory(f.runnerId);
    expect(first.next_cursor).toBeDefined();
    const second = await f.service.inventory(f.runnerId, first.next_cursor, first.snapshot_id);
    expect(second.next_cursor).toBeUndefined();
    const operations = [...first.operations, ...second.operations];
    expect(new Set(operations.map((operation) => operation.operation_id)).size).toBe(70);
    for (const operation of operations) await f.service.finishOperation(f.runnerId, f.incarnation, { attempt_id: f.launch.attempt_id, operation_id: operation.operation_id, success: true, result: { workspace_id: 'workspace', path: '/runner-only/workspace' } });
    await f.service.touch(f.runnerId, f.incarnation);
    const command = complete(f.launch);
    const receipt = await f.service.admit(f.token, submission(command));
    await f.service.finishOperation(f.runnerId, f.incarnation, { attempt_id: f.launch.attempt_id, operation_id: receipt.operation_id!, success: true, result: { writer_absent: true, git_commit: 'a'.repeat(40), git_tree: 'b'.repeat(40) } });
    const settled = await f.service.inventory(f.runnerId);
    expect(settled.dispatches).toEqual([]); expect(settled.operations).toEqual([]);
    expect((await f.service.recoverCommand(f.runnerId, f.launch.attempt_id, command.request_id)).status).toBe('committed');
  });

  it('blocks only typed capture failures and reconciles the original operation after repair', async () => {
    const f = await fixture();
    const receipt = await f.service.admit(f.token, submission(complete(f.launch)));
    const failure = { attempt_id: f.launch.attempt_id, operation_id: receipt.operation_id!, success: false, result: { message: 'reconcile retained result' } };
    const nodeState = async () => (await db.pool.query('SELECT state FROM nodes WHERE id=$1', [f.launch.node_id])).rows[0].state;
    await f.service.finishOperation(f.runnerId, f.incarnation, { ...failure, failure_kind: 'recoverable' });
    expect(await nodeState()).toBe('RUNNING');
    await retryOperationFixture(db, receipt.operation_id!);
    await f.service.finishOperation(f.runnerId, f.incarnation, { ...failure, failure_kind: 'capture_hard_limit' });
    expect(await nodeState()).toBe('BLOCKED');
    expect((await db.pool.query('SELECT process_released FROM attempts WHERE id=$1', [f.launch.attempt_id])).rows[0].process_released).toBe(false);
    await retryOperationFixture(db, receipt.operation_id!);
    await f.service.finishOperation(f.runnerId, f.incarnation, { ...failure, failure_kind: 'recoverable' });
    await retryOperationFixture(db, receipt.operation_id!);
    const result = { attempt_id: f.launch.attempt_id, operation_id: receipt.operation_id!, success: true, result: { writer_absent: true, git_commit: 'a'.repeat(40), git_tree: 'b'.repeat(40) } };
    await db.pool.query('UPDATE nodes SET activation=2 WHERE id=$1', [f.launch.node_id]);
    await expect(f.service.finishOperation(f.runnerId, f.incarnation, result)).rejects.toMatchObject({ detail: { code: 'stale_execution' } });
    await db.pool.query('UPDATE nodes SET activation=1 WHERE id=$1', [f.launch.node_id]);
    await f.service.finishOperation(f.runnerId, f.incarnation, result);
    expect(await nodeState()).toBe('COMPLETED');
    expect((await f.service.recoverOperation(f.runnerId, receipt.operation_id!)).state).toBe('succeeded');
  });

  it('keeps the surrounding Task state when a Planner exits without a formal reply', async () => {
    const f = await fixture('planner');
    await f.service.event(f.runnerId, f.incarnation, { attempt_id: f.launch.attempt_id, dispatch_id: f.launch.dispatch_id, stream_id: 'runtime', sequence: 1, kind: 'exited', text: 'missing reply' });
    expect((await db.pool.query('SELECT state FROM tasks WHERE id=$1', [f.launch.task_id])).rows[0].state).toBe('RUNNING');
    const operations = (await f.service.inventory(f.runnerId)).operations;
    expect(operations).toHaveLength(1); expect(operations[0]!.kind).toBe('stop');
    expect(await f.service.authorize(f.runnerId, f.incarnation, f.launch.dispatch_id)).toBeNull();
  });

  it('does not restart an owned process proven absent without a formal outcome', async () => {
    const f = await fixture();
    await f.service.event(f.runnerId, f.incarnation, { attempt_id: f.launch.attempt_id, dispatch_id: f.launch.dispatch_id, stream_id: 'control', sequence: 1, kind: 'process_absent', text: 'Prior boot process cannot exist', boot_id: 'new-boot' });
    expect(await f.service.authorize(f.runnerId, f.incarnation, f.launch.dispatch_id)).toBeNull();
    expect((await db.pool.query('SELECT state FROM nodes WHERE id=$1', [f.launch.node_id])).rows[0].state).toBe('BLOCKED');
    expect((await f.service.inventory(f.runnerId)).operations[0]!.kind).toBe('stop');
  });

  it('commits Planner reply atomically and keeps workspace writes denied', async () => {
    const f = await fixture('planner');
    const write: CommandEnvelope = { schema_version: 1, scope_id: f.launch.task_id, request_id: randomUUID(), expected_control_version: 1, name: 'open_workspace', payload: { resource_id: 'fixture-repo' } };
    await expect(f.service.admit(f.token, submission(write))).rejects.toMatchObject({ detail: { code: 'denied_scope' } });
    const reply: CommandEnvelope = { ...write, request_id: randomUUID(), name: 'commit_task_turn', payload: { reply: 'x'.repeat(100_000), source_watermark: 1, routing: { kind: 'reply_only' } } };
    expect((await f.service.admit(f.token, submission(reply))).status).toBe('committed');
    expect((await f.service.admit(f.token, submission(reply))).result!.reply).toHaveLength(100_000);
  });

  it('HTTP boundary separates Runner recovery from Attempt mutation credentials', async () => {
    const f = await fixture(); const app = createApp(f.service);
    try {
      const body = submission(complete(f.launch));
      expect((await app.inject({ method: 'POST', url: '/v1/commands', payload: body })).statusCode).toBe(401);
      expect((await app.inject({ method: 'POST', url: '/v1/commands', headers: { authorization: `Bearer ${f.runnerToken}` }, payload: body })).statusCode).toBe(401);
      expect((await app.inject({ method: 'POST', url: '/v1/commands', headers: { authorization: `Bearer ${f.token}` }, payload: body })).statusCode).toBe(200);
      expect((await app.inject({ method: 'GET', url: '/v1/runner/inventory', headers: { authorization: `Bearer ${f.token}` } })).statusCode).toBe(401);
    } finally { await app.close(); }
  });

  it('runs the real socket handshake/RPC and rejects missing authentication and incompatible versions', async () => {
    // Loopback harness checks framing only; deployment tests must additionally prove real TLS trust.
    const f = await fixture(); const app = createApp(f.service);
    await app.listen({ host: '127.0.0.1', port: 0 });
    const url = `ws://127.0.0.1:${(app.server.address() as AddressInfo).port}/v1/runner`;
    const socket = new WebSocket(url, { headers: { authorization: `Bearer ${f.runnerToken}` } });
    socket.on('error', () => undefined);
    const queued: Frame[] = [];
    let wake: (() => void) | undefined;
    socket.on('message', (bytes) => { queued.push(JSON.parse(bytes.toString()) as Frame); wake?.(); });
    async function next(type: Frame['type']): Promise<Frame> {
      for (;;) {
        const found = queued.findIndex((frame) => frame.type === type);
        if (found !== -1) return queued.splice(found, 1)[0]!;
        await new Promise<void>((resolve, reject) => {
          const timeout = setTimeout(() => { wake = undefined; reject(new Error(`Missing frame ${type}`)); }, 3000);
          wake = () => { clearTimeout(timeout); wake = undefined; resolve(); };
        });
      }
    }
    try {
      await once(socket, 'open');
      socket.send(JSON.stringify({ schema_version: 1, type: 'hello', runner_id: f.runnerId, boot_id: 'boot-test' }));
      const welcome = await next('welcome');
      socket.send(JSON.stringify({ schema_version: 1, type: 'ready', incarnation: welcome.incarnation, log_modes: ['ordered_v1'] }));
      socket.send(JSON.stringify({ schema_version: 1, type: 'authorize_dispatch', incarnation: welcome.incarnation, dispatch_id: f.launch.dispatch_id, correlation_id: 'rpc-1' }));
      const authorization = await next('authorization');
      expect(authorization.allowed).toBe(true); expect(authorization.credential).toMatch(/^attempt\.v1\./);
      const unauthenticated = new WebSocket(url);
      unauthenticated.on('error', () => undefined);
      const status = await new Promise<number>((resolve) => unauthenticated.on('unexpected-response', (_request, response) => { resolve(response.statusCode!); response.resume(); unauthenticated.terminate(); }));
      expect(status).toBe(401);
      const incompatible = new WebSocket(url, { headers: { authorization: `Bearer ${f.runnerToken}` } });
      incompatible.on('error', () => undefined);
      await once(incompatible, 'open');
      const closed = once(incompatible, 'close');
      incompatible.send(JSON.stringify({ schema_version: 2, type: 'hello', runner_id: f.runnerId, boot_id: 'boot-test' }));
      expect((await closed)[0]).toBe(4000);
    } finally { socket.terminate(); await app.close(); }
  });
});
