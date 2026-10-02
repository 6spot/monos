import { randomUUID } from 'node:crypto';
import { transaction } from '../../../../packages/db/src/index.ts';
import type { Database } from '../../../../packages/db/src/index.ts';
import { submission, validate } from '../../../../packages/protocol/src/index.ts';
import type { CommandEnvelope, Dispatch, OwnerCommand, PrepareReplan, TaskActionBasis, TaskSpecificationStatus, WorkspaceMetadata } from '../../../../packages/protocol/src/index.ts';
import { Todos } from '../../src/todos.ts';
import { TaskPreviews } from '../../src/task-previews.ts';
import { prepareProposalFixture } from './task-preview-fixture.ts';
import { Configuration } from '../../src/configuration.ts';
import { authenticateOwner, OwnerCommands } from '../../src/owner-commands.ts';
import { enrollFixture } from '../../src/fixtures.ts';
import { DispatchQueue } from '../../src/dispatch-queue.ts';
import { TaskPlanning } from '../../src/task-planning.ts';
import { NodeExecution } from '../../src/node-execution.ts';
import { TaskConversation } from '../../src/task-conversation.ts';
import { TaskSpecification } from '../../src/task-specification.ts';
import { TaskReplan } from '../../src/task-replan.ts';
import { replanImpact } from '../../src/task-replan-state.ts';
import { initializeTask } from '../../src/task-records.ts';
import type { BoundaryService } from '../../src/service.ts';

const scenarios = ['ready', 'board_pages', 'queued', 'planning_issue', 'node_queued', 'running', 'running_workspace', 'review_git', 'log_pages', 'blocked', 'review', 'completion_recovery', 'replan', 'replan_issue', 'joint', 'specification', 'guidance', 'input_issue'] as const;
type Scenario = typeof scenarios[number];
interface Context { task: string; spec: string; plan: string; node: string; project: string; role: string; runner: string; incarnation: number }
interface Agent { dispatch: Dispatch; credential: string }

// Browser-only canonical scenarios with explicitly synthetic Runtime acknowledgements.
// No Runtime or provider is contacted; fixture Tasks never leave the isolated schema.
export class ExecutionUIFixture {
  readonly db: Database;
  readonly service: BoundaryService;
  readonly contexts = new Map<string, Context>();
  private readonly workspaceSnapshots = new Map<string, { workspace_id: string; metadata: WorkspaceMetadata }>();
  private readonly legacyBoardTasks: Context[] = [];
  constructor(db: Database, service: BoundaryService) { this.db = db; this.service = service; }

  async create(token: string, input: { kind: Scenario; title?: string }) {
    await transaction(this.db, (tx) => authenticateOwner(tx, token));
    if (!scenarios.includes(input.kind) || (input.title !== undefined && (typeof input.title !== 'string' || input.title.length > 256))) throw new Error('Invalid browser scenario');
    const f: Context = { task: randomUUID(), spec: randomUUID(), plan: randomUUID(), node: randomUUID(), project: randomUUID(), role: randomUUID(), runner: randomUUID(), incarnation: 0 };
    const resource_id = input.kind === 'running_workspace' || input.kind === 'review_git' ? randomUUID() : undefined;
    const config = new Configuration(this.db);
    await config.save(token, { schema_version: 1, request_id: randomUUID(), expected_control_version: (await config.read(token)).control_version, name: 'save_role', payload: { id: f.role, name: 'Careful builder', description: 'Synthetic browser scenario', instructions: 'Implement the exact requirement and report evidence.', archived: false } });
    await config.save(token, { schema_version: 1, request_id: randomUUID(), expected_control_version: (await config.read(token)).control_version, name: 'save_project', payload: { id: f.project, name: `Execution UI · ${input.kind}`, context: 'Isolated browser fixture; no real Runtime execution.', resources: resource_id ? [{ id: resource_id, remote_url: 'https://github.com/example/execution-ui.git', remote_preparation: 'after_acceptance', default_branch: 'main' }] : [], role_ids: [f.role], archived: false } });
    const todo_id = randomUUID();
    await new Todos(this.db).command(token, { schema_version: 1, request_id: randomUUID(), name: 'capture_todo', payload: { todo_id, original_capture: 'Execution UI browser scenario' } });
    const taskProposal = await prepareProposalFixture(this.db, this.service, token, todo_id);
    const proposal = await taskProposal.commit(input.title ?? `Execution ${input.kind}`, '# Exact execution requirement\n\nPreserve the Owner’s intent, independently verified output and clear recovery.\n\n- Keep current and historical evidence separate.\n- Support keyboard and small-screen use.');
    const previews = new TaskPreviews(this.db);
    const preview = await previews.read(token, todo_id, proposal.proposal_message_id, f.project);
    const confirmed = await previews.command(token, { schema_version: 1, request_id: randomUUID(), todo_id, name: 'confirm_task_preview', payload: { proposal_message_id: proposal.proposal_message_id, project_id: f.project, content_digest: preview.content_digest } });
    const created = await previews.command(token, { schema_version: 1, request_id: randomUUID(), todo_id, name: 'create_execution_task', payload: { proposal_message_id: proposal.proposal_message_id, confirmation_id: confirmed.confirmation_id, content_digest: preview.content_digest } });
    if (!created.task_id || !created.specification_id) throw new Error('Browser fixture Task creation failed');
    f.task = created.task_id; f.spec = created.specification_id;
    await enrollFixture(this.db, f.runner, randomUUID(), 2);
    f.incarnation = await this.service.connect(f.runner, 'execution-ui-fixture');
    await this.service.touch(f.runner, f.incarnation, true, [{ runtime_id: 'opencode', executable: '/synthetic/opencode', availability: 'detected', supports_model: true, supports_thinking: false, model_ids: [] }]);
    // Pin synthetic preparation to its own fixture Runner; no deployed policy is read.
    await this.db.pool.query('UPDATE execution_policies SET policies=$1', [{ global: { default_target: { runtime_id: 'opencode', model_id: 'opencode/longcat-2.5-preview-free', runner_id: f.runner }, fallback_targets: [] } }]);
    this.contexts.set(f.task, f);
    const planning = new TaskPlanning(this.db, this.service.instanceId);
    const execution = new NodeExecution(this.db, this.service.instanceId);
    if (input.kind === 'ready') return f;
    if (input.kind === 'board_pages') {
      const task_ids = [f.task];
      for (let index = 1; index <= 33; index++) {
        const legacy = { ...f, task: randomUUID(), spec: randomUUID() };
        await transaction(this.db, (tx) => initializeTask(tx, {
          task_id: legacy.task, specification_id: legacy.spec, project_id: f.project,
          specification: { fixture: 'Legacy Board pagination', index },
        }));
        this.legacyBoardTasks.push(legacy); task_ids.push(legacy.task);
      }
      return { ...f, task_ids, total_tasks: task_ids.length };
    }
    if (input.kind === 'guidance' || input.kind === 'input_issue') {
      const conversation = new TaskConversation(this.db, this.service.instanceId);
      await conversation.command(token, { schema_version: 1, request_id: randomUUID(), task_id: f.task, name: 'submit_task_message', payload: { message_id: randomUUID(), content: 'Keep the requested output readable and verify the exact behavior.' } });
      await conversation.pump(); const agent = await this.promote(f);
      const source = agent.dispatch.task_conversation_source!;
      const result = await this.agent(f, agent, 'commit_task_turn', { source_id: source.source_id, input_id: source.input_id, source_watermark: source.source_watermark, reply: input.kind === 'guidance' ? 'The guidance is retained for future work.' : 'Which behavior should be verified?', routing: { kind: input.kind === 'guidance' ? 'guidance' : 'issue', text: input.kind === 'guidance' ? 'Keep output readable.' : 'Which behavior should be verified?', basis: await this.basis(f) } });
      await this.finish(f, result.operation_id!, agent.dispatch.attempt_id);
      return { ...f, obligation_id: result.result?.obligation_id };
    }
    if (input.kind === 'specification') {
      const conversation = new TaskConversation(this.db, this.service.instanceId);
      const sent = await conversation.command(token, { schema_version: 1, request_id: randomUUID(), task_id: f.task, name: 'submit_task_message', payload: { message_id: randomUUID(), content: 'Please propose a complete requirement update with a readable exact scope.' } });
      await conversation.pump(); const agent = await this.promote(f);
      const basis = await this.basis(f); const proposal_id = randomUUID();
      const status = validate<TaskSpecificationStatus>('TaskSpecificationStatus', await new TaskSpecification(this.db).status(token, f.task));
      await this.agent(f, agent, 'prepare_specification_revision', { proposal_id, specification: '# Revised exact requirement\n\nKeep every original safeguard and add explicit keyboard recovery.\n\nDo not publish remote changes.', summary: 'Add explicit keyboard recovery while retaining the existing work boundary.', basis, impact: status.impact, source_input_ids: [sent.input_id!] });
      const source = agent.dispatch.task_conversation_source!;
      const result = await this.agent(f, agent, 'commit_task_turn', { source_id: source.source_id, input_id: source.input_id, source_watermark: source.source_watermark, reply: 'Please review the complete proposed requirement and its effect before confirming.', routing: { kind: 'specification_proposal', proposal_id, basis } });
      await this.finish(f, result.operation_id!, agent.dispatch.attempt_id);
      return { ...f, proposal_id };
    }
    await this.owner(token, f, 'start_task', { specification_id: f.spec });
    await planning.pump();
    if (input.kind === 'queued') return f;
    const planner = await this.promote(f);
    const planned = await this.agent(f, planner, input.kind === 'planning_issue' ? 'raise_planning_issue' : 'publish_execution_plan', input.kind === 'planning_issue' ? { planning_intent_id: planner.dispatch.task_planning_source!.intent_id, reason: 'Which output should be authoritative? Please describe the expected behavior.' } : { planning_intent_id: planner.dispatch.task_planning_source!.intent_id, plan_id: f.plan, nodes: [{ node_id: f.node, role_id: f.role, goal: 'Implement and verify the exact requested behavior', dependencies: [], expected_outputs: ['A verified local result with a readable summary'] }] });
    await this.finish(f, planned.operation_id!, planner.dispatch.attempt_id);
    if (input.kind === 'planning_issue') return f;
    await execution.pump();
    if (input.kind === 'node_queued') return f;
    const node = await this.promote(f);
    if (input.kind === 'running') return f;
    if (input.kind === 'log_pages') {
      for (let sequence = 1; sequence <= 70; sequence++) {
        const text = `Synthetic log entry ${String(sequence).padStart(3, '0')}: observed output only; formal results use the Tool Protocol.\n`;
        await this.service.event(f.runner, f.incarnation, {
          attempt_id: node.dispatch.attempt_id, dispatch_id: node.dispatch.dispatch_id,
          stream_id: 'stdout', sequence, order_sequence: sequence, kind: 'output', text,
          data_base64: Buffer.from(text).toString('base64'),
        });
      }
      return { ...f, attempt_id: node.dispatch.attempt_id, log_count: 70 };
    }
    if (resource_id) {
      const opened = await this.agent(f, node, 'open_workspace', { resource_id });
      const operation = await this.service.recoverOperation(f.runner, opened.operation_id!);
      const workspace = operation.workspace!;
      const metadata: WorkspaceMetadata = {
        generation: 1, storage_id: 'synthetic-browser-storage', lease_id: workspace.lease_id,
        repository_identity: workspace.resource.repository_identity, provider_metadata: { github: { repository_id: '42' } },
        base_commit: 'a'.repeat(40), target_branch: 'main', target_commit: 'b'.repeat(40), finalized_commit: 'a'.repeat(40),
      };
      await this.service.finishOperation(f.runner, f.incarnation, {
        operation_id: operation.operation_id, attempt_id: node.dispatch.attempt_id, success: true,
        result: { workspace_id: workspace.workspace_id, path: '/synthetic/private/worktree', instruction_files: [], workspace_metadata: metadata },
      });
      this.workspaceSnapshots.set(node.dispatch.attempt_id, { workspace_id: workspace.workspace_id, metadata });
      if (input.kind === 'running_workspace') return { ...f, resource_id, attempt_id: node.dispatch.attempt_id, workspace_id: workspace.workspace_id };
    }
    if (input.kind === 'blocked') {
      const blocked = await this.agent(f, node, 'block_node', { reason: 'Choose the intended fallback behavior before implementation continues.' });
      await this.finish(f, blocked.operation_id!, node.dispatch.attempt_id); return f;
    }
    if (input.kind === 'review' || input.kind === 'review_git' || input.kind === 'completion_recovery') {
      const artifact_id = randomUUID();
      await this.agent(f, node, 'publish_artifact', { artifact_id, title: 'Verification notes', content: { media_type: 'text/markdown', text: '# Local verification\n\nThe synthetic fixture completed its formal result. No real Runtime or provider ran.\n\n<script>this must remain inert</script>' } });
      const completed = await this.agent(f, node, 'complete_node', { summary: 'The requested local result is ready for Owner review. Verification notes are attached.', artifact_ids: [artifact_id] });
      if (input.kind === 'completion_recovery') await this.service.finishOperation(f.runner, f.incarnation, { operation_id: completed.operation_id!, attempt_id: node.dispatch.attempt_id, success: false, failure_kind: 'recoverable', result: { writer_absent: true } });
      else await this.finish(f, completed.operation_id!, node.dispatch.attempt_id);
      return { ...f, artifact_id, ...(resource_id ? { resource_id, attempt_id: node.dispatch.attempt_id, workspace_id: this.workspaceSnapshots.get(node.dispatch.attempt_id)!.workspace_id, git_commit: 'c'.repeat(40), git_tree: 'd'.repeat(40) } : {}) };
    }
    const requested = await this.agent(f, node, 'request_replan', { reason: 'The current work definition needs replacement to satisfy the requested outcome.' });
    await this.finish(f, requested.operation_id!, node.dispatch.attempt_id);
    const replan = new TaskReplan(this.db, {}, this.service.instanceId); await replan.pump();
    const agent = await this.promote(f); const binding = agent.dispatch.task_replan_source!;
    if (input.kind === 'replan_issue') {
      const issue = await this.agent(f, agent, 'raise_planning_issue', { replan_request_id: binding.request_id, source_id: binding.source_id, reason: 'Which replacement outcome should be authoritative?' });
      await this.finish(f, issue.operation_id!, agent.dispatch.attempt_id);
      return { ...f, request_id: binding.request_id };
    }
    const task = (await this.db.pool.query('SELECT * FROM tasks WHERE id=$1', [f.task])).rows[0];
    const replacement = randomUUID();
    const impact = await transaction(this.db, (tx) => replanImpact(tx, task, replacement));
    const payload: PrepareReplan = { replan_request_id: binding.request_id, source_id: binding.source_id, proposal_id: randomUUID(), plan_id: randomUUID(), basis: await this.basis(f), nodes: [{ node_id: replacement, role_id: f.role, goal: 'Replace the formal work with the complete revised outcome', dependencies: [] }], summary: 'Replace the work definition; retain private history without claiming previous completion.', impact, ...(input.kind === 'joint' ? { requirement: { proposal_id: randomUUID(), specification: '# Joint exact requirements\n\nReplace the previous outcome with independently verified accessible recovery.', summary: 'Update requirements together with the replacement Plan.' } } : {}) };
    const prepared = await this.agent(f, agent, 'prepare_replan', payload as CommandEnvelope['payload']);
    await this.finish(f, prepared.operation_id!, agent.dispatch.attempt_id);
    return { ...f, request_id: binding.request_id, proposal_id: payload.proposal_id, requirement_proposal_id: payload.requirement?.proposal_id };
  }

  async settle(token: string, taskId: string) {
    await transaction(this.db, (tx) => authenticateOwner(tx, token));
    const f = this.contexts.get(taskId); if (!f) throw new Error('Unknown browser fixture Task');
    const operations = (await this.db.pool.query("SELECT o.id,o.attempt_id FROM operations o JOIN attempts a ON a.id=o.attempt_id WHERE a.task_id=$1 AND o.state NOT IN ('succeeded','cancelled') ORDER BY o.created_at,o.id", [taskId])).rows;
    for (const operation of operations) await this.finish(f, operation.id, operation.attempt_id);
    await new TaskSpecification(this.db).pump();
    return { settled: operations.length };
  }

  async reset(token: string) {
    await transaction(this.db, (tx) => authenticateOwner(tx, token));
    for (const legacy of this.legacyBoardTasks) await this.owner(token, legacy, 'cancel_task', { specification_id: legacy.spec });
    this.legacyBoardTasks.length = 0;
    for (const f of this.contexts.values()) {
      // Terminal Task questions are intentionally still schedulable. Resolve
      // fixture inputs explicitly so a later scenario cannot dispatch old chat.
      const conversation = new TaskConversation(this.db, this.service.instanceId);
      const inputs = (await this.db.pool.query("SELECT id,version FROM task_inputs WHERE task_id=$1 AND status IN ('pending','failed') ORDER BY created_at,id", [f.task])).rows;
      for (const input of inputs) await conversation.command(token, { schema_version: 1, request_id: randomUUID(), task_id: f.task, name: 'withdraw_task_input', expected_version: Number(input.version), payload: { operation_id: input.id } });
      const task = (await this.db.pool.query('SELECT state,specification_id,plan_id,initial_planning_intent_id FROM tasks WHERE id=$1', [f.task])).rows[0];
      if (!['COMPLETED', 'CANCELLED'].includes(task.state)) await this.owner(token, f, 'cancel_task', { specification_id: task.specification_id, ...(task.plan_id ? { plan_id: task.plan_id } : task.initial_planning_intent_id ? { planning_intent_id: task.initial_planning_intent_id } : {}) });
      await this.settle(token, f.task);
      await this.service.disconnect(f.runner, f.incarnation);
    }
    this.contexts.clear(); this.workspaceSnapshots.clear(); return { reset: true };
  }

  private async basis(f: Context): Promise<TaskActionBasis> {
    const task = (await this.db.pool.query('SELECT * FROM tasks WHERE id=$1', [f.task])).rows[0];
    const node = (await this.db.pool.query('SELECT * FROM nodes WHERE id=$1', [f.node])).rows[0];
    return { control_version: Number(task.control_version), specification_id: task.specification_id, plan_id: task.plan_id, ...(node ? { node_id: node.id, node_activation: Number(node.activation), source_id: node.execution_source_id } : {}) };
  }
  private async owner(token: string, f: Context, name: OwnerCommand['name'], payload: OwnerCommand['payload']) { return new OwnerCommands(this.db).confirm(token, { schema_version: 1, request_id: randomUUID(), scope_id: f.task, expected_control_version: (await this.basis(f)).control_version, name, payload }); }
  private async promote(f: Context): Promise<Agent> {
    await this.service.touch(f.runner, f.incarnation, true);
    const dispatch = await new DispatchQueue(this.db).promoteNext(f.runner, this.service.instanceId, f.incarnation);
    if (!dispatch || dispatch.task_id !== f.task) throw new Error('Browser fixture dispatch scope mismatch');
    const grant = await this.service.authorize(f.runner, f.incarnation, dispatch.dispatch_id);
    if (!grant) throw new Error('Browser fixture grant unavailable');
    return { dispatch, credential: grant.credential };
  }
  private agent(f: Context, agent: Agent, name: CommandEnvelope['name'], payload: CommandEnvelope['payload']) { return this.service.admit(agent.credential, submission({ schema_version: 1, request_id: randomUUID(), scope_id: f.task, expected_control_version: agent.dispatch.control_version, name, payload })); }
  private async finish(f: Context, operation_id: string, attempt_id: string) {
    const snapshot = this.workspaceSnapshots.get(attempt_id);
    if (snapshot) {
      const operation = await this.service.recoverOperation(f.runner, operation_id);
      if (operation.kind === 'complete_node') {
        const metadata = { ...snapshot.metadata, finalized_commit: 'c'.repeat(40) };
        await this.service.finishOperation(f.runner, f.incarnation, { operation_id, attempt_id, success: true, result: { writer_absent: true, workspace_id: snapshot.workspace_id, workspace_metadata: metadata, git_commit: 'c'.repeat(40), git_tree: 'd'.repeat(40) } });
        this.workspaceSnapshots.set(attempt_id, { ...snapshot, metadata });
        return;
      }
      if (operation.kind === 'stop') {
        await this.service.finishOperation(f.runner, f.incarnation, { operation_id, attempt_id, success: true, result: { writer_absent: true, workspace_id: snapshot.workspace_id, workspace_metadata: { ...snapshot.metadata, checkpoint: { operation_id, head_commit: 'e'.repeat(40), tree_id: 'f'.repeat(40), commit_id: 'e'.repeat(40) } } } });
        return;
      }
    }
    return this.service.finishOperation(f.runner, f.incarnation, { operation_id, attempt_id, success: true, result: { writer_absent: true } });
  }
}
