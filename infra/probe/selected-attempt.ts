// Test-only local fixture. Run inside the staged server container; never expose as HTTP.
import { readFileSync } from 'node:fs';
import { database, transaction } from '../../packages/db/src/index.ts';
import { validate } from '../../packages/protocol/src/index.ts';
import { DispatchQueue } from '../../apps/server/src/dispatch-queue.ts';
import { RuntimeScheduling } from '../../apps/server/src/runtime-scheduling.ts';

const input = JSON.parse(readFileSync(0, 'utf8')) as { runner_id: string; attempt_id: string; task_id: string; kind: 'node' | 'planner'; resource_id: string; prompt: string; pre_plan?: boolean };
for (const id of [input.runner_id, input.attempt_id, input.task_id, input.resource_id]) validate('Id', id);
if (!['node', 'planner'].includes(input.kind) || typeof input.prompt !== 'string') throw new Error('Invalid selected fixture');
if (input.pre_plan !== undefined && (typeof input.pre_plan !== 'boolean' || (input.pre_plan && input.kind !== 'planner'))) throw new Error('Only Planner may use pre-plan fixture');
const url = process.env.MONOS_DATABASE_URL_FILE ? readFileSync(process.env.MONOS_DATABASE_URL_FILE, 'utf8').trim() : process.env.DATABASE_URL;
if (!url) throw new Error('Database configuration required');
const db = database(url);
try {
  const result = await transaction(db, async (tx) => {
    // Fresh IDs only: uncertain admission must be inspected, never overwritten.
    const task = input.task_id, spec = `spec_${task}`, plan = `plan_${task}`, node = `node_${task}`;
    const currentPlan = input.pre_plan ? null : plan;
    await tx.query("INSERT INTO tasks(id,resource_id,specification_id,plan_id,state) VALUES($1,$2,$3,$4,'RUNNING')", [task, input.resource_id, spec, currentPlan]);
    await tx.query('INSERT INTO specification_revisions(id,task_id,content) VALUES($1,$2,$3)', [spec, task, { title: 'Selected execution log acceptance', scope: 'No remote publication' }]);
    if (currentPlan) await tx.query('INSERT INTO plan_revisions(id,task_id,content) VALUES($1,$2,$3)', [plan, task, { probe: true, node_ids: input.kind === 'node' ? [node] : [] }]);
    if (input.kind === 'node') {
      await tx.query("INSERT INTO nodes(id,task_id,activation,state) VALUES($1,$2,1,'PENDING')", [node, task]);
      await tx.query('INSERT INTO plan_nodes(task_id,plan_id,node_id,definition) VALUES($1,$2,$3,$4)', [task, plan, node, { node_id: node, dependencies: [], probe: true }]);
      await tx.query("INSERT INTO node_activations(task_id,node_id,activation,specification_id,plan_id,basis_source) VALUES($1,$2,1,$3,$4,'recorded')", [task, node, spec, plan]);
    }
    const runner = (await tx.query<{ connection_instance: string }>('SELECT connection_instance FROM runners WHERE id=$1', [input.runner_id])).rows[0];
    if (!runner?.connection_instance) throw new Error('Connected Runner required');
    const control = (await tx.query<{ control_version: string }>('SELECT control_version FROM tasks WHERE id=$1', [task])).rows[0]!;
    const selection = await new RuntimeScheduling(new DispatchQueue(db), runner.connection_instance).selectAndEnqueue(tx, {
      attempt_id: input.attempt_id, task_id: task, kind: input.kind,
      ...(input.kind === 'node' ? { node_id: node } : {}),
      expected: { control_version: Number(control.control_version), specification_id: spec, plan_id: currentPlan },
      legacy_probe: true, resource_id: input.resource_id, prompt: input.prompt, source_watermark: 1,
      explicit_target: { runner_id: input.runner_id, runtime_id: 'opencode', model_id: 'opencode/longcat-2.5-preview-free' },
    });
    if (selection.status !== 'queued') throw new Error(`Selected fixture unavailable: ${selection.reason}`);
    return selection;
  });
  process.stdout.write(`${JSON.stringify(result)}\n`);
} finally { await db.pool.end(); }
