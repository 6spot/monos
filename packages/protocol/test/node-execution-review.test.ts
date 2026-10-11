import { describe, expect, it } from 'vitest';
import { validate } from '../src/index.ts';

const cancelledCompletion = {
  operation_id: 'completion', attempt_id: 'attempt', success: false,
  cancelled_by_operation_id: 'settlement', result: { writer_absent: true },
};
const finalizedCompletion = {
  operation_id: 'completion', attempt_id: 'attempt', success: true,
  result: { writer_absent: true, completion_outcome: 'finalized', workspace_results: [] },
};

describe('completion settlement wire authority', () => {
  it('accepts each truthful terminal disposition', () => {
    for (const [disposition, completion_result] of [
      ['cancelled', cancelledCompletion], ['already_finalized', finalizedCompletion],
    ]) {
      expect(() => validate('CompletionSettlement', {
        completion_operation_id: 'completion', disposition, completion_result,
      })).not.toThrow();
    }
  });

  it('rejects contradictory terminal disposition and nested result', () => {
    for (const [disposition, completion_result] of [
      ['cancelled', finalizedCompletion], ['already_finalized', cancelledCompletion],
      ['cancelled', { operation_id: 'completion', attempt_id: 'attempt', success: false, result: { writer_absent: true } }],
      ['already_finalized', { ...finalizedCompletion, result: { writer_absent: true } }],
    ]) {
      expect(() => validate('CompletionSettlement', {
        completion_operation_id: 'completion', disposition, completion_result,
      })).toThrow();
    }
  });

  it('does not accept semantic output fields as cancellation evidence', () => {
    const extras = [
      { artifact_id: 'artifact' }, { blocker_id: 'blocker' },
      { planning_outcome: { kind: 'issue', planning_intent_id: 'intent', issue_sequence: 1 } },
    ];
    for (const extra of extras) {
      for (const schema of ['OperationResult', 'CompletionOperationResult']) {
        expect(() => validate(schema, {
          ...cancelledCompletion, result: { writer_absent: true, ...extra },
        })).toThrow();
      }
    }
  });

  it('keeps a failed outer effect from certifying a completed pair', () => {
    expect(() => validate('OperationResult', {
      operation_id: 'settlement', attempt_id: 'attempt', success: false,
      result: { writer_absent: true },
      completion_settlement: {
        completion_operation_id: 'completion', disposition: 'cancelled',
        completion_result: cancelledCompletion,
      },
    })).toThrow();
  });

  it('rejects completion-manifest authority on a different effect kind', () => {
    expect(() => validate('Operation', {
      schema_version: 1, operation_id: 'stop', attempt_id: 'attempt',
      dispatch_id: 'dispatch', request_id: 'request', kind: 'stop',
      state: 'admitted', completion_manifest_digest: 'a'.repeat(64),
    })).toThrow();
  });

  it('requires an explicit empty collection for repository-free completion', () => {
    const operation = {
      schema_version: 1, operation_id: 'completion', attempt_id: 'attempt',
      dispatch_id: 'dispatch', request_id: 'request', kind: 'complete_node',
      state: 'admitted',
    };
    expect(() => validate('Operation', operation)).toThrow();
    expect(() => validate('Operation', { ...operation, workspaces: [] })).not.toThrow();
    expect(() => validate('Operation', { ...operation, workspaces: [], resource_id: 'resource' })).toThrow();
    expect(() => validate('Operation', { ...operation, workspaces: [], repository_free: true })).toThrow();
  });
});
