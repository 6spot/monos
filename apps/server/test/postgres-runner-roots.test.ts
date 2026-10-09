import { fork } from 'node:child_process';
import type { ChildProcess } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdtemp, readFile, readdir, realpath, rm } from 'node:fs/promises';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { database, transaction } from '../../../packages/db/src/index.ts';
import type { Database } from '../../../packages/db/src/index.ts';
import { migrate } from '../../../packages/db/src/migrate.ts';
import { createApp } from '../src/app.ts';
import { DispatchQueue } from '../src/dispatch-queue.ts';
import { enrollFixture, revokeFixture } from '../src/fixtures.ts';
import { RuntimeScheduling } from '../src/runtime-scheduling.ts';
import type { SchedulingRequest } from '../src/runtime-scheduling.ts';
import { BoundaryService } from '../src/service.ts';
import { initializeTask } from '../src/task-records.ts';
import type { RunnerCommand, RunnerMessage } from './fixtures/rooted-runner.ts';

class RootedRunner {
  readonly child: ChildProcess;
  readonly messages: RunnerMessage[] = [];
  readonly exited: Promise<void>;
  dead = false;
  constructor(root: string) {
    this.child = fork(new URL('./fixtures/rooted-runner.ts', import.meta.url), [], {
      cwd: root, execArgv: ['--experimental-strip-types'], stdio: ['ignore', 'ignore', 'ignore', 'ipc'],
      // No database URL or host credentials are inherited by the fake peer.
      env: { NODE_NO_WARNINGS: '1' },
    });
    this.child.on('message', (message: RunnerMessage) => this.messages.push(message));
    this.child.on('error', () => { this.dead = true; });
    this.exited = new Promise((resolve) => this.child.once('close', () => { this.dead = true; resolve(); }));
  }
  send(message: RunnerCommand) { this.child.send(message); }
  async next<T extends RunnerMessage['type']>(type: T, correlation?: string): Promise<Extract<RunnerMessage, { type: T }>> {
    for (let count = 0; count < 500; count++) {
      const failure = this.messages.find((message) => message.type === 'failure');
      if (failure?.type === 'failure') throw new Error(`Rooted Runner failed: ${failure.reason}`);
      const index = this.messages.findIndex((message) => message.type === type && (!correlation || ('correlation_id' in message && message.correlation_id === correlation)));
      if (index >= 0) return this.messages.splice(index, 1)[0] as Extract<RunnerMessage, { type: T }>;
      if (this.dead) throw new Error('Rooted Runner exited before checkpoint');
      await delay(10);
    }
    throw new Error(`Rooted Runner missed ${type} checkpoint`);
  }
  async snapshot() {
    const correlation_id = randomUUID(); this.send({ type: 'snapshot', correlation_id });
    return this.next('snapshot', correlation_id);
  }
  async stop() {
    if (!this.dead) this.child.kill('SIGKILL');
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([this.exited, new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error('Rooted Runner cleanup timed out')), 5000); })]);
    } finally { clearTimeout(timer); }
  }
}

describe.skipIf(process.env.MONOS_TEST_DATABASE !== '1')('Stage A placement across two fake Runner filesystem roots', () => {
  let db: Database; let admin: Database;
  const namespace = `runner_roots_${randomUUID().replaceAll('-', '')}`;
  beforeAll(async () => {
    if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL required');
    admin = database(process.env.DATABASE_URL);
    await admin.pool.query(`CREATE SCHEMA ${namespace}`);
    const url = new URL(process.env.DATABASE_URL);
    url.searchParams.set('options', `-c search_path=${namespace} -c statement_timeout=10000`);
    db = database(url.toString()); await migrate(db);
  });
  afterAll(async () => {
    if (db) await db.pool.end();
    if (admin) { await admin.pool.query(`DROP SCHEMA ${namespace} CASCADE`); await admin.pool.end(); }
  });

  it('resolves logical Auto, rejects ambiguity and transfer, and fences a held stale Start before any local write', async () => {
    const roots: string[] = []; const peers: RootedRunner[] = [];
    const service = new BoundaryService(db, { signingKey: 'synthetic-two-root-boundary-signing-key' });
    const app = createApp(service);
    const scheduling = new RuntimeScheduling(new DispatchQueue(db), service.instanceId);
    const model = 'opencode/longcat-2.5-preview-free';
    const target = { runtime_id: 'opencode', model_id: model };
    const submit = (request: SchedulingRequest) => transaction(db, (tx) => scheduling.selectAndEnqueue(tx, request));
    async function request(): Promise<SchedulingRequest> {
      const task_id = randomUUID();
      const expected = await transaction(db, (tx) => initializeTask(tx, { task_id, specification_id: randomUUID(), specification: { title: 'Two-root placement fixture' } }));
      // Explicit probe provenance, as in the scheduling/dispatch fixtures. No Owner or native-execution claim.
      await db.pool.query("UPDATE tasks SET state='RUNNING' WHERE id=$1", [task_id]);
      return { attempt_id: randomUUID(), task_id, expected, kind: 'planner', legacy_probe: true, resource_id: 'repo', prompt: 'Fake peer marker only; never invoke a model', source_watermark: 1 };
    }
    async function ready(id: string, installed: boolean) {
      await expect.poll(async () => (await db.pool.query(`SELECT r.connected,r.ready,r.runtime_report_incarnation=r.incarnation AS current,
        (SELECT count(*)::int FROM runtime_installations i WHERE i.runner_id=r.id) AS installations
        FROM runners r WHERE r.id=$1`, [id])).rows[0]).toEqual({ connected: true, ready: true, current: true, installations: installed ? 1 : 0 });
    }
    async function noAttempt(attempt: string) {
      expect((await db.pool.query('SELECT id FROM attempts WHERE id=$1', [attempt])).rowCount).toBe(0);
      expect((await db.pool.query('SELECT id FROM outbox WHERE attempt_id=$1', [attempt])).rowCount).toBe(0);
    }
    try {
      await app.listen({ host: '127.0.0.1', port: 0 });
      const endpoint = `ws://127.0.0.1:${(app.server.address() as AddressInfo).port}/v1/runner`;
      for (const name of ['a', 'b']) roots.push(await realpath(await mkdtemp(join(tmpdir(), `monos-runner-${name}-`))));
      const [rootA, rootB] = roots as [string, string];
      expect(rootA).not.toBe(rootB);
      expect(roots).not.toContain(await realpath(process.cwd()));
      const runnerA = randomUUID(); const runnerB = randomUUID();
      const tokenA = randomUUID(); const tokenB = randomUUID();
      await enrollFixture(db, runnerA, tokenA, 2); await enrollFixture(db, runnerB, tokenB, 2);
      const a = new RootedRunner(rootA); peers.push(a);
      const b = new RootedRunner(rootB); peers.push(b);
      a.send({ type: 'connect', endpoint, runner_id: runnerA, token: tokenA, installed: true });
      b.send({ type: 'connect', endpoint, runner_id: runnerB, token: tokenB, installed: false });
      const connectedA = await a.next('connected'); const connectedB = await b.next('connected');
      expect(connectedA.root).toBe(rootA); expect(connectedB.root).toBe(rootB);
      expect(connectedA.pid).toBe(a.child.pid); expect(connectedB.pid).toBe(b.child.pid);
      expect(new Set([process.pid, connectedA.pid, connectedB.pid]).size).toBe(3);
      await ready(runnerA, true); await ready(runnerB, false);
      await db.pool.query('UPDATE execution_policies SET policies=$1', [{ global: { default_target: target, fallback_targets: [] } }]);

      const first = await request(); const auto = await submit(first);
      expect(auto).toMatchObject({ status: 'queued', runner_id: runnerA, source: 'global', target });
      if (auto.status !== 'queued') throw new Error('Auto placement failed');
      const heldA = (await a.next('held')).dispatch;
      expect(heldA).toMatchObject({ dispatch_id: auto.dispatch_id, attempt_id: first.attempt_id, task_id: first.task_id, runner_id: runnerA, runtime_id: 'opencode', model, log_mode: 'ordered_v1' });
      expect(await readdir(join(rootA, 'starts'))).toEqual([]);
      expect(await readdir(join(rootB, 'starts'))).toEqual([]);

      const cross = randomUUID(); b.send({ type: 'probe', dispatch_id: auto.dispatch_id, correlation_id: cross });
      expect(await b.next('authorization', cross)).toEqual({ type: 'authorization', correlation_id: cross, allowed: false, credential_present: false });
      a.send({ type: 'release', dispatch_id: auto.dispatch_id });
      const authorizedA = await a.next('authorization', auto.dispatch_id);
      expect(authorizedA).toMatchObject({ allowed: true, credential_present: true });
      const markerA = JSON.parse(await readFile(join(rootA, 'starts', `${auto.dispatch_id}.json`), 'utf8'));
      expect(markerA).toEqual({ runner_id: runnerA, dispatch_id: auto.dispatch_id, attempt_id: first.attempt_id, task_id: first.task_id, runtime_id: 'opencode', root: rootA, executable: await realpath(connectedA.installation.executable!), pid: connectedA.pid });
      expect(authorizedA.marker).toEqual(markerA);
      expect(await readdir(join(rootB, 'starts'))).toEqual([]);

      b.send({ type: 'report', installed: true }); await ready(runnerB, true);
      const observations = (await db.pool.query('SELECT runner_id,runtime_id,observation FROM runtime_installations ORDER BY runner_id')).rows;
      expect(observations).toHaveLength(2);
      expect(observations.every((row) => row.runtime_id === 'opencode')).toBe(true);
      expect(new Set(observations.map((row) => row.observation.executable))).toEqual(new Set([join(rootA, 'bin', 'opencode'), join(rootB, 'bin', 'opencode')]));
      const ambiguous = await request();
      expect(await submit(ambiguous)).toMatchObject({ status: 'unavailable', reason: 'ambiguous_auto_placement' });
      await noAttempt(ambiguous.attempt_id);
      expect((await a.snapshot()).dispatch_ids).toEqual([auto.dispatch_id]);
      expect((await b.snapshot()).dispatch_ids).toEqual([]);

      const second = await request();
      const pinned = await submit({ ...second, explicit_target: { ...target, runner_id: runnerB } });
      expect(pinned).toMatchObject({ status: 'queued', runner_id: runnerB, source: 'explicit' });
      if (pinned.status !== 'queued') throw new Error('Pinned placement failed');
      expect((await b.next('held')).dispatch).toMatchObject({ dispatch_id: pinned.dispatch_id, attempt_id: second.attempt_id, task_id: second.task_id, runner_id: runnerB, runtime_id: 'opencode' });
      b.send({ type: 'release', dispatch_id: pinned.dispatch_id });
      const authorizedB = await b.next('authorization', pinned.dispatch_id);
      expect(authorizedB).toMatchObject({ allowed: true, credential_present: true });
      const markerB = JSON.parse(await readFile(join(rootB, 'starts', `${pinned.dispatch_id}.json`), 'utf8'));
      expect(markerB).toEqual({ runner_id: runnerB, dispatch_id: pinned.dispatch_id, attempt_id: second.attempt_id, task_id: second.task_id, runtime_id: 'opencode', root: rootB, executable: await realpath(connectedB.installation.executable!), pid: connectedB.pid });
      expect(authorizedB.marker).toEqual(markerB);

      const moved = { ...first, attempt_id: randomUUID(), explicit_target: { ...target, runner_id: runnerB } };
      await expect(submit(moved)).rejects.toMatchObject({ detail: { code: 'unmet_precondition', message: 'Task workspace belongs to another Runner; transfer is unsupported' } });
      await noAttempt(moved.attempt_id);
      expect((await db.pool.query('SELECT runner_id FROM task_runner_locality WHERE task_id=$1', [first.task_id])).rows).toEqual([{ runner_id: runnerA }]);
      expect((await b.snapshot()).dispatch_ids).toEqual([pinned.dispatch_id]);

      const stale = await request();
      const delayed = await submit({ ...stale, explicit_target: { ...target, runner_id: runnerA } });
      if (delayed.status !== 'queued') throw new Error('Delayed placement failed');
      const originalStart = (await a.next('held')).dispatch;
      expect(originalStart).toMatchObject({ dispatch_id: delayed.dispatch_id, attempt_id: stale.attempt_id, mutation_allowed: true });
      await revokeFixture(db, stale.attempt_id);
      a.send({ type: 'release', dispatch_id: originalStart.dispatch_id });
      expect(await a.next('authorization', originalStart.dispatch_id)).toEqual({ type: 'authorization', correlation_id: originalStart.dispatch_id, allowed: false, credential_present: false });
      expect((await db.pool.query('SELECT state,mutation_allowed,process_released FROM attempts WHERE id=$1', [stale.attempt_id])).rows[0]).toEqual({ state: 'CANCELLED', mutation_allowed: false, process_released: false });
      expect((await db.pool.query("SELECT done FROM outbox WHERE attempt_id=$1 AND kind='start'", [stale.attempt_id])).rows).toEqual([{ done: true }]);
      expect((await a.snapshot()).marker_files).toEqual([`${auto.dispatch_id}.json`]);
      expect((await b.snapshot()).marker_files).toEqual([`${pinned.dispatch_id}.json`]);
      expect(await readdir(join(rootA, 'starts'))).toEqual([`${auto.dispatch_id}.json`]);
      expect(await readdir(join(rootB, 'starts'))).toEqual([`${pinned.dispatch_id}.json`]);
      expect(JSON.parse(await readFile(join(rootA, 'starts', `${auto.dispatch_id}.json`), 'utf8'))).toEqual(markerA);
      expect(JSON.parse(await readFile(join(rootB, 'starts', `${pinned.dispatch_id}.json`), 'utf8'))).toEqual(markerB);
    } finally {
      // Stop every child before closing its server or dropping its isolated schema.
      try { await Promise.all(peers.map((peer) => peer.stop())); }
      finally { try { await app.close(); } finally { await Promise.all(roots.map((root) => rm(root, { recursive: true, force: true }))); } }
    }
  }, 30000);
});
