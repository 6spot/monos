import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { MAX_DELIVERY_BYTES, validate } from '../src/validation.ts';
import type { DeliveryAcceptanceManifest } from '../generated/types.ts';

const cases = JSON.parse(readFileSync(new URL('../fixtures/validation.json', import.meta.url), 'utf8')) as { name: string; value: unknown }[];
const original = cases.find(value => value.name === 'owner delivery repository free complete manifest')!.value as DeliveryAcceptanceManifest;

function manifestWithSummary(summary: string): DeliveryAcceptanceManifest {
  const manifest = structuredClone(original);
  manifest.outputs[0].completion.summary = summary;
  return manifest;
}

describe('complete Owner delivery evidence bounds', () => {
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
