import { randomUUID } from 'node:crypto';
import { transaction } from '../../../../packages/db/src/index.ts';
import type { Database } from '../../../../packages/db/src/index.ts';
import { submission, validate } from '../../../../packages/protocol/src/index.ts';
import { Discussion } from '../../src/discussion.ts';
import { lockDiscussion, prepareDiscussionContext } from '../../src/discussion-state.ts';
import { lockConfiguration } from '../../src/configuration-guards.ts';
import { DispatchQueue } from '../../src/dispatch-queue.ts';
import { enrollFixture } from '../../src/fixtures.ts';
import { OwnerCommands, prepareTaskProposal } from '../../src/owner-commands.ts';
import { publishPlanningSpecification } from '../../src/task-records.ts';
import type { BoundaryService } from '../../src/service.ts';

// Synthetic Runtime facts only. Canonical source/reply persistence uses the real
// Discussion, queue, grant and Tool Protocol admission, never mocked creation.
export async function prepareProposalFixture(db: Database, service: BoundaryService, token: string, todoId: string, content = 'Fixture: prepare an exact Task proposal') {
  const discussion = new Discussion(db, service.instanceId); const messageId = randomUUID();
  await discussion.command(token, { schema_version: 1, request_id: randomUUID(), todo_id: todoId, name: 'submit_discussion_message', payload: { message_id: messageId, content } });
  const runnerId = randomUUID(); await enrollFixture(db, runnerId, randomUUID()); const incarnation = await service.connect(runnerId, 'proposal-fixture');
  await service.touch(runnerId, incarnation, true, [{ runtime_id: 'opencode', executable: '/test/fixture-opencode', availability: 'detected', supports_model: true, supports_thinking: false, model_ids: [] }]);
  const context = await transaction(db, async (tx) => { const version = await lockConfiguration(tx); const control = await lockDiscussion(tx, todoId); if (control.source_message_id !== messageId) throw new Error('Proposal fixture requires a resolved Todo'); return prepareDiscussionContext(tx, control, version); });
  const queue = new DispatchQueue(db);
  await transaction(db, async (tx) => { await lockConfiguration(tx); await queue.enqueue(tx, { attempt_id: randomUUID(), todo_id: todoId, kind: 'planner', expected: { control_version: context.discussion_version }, discussion_context: context, source_watermark: context.source_watermark, prompt: context.prompt, runner_id: runnerId, runtime_id: 'opencode', model: 'opencode/longcat-2.5-preview-free' }); });
  const launch = await queue.promoteNext(runnerId, service.instanceId, incarnation); if (!launch) throw new Error('Fixture Attempt was not promoted');
  const grant = await service.authorize(runnerId, incarnation, launch.dispatch_id); if (!grant) throw new Error('Fixture Attempt lacks grant');
  return {
    source_message_id: messageId, launch,
    async commit(title: string, specification: string, settle = true) {
      const result = await service.admit(grant.credential, submission({ schema_version: 1, request_id: randomUUID(), scope_id: todoId, expected_control_version: context.discussion_version, name: 'commit_discussion_turn',
        payload: { reply: 'Fixture Planner: review the exact proposal below.', working_requirement_state: 'Fixture discussion cache; must never become Task context', source_message_id: messageId, source_watermark: context.source_watermark,
          task_preview: { title, specification, ...(context.project_id ? { project_id: context.project_id } : {}) } } }));
      if (settle) { await service.finishOperation(runnerId, incarnation, { attempt_id: launch.attempt_id, operation_id: result.operation_id!, success: true, result: { writer_absent: true } }); await service.disconnect(runnerId, incarnation); }
      return { todo_id: todoId, proposal_message_id: result.result!.message_id!, source_message_id: messageId };
    },
  };
}

export async function reviseSpecificationFixture(db: Database, token: string, taskId: string, specification: unknown) {
  validate('Id', taskId); const proposalId = randomUUID();
  const proposal = await transaction(db, (tx) => prepareTaskProposal(tx, { id: proposalId, task_id: taskId, action: 'apply_specification_revision', content: specification }));
  const confirmation = await new OwnerCommands(db).confirm(token, { schema_version: 1, request_id: randomUUID(), scope_id: taskId, expected_control_version: proposal.basis.control_version, name: 'confirm_proposal', payload: { proposal_id: proposalId, content_digest: proposal.content_digest } });
  return transaction(db, (tx) => publishPlanningSpecification(tx, token, { task_id: taskId, specification_id: randomUUID(), specification, confirmation_id: confirmation.confirmation_id!, request_id: randomUUID(), expected: proposal.basis }));
}
