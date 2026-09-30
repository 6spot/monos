import { describe, expect, it } from 'vitest';
import { validate } from '../src/index.ts';

const source = {
  source_id: 'source', input_id: 'input', source_watermark: 1,
  conversation_version: 2, context_digest: 'a'.repeat(64), reply_only: false,
};
const dispatch = {
  dispatch_id: 'dispatch', attempt_id: 'attempt', runner_id: 'runner', task_id: 'task',
  kind: 'planner', fencing_generation: 1, node_activation: 0, control_version: 2,
  runtime_id: 'opencode', model: 'opencode/longcat-2.5-preview-free', prompt: 'context',
  source_watermark: 1, mutation_allowed: true, process_released: false,
  workspace_reservations: { project_id: 'project', configuration_version: 1, resources: [] },
  task_conversation_source: source,
};
const envelope = (name: string, payload: object) => ({
  schema_version: 1, request_id: 'request', scope_id: 'task',
  expected_control_version: 2, name, payload,
});
const reply = { reply: 'Saved reply', source_watermark: 1, routing: { kind: 'reply' } };
const basis = { control_version: 5, specification_id: 'spec', plan_id: null };

describe('Task conversation independent wire review', () => {
  it('compiles and accepts canonical Owner submit and recovery commands', () => {
    const common = { schema_version: 1, request_id: 'request', task_id: 'task' };
    expect(() => validate('TaskConversationCommand', {
      ...common, name: 'submit_task_message', payload: { message_id: 'message', content: 'Hello' },
    })).not.toThrow();
    for (const name of ['retry_task_input', 'withdraw_task_input', 'stop_task_turn']) {
      expect(() => validate('TaskConversationCommand', {
        ...common, name, expected_version: 0, payload: { operation_id: 'input' },
      })).not.toThrow();
      expect(() => validate('TaskConversationCommand', {
        ...common, name, payload: { operation_id: 'input' },
      })).toThrow();
    }
  });

  it('accepts canonical conversation Dispatch and rejects alternate authority', () => {
    expect(() => validate('Dispatch', dispatch)).not.toThrow();
    for (const extra of [
      { task_planning_source: { intent_id: 'intent', specification_id: 'spec', context_digest: 'a'.repeat(64) } },
      { node_id: 'node' }, { resource_id: 'resource' }, { kind: 'node' },
      { workspace_reservations: { project_id: 'project', configuration_version: 1,
        resources: [{ resource_id: 'resource', workspace_id: 'workspace' }] } },
    ]) {
      expect(() => validate('Dispatch', { ...dispatch, ...extra })).toThrow();
    }
  });

  it('accepts explicit canonical and legacy replies with their own complete identity', () => {
    expect(() => validate('CommandEnvelope', envelope('commit_task_turn', {
      ...reply, source_id: 'source', input_id: 'input',
    }))).not.toThrow();
    expect(() => validate('CommandEnvelope', envelope('commit_task_turn', {
      ...reply, routing: { kind: 'reply_only' },
    }))).not.toThrow();
  });

  it('rejects partial source identity and legacy routing on canonical authority', () => {
    for (const payload of [
      reply, { ...reply, source_id: 'source' }, { ...reply, input_id: 'input' },
      { ...reply, source_id: 'source', input_id: 'input', routing: { kind: 'reply_only' } },
    ]) {
      expect(() => validate('CommandEnvelope', envelope('commit_task_turn', payload))).toThrow();
    }
  });

  it('requires execution basis for actions and forbids it on replies', () => {
    for (const kind of ['guidance', 'issue']) {
      expect(() => validate('TaskTurnRouting', { kind, text: 'In scope', basis })).not.toThrow();
      expect(() => validate('TaskTurnRouting', { kind, text: 'In scope' })).toThrow();
    }
    expect(() => validate('TaskTurnRouting', { kind: 'reply', basis })).toThrow();
  });

  it('keeps absent, empty and explicit completion guidance declarations distinct and bounded', () => {
    for (const extra of [{}, { handled_guidance_ids: [] }, { handled_guidance_ids: ['guidance'] }]) {
      expect(() => validate('CommandEnvelope', envelope('complete_node', { summary: 'Done', ...extra }))).not.toThrow();
    }
    for (const handled_guidance_ids of [null, ['guidance', 'guidance'], [1], [''], Array.from({ length: 257 }, (_, i) => `g${i}`)]) {
      expect(() => validate('CommandEnvelope', envelope('complete_node', { summary: 'Done', handled_guidance_ids }))).toThrow();
    }
  });
});
