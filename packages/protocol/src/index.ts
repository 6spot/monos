import { createHash } from 'node:crypto';
import canonicalize from 'canonicalize';
import type { CommandEnvelope, CommandSubmission, Frame } from '../generated/types.ts';

export * from '../generated/types.ts';
export * from './validation.ts';
import { validate, ProtocolValidationError } from './validation.ts';

export function canonicalJSON(value: unknown): string {
  // RFC 8785 requires Unicode scalar values. JSON.stringify would preserve lone
  // surrogates, while Go's decoder replaces them, changing the journaled digest.
  assertUnicode(value);
  const result = canonicalize(value);
  if (result === undefined) throw new Error('Value has no JSON representation');
  return result;
}

function assertUnicode(value: unknown): void {
  if (typeof value === 'string' && /[\uD800-\uDFFF]/u.test(value)) throw new ProtocolValidationError('JSON strings must contain well-formed Unicode');
  if (Array.isArray(value)) value.forEach(assertUnicode);
  else if (value && typeof value === 'object') {
    for (const [key, member] of Object.entries(value)) { assertUnicode(key); assertUnicode(member); }
  }
}

export function digest(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

export function workspaceId(taskId: string, resourceId: string): string {
  validate('Id', taskId); validate('Id', resourceId);
  return 'ws_' + digest(canonicalJSON([taskId, resourceId]));
}

export function submission(envelope: CommandEnvelope): CommandSubmission {
  validateEnvelope(envelope);
  const envelope_json = canonicalJSON(envelope);
  return { envelope_json, sha256: digest(envelope_json) };
}

export function parseSubmission(body: unknown): { submission: CommandSubmission; envelope: CommandEnvelope } {
  const request = validate<CommandSubmission>('CommandSubmission', body);
  if (Buffer.byteLength(request.envelope_json) > 1048576 || digest(request.envelope_json) !== request.sha256) throw new Error('Envelope size or digest mismatch');
  const envelope = JSON.parse(request.envelope_json) as unknown;
  validateEnvelope(envelope);
  if (canonicalJSON(envelope) !== request.envelope_json) throw new Error('Envelope must use RFC 8785 canonical JSON');
  return { submission: request, envelope };
}

export function validateEnvelope(value: unknown): asserts value is CommandEnvelope {
  validate<CommandEnvelope>('CommandEnvelope', value);
}

export function parseFrame(value: unknown): Frame {
  return validate<Frame>('Frame', value);
}
