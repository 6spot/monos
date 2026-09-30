import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { transaction } from '../../../packages/db/src/index.ts';
import type { SpecificationImpact } from '../../../packages/protocol/src/index.ts';
import { canonicalJSON, digest } from '../../../packages/protocol/src/index.ts';
import { TaskSpecification } from '../src/task-specification.ts';
import { specificationImpact } from '../src/task-specification-state.ts';
import { conversationFixture } from './fixtures/task-conversation-fixture.ts';

describe.skipIf(process.env.MONOS_TEST_DATABASE !== '1')('Specification independent authority review', { timeout: 30000 }, () => {
  let x: Awaited<ReturnType<typeof conversationFixture>>;
  let specification: TaskSpecification;
  beforeEach(async () => { x = await conversationFixture(); specification = new TaskSpecification(x.db); }, 30000);
  afterEach(async () => { await x?.close(); }, 30000);
  const command = (name: string, payload: object) => specification.command(x.token, {
    schema_version: 1, request_id: randomUUID(), task_id: x.f.task, name, payload,
  });
  const impact = () => transaction(x.db, async tx => specificationImpact(tx,
    (await tx.query('SELECT * FROM tasks WHERE id=$1', [x.f.task])).rows[0]));
  async function proposal() {
    const input = await x.send('Prepare a complete requirement proposal.');
    const turn = await x.turn(), basis = await x.basis(), id = randomUUID();
    const prepared = await x.agent(turn, 'prepare_specification_revision', {
      proposal_id: id, specification: '# Exact requirements\nPreserve existing work.',
      summary: 'Clarify the complete result.', basis, impact: await impact(), source_input_ids: [input.input_id!],
    });
    const reply = await x.reply(turn, { kind: 'specification_proposal', proposal_id: id, basis });
    await x.finish(reply.operation_id!, turn.dispatch.attempt_id);
    return { id, input, prepared };
  }
  async function edit(assessment?: SpecificationImpact) {
    return command('edit_specification', { proposal_id: randomUUID(), specification: 'Complete changed requirements',
      summary: 'Exact edit', basis: await x.basis(), impact: assessment ?? await impact(), source_input_ids: [] });
  }

  it('rejects duplicate guidance identities disguised as different dispositions', async () => {
    for (const text of ['Preserve private files', 'Verify local result']) {
      await x.send(text);
      const turn = await x.turn();
      const reply = await x.reply(turn, { kind: 'guidance', text, basis: await x.basis() });
      await x.finish(reply.operation_id!, turn.dispatch.attempt_id);
    }
    const assessment = await impact();
    expect(assessment.guidance).toHaveLength(2);
    const first = assessment.guidance[0]!;
    assessment.guidance = [{ ...first, disposition: 'retain' }, { ...first, disposition: 'supersede' }];
    await expect(edit(assessment)).rejects.toMatchObject({ detail: { code: 'invalid_input' } });
    expect((await x.db.pool.query('SELECT count(*) FROM requirement_publications')).rows[0].count).toBe('0');
  });

  it('rejects using an unrelated Owner message receipt as exact input-deferral authority', async () => {
    const p = await proposal();
    const later = await x.send('This later requirement has not been deferred.');
    await expect(x.db.pool.query(`INSERT INTO requirement_input_deferrals
      (task_id,proposal_id,input_id,input_version,request_id) VALUES($1,$2,$3,1,$4)`,
    [x.f.task, p.id, later.input_id, later.request_id])).rejects.toMatchObject({ code: '23514' });
    await expect(command('confirm_specification', { proposal_id: p.id, content_digest: p.prepared.result!.content_digest }))
      .rejects.toMatchObject({ detail: { code: 'unmet_precondition' } });
  });

  it('rejects rebinding an originating obligation to another obligation proposal', async () => {
    const first = await proposal(), second = await proposal();
    await expect(x.db.pool.query(`UPDATE requirement_obligations SET current_proposal_id=$2,version=version+1
      WHERE current_proposal_id=$1`, [first.id, second.id])).rejects.toMatchObject({ code: '23503' });
  });

  it('keeps the active publication slot and terminal publication inseparable from the admitted change', async () => {
    await x.start();
    await x.node();
    const admitted = await edit();
    expect((await x.db.pool.query('SELECT status FROM requirement_changes WHERE id=$1', [admitted.operation_id])).rows[0].status).toBe('settling');
    await expect(x.db.pool.query('DELETE FROM task_publication_slots WHERE operation_id=$1', [admitted.operation_id]))
      .rejects.toMatchObject({ code: '23514' });
    await expect(x.db.pool.query("UPDATE requirement_changes SET status='published',version=version+1 WHERE id=$1", [admitted.operation_id]))
      .rejects.toMatchObject({ code: '23514' });
  });

  it('carries a completion genuinely produced after same-activation refresh without rewriting its creation basis', async () => {
    await x.start();
    const original = await x.node();
    const refreshed = await edit();
    const stop = (await x.db.pool.query('SELECT operation_id FROM requirement_change_effects WHERE change_id=$1',
      [refreshed.operation_id])).rows[0];
    await x.finish(stop.operation_id, original.dispatch.attempt_id);
    await specification.pump();
    const next = await x.node();
    const completion = await x.agent(next, 'complete_node', { summary: 'Completed under the refreshed effective requirements.' });
    await x.finish(completion.operation_id!, next.dispatch.attempt_id);
    const historical = (await x.db.pool.query('SELECT * FROM node_completions')).rows[0];
    const assessment = await impact();
    assessment.nodes[0]!.disposition = 'carry';
    await edit(assessment);
    expect((await x.db.pool.query('SELECT state FROM tasks')).rows[0].state).toBe('REVIEW');
    expect((await x.db.pool.query('SELECT * FROM node_completions')).rows[0]).toEqual(historical);
    expect((await x.db.pool.query('SELECT specification_id FROM node_activations')).rows[0].specification_id).toBe(x.f.spec);
    expect((await x.db.pool.query('SELECT disposition FROM specification_node_applicability ORDER BY disposition')).rows)
      .toEqual([{ disposition: 'carry' }, { disposition: 'refresh' }]);
  });

  it('requires all exact envelope input identities to exist as immutable normalized source rows', async () => {
    const original = await proposal();
    await expect(transaction(x.db, async tx => {
      const generic = (await tx.query('SELECT * FROM task_command_proposals WHERE id=$1', [original.id])).rows[0]!;
      const id = randomUUID(), content = { ...generic.content, proposal_id: id };
      const hash = digest(canonicalJSON(content));
      await tx.query(`INSERT INTO task_command_proposals(id,task_id,action,content,content_digest,basis,expires_at)
        VALUES($1,$2,$3,$4,$5,$6,$7)`, [id, x.f.task, generic.action, content, hash, generic.basis, generic.expires_at]);
      await tx.query(`INSERT INTO requirement_proposals(id,task_id,obligation_id,predecessor_id,source_id,input_id,
        specification,summary,impact,specification_digest,impact_digest,content_digest,base_specification_id,
        base_plan_id,base_control_version,input_cutoff)
        SELECT $1,task_id,obligation_id,id,source_id,input_id,specification,summary,impact,specification_digest,
        impact_digest,$2,base_specification_id,base_plan_id,base_control_version,input_cutoff
        FROM requirement_proposals WHERE id=$3`, [id, hash, original.id]);
      // No requirement_sources rows: the JSON source list alone is not provenance.
    })).rejects.toMatchObject({ code: '23514' });
  });

  it('does not consume an exact confirmed authorization without a matching admitted operation and command', async () => {
    const p = await proposal();
    const confirmation = await command('confirm_specification', { proposal_id: p.id, content_digest: p.prepared.result!.content_digest });
    await expect(x.db.pool.query('UPDATE authorization_receipts SET consumed_by=$2 WHERE id=$1',
      [confirmation.confirmation_id, 'nonexistent-command'])).rejects.toMatchObject({ code: '23514' });
  });

  it.each(['content_digest', 'name', 'task_id'] as const)('rejects a forged Owner authorization origin missing %s', async missing => {
    const p = await proposal(), requestId = randomUUID(), authorizationId = randomUUID();
    const body: Record<string, unknown> = {
      schema_version: 1, request_id: requestId, task_id: x.f.task, name: 'confirm_specification',
      payload: { proposal_id: p.id, content_digest: p.prepared.result!.content_digest },
    };
    if (missing === 'content_digest') delete (body.payload as Record<string, unknown>).content_digest;
    else delete body[missing];
    const json = canonicalJSON(body);
    await expect(transaction(x.db, async tx => {
      await tx.query(`INSERT INTO owner_command_receipts(scope_id,request_id,digest,envelope_json,response)
        VALUES($1,$2,$3,$4,$5)`, [x.f.task, requestId, digest(json), json, {
        schema_version: 1, request_id: requestId, status: 'committed', proposal_id: p.id, confirmation_id: authorizationId,
      }]);
      await tx.query('INSERT INTO authorization_receipts(id,proposal_id) VALUES($1,$2)', [authorizationId, p.id]);
      await tx.query('INSERT INTO requirement_authorization_commands(authorization_id,task_id,request_id) VALUES($1,$2,$3)',
        [authorizationId, x.f.task, requestId]);
    })).rejects.toMatchObject({ code: '23514' });
  });
});
