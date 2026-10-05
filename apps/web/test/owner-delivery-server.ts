import { createServer } from 'node:http';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import { ownerDeliveryFixture } from '../../server/test/fixtures/owner-delivery-fixture.ts';
import { ownerDeliveryHooks } from '../../server/src/owner-delivery-control.ts';
import { createApp } from '../../server/src/app.ts';
import { transaction } from '../../../packages/db/src/index.ts';
import { initializeTask } from '../../server/src/task-records.ts';

// Test-only loopback process. Genuine fixture schema, real protected Owner commands;
// progress controls below change only synthetic mutable scheduling projections.
if (!process.env.MONOS_TEST_WEB_DATABASE_URL) throw new Error('Isolated browser database is required');
process.env.DATABASE_URL = process.env.MONOS_TEST_WEB_DATABASE_URL;
let current: { fixture: Awaited<ReturnType<typeof ownerDeliveryFixture>>; app: ReturnType<typeof createApp>; heartbeat: NodeJS.Timeout; second: string; schema: string } | undefined;
let closing = false;
let closedSchemas = 0;
const ownedScopes: string[] = [], closedScopes: string[] = [];
async function recordCleanup() {
  if (process.env.MONOS_TEST_WEB_CLEANUP_PROOF) await writeFile(process.env.MONOS_TEST_WEB_CLEANUP_PROOF, JSON.stringify({ ownedScopes, closedScopes, closing })+'\n');
}
const origin = 'http://127.0.0.1:18556';
async function dispose() {
  const old = current; current = undefined;
  if (!old) return;
  clearInterval(old.heartbeat);
  try { await old.app.close(); } finally { await old.fixture.close(); closedSchemas++; closedScopes.push(old.schema); await recordCleanup(); }
}
const server = createServer((request, response) => { void (async () => {
  if (request.url === '/health') { response.writeHead(200, { 'Content-Type': 'application/json' }); response.end('{"test_fixture":"ready"}'); return; }
  const chunks: Buffer[] = []; let size = 0;
  for await (const chunk of request) { size += chunk.length; if (size > 2 * 1024 * 1024) throw new Error('Test body too large'); chunks.push(chunk); }
  const payload = Buffer.concat(chunks);
  if (request.url?.startsWith('/__test__/')) {
    if (request.method !== 'POST' || request.headers.origin !== origin) { response.writeHead(403); response.end(); return; }
    const body = payload.length ? JSON.parse(payload.toString('utf8')) as Record<string, unknown> : {};
    if (request.url === '/__test__/owner-delivery-scenario') {
      await dispose();
      if (!['repository_free','modified','no_change'].includes(String(body.mode))) throw new Error('Unknown synthetic mode');
      const fixture = await ownerDeliveryFixture(body.mode as 'repository_free'|'modified'|'no_change', ownerDeliveryHooks);
      const schema = new URL(fixture.databaseUrl).searchParams.get('options')?.match(/search_path=(conversation_[a-z0-9]+)/)?.[1];
      if (!schema) { await fixture.close(); throw new Error('Exact fixture schema is missing'); }
      ownedScopes.push(schema);
      const second = randomUUID();
      await transaction(fixture.db, tx => initializeTask(tx, { task_id: second, specification_id: randomUUID(), project_id: fixture.f.project, specification: 'Independent test-only Task for source fencing' }));
      const app = createApp(fixture.service, undefined, fileURLToPath(new URL('../dist', import.meta.url)));
      await app.ready();
      const heartbeat = setInterval(() => { void fixture.service.touch(fixture.f.runner, fixture.f.incarnation, true).catch(() => {}); }, 1000);
      current = { fixture, app, heartbeat, second, schema };
      response.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'Set-Cookie': `__Host-monos=${fixture.token}; Path=/; HttpOnly; SameSite=Strict; Secure` });
      response.end(JSON.stringify({ task: fixture.f.task, second, schema })); return;
    }
    if (!current) throw new Error('Scenario is not initialized');
    if (request.url === '/__test__/owner-delivery-progress') {
      if (!['waiting','failed','reconciling'].includes(String(body.status))) throw new Error('Unknown synthetic progress');
      await current.fixture.db.pool.query('UPDATE owner_delivery_batches SET status=$2,attention_reason=$3,version=version+1 WHERE task_id=$1 AND status NOT IN (\'completed\',\'cancelled\')',[current.fixture.f.task,body.status,body.status==='failed'?'synthetic_provider_unavailable':body.status==='reconciling'?'synthetic_unknown_effect':'synthetic_checks_pending']);
      response.writeHead(200, { 'Content-Type': 'application/json' }); response.end('{"synthetic_progress":true}'); return;
    }
    if (request.url === '/__test__/owner-delivery-observe') {
      const x = current.fixture;
      const batch = (await x.db.pool.query('SELECT id,content_digest,input_cutoff,status FROM owner_delivery_batches WHERE task_id=$1',[x.f.task])).rows;
      const input = (await x.db.pool.query('SELECT m.sequence,i.accepted_delivery_operation_id FROM task_inputs i JOIN task_messages m ON m.id=i.message_id WHERE i.task_id=$1 ORDER BY m.sequence',[x.f.task])).rows;
      const receipts = (await x.db.pool.query('SELECT request_id,envelope,response FROM owner_delivery_command_receipts WHERE task_id=$1 ORDER BY request_id',[x.f.task])).rows;
      response.writeHead(200, { 'Content-Type': 'application/json' }); response.end(JSON.stringify({ batch,input,receipts,provider_calls:0 })); return;
    }
    response.writeHead(404); response.end(); return;
  }
  if (!current) { response.writeHead(503); response.end('Initialize the isolated scenario'); return; }
  if (!['GET','POST'].includes(request.method ?? '')) { response.writeHead(405); response.end(); return; }
  const result = await current.app.inject({ method: request.method as 'GET'|'POST', url: request.url ?? '/', headers: request.headers, ...(payload.length ? { payload } : {}) });
  response.writeHead(result.statusCode, result.headers); response.end(result.rawPayload);
})().catch(() => { if (!response.headersSent) response.writeHead(500); response.end('Isolated fixture request failed'); }); });
server.listen(18556, '127.0.0.1', () => { process.stdout.write('Isolated Owner delivery browser fixture ready on port 18556.\n'); });
async function close() {
  if (closing) return; closing = true;
  await new Promise<void>(resolve => server.close(() => resolve()));
  await dispose();
  process.stdout.write(`Closed ${closedSchemas} exact owned browser schemas.\n`);
}
for (const signal of ['SIGTERM','SIGINT']) process.on(signal, () => { void close(); });
