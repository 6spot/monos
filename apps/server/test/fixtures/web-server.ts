import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { database } from '../../../../packages/db/src/index.ts';
import { migrate } from '../../../../packages/db/src/migrate.ts';
import { bootstrapOwner } from '../../src/owner-access.ts';
import { createApp } from '../../src/app.ts';
import { BoundaryService } from '../../src/service.ts';
import { prepareProposalFixture, reviseSpecificationFixture } from './task-preview-fixture.ts';
import { validate } from '../../../../packages/protocol/src/index.ts';
import type { FastifyRequest } from 'fastify';

// Test-only process: never use an existing schema or deployed Owner credentials.
const connection = process.env.MONOS_TEST_WEB_DATABASE_URL;
if (!connection) throw new Error('MONOS_TEST_WEB_DATABASE_URL is required for isolated browser tests');
const namespace = `web_test_${randomUUID().replaceAll('-', '')}`;
const admin = database(connection);
await admin.pool.query(`CREATE SCHEMA ${namespace}`);
const url = new URL(connection); url.searchParams.set('options', `-c search_path=${namespace} -c statement_timeout=10000`);
const db = database(url.toString());
const service = new BoundaryService(db, { signingKey: 'synthetic-browser-test-service-signing-key' });
const app = createApp(service, undefined, fileURLToPath(new URL('../../../web/dist', import.meta.url)));
function fixtureOwner(request: FastifyRequest): string {
  if (request.headers.origin !== 'http://127.0.0.1:18555') throw new Error('Test fixture requires same origin');
  return (request.headers.cookie ?? '').split(';').map((value) => value.trim()).find((value) => value.startsWith('__Host-monos='))?.slice('__Host-monos='.length) ?? '';
}
// These routes exist only in this isolated browser fixture, never createApp/main.
app.post<{ Body: { todo_id: string; title: string; specification: string; content?: string } }>('/__test__/discussion-proposal', async (request) => {
  validate('TaskPreview', { title: request.body.title, specification: request.body.specification });
  const prepared = await prepareProposalFixture(db, service, fixtureOwner(request), request.body.todo_id, request.body.content);
  return prepared.commit(request.body.title, request.body.specification);
});
app.post<{ Body: { task_id: string; specification: unknown } }>('/__test__/task-specification', async (request) => reviseSpecificationFixture(db, fixtureOwner(request), request.body.task_id, request.body.specification));
let closing = false;
async function close() {
  if (closing) return; closing = true;
  try { await app.close(); } finally {
    try { await db.pool.end(); } finally {
      try { await admin.pool.query(`DROP SCHEMA ${namespace} CASCADE`); } finally { await admin.pool.end(); }
    }
  }
}
for (const signal of ['SIGTERM', 'SIGINT'] as const) process.on(signal, () => { void close(); });

try {
  await migrate(db);
  await bootstrapOwner(db, 'monos-browser-test-password');
  await app.listen({ host: '127.0.0.1', port: 18555 });
  process.stdout.write('Isolated browser test server ready on port 18555.\n');
} catch {
  await close();
  throw new Error('Isolated browser test server failed to start');
}
