import { createHash, webcrypto } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { randomUUID, sha256 } from './browser-crypto.ts';

afterEach(() => vi.unstubAllGlobals());

describe.each(['WebCrypto', 'HTTP without secure-context APIs'])('%s', mode => {
  function browserCrypto() {
    vi.stubGlobal('crypto', mode === 'WebCrypto' ? webcrypto : {
      getRandomValues: webcrypto.getRandomValues.bind(webcrypto),
    });
  }

  it.each([
    ['', 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855'],
    ['abc', 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad'],
    ['abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq', '248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1'],
  ])('matches the SHA-256 known vector for %j', async (input, digest) => {
    browserCrypto();
    await expect(sha256(input)).resolves.toBe(digest);
  });

  it('hashes exact UTF-8, padding boundaries and multiple blocks', async () => {
    browserCrypto();
    for (const input of ['中文 / café / 😀\n', ...[55, 56, 63, 64, 65, 1024].map(size => 'a'.repeat(size))]) {
      await expect(sha256(input)).resolves.toBe(createHash('sha256').update(input).digest('hex'));
    }
  });

  it('generates distinct RFC 9562 version 4 IDs using browser cryptographic randomness', () => {
    browserCrypto();
    const ids = Array.from({ length: 32 }, () => randomUUID());
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });
});

it('sets UUID version/variant bits while preserving the supplied entropy', () => {
  const getRandomValues = vi.fn((bytes: Uint8Array) => bytes.fill(255));
  vi.stubGlobal('crypto', { getRandomValues });
  expect(randomUUID()).toBe('ffffffff-ffff-4fff-bfff-ffffffffffff');
  expect(getRandomValues).toHaveBeenCalledTimes(1);
});

it('does not substitute weak randomness or hide an available WebCrypto failure', async () => {
  vi.stubGlobal('crypto', { subtle: { digest: async () => { throw new Error('Digest failed'); } } });
  expect(() => randomUUID()).toThrow();
  await expect(sha256('abc')).rejects.toThrow('Digest failed');
});
