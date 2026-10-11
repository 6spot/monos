import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { database, transaction } from '../../../packages/db/src/index.ts';
import type { Database } from '../../../packages/db/src/index.ts';
import { migrate } from '../../../packages/db/src/migrate.ts';
import { digest, submission } from '../../../packages/protocol/src/index.ts';
import { initializeTask, publishInitialPlan, publishPlanningSpecification, reactivateSettledNodes, assertCurrentNode, validatePlan } from '../src/task-records.ts';
import type { PlanNode } from '../src/task-records.ts';
import { issueOwnerSession, OwnerCommands, prepareTaskProposal } from '../src/owner-commands.ts';
import { createAttemptFixture, enrollFixture } from '../src/fixtures.ts';
import { BoundaryService } from '../src/service.ts';

const fault = (code: string) => ({ detail: { code } });
const nodes = (): PlanNode[] => {
  const a = randomUUID(); const b = randomUUID(); const c = randomUUID();
  return [{ node_id: a, role_id: 'role', goal: 'first', dependencies: [] }, { node_id: b, role_id: 'role', goal: 'dependent', dependencies: [a] }, { node_id: c, role_id: 'role', goal: 'independent', dependencies: [] }];
};

it('validates graph identities, references and cycles before publication', () => {
  const graph = nodes();
  expect(() => validatePlan(graph)).not.toThrow();
  expect(() => validatePlan([])).toThrow();
  expect(() => validatePlan([graph[0]!, graph[0]!])).toThrow();
  expect(() => validatePlan([{ ...graph[0]!, dependencies: ['missing'] }])).toThrow();
  expect(() => validatePlan([{ ...graph[0]!, dependencies: [graph[1]!.node_id] }, graph[1]!])).toThrow();
});

describe.skipIf(process.env.MONOS_TEST_DATABASE !== '1')('PostgreSQL Task records', () => {
  let db: Database; let admin: Database;
  const namespace = `records_${randomUUID().replaceAll('-', '')}`;
  beforeAll(async () => {
    if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL required');
    admin = database(process.env.DATABASE_URL); await admin.pool.query(`CREATE SCHEMA ${namespace}`);
    const url = new URL(process.env.DATABASE_URL); url.searchParams.set('options', `-c search_path=${namespace} -c statement_timeout=10000`);
    db = database(url.toString()); await migrate(db);
  });
  afterAll(async () => { if (db) await db.pool.end(); if (admin) { await admin.pool.query(`DROP SCHEMA ${namespace} CASCADE`); await admin.pool.end(); } });

  async function task() {
    const task_id = randomUUID(); const specification_id = randomUUID();
    const expected = await transaction(db, (tx) => initializeTask(tx, { task_id, specification_id, specification: { title: 'independent task' } }));
    return { task_id, expected };
  }
  async function planner() {
    const t = await task(); const runner = randomUUID(); const attempt = randomUUID();
    await enrollFixture(db, runner, randomUUID());
    // Fake claim admission: the subsequent dispatch leaf owns real Start/outbox.
    await transaction(db, async (tx) => {
      await tx.query("UPDATE tasks SET state='RUNNING' WHERE id=$1", [t.task_id]);
      await tx.query("INSERT INTO attempts(id,runner_id,task_id,owner_key,dispatch_id,kind,fencing_generation,node_activation,launch,specification_id) VALUES($1,$2,$3,$4,$5,'planner',1,0,$6,$7)", [attempt, runner, t.task_id, `planner:${t.task_id}`, randomUUID(), {}, t.expected.specification_id]);
    });
    return { ...t, plan_id: randomUUID(), nodes: nodes(), claim: { attempt_id: attempt, fencing_generation: 1 } };
  }

  it('creates an independent PLANNING Task without Plan, Node, Attempt or outbox', async () => {
    const f = await task();
    expect((await db.pool.query('SELECT state,plan_id,resource_id FROM tasks WHERE id=$1', [f.task_id])).rows[0]).toEqual({ state: 'PLANNING', plan_id: null, resource_id: null });
    for (const table of ['nodes', 'attempts', 'plan_revisions']) expect((await db.pool.query(`SELECT count(*) FROM ${table} WHERE task_id=$1`, [f.task_id])).rows[0].count).toBe('0');
    await expect(transaction(db, async (tx) => {
      await initializeTask(tx, { task_id: 'rolled-back-task', specification_id: 'rolled-back-spec', specification: {} });
      throw new Error('injected');
    })).rejects.toThrow('injected');
    expect((await db.pool.query("SELECT id FROM specification_revisions WHERE id='rolled-back-spec'")).rowCount).toBe(0);
  });

  it('publishes one complete graph under concurrent Planner requests and retains immutable definitions', async () => {
    const f = await planner();
    const results = await Promise.allSettled([f, { ...f, plan_id: randomUUID() }].map((input) => transaction(db, (tx) => publishInitialPlan(tx, input))));
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect(results.find((result) => result.status === 'rejected')).toMatchObject({ reason: fault('version_conflict') });
    const row = (await db.pool.query('SELECT plan_id,control_version FROM tasks WHERE id=$1', [f.task_id])).rows[0];
    expect(row.control_version).toBe('2');
    expect((await db.pool.query('SELECT count(*) FROM plan_nodes WHERE plan_id=$1', [row.plan_id])).rows[0].count).toBe('3');
    expect((await db.pool.query('SELECT count(*) FROM node_activations WHERE task_id=$1', [f.task_id])).rows[0].count).toBe('3');
    for (const sql of ['UPDATE plan_revisions SET content=content WHERE id=$1', 'DELETE FROM plan_nodes WHERE plan_id=$1']) await expect(db.pool.query(sql, [row.plan_id])).rejects.toMatchObject({ code: '23514' });
    await expect(db.pool.query('INSERT INTO plan_nodes(task_id,plan_id,node_id,definition) VALUES($1,$2,$3,$4)', [f.task_id, row.plan_id, randomUUID(), {}])).rejects.toMatchObject({ code: '23514' });
    expect((await db.pool.query('SELECT specification_id FROM plan_revisions WHERE id=$1', [row.plan_id])).rows[0].specification_id).toBe(f.expected.specification_id);
  });

  it('rejects stale claim/revision inputs and never exposes a partial published graph', async () => {
    const f = await planner();
    await expect(transaction(db, (tx) => publishInitialPlan(tx, { ...f, claim: { ...f.claim, fencing_generation: 2 } }))).rejects.toMatchObject(fault('stale_execution'));
    await expect(transaction(db, (tx) => publishInitialPlan(tx, { ...f, expected: { ...f.expected, specification_id: 'old-spec' } }))).rejects.toMatchObject(fault('version_conflict'));
    await expect(transaction(db, async (tx) => {
      await publishInitialPlan(tx, f);
      // Separate connection sees the original pointer and no uncommitted children.
      expect((await db.pool.query('SELECT plan_id FROM tasks WHERE id=$1', [f.task_id])).rows[0].plan_id).toBeNull();
      expect((await db.pool.query('SELECT node_id FROM plan_nodes WHERE plan_id=$1', [f.plan_id])).rowCount).toBe(0);
      throw new Error('before publication commit');
    })).rejects.toThrow('before publication commit');
    expect((await db.pool.query('SELECT id FROM plan_revisions WHERE id=$1', [f.plan_id])).rowCount).toBe(0);
    expect((await db.pool.query('SELECT id FROM nodes WHERE task_id=$1', [f.task_id])).rowCount).toBe(0);
    const newSpec = randomUUID();
    await transaction(db, async (tx) => {
      await tx.query('INSERT INTO specification_revisions(id,task_id,content) VALUES($1,$2,$3)', [newSpec, f.task_id, {}]);
      await tx.query('UPDATE tasks SET specification_id=$2 WHERE id=$1', [f.task_id, newSpec]);
    });
    await expect(transaction(db, (tx) => publishInitialPlan(tx, { ...f, expected: { ...f.expected, specification_id: newSpec } }))).rejects.toMatchObject(fault('version_conflict'));
    await db.pool.query('UPDATE tasks SET specification_id=$2 WHERE id=$1', [f.task_id, f.expected.specification_id]);
    await db.pool.query('UPDATE attempts SET mutation_allowed=false WHERE id=$1', [f.claim.attempt_id]);
    await expect(transaction(db, (tx) => publishInitialPlan(tx, f))).rejects.toMatchObject(fault('stale_execution'));
  });

  it('publishes only exact authorized pre-start revisions and rolls authorization back with failure', async () => {
    const f = await task(); const session = await issueOwnerSession(db); const specification = { title: 'revised requirement' };
    const prepared = await transaction(db, (tx) => prepareTaskProposal(tx, { id: randomUUID(), task_id: f.task_id, action: 'apply_specification_revision', content: specification }));
    const confirmation = await new OwnerCommands(db).confirm(session.token, { schema_version: 1, scope_id: f.task_id, request_id: randomUUID(), expected_control_version: 1, name: 'confirm_proposal', payload: { proposal_id: prepared.proposal_id, content_digest: prepared.content_digest } });
    const input = { ...f, specification_id: randomUUID(), specification, confirmation_id: confirmation.confirmation_id!, request_id: randomUUID() };
    await expect(transaction(db, (tx) => publishPlanningSpecification(tx, session.token, { ...input, specification: { title: 'different' } }))).rejects.toMatchObject(fault('payload_conflict'));
    await expect(transaction(db, async (tx) => { await publishPlanningSpecification(tx, session.token, input); throw new Error('injected'); })).rejects.toThrow('injected');
    expect((await db.pool.query('SELECT consumed_by FROM authorization_receipts WHERE id=$1', [input.confirmation_id])).rows[0].consumed_by).toBeNull();
    const published = await transaction(db, (tx) => publishPlanningSpecification(tx, session.token, input));
    expect(published.specification_id).toBe(input.specification_id);
    const revision = (await db.pool.query('SELECT parent_id,authorization_id,content FROM specification_revisions WHERE id=$1', [input.specification_id])).rows[0];
    expect(revision).toEqual({ parent_id: f.expected.specification_id, authorization_id: input.confirmation_id, content: specification });
    await expect(db.pool.query('UPDATE specification_revisions SET content=$2 WHERE id=$1', [input.specification_id, {}])).rejects.toMatchObject({ code: '23514' });
  });

  it('enforces same-Task revision and Node ownership in the database', async () => {
    const f = await planner(); const g = await planner(); await transaction(db, (tx) => publishInitialPlan(tx, f));
    await expect(db.pool.query('UPDATE tasks SET specification_id=$2 WHERE id=$1', [g.task_id, f.expected.specification_id])).rejects.toMatchObject({ code: '23503' });
    await expect(transaction(db, async (tx) => {
      await tx.query('INSERT INTO plan_revisions(id,task_id,content) VALUES($1,$2,$3)', [g.plan_id, g.task_id, {}]);
      await tx.query('INSERT INTO plan_nodes(task_id,plan_id,node_id,definition) VALUES($1,$2,$3,$4)', [g.task_id, g.plan_id, f.nodes[0]!.node_id, {}]);
    })).rejects.toMatchObject({ code: '23503' });
    await expect(db.pool.query('UPDATE attempts SET node_id=$2,kind=$3,node_activation=1 WHERE id=$1', [g.claim.attempt_id, f.nodes[0]!.node_id, 'node'])).rejects.toMatchObject({ code: '23503' });
  });

  it('reactivates descendants only after settlement and keeps previous activation records', async () => {
    const f = await planner(); const basis = await transaction(db, (tx) => publishInitialPlan(tx, f));
    const current = { task_id: f.task_id, expected: basis, node_ids: [f.nodes[0]!.node_id] };
    await db.pool.query("UPDATE attempts SET node_id=$2,kind='node',node_activation=1 WHERE id=$1", [f.claim.attempt_id, f.nodes[0]!.node_id]);
    await expect(transaction(db, (tx) => reactivateSettledNodes(tx, current))).rejects.toMatchObject(fault('unmet_precondition'));
    await db.pool.query('UPDATE attempts SET mutation_allowed=false,process_released=true,process_absent=true WHERE id=$1', [f.claim.attempt_id]);
    const changed = await transaction(db, (tx) => reactivateSettledNodes(tx, current));
    expect(new Set(changed)).toEqual(new Set([f.nodes[0]!.node_id, f.nodes[1]!.node_id]));
    expect((await db.pool.query('SELECT activation FROM nodes WHERE id=$1', [f.nodes[2]!.node_id])).rows[0].activation).toBe('1');
    expect((await db.pool.query('SELECT count(*) FROM node_activations WHERE task_id=$1', [f.task_id])).rows[0].count).toBe('5');
    await expect(transaction(db, (tx) => assertCurrentNode(tx, { task_id: f.task_id, node_id: f.nodes[0]!.node_id, node_activation: 1 }))).rejects.toMatchObject(fault('stale_execution'));
    await expect(db.pool.query('DELETE FROM node_activations WHERE node_id=$1', [f.nodes[0]!.node_id])).rejects.toMatchObject({ code: '23514' });
  });

  it('persists completion once and retains it after reactivation without granting stale evidence', async () => {
    const runner = randomUUID(); await enrollFixture(db, runner, randomUUID());
    const service = new BoundaryService(db, { signingKey: 'test-only-task-records-signing-key' });
    const incarnation = await service.connect(runner, 'boot'); await service.touch(runner, incarnation, true);
    const launch = await createAttemptFixture(db, { runner_id: runner, attempt_id: randomUUID(), task_id: randomUUID(), kind: 'node', resource_id: 'repo', prompt: 'completion history' });
    const grant = await service.authorize(runner, incarnation, launch.dispatch_id);
    const command = submission({ schema_version: 1, request_id: randomUUID(), scope_id: launch.task_id, expected_control_version: 1, name: 'complete_node', payload: { summary: 'done' } });
    const accepted = await service.admit(grant!.credential, command);
    const result = { writer_absent: true, completion_outcome: 'finalized' as const, workspace_results: [] };
    const finish = { operation_id: accepted.operation_id!, attempt_id: launch.attempt_id, success: true, result };
    const originalPlan = (await db.pool.query('SELECT plan_id FROM tasks WHERE id=$1', [launch.task_id])).rows[0].plan_id;
    const changedPlan = randomUUID();
    await transaction(db, async (tx) => {
      await tx.query('INSERT INTO plan_revisions(id,task_id,content) VALUES($1,$2,$3)', [changedPlan, launch.task_id, {}]);
      await tx.query('UPDATE tasks SET plan_id=$2 WHERE id=$1', [launch.task_id, changedPlan]);
    });
    await expect(service.finishOperation(runner, incarnation, finish)).rejects.toMatchObject(fault('stale_execution'));
    expect((await db.pool.query('SELECT state FROM operations WHERE id=$1', [accepted.operation_id])).rows[0].state).toBe('admitted');
    expect((await db.pool.query('SELECT node_id FROM node_completions WHERE node_id=$1', [launch.node_id])).rowCount).toBe(0);
    await db.pool.query('UPDATE tasks SET plan_id=$2 WHERE id=$1', [launch.task_id, originalPlan]);
    await service.finishOperation(runner, incarnation, finish); await service.finishOperation(runner, incarnation, finish);
    const t = (await db.pool.query('SELECT specification_id,plan_id,control_version FROM tasks WHERE id=$1', [launch.task_id])).rows[0];
    await transaction(db, (tx) => reactivateSettledNodes(tx, { task_id: launch.task_id, expected: { ...t, control_version: Number(t.control_version) }, node_ids: [launch.node_id!] }));
    expect((await db.pool.query('SELECT result FROM node_completions WHERE node_id=$1 AND activation=1', [launch.node_id])).rows[0].result).toEqual(result);
    expect((await db.pool.query('SELECT result,state,activation FROM nodes WHERE id=$1', [launch.node_id])).rows[0]).toEqual({ result: null, state: 'PENDING', activation: '2' });
    expect((await service.admit(grant!.credential, command)).status).toBe('committed');
    expect((await db.pool.query('SELECT count(*) FROM node_completions WHERE node_id=$1', [launch.node_id])).rows[0].count).toBe('1');
  });

  it('rejects legacy singular completion migration atomically without fabricating collection evidence', async () => {
    const name = `upgrade_${randomUUID().replaceAll('-', '')}`;
    await admin.pool.query(`CREATE SCHEMA ${name}`);
    const url = new URL(process.env.DATABASE_URL!); url.searchParams.set('options', `-c search_path=${name}`);
    const old = database(url.toString());
    try {
      await old.pool.query('CREATE TABLE schema_migrations(version integer PRIMARY KEY,checksum text NOT NULL)');
      for (const [i, file] of ['0001_boundary_probe.sql', '0002_connection_instance.sql', '0003_capture_failure.sql', '0004_owner_commands.sql'].entries()) {
        const sql = await readFile(new URL(`../../../packages/db/migrations/${file}`, import.meta.url), 'utf8');
        await old.pool.query(sql); await old.pool.query('INSERT INTO schema_migrations VALUES($1,$2)', [i + 1, digest(sql)]);
      }
      await transaction(old, async (tx) => {
        await tx.query("INSERT INTO tasks(id,resource_id,specification_id,plan_id,state) VALUES('t','repo','s','p','RUNNING')");
        await tx.query("INSERT INTO specification_revisions VALUES('s','t','{}')");
        await tx.query(`INSERT INTO plan_revisions VALUES('p','t','{"node_ids":["n"]}')`);
        await tx.query("INSERT INTO nodes(id,task_id,activation,state,result) VALUES('n','t',1,'COMPLETED','{}')");
        await tx.query("INSERT INTO runners(id,credential_hash,capacity) VALUES('r','synthetic-hash',1)");
        await tx.query("INSERT INTO attempts(id,runner_id,task_id,node_id,owner_key,dispatch_id,kind,fencing_generation,node_activation,launch,process_released) VALUES('a','r','t','n','node:n','d','node',1,1,'{}',true)");
        await tx.query("INSERT INTO operations(id,attempt_id,schema_version,kind,request_id,state,resource_id,result) VALUES('o','a',1,'complete_node','request','succeeded','repo','{}')");
      });
      const original = {
        migrations: (await old.pool.query('SELECT * FROM schema_migrations ORDER BY version')).rows,
        tasks: (await old.pool.query('SELECT * FROM tasks')).rows,
        specifications: (await old.pool.query('SELECT * FROM specification_revisions')).rows,
        plans: (await old.pool.query('SELECT * FROM plan_revisions')).rows,
        attempts: (await old.pool.query('SELECT * FROM attempts')).rows,
        operations: (await old.pool.query('SELECT * FROM operations')).rows,
      };
      // Historical scalar completion compatibility is deliberately unsupported.
      // Migration must reject missing collection provenance, never invent it or
      // partially apply earlier migrations before encountering the legacy row.
      for (let attempt = 0; attempt < 2; attempt++) {
        await expect(migrate(old)).rejects.toMatchObject({ code: '23514', constraint: 'operation_completion_collection_shape' });
        expect((await old.pool.query('SELECT * FROM schema_migrations ORDER BY version')).rows).toEqual(original.migrations);
        expect((await old.pool.query('SELECT * FROM tasks')).rows).toEqual(original.tasks);
        expect((await old.pool.query('SELECT * FROM specification_revisions')).rows).toEqual(original.specifications);
        expect((await old.pool.query('SELECT * FROM plan_revisions')).rows).toEqual(original.plans);
        expect((await old.pool.query('SELECT * FROM attempts')).rows).toEqual(original.attempts);
        expect((await old.pool.query('SELECT * FROM operations')).rows).toEqual(original.operations);
        expect((await old.pool.query("SELECT to_regclass('node_activations') AS relation")).rows[0].relation).toBeNull();
      }
    } finally { await old.pool.end(); await admin.pool.query(`DROP SCHEMA ${name} CASCADE`); }
  });
});
