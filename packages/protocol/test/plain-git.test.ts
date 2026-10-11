import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { canonicalJSON, digest, validate } from '../src/index.ts';
import type {
  PublicationPushRequest, PublicationPushResult, PublicationPublishedProof,
  PublicationRefReadRequest, PublicationRefReadResponse,
  DeliveryRepository, RemotePreparationRecord, DeliveryItemProgress,
} from '../src/index.ts';

const fixture = JSON.parse(readFileSync(new URL('../fixtures/plain-git.json', import.meta.url), 'utf8')) as {
  push: PublicationPushRequest;
  push_result: PublicationPushResult;
  published: PublicationPublishedProof;
  ref_request: PublicationRefReadRequest;
  ref_response: PublicationRefReadResponse;
  delivery_repository: DeliveryRepository;
  remote_record: RemotePreparationRecord;
  final_progress: DeliveryItemProgress;
  canonical_request: string;
  request_digest: string;
  credential_status: Record<string, unknown>;
  credential_saved: Record<string, unknown>;
  credential_cleared: Record<string, unknown>;
  cases: { name: string; schema: string; valid: boolean; value: unknown }[];
};
const hash = (value: unknown) => digest(canonicalJSON(value));

describe('shared plain HTTPS Git boundary', () => {
  for (const c of fixture.cases) it(c.name, () => {
    if (c.valid) expect(() => validate(c.schema, c.value)).not.toThrow();
    else expect(() => validate(c.schema, c.value)).toThrow();
  });

  it('pins the complete push, scan, permission and published proof graph', () => {
    const { push, push_result: result, published } = fixture;
    expect(canonicalJSON(push)).toBe(fixture.canonical_request);
    expect(hash(push)).toBe(fixture.request_digest);
    expect(push.remote_url).toBe('https://Git.Example:8443/Team/Repo.git');
    expect(push.provider_metadata).toEqual({});
    expect(push.preparation.configuration.provider_blob_limit).toBeNull();
    expect(push.preparation.configuration.workflow_write).toBe('not_applicable');
    expect(push.prepared.scan!.workflow_changes).toBe(true);
    expect(push.permission_proof.kind).toBe('git_https_configuration');
    expect(hash({ kind: push.permission_proof.kind, scope_digest: push.permission_proof.scope_digest })).toBe(push.permission_proof.permission_fingerprint);
    expect(hash(push.permission_proof)).toBe(push.permission_proof_digest);
    expect(hash(push.preparation)).toBe(push.prepared.request_digest);
    expect(hash(push.prepared)).toBe(push.preparation_result_digest);
    expect(hash(push.prepared.scan)).toBe(push.prepared.scan_digest);
    expect(hash(push.prepared.candidate)).toBe(push.prepared.candidate_manifest_digest);
    expect(result.request_digest).toBe(fixture.request_digest);
    expect(result.observation_digest).toBe(hash(result.observation));
    expect(published.request_digest).toBe(fixture.request_digest);
    expect(published.result_digest).toBe(hash(result));
    expect(published.candidate).toEqual(push.prepared.candidate);
    expect(published.observation).toEqual(result.observation);
  });

  it('echoes a fresh read identity without changing the original push result', () => {
    const before = canonicalJSON(fixture.push_result);
    const { ref_request: request, ref_response: response, push_result: result } = fixture;
    expect(request.push_request_digest).toBe(fixture.request_digest);
    expect(request.push).toEqual(fixture.push);
    expect(response.request).toEqual(request);
    expect(response.worker_absent).toBe(true);
    expect(response.observation_digest).toBe(hash(response.observation));
    expect(response.observation.operation_id).toBe(request.push.operation_id);
    expect(response.observation.delivery_ref).toBe(request.push.delivery_ref);
    expect(response.observation.observation_id).not.toBe(result.observation.observation_id);
    expect(Date.parse(response.observation.observed_at)).toBeGreaterThan(Date.parse(result.observation.observed_at));
    expect(hash({ ...request, request_id: 'other-read' })).not.toBe(hash(request));
    expect(hash({ ...request.push, remote_url: request.push.remote_url.replace('/Team/', '/team/') })).not.toBe(request.push_request_digest);
    expect(canonicalJSON(fixture.push_result)).toBe(before);
  });

  it('retains branch finality and public credential status without provider or secret fields', () => {
    const { delivery_repository: repository, remote_record: record, final_progress: final } = fixture;
    expect(hash(repository.preparation_request)).toBe(repository.preparation_request_digest);
    expect(hash(repository.preparation_result)).toBe(repository.preparation_result_digest);
    expect(record.published_digest).toBe(hash(fixture.published));
    expect(final.finality_kind).toBe('git_branch');
    expect(final.checks).toBe('not_applicable');
    expect(final.final_commit).toBe(fixture.push.prepared.candidate!.head);
    for (const value of [repository, record, final]) {
      for (const key of ['review', 'merge_method', 'provider_content', 'marker']) expect(value).not.toHaveProperty(key);
    }
    for (const value of [fixture.credential_status, fixture.credential_saved, fixture.credential_cleared]) {
      for (const key of ['token', 'authentication', 'token_digest', 'encrypted_token', 'ciphertext']) expect(value).not.toHaveProperty(key);
    }
  });
});
