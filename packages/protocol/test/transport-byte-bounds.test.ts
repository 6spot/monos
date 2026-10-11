import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { validate, MAX_PUBLICATION_PUSH_BYTES } from '../src/validation.ts';
import type {
  PublicationPushRequest, PublicationRefReadRequest, PublicationRefReadResponse,
  PublicationRefObservation, RepositoryAccessResult, InspectionRepositoryAccessResult,
} from '../src/index.ts';

const fixture = JSON.parse(readFileSync(new URL('../fixtures/plain-git.json', import.meta.url), 'utf8')) as {
  push: PublicationPushRequest;
  ref_request: PublicationRefReadRequest;
  ref_response: PublicationRefReadResponse;
  repository_access: RepositoryAccessResult;
  inspection_access: InspectionRepositoryAccessResult;
};
const size = (value: unknown) => Buffer.byteLength(JSON.stringify(value));

function pushWithSize(bytes: number): PublicationPushRequest {
  const push = structuredClone(fixture.push);
  push.override_receipts = Array.from({ length: bytes < 510_000 ? 60 : 64 }, () => ({
    receipt_id: 'r'.repeat(128), confirmation_id: 'c'.repeat(128), selection_digest: 'a'.repeat(64),
    selection: {
      candidate_id: 'i'.repeat(128), candidate_manifest_digest: 'b'.repeat(64),
      effective_basis_digest: 'c'.repeat(64), scan_digest: 'd'.repeat(64), mapping_digest: 'e'.repeat(64),
      finding_ids: Array.from({ length: 64 }, (_, i) => i.toString(16).padStart(64, '0')) as [string, ...string[]],
    },
  }));
  const grow = (value: unknown): void => {
    if (!value || typeof value !== 'object') return;
    for (const [key, item] of Object.entries(value)) {
      const object = value as Record<string, unknown>;
      if (key === 'repository_identity') object[key] = '\u0001'.repeat(2048);
      else if (key === 'storage_id') object[key] = 's'.repeat(128);
      else if (key === 'remote_url') object[key] = 'https://git.example/' + '\u0001'.repeat(2028);
      else if (key === 'target_branch') object[key] = '\u0001'.repeat(1024);
      else if (key === 'path') object[key] = '/';
      else grow(item);
    }
  };
  grow(push);
  const padding = bytes - size(push);
  expect(padding).toBeGreaterThanOrEqual(0);
  const path = '/' + '\u0001'.repeat(Math.floor(padding / 6)) + 'x'.repeat(padding % 6);
  expect(Buffer.byteLength(path)).toBeLessThanOrEqual(4096);
  push.preparation.construction.parents[0].outcome!.path = path;
  expect(size(push)).toBe(bytes);
  return push;
}

function envelopes(push: PublicationPushRequest): [string, unknown][] {
  const request = { ...structuredClone(fixture.ref_request), push };
  const response = { ...structuredClone(fixture.ref_response), request };
  const common = { schema_version: 1, incarnation: 7, correlation_id: 'fresh-ref-correlation' };
  return [
    ['PublicationPushRequest', push],
    ['PublicationRefReadRequest', request],
    ['PublicationRefReadResponse', response],
    ['Frame', { schema_version: 1, incarnation: 7, type: 'publication_push', publication_push: push }],
    ['Frame', { ...common, type: 'publication_ref_read', publication_ref_read: request }],
    ['Frame', { ...common, type: 'publication_ref_read_result', publication_ref_read_result: response }],
  ];
}

describe('plain Git encoded transport bounds', () => {
  for (const [key, schema] of [
    ['repository_access', 'RepositoryAccessResult'],
    ['inspection_access', 'InspectionRepositoryAccessResult'],
  ] as const) it(`${schema} limits actual encoded bytes`, () => {
    const value = structuredClone(fixture[key]);
    expect(() => validate(schema, value)).not.toThrow();
    value.authentication = { kind: 'https_basic', username: '界'.repeat(256), token: '界'.repeat(4096), expires_at: '2026-10-04T13:00:00.000Z' };
    value.default_branch = '界'.repeat(1024);
    expect(JSON.stringify(value).length).toBeLessThan(16 * 1024);
    expect(size(value)).toBeGreaterThan(16 * 1024);
    expect(() => validate(schema, value)).toThrow('encoded wire byte limit');
  });

  it('reserves response space before push admission and on every ref-read ingress', () => {
    for (const [schema, value] of envelopes(pushWithSize(MAX_PUBLICATION_PUSH_BYTES))) {
      expect(() => validate(schema, value), schema).not.toThrow();
    }
    for (const [schema, value] of envelopes(pushWithSize(MAX_PUBLICATION_PUSH_BYTES + 1))) {
      expect(size(value)).toBeLessThan(512 * 1024);
      expect(() => validate(schema, value), schema).toThrow('PublicationPushRequest exceeds');
    }
  });

  it('reserves for Go escaping when a compact incoming push expands on echo', () => {
    const push = pushWithSize(MAX_PUBLICATION_PUSH_BYTES + 1);
    const outcome = push.preparation.construction.parents[0].outcome!;
    outcome.path = outcome.path!.replaceAll('\u0001', '<');
    expect(size(push)).toBeLessThan(MAX_PUBLICATION_PUSH_BYTES);
    for (const [schema, value] of envelopes(push)) {
      expect(() => validate(schema, value)).toThrow('PublicationPushRequest exceeds');
    }
  });

  it('keeps even the schema maximum ref observation and envelope within the reservation', () => {
    const observation: PublicationRefObservation = {
      schema_version: 1, observation_id: 'i'.repeat(128), operation_id: 'i'.repeat(128),
      item_id: 'i'.repeat(128), task_id: 'i'.repeat(128), resource_id: 'i'.repeat(128), runner_id: 'i'.repeat(128),
      storage_id: '\u0001'.repeat(512), repository_identity: '\u0001'.repeat(2048),
      provider_metadata: { github: { repository_id: '9'.repeat(16) } },
      delivery_ref: 'refs/heads/monos/task/' + 'a'.repeat(36) + '/' + 'i'.repeat(128),
      status: 'present', head: 'a'.repeat(64), observed_at: '9999-12-31T23:59:59.999Z',
    };
    const push = pushWithSize(MAX_PUBLICATION_PUSH_BYTES);
    const request = { schema_version: 1, request_id: 'i'.repeat(128), push, push_request_digest: 'a'.repeat(64) };
    const response = { schema_version: 1, request, worker_absent: true, observation, observation_digest: 'a'.repeat(64) };
    const frame = { schema_version: 1, type: 'publication_ref_read_result', incarnation: Number.MAX_SAFE_INTEGER, correlation_id: 'i'.repeat(128), publication_ref_read_result: response };
    expect(() => validate('Frame', frame)).not.toThrow();
    expect(size(frame) - size(push)).toBe(17_375);
    expect(size(frame)).toBe(508_895);
    expect(size(frame)).toBeLessThan(512 * 1024);
  });

  for (const index of [4, 5]) it(`checks nested UTF-8 paths and malformed Unicode in ref frame ${index}`, () => {
    for (const [path, valid] of [['界'.repeat(1365), true], ['界'.repeat(1366), false], ['\ud800', false]] as const) {
      const push = structuredClone(fixture.push);
      push.preparation.construction.parents[0].outcome!.path = path;
      const [schema, frame] = envelopes(push)[index]!;
      if (valid) expect(() => validate(schema, frame)).not.toThrow();
      else expect(() => validate(schema, frame)).toThrow(/byte bounds|well-formed Unicode/);
    }
  });

  it('applies the 512 KiB whole-frame limit to both fresh ref frame types', () => {
    for (const index of [4, 5]) {
      const [schema, frame] = envelopes(pushWithSize(512 * 1024))[index]!;
      expect(size(frame)).toBeGreaterThan(512 * 1024);
      expect(size(frame)).toBeLessThan(1024 * 1024);
      expect(() => validate(schema, frame)).toThrow('Publication frame exceeds');
    }
  });
});
