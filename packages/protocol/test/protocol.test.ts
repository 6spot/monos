import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { canonicalJSON, parseSubmission, submission, validate, workspaceId } from '../src/index.ts';
import type { CommandEnvelope } from '../src/index.ts';

const fixtures = JSON.parse(readFileSync(new URL('../fixtures/validation.json', import.meta.url), 'utf8')) as { name: string; schema: string; valid: boolean; value: unknown }[];
const canonical = JSON.parse(readFileSync(new URL('../fixtures/canonicalization.json', import.meta.url), 'utf8')) as { name: string; input: unknown; canonical: string }[];
const workspaces = JSON.parse(readFileSync(new URL('../fixtures/workspace-identities.json', import.meta.url), 'utf8')) as { task_id: string; resource_id: string; canonical: string; workspace_id: string }[];
describe('shared language fixtures', () => {
  for (const fixture of fixtures) it(fixture.name, () => {
    if (fixture.valid) expect(() => validate(fixture.schema, fixture.value)).not.toThrow();
    else expect(() => validate(fixture.schema, fixture.value)).toThrow();
  });
  for (const fixture of canonical) it(fixture.name, () => expect(canonicalJSON(fixture.input)).toBe(fixture.canonical));
  for (const fixture of workspaces) it('stable Task workspace ' + fixture.workspace_id, () => {
    expect(canonicalJSON([fixture.task_id, fixture.resource_id])).toBe(fixture.canonical);
    expect(workspaceId(fixture.task_id, fixture.resource_id)).toBe(fixture.workspace_id);
  });
});

it('input formatting cannot change request identity; edited content does', () => {
  const command: CommandEnvelope = { schema_version: 1, request_id: 'r', scope_id: 't', name: 'complete_node', expected_control_version: 1, payload: { summary: 'x'.repeat(100_000) } };
  const first = submission(command);
  expect(submission(JSON.parse(JSON.stringify(command, null, 2)))).toEqual(first);
  expect(parseSubmission(first).envelope).toEqual(command);
  expect(submission({ ...command, payload: { summary: 'different' } }).sha256).not.toBe(first.sha256);
  expect(() => parseSubmission({ ...first, envelope_json: `${first.envelope_json} ` })).toThrow();
});

it('rejects lone surrogates instead of hashing content differently from Go', () => {
  expect(() => canonicalJSON({ summary: '\ud800' })).toThrow('well-formed Unicode');
  expect(() => canonicalJSON({ '\udfff': 'value' })).toThrow('well-formed Unicode');
  expect(canonicalJSON({ summary: 'a😀b' })).toBe('{"summary":"a😀b"}');
});
