import assert from 'node:assert/strict';
import {mkdtemp, readFile, rm, stat} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {NativeProviderKernel, fixture} from './native-provider-kernel.ts';

const directory = await mkdtemp(join(tmpdir(), 'monos-native-provider-scope-'));
const syntheticMemoryOnlyToken = 'memory-only-invalid-synthetic-authentication';
// TS private is not a product capability. This fixture bypasses keychain lookup
// solely to exercise pre-effect scope/persistence guards without any real token.
const kernel = Reflect.construct(NativeProviderKernel, [directory, syntheticMemoryOnlyToken]);
const originalFetch = globalThis.fetch;
let networkCalls = 0;
globalThis.fetch = async () => {networkCalls++; throw new Error('Scope fixture forbids network');};
try {
  const scope = {resource_id: 'synthetic-resource', repository_identity: fixture.identity,
    repository_id: fixture.id, remote_url: fixture.url, workflow_changes: false};
  kernel.requireScope(scope);
  for (const changed of [
    {...scope, repository_id: '42'},
    {...scope, repository_identity: 'github.com/6spot/product'},
    {...scope, remote_url: 'https://github.com/6spot/product.git'},
    {...scope, remote_url: fixture.url + '/extra'},
    {...scope, workflow_changes: true},
  ]) assert.throws(() => kernel.requireScope(changed), /Exact synthetic fixture scope/);
  await assert.rejects(kernel.saveExclusive('../outside.json', {}), /Invalid evidence basename/);
  await assert.rejects(kernel.saveExclusive('secret.json', {value: syntheticMemoryOnlyToken}), /Unsafe or oversized/);
  await assert.rejects(kernel.saveExclusive('large.json', {value: 'x'.repeat(512 * 1024)}), /Unsafe or oversized/);
  await kernel.saveExclusive('intent.json', {scope: 'synthetic-only', intent: 'original'});
  const original = await readFile(join(directory, 'intent.json'));
  assert.equal((await stat(join(directory, 'intent.json'))).mode & 0o777, 0o600);
  await assert.rejects(kernel.saveExclusive('intent.json', {scope: 'synthetic-only', intent: 'replacement'}), {code: 'EEXIST'});
  assert.deepEqual(await readFile(join(directory, 'intent.json')), original);
  assert.throws(() => kernel.verifyPush({intent: {repository: fixture.name,
    repository_id: '42'}}), /Push scope differs from fixture/);
  assert.equal(networkCalls, 0);
  process.stdout.write('PASS: exact fixture scope, token/bounds/path refusal, immutable intent, wrong push scope; zero network calls\n');
} finally {
  globalThis.fetch = originalFetch;
  await rm(directory, {recursive: true});
}
