import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { serverTLS } from '../src/transport-config.ts';

describe('optional backend TLS configuration', () => {
  let directory: string;
  let env: NodeJS.ProcessEnv;
  beforeAll(async () => {
    directory = await mkdtemp(join(tmpdir(), 'monos-transport-test-'));
    env = { MONOS_TLS_KEY_FILE: join(directory, 'key.pem'), MONOS_TLS_CERT_FILE: join(directory, 'cert.pem') };
    execFileSync('/usr/bin/openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-subj', '/CN=127.0.0.1', '-days', '1', '-keyout', env.MONOS_TLS_KEY_FILE!, '-out', env.MONOS_TLS_CERT_FILE!], { stdio: 'ignore' });
    execFileSync('/usr/bin/openssl', ['genrsa', '-out', join(directory, 'other-key.pem'), '2048'], { stdio: 'ignore' });
  });
  afterAll(async () => { if (directory) await rm(directory, { recursive: true, force: true }); });

  it('uses HTTP when both TLS paths are absent and validates a configured HTTPS pair', async () => {
    expect(await serverTLS({})).toBeUndefined();
    const tls = await serverTLS(env);
    expect(tls!.cert).toEqual(await readFile(env.MONOS_TLS_CERT_FILE!));
    expect(tls!.key).toEqual(await readFile(env.MONOS_TLS_KEY_FILE!));
  });

  it('rejects partial, empty, unreadable, malformed and mismatched pairs', async () => {
    for (const partial of [{ MONOS_TLS_KEY_FILE: env.MONOS_TLS_KEY_FILE }, { MONOS_TLS_CERT_FILE: env.MONOS_TLS_CERT_FILE }, { MONOS_TLS_KEY_FILE: '', MONOS_TLS_CERT_FILE: '' }]) {
      await expect(serverTLS(partial)).rejects.toThrow('must both be configured');
    }
    await writeFile(join(directory, 'invalid.pem'), 'synthetic invalid TLS file');
    for (const key of ['missing.pem', 'invalid.pem', 'other-key.pem']) {
      await expect(serverTLS({ ...env, MONOS_TLS_KEY_FILE: join(directory, key) })).rejects.toThrow('must be readable and form a valid pair');
    }
  });

  it('rejects invalid TLS before reading database configuration or running migrations', () => {
    const childEnv: NodeJS.ProcessEnv = { ...process.env, MONOS_TLS_KEY_FILE: env.MONOS_TLS_KEY_FILE, MONOS_DATABASE_URL_FILE: join(directory, 'database-must-not-be-read') };
    delete childEnv.MONOS_TLS_CERT_FILE;
    const child = spawnSync(process.execPath, ['--experimental-strip-types', fileURLToPath(new URL('../src/main.ts', import.meta.url))], { env: childEnv, encoding: 'utf8', timeout: 10000 });
    expect(child.status).not.toBe(0);
    expect(child.stderr).toContain('must both be configured');
    expect(child.stderr).not.toContain('database-must-not-be-read');
  });
});
