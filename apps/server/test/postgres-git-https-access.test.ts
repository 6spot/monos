import { randomUUID } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ConfigurationCommand, Operation, ProjectConfiguration } from '../../../packages/protocol/src/index.ts';
import { Configuration } from '../src/configuration.ts';
import { GitHub } from '../src/github.ts';
import { conversationFixture } from './fixtures/task-conversation-fixture.ts';

type Mode = 'workspace' | 'inspection';
type Fixture = Awaited<ReturnType<typeof conversationFixture>>;
const fault = (code: string) => ({ detail: { code } });

describe.skipIf(process.env.MONOS_TEST_DATABASE !== '1')('plain Git repository access through the service boundary', { timeout: 20000 }, () => {
  const fixtures: Fixture[] = [];
  afterEach(async () => { for (const x of fixtures.splice(0)) await x.close(); vi.restoreAllMocks(); }, 20000);

  async function fixture(mode: Mode) {
    const x = await conversationFixture(); fixtures.push(x);
    const github = new GitHub(x.service.options.signingKey);
    x.service.options.github = github;
    const provider = vi.spyOn(github, 'repositoryAccess').mockRejectedValue(new Error('Plain Git must not contact GitHub'));
    const configuration = new Configuration(x.db, github, x.service.gitHTTPS);
    async function save(name: ConfigurationCommand['name'], payload: ConfigurationCommand['payload']) {
      return configuration.save(x.token, { schema_version: 1, request_id: randomUUID(),
        expected_control_version: (await configuration.read(x.token)).control_version, name, payload });
    }
    const project: ProjectConfiguration = { id: x.f.project, name: 'Plain Git access', context: '', archived: false, role_ids: [x.f.role],
      resources: [0, 1].map(index => ({ id: randomUUID(), remote_url: `https://GIT.example.test:8443/Exact/Repo-${index}.git`,
        default_branch: 'main', default_ref: 'refs/tags/baseline', remote_preparation: 'after_acceptance' })) };
    await save('save_project', project);
    // Another Project may use the exact same endpoint with an independent credential.
    const foreign = { ...project, id: randomUUID(), resources: [{ ...project.resources[0]!, id: randomUUID() }] };
    await save('save_project', foreign);
    await x.db.pool.query(`INSERT INTO github_configuration(singleton,app_id,installation_id,encrypted_key,key_fingerprint)
      VALUES(true,'1','2','deliberately-unreadable-app-ciphertext',$1)`, ['a'.repeat(64)]);
    let agent: Awaited<ReturnType<Fixture['promote']>>;
    if (mode === 'workspace') { await x.start(); agent = await x.node(); }
    else { await x.owner('start_task', { specification_id: x.f.spec }); await x.planning.pump(); agent = await x.promote(); }
    async function admit(resource: string) {
      const response = await x.agent(agent, mode === 'workspace' ? 'open_workspace' : 'inspect_repository', { resource_id: resource });
      return x.service.recoverOperation(x.f.runner, response.operation_id!);
    }
    const operations = [await admit(project.resources[0]!.id), await admit(project.resources[1]!.id)] as const;
    function access(op: Operation, options: { operationId?: string; digest?: string; runner?: string; incarnation?: number } = {}) {
      const body = { schema_version: 1, incarnation: options.incarnation ?? x.f.incarnation };
      return mode === 'workspace'
        ? x.service.repositoryAccess(options.runner ?? x.f.runner, options.operationId ?? op.operation_id,
          { ...body, workspace_digest: options.digest ?? op.workspace_digest })
        : x.service.inspectionRepositoryAccess(options.runner ?? x.f.runner, options.operationId ?? op.operation_id,
          { ...body, inspection_digest: options.digest ?? op.inspection_digest });
    }
    return { ...x, mode, save, project, foreign, operations, access, provider };
  }

  for (const mode of ['workspace', 'inspection'] as const) {
    it(`${mode}: isolates resource credentials and returns only the exact admitted URL and digest`, async () => {
      const x = await fixture(mode), [first, second] = x.operations;
      const primary = x.project.resources[0]!, secondary = x.project.resources[1]!;
      await x.save('save_git_https_credential', { resource_id: x.foreign.resources[0]!.id, username: 'foreign-user', token: 'foreign-project-secret' });
      await x.save('save_git_https_credential', { resource_id: secondary.id, username: 'second-user', token: 'second-resource-secret' });
      expect(await x.access(first)).toMatchObject({ operation_id: first.operation_id, remote_url: primary.remote_url,
        provider_metadata: {}, default_branch: 'main', authentication: { kind: 'anonymous' } });
      expect((await x.access(second)).authentication).toMatchObject({ kind: 'https_basic', username: 'second-user', token: 'second-resource-secret' });
      await x.save('save_git_https_credential', { resource_id: primary.id, username: 'first-user', token: 'first-resource-secret' });
      const before = Date.now(), result = await x.access(first), after = Date.now();
      expect(result).toMatchObject({ schema_version: 1, operation_id: first.operation_id, remote_url: primary.remote_url,
        provider_metadata: {}, default_branch: 'main', authentication: { kind: 'https_basic', username: 'first-user', token: 'first-resource-secret' },
        ...(mode === 'workspace' ? { workspace_digest: first.workspace_digest } : { inspection_digest: first.inspection_digest }) });
      expect(Date.parse(result.authentication.expires_at!)).toBeGreaterThanOrEqual(before + 300_000);
      expect(Date.parse(result.authentication.expires_at!)).toBeLessThanOrEqual(after + 300_000);
      const descriptor = first.workspace?.resource ?? first.inspection!.resource;
      expect(descriptor.default_ref).toBe('refs/tags/baseline');
      expect(descriptor.remote_url).toBe(primary.remote_url);
      if (mode === 'workspace') {
        await x.save('save_project', { ...x.project, resources: x.project.resources.map(r => r.id === primary.id
          ? { ...r, default_ref: 'refs/tags/later', default_branch: 'future-target' } : r) });
        expect(await x.access(first)).toMatchObject({ workspace_digest: first.workspace_digest, remote_url: primary.remote_url, default_branch: 'main' });
      }
      await expect(x.access(first, { digest: second.workspace_digest ?? second.inspection_digest })).rejects.toMatchObject(fault('denied_scope'));
      await expect(x.access(first, { operationId: randomUUID() })).rejects.toMatchObject(fault('denied_scope'));
      await expect(x.access(first, { runner: randomUUID() })).rejects.toMatchObject(fault('denied_scope'));
      await expect(x.access(first, { incarnation: x.f.incarnation + 1 })).rejects.toMatchObject(fault('stale_execution'));
      const persisted = (await x.db.pool.query(`SELECT to_jsonb(o) operation,to_jsonb(r) receipt FROM operations o
        JOIN command_receipts r ON r.operation_id=o.id WHERE o.id=ANY($1::text[])`, [x.operations.map(op => op.operation_id)])).rows;
      for (const secret of ['first-resource-secret', 'second-resource-secret', 'foreign-project-secret']) expect(JSON.stringify(persisted)).not.toContain(secret);
      expect(x.provider).not.toHaveBeenCalled();
    });

    it(`${mode}: denies damaged credentials and settled operations without anonymous fallback`, async () => {
      const x = await fixture(mode), op = x.operations[0]!, resource_id = x.project.resources[0]!.id;
      await x.save('save_git_https_credential', { resource_id, username: 'service-user', token: 'ephemeral-access-secret' });
      expect((await x.access(op)).authentication.kind).toBe('https_basic');
      await x.db.pool.query(`UPDATE git_https_credentials SET encrypted_token=
        (CASE left(encrypted_token,1) WHEN 'A' THEN 'B' ELSE 'A' END)||substr(encrypted_token,2) WHERE resource_id=$1`, [resource_id]);
      await expect(x.access(op)).rejects.toMatchObject(fault('unmet_precondition'));
      await x.save('clear_git_https_credential', { resource_id });
      expect((await x.access(op)).authentication).toEqual({ kind: 'anonymous' });
      if (mode === 'workspace') {
        const w = op.workspace!;
        await x.service.finishOperation(x.f.runner, x.f.incarnation, { operation_id: op.operation_id, attempt_id: op.attempt_id, success: true,
          result: { workspace_id: w.workspace_id, path: `/runner/workspaces/${w.workspace_id}`, instruction_files: [], workspace_metadata: {
            generation: w.generation, lease_id: w.lease_id, storage_id: `storage-${resource_id}`, repository_identity: w.resource.repository_identity,
            provider_metadata: {}, base_commit: 'a'.repeat(40), target_branch: 'main', target_commit: 'b'.repeat(40), finalized_commit: 'a'.repeat(40) } } });
      } else {
        await x.service.finishOperation(x.f.runner, x.f.incarnation, { operation_id: op.operation_id, attempt_id: op.attempt_id, success: true,
          result: { inspection: { inspection_id: op.operation_id, descriptor_digest: op.inspection_digest!, status: 'unavailable', reason: 'source_stale' } } });
      }
      await expect(x.access(op)).rejects.toMatchObject(fault('denied_scope'));
      expect(x.provider).not.toHaveBeenCalled();
    });
  }

  it('inspection: denies a changed default-ref basis and a removed resource while preserving the admitted operation', async () => {
    const x = await fixture('inspection'), op = x.operations[0]!, resource = x.project.resources[0]!;
    await x.save('save_git_https_credential', { resource_id: resource.id, username: 'inspection-user', token: 'inspection-secret' });
    expect((await x.access(op)).authentication.kind).toBe('https_basic');
    await x.save('save_project', { ...x.project, resources: x.project.resources.map(r => r.id === resource.id ? { ...r, default_ref: 'refs/tags/later' } : r) });
    await expect(x.access(op)).rejects.toMatchObject(fault('stale_execution'));
    await x.save('save_project', { ...x.project, resources: x.project.resources.filter(r => r.id !== resource.id) });
    await expect(x.access(op)).rejects.toMatchObject(fault('denied_scope'));
    expect((await x.service.recoverOperation(x.f.runner, op.operation_id)).state).toBe('admitted');
    expect(x.provider).not.toHaveBeenCalled();
  });
});
