import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { database, transaction } from '../../../packages/db/src/index.ts';
import type { Database } from '../../../packages/db/src/index.ts';
import { migrate } from '../../../packages/db/src/migrate.ts';
import type { ConfigurationCommand, ProjectConfiguration } from '../../../packages/protocol/src/index.ts';
import { Configuration } from '../src/configuration.ts';
import { GitHTTPSCredentials, gitHTTPSCredentialScope, verifyGitHTTPSCredentialReceipt } from '../src/git-https-credentials.ts';
import { lockConfiguration } from '../src/configuration-guards.ts';
import { issueOwnerSession } from '../src/owner-commands.ts';

const fault = (code: string) => ({ detail: { code } });
const signingKey = 'synthetic-https-git-signing-key-for-tests';

describe.skipIf(process.env.MONOS_TEST_DATABASE !== '1')('resource-scoped HTTPS Git credentials', () => {
  let db: Database; let admin: Database; let ownerToken: string; let configuration: Configuration;
  const credentials = new GitHTTPSCredentials(signingKey);
  const namespace = `git_https_${randomUUID().replaceAll('-', '')}`;
  beforeAll(async () => {
    if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL required');
    admin = database(process.env.DATABASE_URL); await admin.pool.query(`CREATE SCHEMA ${namespace}`);
    const url = new URL(process.env.DATABASE_URL); url.searchParams.set('options', `-c search_path=${namespace} -c statement_timeout=10000`);
    db = database(url.toString()); await migrate(db);
    ownerToken = (await issueOwnerSession(db)).token; configuration = new Configuration(db, undefined, credentials);
  });
  afterAll(async () => { if (db) await db.pool.end(); if (admin) { await admin.pool.query(`DROP SCHEMA ${namespace} CASCADE`); await admin.pool.end(); } });
  async function command(name: ConfigurationCommand['name'], payload: ConfigurationCommand['payload']): Promise<ConfigurationCommand> {
    return { schema_version: 1, request_id: randomUUID(), expected_control_version: (await configuration.read(ownerToken)).control_version, name, payload };
  }
  async function save(name: ConfigurationCommand['name'], payload: ConfigurationCommand['payload']) { return configuration.save(ownerToken, await command(name, payload)); }
  async function project(remote = `https://git.example.test:8443/Group/Repo-${randomUUID()}.git`): Promise<ProjectConfiguration> {
    const value: ProjectConfiguration = { id: randomUUID(), name: 'HTTPS repository', context: '', archived: false, role_ids: [],
      resources: [{ id: randomUUID(), remote_url: remote, default_branch: 'main', remote_preparation: 'automatic' }] };
    await save('save_project', value); return value;
  }
  async function access(resourceId: string, scope?: string, storage = credentials) {
    return transaction(db, async (tx) => { await lockConfiguration(tx); return storage.authentication(tx, resourceId, scope); });
  }
  async function current(resourceId: string) {
    return transaction(db, async (tx) => { await lockConfiguration(tx); return gitHTTPSCredentialScope(tx, resourceId); });
  }
  async function verify(scope: NonNullable<Awaited<ReturnType<typeof current>>>) {
    return transaction(db, async (tx) => { await lockConfiguration(tx); return verifyGitHTTPSCredentialReceipt(tx, scope); });
  }

  it('returns an empty safe status and allows anonymous reads independently of the global GitHub App', async () => {
    expect((await configuration.read(ownerToken)).git_https_credentials).toEqual([]);
    const p = await project(); const id = p.resources[0]!.id;
    expect(await access(id)).toEqual({ kind: 'anonymous' });
    await db.pool.query(`INSERT INTO github_configuration(singleton,app_id,installation_id,encrypted_key,key_fingerprint)
      VALUES(true,'1','2','deliberately-unreadable-app-ciphertext',$1)`, ['a'.repeat(64)]);
    expect(await access(id)).toEqual({ kind: 'anonymous' });
    await db.pool.query('DELETE FROM github_configuration');
    await expect(access(id, 'a'.repeat(64))).rejects.toMatchObject(fault('unmet_precondition'));
  });

  it('persists only ciphertext and safe receipt/status while returning bounded local-use authentication', async () => {
    const p = await project(); const resource_id = p.resources[0]!.id; const token = 'synthetic-private-https-token';
    const result = await save('save_git_https_credential', { resource_id, username: 'service-user', token });
    expect(result.credential_change).toMatchObject({ action: 'saved', resource_id, username: 'service-user' });
    const scope = (await current(resource_id))!;
    expect(scope.remote_url).toBe(p.resources[0]!.remote_url);
    expect(scope.configuration_request_id).toBe(result.request_id);
    expect(await verify(scope)).toBe(true);
    const stored = (await db.pool.query('SELECT * FROM git_https_credentials WHERE resource_id=$1', [resource_id])).rows[0];
    const receipt = (await db.pool.query('SELECT * FROM configuration_receipts WHERE request_id=$1', [result.request_id])).rows[0];
    const snapshot = await configuration.read(ownerToken);
    expect(snapshot.git_https_credentials.find((entry) => entry.resource_id === resource_id)).toEqual({ resource_id, username: scope.username, generation: scope.generation, scope_digest: scope.scope_digest });
    for (const record of [stored, receipt, snapshot]) expect(JSON.stringify(record)).not.toContain(token);
    expect(JSON.stringify(receipt)).not.toContain(stored.encrypted_token);
    const authentication = await access(resource_id, scope.scope_digest);
    expect(authentication).toMatchObject({ kind: 'https_basic', username: 'service-user', token });
    expect(Date.parse(authentication.expires_at!) - Date.now()).toBeGreaterThan(290_000);
    expect(Date.parse(authentication.expires_at!) - Date.now()).toBeLessThanOrEqual(300_000);
    await expect(access(resource_id, undefined, new GitHTTPSCredentials('different-synthetic-service-signing-key'))).rejects.toMatchObject(fault('unmet_precondition'));
  });

  it('keeps historical same-scope authority during token rotation and never reinstalls a replayed old token', async () => {
    const resource_id = (await project()).resources[0]!.id;
    const oldCommand = await command('save_git_https_credential', { resource_id, username: 'same-user', token: 'old-material' });
    const first = await configuration.save(ownerToken, oldCommand); const oldScope = (await current(resource_id))!;
    await save('save_git_https_credential', { resource_id, username: 'same-user', token: 'renewed-material' });
    const renewed = (await current(resource_id))!;
    expect(renewed.scope_digest).toBe(oldScope.scope_digest); expect(renewed.generation).not.toBe(oldScope.generation);
    expect(await verify(oldScope)).toBe(true);
    expect(await configuration.save(ownerToken, oldCommand)).toEqual(first);
    expect(await access(resource_id, oldScope.scope_digest)).toMatchObject({ token: 'renewed-material' });
    await expect(configuration.save(ownerToken, { ...oldCommand, payload: { ...oldCommand.payload, token: 'changed-same-request' } })).rejects.toMatchObject(fault('payload_conflict'));
    await expect(configuration.save(ownerToken, { ...oldCommand, request_id: randomUUID() })).rejects.toMatchObject(fault('version_conflict'));
    expect(await verify({ ...oldScope, configuration_request_id: randomUUID() })).toBe(false);
    await save('save_git_https_credential', { resource_id, username: 'different-user', token: 'different-material' });
    expect(await verify(oldScope)).toBe(false);
    await expect(access(resource_id, oldScope.scope_digest)).rejects.toMatchObject(fault('unmet_precondition'));
    const changed = (await current(resource_id))!;
    const cleared = await save('clear_git_https_credential', { resource_id });
    expect(cleared.credential_change).toEqual({ action: 'cleared', resource_id });
    expect(await verify(changed)).toBe(false); expect(await access(resource_id)).toEqual({ kind: 'anonymous' });
    await expect(access(resource_id, changed.scope_digest)).rejects.toMatchObject(fault('unmet_precondition'));
    expect(await configuration.status(ownerToken, oldCommand.request_id)).toEqual(first);
  });

  it('rejects ciphertext transplanted across resources, generations and usernames without anonymous fallback', async () => {
    const firstId = (await project()).resources[0]!.id; const secondId = (await project()).resources[0]!.id;
    await save('save_git_https_credential', { resource_id: firstId, username: 'account', token: 'first-secret' });
    await save('save_git_https_credential', { resource_id: secondId, username: 'account', token: 'second-secret' });
    const oldCiphertext = (await db.pool.query('SELECT encrypted_token FROM git_https_credentials WHERE resource_id=$1', [firstId])).rows[0].encrypted_token;
    await db.pool.query('UPDATE git_https_credentials SET encrypted_token=$2 WHERE resource_id=$1', [secondId, oldCiphertext]);
    await expect(access(secondId)).rejects.toMatchObject(fault('unmet_precondition'));
    await save('save_git_https_credential', { resource_id: firstId, username: 'account', token: 'rotated-secret' });
    await db.pool.query('UPDATE git_https_credentials SET encrypted_token=$2 WHERE resource_id=$1', [firstId, oldCiphertext]);
    await expect(access(firstId)).rejects.toMatchObject(fault('unmet_precondition'));
    await save('save_git_https_credential', { resource_id: firstId, username: 'changed-account', token: 'new-account-secret' });
    await db.pool.query('UPDATE git_https_credentials SET encrypted_token=$2 WHERE resource_id=$1', [firstId, oldCiphertext]);
    await expect(access(firstId)).rejects.toMatchObject(fault('unmet_precondition'));
  });

  it('requires exact genuine safe receipt and immutable resource bindings in PostgreSQL', async () => {
    const p = await project(); const resource_id = p.resources[0]!.id;
    const projectCommand = await command('save_project', p); await configuration.save(ownerToken, projectCommand);
    await save('save_git_https_credential', { resource_id, username: 'account', token: 'credential-material' });
    const scope = (await current(resource_id))!;
    await expect(db.pool.query('UPDATE git_https_credentials SET configuration_request_id=$2 WHERE resource_id=$1', [resource_id, projectCommand.request_id])).rejects.toMatchObject({ code: '23514' });
    await expect(db.pool.query('UPDATE git_https_credentials SET generation=$2 WHERE resource_id=$1', [resource_id, randomUUID()])).rejects.toMatchObject({ code: '23514' });
    await expect(db.pool.query('UPDATE git_https_credentials SET remote_url=$2 WHERE resource_id=$1', [resource_id, 'https://foreign.test/repo'])).rejects.toMatchObject({ code: '23514' });
    await expect(db.pool.query('UPDATE configuration_receipts SET response=response WHERE request_id=$1', [scope.configuration_request_id])).rejects.toMatchObject({ code: '23514' });
    expect(await current(resource_id)).toEqual(scope);
    await save('save_project', { ...p, resources: [] });
    await expect(access(resource_id)).rejects.toMatchObject(fault('denied_scope'));
    await expect(save('save_git_https_credential', { resource_id, username: 'account', token: 'changed' })).rejects.toMatchObject(fault('denied_scope'));
    expect((await configuration.read(ownerToken)).git_https_credentials.some((entry) => entry.resource_id === resource_id)).toBe(false);
  });

  it('validates resource and secret bounds and rolls back material, control version and receipts together', async () => {
    const p = await project(); const resource_id = p.resources[0]!.id;
    for (const payload of [{ resource_id, username: 'colon:user', token: 'token' }, { resource_id, username: 'user', token: 'line\nbreak' },
      { resource_id, username: 'user', token: '€'.repeat(1366) }]) await expect(save('save_git_https_credential', payload)).rejects.toThrow();
    const githubId = (await project('git@github.com:Owner/Repo.git')).resources[0]!.id;
    await expect(save('save_git_https_credential', { resource_id: githubId, username: 'user', token: 'token' })).rejects.toMatchObject(fault('invalid_input'));
    for (const resource of [{ ...p.resources[0]!, default_branch: undefined }, { ...p.resources[0]!, merge_method: 'merge' as const }]) {
      await expect(save('save_project', { ...p, resources: [resource] })).rejects.toThrow();
    }
    const before = await configuration.read(ownerToken);
    const c = await command('save_git_https_credential', { resource_id, username: 'user', token: 'not-committed' });
    await db.pool.query(`CREATE FUNCTION fail_git_https_receipt() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'test receipt failure'; END; $$`);
    await db.pool.query('CREATE TRIGGER fail_git_https_receipt BEFORE INSERT ON configuration_receipts FOR EACH ROW EXECUTE FUNCTION fail_git_https_receipt()');
    try {
      await expect(configuration.save(ownerToken, c)).rejects.toThrow('test receipt failure');
      expect(await configuration.read(ownerToken)).toEqual(before);
      expect(await current(resource_id)).toBeUndefined();
      expect((await configuration.status(ownerToken, c.request_id)).status).toBe('unknown');
    } finally { await db.pool.query('DROP TRIGGER fail_git_https_receipt ON configuration_receipts'); await db.pool.query('DROP FUNCTION fail_git_https_receipt()'); }
  });
});
