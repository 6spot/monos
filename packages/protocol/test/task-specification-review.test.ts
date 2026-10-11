import { describe, expect, it } from 'vitest';
import { validate } from '../src/index.ts';

const basis = { control_version: 4, specification_id: 'spec', plan_id: null };
const proposal = {
  proposal_id: 'proposal', specification: '# Complete requirements\nKeep private work.',
  summary: 'Clarify the required result.', basis,
  impact: { graph_sufficient: true, nodes: [], guidance: [] },
  source_input_ids: ['input'],
};
const owner = (name: string, payload: object) => ({
  schema_version: 1, request_id: 'request', task_id: 'task', name, payload,
});
const agent = (name: string, payload: object) => ({
  schema_version: 1, request_id: 'request', scope_id: 'task',
  expected_control_version: 2, name, payload,
});
const apply = { proposal_id: 'proposal', confirmation_id: 'confirmation', basis };

describe('Specification changes independent wire review', () => {
  it('compiles strict schemas and preserves explicit Owner versus Agent envelopes', () => {
    expect(() => validate('TaskSpecificationCommand', owner('edit_specification', proposal))).not.toThrow();
    expect(() => validate('CommandEnvelope', agent('prepare_specification_revision', proposal))).not.toThrow();
    expect(() => validate('TaskSpecificationCommand', owner('apply_specification_revision', apply))).not.toThrow();
    expect(() => validate('CommandEnvelope', agent('apply_specification_revision', apply))).not.toThrow();
    expect(() => validate('CommandEnvelope', owner('edit_specification', proposal))).toThrow();
    expect(() => validate('TaskSpecificationCommand', agent('prepare_specification_revision', proposal))).toThrow();
  });

  it('requires full content, displayed impact and exact authorization rather than consent flags', () => {
    for (const key of ['specification', 'summary', 'basis', 'impact', 'source_input_ids']) {
      const incomplete: Record<string, unknown> = { ...proposal };
      delete incomplete[key];
      expect(() => validate('PrepareSpecificationRevision', incomplete)).toThrow();
    }
    for (const payload of [
      { proposal_id: 'proposal', basis }, { ...apply, approved: true },
      { ...apply, confirmation_id: '' }, { ...apply, basis: { control_version: 4 } },
    ]) expect(() => validate('ApplySpecificationRevision', payload)).toThrow();
    expect(() => validate('TaskSpecificationCommand', owner('confirm_specification', {
      proposal_id: 'proposal', content_digest: 'a'.repeat(64),
    }))).not.toThrow();
    expect(() => validate('TaskSpecificationCommand', owner('confirm_specification', {
      proposal_id: 'proposal', content_digest: 'a'.repeat(63),
    }))).toThrow();
  });

  it('transports bounded multi-Node observations and requires exact evidence fields', () => {
    const node = { node_id: 'node', node_activation: 1, source_id: 'source',
      completion_operation_id: 'completion', completion_manifest_digest: 'b'.repeat(64), disposition: 'carry' };
    const impact = { graph_sufficient: true, nodes: [node], guidance: [] };
    expect(() => validate('SpecificationImpact', impact)).not.toThrow();
    expect(() => validate('SpecificationImpact', { ...impact, nodes: [node, { ...node, node_id: 'other' }] })).not.toThrow();
    for (const value of [
      { ...impact, graph_sufficient: false },
      { ...impact, nodes: Array.from({ length: 257 }, (_, i) => ({ ...node, node_id: `node-${i}` })) },
      { ...impact, nodes: [{ ...node, goal: 'Silently replace definition' }] },
      { ...impact, nodes: [{ ...node, completion_manifest_digest: 12 }] },
      { ...impact, nodes: [{ ...node, disposition: 'unaffected_live' }] },
    ]) expect(() => validate('SpecificationImpact', value)).toThrow();
    for (const key of ['node_activation', 'source_id', 'completion_operation_id', 'completion_manifest_digest']) {
      const incomplete: Record<string, unknown> = { ...node };
      delete incomplete[key];
      expect(() => validate('SpecificationImpactNode', incomplete)).toThrow();
    }
  });

  it('bounds and preserves source identities and guidance dispositions', () => {
    for (const source_input_ids of [['input', 'input'], [1], [''], Array.from({ length: 257 }, (_, i) => `i${i}`)]) {
      expect(() => validate('PrepareSpecificationRevision', { ...proposal, source_input_ids })).toThrow();
    }
    for (const specification of ['', 'x'.repeat(65537), 'bad\0text']) {
      expect(() => validate('PrepareSpecificationRevision', { ...proposal, specification })).toThrow();
    }
    const guidance = { guidance_id: 'guidance', version: 2, disposition: 'retain' };
    expect(() => validate('SpecificationImpact', { ...proposal.impact, guidance: [guidance] })).not.toThrow();
    for (const value of [
      [guidance, guidance], [{ ...guidance, disposition: 'handled' }],
      [{ guidance_id: 'guidance', disposition: 'supersede' }], [{ ...guidance, version: '2' }],
    ]) expect(() => validate('SpecificationImpact', { ...proposal.impact, guidance: value })).toThrow();
  });

  it('attaches a proposal only through a complete canonical source-bound turn payload', () => {
    const payload = { source_id: 'source', input_id: 'input', source_watermark: 1,
      reply: 'Please review the exact proposal.', routing: { kind: 'specification_proposal', proposal_id: 'proposal', basis } };
    expect(() => validate('CommandEnvelope', agent('commit_task_turn', payload))).not.toThrow();
    for (const value of [
      { ...payload, source_id: undefined }, { ...payload, input_id: undefined },
      { ...payload, routing: { kind: 'specification_proposal', proposal_id: 'proposal' } },
      { ...payload, routing: { kind: 'specification_proposal', basis } },
    ]) expect(() => validate('CommandEnvelope', agent('commit_task_turn', value))).toThrow();
  });

  it('requires versioned exact recovery and input deferral rather than broad cutoff overrides', () => {
    for (const [name, payload] of [
      ['withdraw_specification', { proposal_id: 'proposal', expected_version: 0 }],
      ['retry_specification', { operation_id: 'operation', expected_version: 0 }],
      ['defer_specification_inputs', { proposal_id: 'proposal', inputs: [{ input_id: 'input', version: 1 }] }],
    ] as const) expect(() => validate('TaskSpecificationCommand', owner(name, payload))).not.toThrow();
    for (const [name, payload] of [
      ['withdraw_specification', { proposal_id: 'proposal' }],
      ['retry_specification', { operation_id: 'operation', expected_version: -1 }],
      ['defer_specification_inputs', { proposal_id: 'proposal', input_cutoff: 999 }],
      ['defer_specification_inputs', { proposal_id: 'proposal', inputs: [{ input_id: 'input' }] }],
      ['defer_specification_inputs', { proposal_id: 'proposal', inputs: [{ input_id: 'input', version: 1 }, { input_id: 'input', version: 1 }] }],
    ] as const) expect(() => validate('TaskSpecificationCommand', owner(name, payload))).toThrow();
  });
});
