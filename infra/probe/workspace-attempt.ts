// Test-only canonical Node admission. No HTTP surface and no fixture Git grant.
// Start/Plan product commands are implemented by the following roadmap leaves.
import { readFileSync } from 'node:fs';
import { database, transaction } from '../../packages/db/src/index.ts';
import { canonicalJSON, digest, validate } from '../../packages/protocol/src/index.ts';
import { initializeTask } from '../../apps/server/src/task-records.ts';
import { DispatchQueue } from '../../apps/server/src/dispatch-queue.ts';
import { RuntimeScheduling } from '../../apps/server/src/runtime-scheduling.ts';

const input = JSON.parse(readFileSync(0, 'utf8')) as {
  runner_id: string; attempt_id: string; task_id: string; project_id: string;
  prompt: string; create: boolean;
};
for (const id of [input.runner_id, input.attempt_id, input.task_id, input.project_id]) validate('Id', id);
if (typeof input.prompt !== 'string' || !input.prompt.trim() || typeof input.create !== 'boolean') throw new Error('Invalid workspace fixture');
const url = process.env.MONOS_DATABASE_URL_FILE ? readFileSync(process.env.MONOS_DATABASE_URL_FILE, 'utf8').trim() : process.env.DATABASE_URL;
if (!url) throw new Error('Database configuration required');
const db = database(url);
try {
  const result = await transaction(db, async (tx) => {
    const task = input.task_id, spec = `spec_${task}`, plan = `plan_${task}`, node = `node_${task}`;
    if (input.create) {
      await initializeTask(tx, { task_id: task, specification_id: spec, project_id: input.project_id,
        specification: { title: 'Canonical serial workspace acceptance', scope: 'Private local edits; no remote publication' } });
      const content = canonicalJSON({ node_ids: [node], probe: 'serial-workspace-native' });
      await tx.query('INSERT INTO plan_revisions(id,task_id,content,specification_id,content_digest) VALUES($1,$2,$3,$4,$5)', [plan, task, content, spec, digest(content)]);
      await tx.query("INSERT INTO nodes(id,task_id,activation,state) VALUES($1,$2,1,'PENDING')", [node, task]);
      await tx.query('INSERT INTO plan_nodes(task_id,plan_id,node_id,definition) VALUES($1,$2,$3,$4)', [task, plan, node, { node_id: node, dependencies: [], probe: true }]);
      await tx.query("INSERT INTO node_activations(task_id,node_id,activation,specification_id,plan_id,basis_source) VALUES($1,$2,1,$3,$4,'recorded')", [task, node, spec, plan]);
      await tx.query("UPDATE tasks SET state='RUNNING',plan_id=$2 WHERE id=$1", [task, plan]);
    }
    const control = (await tx.query<{ control_version: string; project_id: string; resource_id: string | null; state: string }>('SELECT control_version,project_id,resource_id,state FROM tasks WHERE id=$1', [task])).rows[0];
    if (!control || control.project_id !== input.project_id || control.resource_id !== null || control.state !== 'RUNNING') throw new Error('Canonical running Project Task required');
    const runner = (await tx.query<{ connection_instance: string }>('SELECT connection_instance FROM runners WHERE id=$1', [input.runner_id])).rows[0];
    if (!runner?.connection_instance) throw new Error('Connected Runner required');
    const selection = await new RuntimeScheduling(new DispatchQueue(db), runner.connection_instance).selectAndEnqueue(tx, {
      attempt_id: input.attempt_id, task_id: task, kind: 'node', node_id: node,
      expected: { control_version: Number(control.control_version), specification_id: spec, plan_id: plan },
      prompt: input.prompt, source_watermark: 1,
      explicit_target: { runner_id: input.runner_id, runtime_id: 'opencode', model_id: 'opencode/longcat-2.5-preview-free' },
    });
    if (selection.status !== 'queued') throw new Error(`Canonical fixture unavailable: ${selection.reason}`);
    return selection;
  });
  process.stdout.write(`${JSON.stringify(result)}\n`);
} finally { await db.pool.end(); }
