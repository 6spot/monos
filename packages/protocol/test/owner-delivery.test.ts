import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { MAX_DELIVERY_BYTES, validate } from '../src/validation.ts';
import type { DeliveryAcceptanceManifest } from '../generated/types.ts';
import { canonicalJSON, digest } from '../src/index.ts';

const cases = JSON.parse(readFileSync(new URL('../fixtures/validation.json', import.meta.url), 'utf8')) as { name: string; value: unknown }[];
const original = cases.find(value => value.name === 'owner delivery repository free complete manifest')!.value as DeliveryAcceptanceManifest;

function manifestWithSummary(summary: string): DeliveryAcceptanceManifest {
  const manifest = structuredClone(original);
  manifest.outputs[0].completion.summary = summary;
  return manifest;
}

describe('complete Owner delivery evidence bounds', () => {
  it('keeps modified, mapped and no-change fixture preparation digests exact', () => {
    const pairs = [['source', 'source_digest'], ['effective_basis', 'effective_basis_digest'], ['construction', 'construction_digest'], ['configuration', 'configuration_digest'], ['permission_proof', 'permission_proof_digest'], ['published', 'published_digest'], ['published_proof', 'published_proof_digest'], ['candidate', 'candidate_manifest_digest'], ['scan', 'scan_digest'], ['mapping', 'mapping_digest'], ['observation', 'observation_digest'], ['provider_content', 'provider_content_digest']];
    const hash = (value: unknown) => digest(canonicalJSON(value));
    const visit = (value: unknown) => {
      if (Array.isArray(value)) { value.forEach(visit); return; }
      if (!value || typeof value !== 'object') return;
      const record = value as Record<string, unknown>;
      for (const [key, field] of pairs) if (record[key!] !== undefined && record[field!] !== undefined) expect(record[field!]).toBe(hash(record[key!]));
      if (record.preparation_request && record.preparation_result) {
        expect(record.preparation_request_digest).toBe(hash(record.preparation_request));
        expect(record.preparation_result_digest).toBe(hash(record.preparation_result));
        expect((record.preparation_result as Record<string, unknown>).request_digest).toBe(record.preparation_request_digest);
      }
      Object.values(record).forEach(visit);
    };
    for (const name of ['owner delivery modified exact manifest', 'owner delivery no change exact terminal preparation', 'owner delivery mapped zero new commits remains modified']) visit(cases.find(c => c.name === name)!.value);
  });

  it('accepts complete evidence inside the encoded byte budget', () => {
    expect(() => validate('DeliveryAcceptanceManifest', manifestWithSummary('a'.repeat(250_000)))).not.toThrow();
  });

  it('rejects multi-byte evidence that satisfies character bounds but exceeds encoded bytes', () => {
    const value = manifestWithSummary('界'.repeat(180_000));
    expect(value.outputs[0].completion.summary.length).toBeLessThan(262_144);
    expect(new TextEncoder().encode(JSON.stringify(value)).length).toBeGreaterThan(MAX_DELIVERY_BYTES);
    expect(() => validate('DeliveryAcceptanceManifest', value)).toThrow('encoded wire byte limit');
  });

  it('rejects malformed Unicode rather than hashing a replacement value', () => {
    expect(() => validate('DeliveryAcceptanceManifest', manifestWithSummary('\ud800'))).toThrow('well-formed Unicode');
  });

  it('rejects required output membership beyond the existing Plan cap', () => {
    const value = structuredClone(original);
    value.outputs = [structuredClone(value.outputs[0]), ...Array.from({ length: 256 }, () => structuredClone(value.outputs[0]))];
    expect(() => validate('DeliveryAcceptanceManifest', value)).toThrow('must NOT have more than 256 items');
  });
});
