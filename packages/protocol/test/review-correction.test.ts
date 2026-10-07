import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { validate } from '../src/validation.ts';

const fixtures = JSON.parse(readFileSync(new URL('../fixtures/validation.json', import.meta.url), 'utf8')) as { name: string; value: unknown }[];
const request = fixtures.find(fixture => fixture.name === 'review correction unaccepted exact request')!.value as {
  payload: { text: string };
};

describe('complete review request byte and identity bounds', () => {
  it('preserves a complete Unicode feedback within the raw text budget', () => {
    expect(() => validate('OwnerReviewCommand', { ...request, payload: { ...request.payload, text: '界'.repeat(18_000) } })).not.toThrow();
  });

  it('rejects oversized encoded feedback despite valid character length', () => {
    expect(() => validate('OwnerReviewCommand', { ...request, payload: { ...request.payload, text: '界'.repeat(22_000) } })).toThrow('raw byte bounds');
  });

  it('rejects malformed Unicode before it becomes replacement text', () => {
    expect(() => validate('OwnerReviewCommand', { ...request, payload: { ...request.payload, text: '\ud800' } })).toThrow('well-formed Unicode');
  });
});
