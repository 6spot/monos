import { expect, it } from 'vitest';
import { guardNewCommand } from './commands.ts';
import type { AdmissionBasis } from './commands.ts';
import type { CommandEnvelope } from '../../protocol/src/index.ts';

const basis: AdmissionBasis = { kind: 'node', taskId: 'task', resourceId: 'repo', mutationAllowed: true, processReleased: false, controlVersion: 1, sourceWatermark: 1, connectionAvailable: true };
const command: CommandEnvelope = { schema_version: 1, request_id: 'request', scope_id: 'task', expected_control_version: 1, name: 'open_workspace', payload: { resource_id: 'repo' } };
it('separates Planner repository reads from Node workspace writes', () => {
  expect(() => guardNewCommand(command, { ...basis, kind: 'planner' })).toThrow('not allowed');
  expect(() => guardNewCommand({ ...command, name: 'inspect_repository' }, { ...basis, kind: 'planner' })).not.toThrow();
});
it('rejects revoked, offline, wrong-resource and stale-basis mutations', () => {
  expect(() => guardNewCommand(command, { ...basis, mutationAllowed: false })).toThrow('ended');
  expect(() => guardNewCommand(command, { ...basis, connectionAvailable: false })).toThrow('unavailable');
  expect(() => guardNewCommand(command, { ...basis, resourceId: 'other' })).toThrow('outside');
  expect(() => guardNewCommand(command, { ...basis, controlVersion: 2 })).toThrow('stale');
});

it('allows upstream Rework only from a live Node command scope', () => {
  const request: CommandEnvelope = { ...command, name: 'request_rework', payload: { reason: 'Correct upstream output' } };
  expect(() => guardNewCommand(request, basis)).not.toThrow();
  for (const foreign of [
    { ...basis, kind: 'planner' as const },
    { ...basis, kind: 'planner' as const, initialPlanning: true },
    { ...basis, kind: 'planner' as const, taskConversation: true },
    { ...basis, kind: 'planner' as const, taskReview: true },
    { ...basis, kind: 'planner' as const, taskReplan: true },
    { ...basis, mutationAllowed: false },
  ]) expect(() => guardNewCommand(request, foreign)).toThrow();
});

it('grants initial phase outcomes only to a source-bound Task Planner', () => {
  const publish: CommandEnvelope = { ...command, name: 'publish_execution_plan', payload: { planning_intent_id: 'source', plan_id: 'plan', nodes: [{ node_id: 'node', role_id: 'role', goal: 'Deliver', dependencies: [] }] } };
  for (const scope of [{ ...basis }, { ...basis, kind: 'planner' as const }, { ...basis, kind: 'planner' as const, scopeKind: 'todo' as const, scopeId: 'task' }]) expect(() => guardNewCommand(publish, scope)).toThrow();
  expect(() => guardNewCommand(publish, { ...basis, kind: 'planner', initialPlanning: true })).not.toThrow();
  expect(() => guardNewCommand({ ...command, name: 'commit_task_turn', payload: { reply: 'not an initial outcome', source_watermark: 1, routing: { kind: 'reply_only' } } }, { ...basis, kind: 'planner', initialPlanning: true })).toThrow('must publish');
});

it('keeps review tools exclusive from Node, Conversation, Todo and Replan authority',()=>{
  const review:AdmissionBasis={...basis,kind:'planner',taskReview:true};
  const outcome:CommandEnvelope={...command,name:'apply_review_rework',payload:{feedback_id:'feedback',operation_id:'operation',operation_version:1,source_id:'source',basis:{control_version:1,specification_id:'spec',plan_id:'plan'},node_ids:['node'],reason:'Fix result'}};
  expect(()=>guardNewCommand(outcome,review)).not.toThrow();
  for(const foreign of [basis,{...basis,kind:'planner' as const,taskConversation:true},{...basis,kind:'planner' as const,taskReplan:true},{...review,scopeKind:'todo' as const}])expect(()=>guardNewCommand(outcome,foreign)).toThrow();
  for(const name of ['open_workspace','complete_node','commit_task_turn','prepare_replan','publish_execution_plan','apply_specification_revision','inspect_repository'] as const)expect(()=>guardNewCommand({...command,name},review)).toThrow();
  expect(()=>guardNewCommand(outcome,{...review,mutationAllowed:false})).toThrow('ended');
});
