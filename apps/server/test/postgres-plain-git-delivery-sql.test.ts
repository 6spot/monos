import { randomUUID } from 'node:crypto';
import { afterEach, describe, expect, it } from 'vitest';
import { transaction } from '../../../packages/db/src/index.ts';
import { multiRepositoryDeliveryFixture } from './fixtures/multi-repository-delivery-fixture.ts';
import { readPublicationRef } from '../src/remote-preparation-ref-read.ts';
import type { RetainedRefRead } from '../src/remote-preparation-ref-read.ts';
import { publicationDigest as hash } from '../src/publication-policy.ts';

describe.skipIf(process.env.MONOS_TEST_DATABASE !== '1')('Plain Git delivery SQL authority', { timeout: 60000 }, () => {
  let x: Awaited<ReturnType<typeof multiRepositoryDeliveryFixture>>;
  afterEach(async () => { await x?.close(); });
  async function accepted() {
    x = await multiRepositoryDeliveryFixture('after_acceptance', [0, 1]);
    const result = await x.accept(); await x.prepareRemote();
    return result.operation_id!;
  }
  async function facts(batchId: string, index = 0) {
    await x.due();
    const member = (await x.db.pool.query('SELECT * FROM owner_delivery_batch_items WHERE batch_id=$1 AND resource_id=$2', [batchId, x.resources[index]])).rows[0];
    const item = (await x.db.pool.query('SELECT * FROM remote_preparation_items WHERE item_id=$1', [member.item_id])).rows[0];
    const batch = (await x.db.pool.query('SELECT content_digest FROM owner_delivery_batches WHERE id=$1', [batchId])).rows[0];
    const ref_read = await readPublicationRef(x.db, x.service.instanceId, x.refReads, item.item_id);
    return { kind: 'git_branch', batch_id: batchId, content_digest: batch.content_digest as string, item_id: item.item_id as string,
      repository_digest: member.repository_digest as string, ref_read, published_proof: item.last_published_proof, published_proof_digest: item.last_published_digest as string };
  }
  async function insertFinal(value: Awaited<ReturnType<typeof facts>>, finalCommit = value.published_proof.candidate.head) {
    return transaction(x.db, async tx => {
      const id = randomUUID(); const fact = { schema_version: 1, kind: 'git_branch', batch_id: value.batch_id, item_id: value.item_id,
        observation_id: id, accepted_head: value.published_proof.candidate.head, final_commit: finalCommit, evidence: value };
      await tx.query("INSERT INTO owner_delivery_observations(id,batch_id,item_id,kind,observation,digest) VALUES($1,$2,$3,'final',$4,$5)", [id, value.batch_id, value.item_id, fact, hash(fact)]);
      await tx.query("INSERT INTO owner_delivery_finalizations(batch_id,item_id,kind,observation_id,operation_id,final_commit,fact,digest) VALUES($1,$2,'git_branch',$3,NULL,$4,$5,$6)", [value.batch_id, value.item_id, id, finalCommit, fact, hash(fact)]);
    });
  }
  async function retainChangedRead(original: RetainedRefRead, change: (read: RetainedRefRead) => void) {
    const read = structuredClone(original); read.observation_id = randomUUID(); change(read);
    await x.db.pool.query("INSERT INTO remote_preparation_observations(id,item_id,task_id,operation_id,kind,observation,digest) VALUES($1,$2,$3,$4,'ref',$5,$6)",
      [read.observation_id, read.request.push.item_id, read.request.push.task_id, read.request.push.operation_id, read, hash(read)]);
    return read;
  }

  it('rejects generic permission observations without a genuine matching configuration receipt', async () => {
    await accepted();
    const original = (await x.db.pool.query("SELECT * FROM publication_permission_observations WHERE proof->>'kind'='git_https_configuration' LIMIT 1")).rows[0];
    for (const altered of [{ configuration_request_id: randomUUID() }, { remote_url: 'https://foreign.example.test/repo.git' }, { username: 'another-account' }]) {
      const proof = { ...original.proof, ...altered, observation_id: randomUUID() };
      await expect(x.db.pool.query(`INSERT INTO publication_permission_observations(id,resource_id,repository_identity,repository_id,configuration_fingerprint,permission_fingerprint,proof,proof_digest,observed_at,expires_at)
        VALUES($1,$2,$3,NULL,$4,$5,$6,$7,$8,$9)`, [proof.observation_id, proof.resource_id, proof.repository_identity, proof.configuration_fingerprint, proof.permission_fingerprint, proof, hash(proof), proof.observed_at, proof.expires_at])).rejects.toMatchObject({ code: '23514' });
    }
    expect((await x.db.pool.query('SELECT count(*) FROM owner_delivery_finalizations')).rows[0].count).toBe('0');
  });

  it('requires all member certificates and stable resource finalization order', async () => {
    const batchId = await accepted();
    const first = await facts(batchId);
    expect((await x.db.pool.query('SELECT plain_git_delivery_evidence_valid($1,$2,$3) AS valid', [batchId, first.item_id, first])).rows[0].valid).toBe(true);
    await expect(insertFinal(first)).rejects.toMatchObject({ code: '23514', message: 'Every accepted repository requires validation before plain finalization' });
    await x.barrier(batchId);
    await expect(insertFinal(await facts(batchId, 1))).rejects.toMatchObject({ code: '23514', message: 'Delivery finalizations must follow stable resource order' });
    expect((await x.db.pool.query('SELECT count(*) FROM owner_delivery_finalizations')).rows[0].count).toBe('0');
  });

  it('rejects GitHub metadata and PR mutations for a plain repository', async () => {
    await accepted();
    const original = (await x.db.pool.query("SELECT * FROM remote_preparation_operations WHERE kind='push' LIMIT 1")).rows[0];
    for (const kind of ['push', 'create_pr']) {
      const id = randomUUID(); const request = { ...original.request, operation_id: id, provider_metadata: { github: { repository_id: '42' } } };
      await expect(x.db.pool.query(`INSERT INTO remote_preparation_operations(id,item_id,task_id,resource_id,runner_id,kind,request,request_digest,active)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,false)`, [id, original.item_id, original.task_id, original.resource_id, original.runner_id, kind, request, hash(request)])).rejects.toMatchObject({ code: '23514' });
    }
    await expect(x.db.pool.query("UPDATE remote_preparation_items SET delivery_kind='github_pr',repository_id='42',marker='<!-- monos-delivery-item:'||item_id||' -->' WHERE item_id=$1", [original.item_id])).rejects.toMatchObject({ code: '23514' });
  });

  it('requires a distinct final read and rejects wrong head, stale time and cross-item observations', async () => {
    const batchId = await accepted(); await x.barrier(batchId);
    const first = await facts(batchId);
    const certificate = (await x.db.pool.query(`SELECT o.observation FROM owner_delivery_item_validations v JOIN owner_delivery_observations o ON o.id=v.observation_id WHERE v.batch_id=$1 AND v.item_id=$2`, [batchId, first.item_id])).rows[0].observation;
    await expect(insertFinal({ ...first, ref_read: certificate.ref_read })).rejects.toMatchObject({ code: '23514' });
    await expect(insertFinal(first, 'f'.repeat(40))).rejects.toMatchObject({ code: '23514' });
    const wrong = await retainChangedRead(first.ref_read, read => {
      read.response.observation.head = 'f'.repeat(40); read.response.observation_digest = hash(read.response.observation);
    });
    await expect(insertFinal({ ...first, ref_read: wrong })).rejects.toMatchObject({ code: '23514' });
    const stale = await retainChangedRead(first.ref_read, read => {
      read.issued_at = new Date(Date.now() - 61_000).toISOString(); read.received_at = new Date(Date.now() - 60_000).toISOString();
    });
    await expect(insertFinal({ ...first, ref_read: stale })).rejects.toMatchObject({ code: '23514' });
    await expect(insertFinal({ ...first, ref_read: (await facts(batchId, 1)).ref_read })).rejects.toMatchObject({ code: '23514' });
    await insertFinal(first);
    const final = (await x.db.pool.query('SELECT * FROM owner_delivery_finalizations WHERE batch_id=$1', [batchId])).rows[0];
    expect(final).toMatchObject({ kind: 'git_branch', operation_id: null, item_id: first.item_id, final_commit: first.published_proof.candidate.head });
    expect((await x.db.pool.query('SELECT count(*) FROM owner_delivery_merge_operations')).rows[0].count).toBe('0');
  });

  it('blocks new finality after credential clear or Cancel while retaining original published evidence', async () => {
    const batchId = await accepted(); await x.barrier(batchId); const first = await facts(batchId);
    const before = (await x.db.pool.query('SELECT last_published_digest FROM remote_preparation_items WHERE item_id=$1', [first.item_id])).rows[0];
    await x.configuration.save(x.token, { schema_version: 1, request_id: randomUUID(), name: 'clear_git_https_credential', payload: { resource_id: x.resources[0] }, expected_control_version: (await x.configuration.read(x.token)).control_version });
    await expect(insertFinal(first)).rejects.toMatchObject({ code: '23514', message: 'Accepted repository authorization is no longer current' });
    await x.control(batchId, 'cancel_delivery');
    await expect(insertFinal(first)).rejects.toMatchObject({ code: '23514', message: 'Plain Git finalization requires current uncancelled Owner acceptance' });
    expect((await x.db.pool.query('SELECT last_published_digest FROM remote_preparation_items WHERE item_id=$1', [first.item_id])).rows[0]).toEqual(before);
    expect((await x.db.pool.query('SELECT count(*) FROM owner_delivery_finalizations')).rows[0].count).toBe('0');
  });
});
