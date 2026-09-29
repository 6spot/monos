import { randomUUID } from 'node:crypto';
import { transaction } from '../../../packages/db/src/index.ts';
import type { Database } from '../../../packages/db/src/index.ts';
import { CommandError } from '../../../packages/domain/src/commands.ts';
import { canonicalJSON, digest, validate } from '../../../packages/protocol/src/index.ts';
import type { Dispatch } from '../../../packages/protocol/src/index.ts';

type TaskFixtureDispatch = Dispatch & { task_id: string; resource_id: string };

export interface AttemptFixture { runner_id: string; attempt_id: string; task_id: string; kind: 'node' | 'planner'; resource_id: string; prompt: string; node_id?: string }

export async function enrollFixture(db: Database, runnerId: string, credential: string, capacity = 2): Promise<void> {
  validate('Id', runnerId);
  if (credential.length < 32 || !Number.isInteger(capacity) || capacity < 1 || capacity > 32) throw new Error('Invalid fixture credential or capacity');
  await transaction(db, async (tx) => {
    await tx.query('INSERT INTO runners(id,credential_hash,capacity) VALUES($1,$2,$3) ON CONFLICT(id) DO NOTHING', [runnerId, digest(credential), capacity]);
    const row = (await tx.query<{ credential_hash: string; capacity: number }>('SELECT credential_hash,capacity FROM runners WHERE id=$1 FOR UPDATE', [runnerId])).rows[0]!;
    if (row.credential_hash !== digest(credential) || row.capacity !== capacity) throw new Error('Existing Runner enrollment differs; no overwrite performed');
  });
}

export async function createAttemptFixture(db: Database, input: AttemptFixture): Promise<TaskFixtureDispatch> {
  for (const id of [input.runner_id, input.attempt_id, input.task_id, input.resource_id, ...(input.node_id ? [input.node_id] : [])]) validate('Id', id);
  if (!['node', 'planner'].includes(input.kind) || typeof input.prompt !== 'string') throw new Error('Invalid fixture');
  return transaction(db, async (tx) => {
    const runner = (await tx.query<{ capacity: number }>('SELECT capacity FROM runners WHERE id=$1 FOR UPDATE', [input.runner_id])).rows[0];
    if (!runner) throw new Error('Enroll the Runner first');
    const existing = (await tx.query<{ launch: TaskFixtureDispatch }>('SELECT launch FROM attempts WHERE id=$1', [input.attempt_id])).rows[0];
    if (existing) {
      if (existing.launch.task_id !== input.task_id || existing.launch.runner_id !== input.runner_id || existing.launch.prompt !== input.prompt || existing.launch.kind !== input.kind || existing.launch.resource_id !== input.resource_id) throw new Error('Attempt fixture already has different content');
      return existing.launch;
    }
    const used = (await tx.query<{ count: string }>('SELECT count(*) FROM attempts WHERE runner_id=$1 AND NOT process_released', [input.runner_id])).rows[0]!;
    if (Number(used.count) >= runner.capacity) throw new CommandError('unmet_precondition', 'Runner capacity is reserved, including unresolved process ownership');
    const specId = `spec_${input.task_id}`;
    const planId = `plan_${input.task_id}`;
    const inserted = await tx.query("INSERT INTO tasks(id,resource_id,specification_id,plan_id,state) VALUES($1,$2,$3,$4,'RUNNING') ON CONFLICT(id) DO NOTHING", [input.task_id, input.resource_id, specId, planId]);
    if (inserted.rowCount) {
      await tx.query('INSERT INTO specification_revisions(id,task_id,content) VALUES($1,$2,$3)', [specId, input.task_id, { title: 'Boundary probe fixture', scope: 'No remote publication' }]);
      await tx.query('INSERT INTO plan_revisions(id,task_id,content) VALUES($1,$2,$3)', [planId, input.task_id, { probe: true, node_ids: input.kind === 'node' ? [input.node_id ?? `node_${input.task_id}`] : [] }]);
    }
    const task = (await tx.query<{ resource_id: string; control_version: string; specification_id: string; plan_id: string }>('SELECT resource_id,control_version,specification_id,plan_id FROM tasks WHERE id=$1 FOR UPDATE', [input.task_id])).rows[0]!;
    if (task.resource_id !== input.resource_id) throw new Error('Task resource fixture cannot change');
    const nodeId = input.kind === 'node' ? input.node_id ?? `node_${input.task_id}` : undefined;
    if (nodeId) {
      await tx.query("INSERT INTO nodes(id,task_id,activation,state) VALUES($1,$2,1,'RUNNING') ON CONFLICT(id) DO NOTHING", [nodeId, input.task_id]);
      const node = (await tx.query<{ task_id: string; activation: string }>('SELECT task_id,activation FROM nodes WHERE id=$1', [nodeId])).rows[0]!;
      if (node.task_id !== input.task_id || node.activation !== '1') throw new Error('Node fixture identity or activation changed');
      await tx.query('INSERT INTO plan_nodes(task_id,plan_id,node_id,definition) SELECT id,plan_id,$2,$3 FROM tasks WHERE id=$1 AND NOT EXISTS (SELECT 1 FROM plan_nodes WHERE plan_nodes.plan_id=tasks.plan_id AND node_id=$2)', [input.task_id, nodeId, { node_id: nodeId, dependencies: [], probe: true }]);
      await tx.query("INSERT INTO node_activations(task_id,node_id,activation,specification_id,plan_id,basis_source) SELECT id,$2,1,specification_id,plan_id,'recorded' FROM tasks WHERE id=$1 ON CONFLICT DO NOTHING", [input.task_id, nodeId]);
    }
    const launch: TaskFixtureDispatch = {
      dispatch_id: randomUUID(), attempt_id: input.attempt_id, runner_id: input.runner_id, task_id: input.task_id,
      ...(nodeId ? { node_id: nodeId } : {}), kind: input.kind, fencing_generation: 1, node_activation: nodeId ? 1 : 0,
      control_version: Number(task.control_version), resource_id: input.resource_id, runtime_id: 'opencode', model: 'opencode/longcat-2.5-preview-free',
      prompt: input.prompt, source_watermark: 1, mutation_allowed: true, process_released: false,
    };
    validate('Dispatch', launch);
    await tx.query('INSERT INTO attempts(id,runner_id,task_id,node_id,owner_key,dispatch_id,kind,fencing_generation,node_activation,launch) VALUES($1,$2,$3,$4,$5,$6,$7,1,$8,$9)', [input.attempt_id, input.runner_id, input.task_id, nodeId ?? null, nodeId ? `node:${nodeId}` : `planner:${input.task_id}`, launch.dispatch_id, input.kind, launch.node_activation, launch]);
    await tx.query('UPDATE attempts SET specification_id=$2,plan_id=$3 WHERE id=$1', [input.attempt_id, task.specification_id, task.plan_id]);
    await tx.query('INSERT INTO legacy_probe_attempts(attempt_id) VALUES($1)', [input.attempt_id]);
    await tx.query("INSERT INTO outbox(id,runner_id,attempt_id,kind) VALUES($1,$2,$3,'start')", [randomUUID(), input.runner_id, input.attempt_id]);
    return launch;
  });
}

export async function revokeFixture(db: Database, attemptId: string): Promise<void> {
  await transaction(db, async (tx) => {
    const identity = (await tx.query<{ runner_id: string; task_id: string }>('SELECT runner_id,task_id FROM attempts WHERE id=$1', [attemptId])).rows[0];
    if (!identity) throw new Error('Unknown Attempt');
    await tx.query('SELECT id FROM runners WHERE id=$1 FOR UPDATE', [identity.runner_id]);
    await tx.query('SELECT id FROM tasks WHERE id=$1 FOR UPDATE', [identity.task_id]);
    const attempt = (await tx.query<{ mutation_allowed: boolean; launch: Dispatch }>('SELECT * FROM attempts WHERE id=$1 FOR UPDATE', [attemptId])).rows[0]!;
    if (!attempt.mutation_allowed) return;
    await tx.query("UPDATE attempts SET mutation_allowed=false,state='CANCELLED',end_reason='revoked' WHERE id=$1", [attemptId]);
    await tx.query("UPDATE tasks SET control_version=control_version+1,state=CASE WHEN $2::boolean THEN 'BLOCKED' ELSE state END WHERE id=$1", [identity.task_id, attempt.launch.kind === 'node']);
    await tx.query("UPDATE nodes SET state='BLOCKED' WHERE id=$1", [attempt.launch.node_id ?? null]);
    await tx.query("UPDATE outbox SET done=true WHERE attempt_id=$1 AND kind='start'", [attemptId]);
    const operationId = randomUUID();
    await tx.query("INSERT INTO operations(id,attempt_id,schema_version,kind,request_id,state,resource_id) VALUES($1,$2,1,'stop',$3,'admitted',$4)", [operationId, attemptId, randomUUID(), attempt.launch.resource_id]);
    await tx.query("INSERT INTO outbox(id,runner_id,attempt_id,kind,operation_id) VALUES($1,$2,$3,'effect',$4)", [randomUUID(), identity.runner_id, attemptId, operationId]);
  });
}

export async function retryOperationFixture(db: Database, operationId: string): Promise<void> {
  await transaction(db, async (tx) => {
    const owner = (await tx.query<{ runner_id: string; task_id: string; attempt_id: string }>('SELECT a.runner_id,a.task_id,a.id AS attempt_id FROM operations o JOIN attempts a ON a.id=o.attempt_id WHERE o.id=$1', [operationId])).rows[0];
    if (!owner) throw new Error('Unknown operation');
    await tx.query('SELECT id FROM runners WHERE id=$1 FOR UPDATE', [owner.runner_id]);
    await tx.query('SELECT id FROM tasks WHERE id=$1 FOR UPDATE', [owner.task_id]);
    await tx.query('SELECT id FROM attempts WHERE id=$1 FOR UPDATE', [owner.attempt_id]);
    await tx.query("UPDATE operations SET state='admitted' WHERE id=$1 AND state='recovery'", [operationId]);
  });
}

export function safeFixtureResult(value: unknown): string { return canonicalJSON(value); }
