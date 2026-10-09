import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { copyFileSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

test('default preparation needs no OpenSSL and creates only private credentials', () => {
  const directory = mkdtempSync(join(tmpdir(), 'monos-probe-http-'));
  try {
    const script = join(directory, 'prepare.mjs');
    copyFileSync(new URL('./prepare.mjs', import.meta.url), script);
    const options = { env: { ...process.env, PATH: directory }, encoding: 'utf8' };
    execFileSync(process.execPath, [script], options);
    const privateDirectory = join(directory, 'private');
    assert.equal(statSync(privateDirectory).mode & 0o777, 0o700);
    assert.deepEqual(readdirSync(privateDirectory).sort(), ['database_url', 'db_password', 'runner_credential', 'signing_key']);
    const before = new Map(readdirSync(privateDirectory).map(name => [name, readFileSync(join(privateDirectory, name))]));
    for (const name of before.keys()) assert.equal(statSync(join(privateDirectory, name)).mode & 0o777, 0o600);
    for (const args of [[], ['--tls']]) {
      const repeated = spawnSync(process.execPath, [script, ...args], options);
      assert.ifError(repeated.error);
      assert.notEqual(repeated.status, 0);
      assert.match(repeated.stderr, /Private directory already exists; preserving it/);
      assert.deepEqual(readdirSync(privateDirectory), [...before.keys()]);
      for (const [name, bytes] of before) assert.deepEqual(readFileSync(join(privateDirectory, name)), bytes);
    }
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('probe certificates satisfy strict TLS verification and preparation preserves existing state', () => {
  const directory = mkdtempSync(join(tmpdir(), 'monos-probe-tls-'));
  try {
    const script = join(directory, 'prepare.mjs');
    copyFileSync(new URL('./prepare.mjs', import.meta.url), script);
    execFileSync(process.execPath, [script, '--tls'], { stdio: 'pipe' });
    const privateDirectory = join(directory, 'private');
    const verify = ['verify', '-x509_strict', '-purpose', 'sslserver', '-CAfile', 'ca.crt'];
    for (const identity of [['-verify_ip', '127.0.0.1'], ['-verify_hostname', 'localhost']]) {
      execFileSync('openssl', [...verify, ...identity, 'server.crt'], { cwd: privateDirectory, stdio: 'pipe' });
    }
    const wrongHost = spawnSync('openssl', [...verify, '-verify_hostname', 'unrelated.example', 'server.crt'], { cwd: privateDirectory });
    assert.ifError(wrongHost.error);
    assert.notEqual(wrongHost.status, 0, 'the certificate must remain localhost-only');
    assert.equal(statSync(privateDirectory).mode & 0o777, 0o700);
    for (const name of ['ca.key', 'server.key', 'db_password', 'database_url', 'signing_key', 'runner_credential']) {
      assert.equal(statSync(join(privateDirectory, name)).mode & 0o777, 0o600);
    }
    const before = new Map(readdirSync(privateDirectory).map(name => [name, readFileSync(join(privateDirectory, name))]));
    const repeated = spawnSync(process.execPath, [script], { encoding: 'utf8' });
    assert.ifError(repeated.error);
    assert.notEqual(repeated.status, 0);
    assert.match(repeated.stderr, /Private directory already exists; preserving it/);
    assert.deepEqual(readdirSync(privateDirectory), [...before.keys()]);
    for (const [name, bytes] of before) assert.deepEqual(readFileSync(join(privateDirectory, name)), bytes);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
