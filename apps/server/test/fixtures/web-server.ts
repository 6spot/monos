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
import { ExecutionUIFixture } from './execution-ui-fixture.ts';
import { GitHub } from '../../src/github.ts';
import { GitHubRemote } from '../../src/github-remote.ts';
import { RemotePreparation } from '../../src/remote-preparation.ts';

// Test-only process: never use an existing schema or deployed Owner credentials.
const connection = process.env.MONOS_TEST_WEB_DATABASE_URL;
if (!connection) throw new Error('MONOS_TEST_WEB_DATABASE_URL is required for isolated browser tests');
const namespace = `web_test_${randomUUID().replaceAll('-', '')}`;
const admin = database(connection);
await admin.pool.query(`CREATE SCHEMA ${namespace}`);
const url = new URL(connection); url.searchParams.set('options', `-c search_path=${namespace} -c statement_timeout=10000`);
const db = database(url.toString());
const service = new BoundaryService(db, { signingKey: 'synthetic-browser-test-service-signing-key' });
const executionUI = new ExecutionUIFixture(db, service);
const remoteProvider = new GitHubRemote(new GitHub('synthetic-browser-test-service-signing-key'), { acquireGrant: executionUI.remoteGrant, fetcher: executionUI.remoteFetch });
const remote = new RemotePreparation(db, service.instanceId, remoteProvider);
const app = createApp(service, undefined, fileURLToPath(new URL('../../../web/dist', import.meta.url)), { remoteProvider });
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
app.post<{ Body: Parameters<ExecutionUIFixture['create']>[1] }>('/__test__/execution-scenario', async (request) => executionUI.create(fixtureOwner(request), request.body));
app.post<{ Body: Parameters<ExecutionUIFixture['createPublication']>[1] }>('/__test__/publication-scenario', async request => executionUI.createPublication(fixtureOwner(request), request.body));
app.post<{ Body: Parameters<ExecutionUIFixture['createRemote']>[1] }>('/__test__/remote-scenario', async request => executionUI.createRemote(fixtureOwner(request), request.body));
app.post<{ Body: { task_id: string; action: Parameters<ExecutionUIFixture['remotePeer']>[2]; mode?: Parameters<ExecutionUIFixture['remotePeer']>[3] } }>('/__test__/remote-peer', async request => executionUI.remotePeer(fixtureOwner(request), request.body.task_id, request.body.action, request.body.mode));
app.post<{ Body: { task_id: string; action: Parameters<ExecutionUIFixture['publicationPeer']>[2]; mode?: Parameters<ExecutionUIFixture['publicationPeer']>[3] } }>('/__test__/publication-peer', async request => executionUI.publicationPeer(fixtureOwner(request), request.body.task_id, request.body.action, request.body.mode));
app.post<{ Body: { task_id: string } }>('/__test__/execution-settle', async (request) => executionUI.settle(fixtureOwner(request), request.body.task_id));
app.post('/__test__/execution-reset', async (request) => executionUI.reset(fixtureOwner(request)));
app.post<{ Body: { task_id: string; action: Parameters<ExecutionUIFixture['readPeer']>[2]; status?: Parameters<ExecutionUIFixture['readPeer']>[3] } }>('/__test__/result-peer', async request => executionUI.readPeer(fixtureOwner(request), request.body.task_id, request.body.action, request.body.status));
let closing = false;
let remotePump: Promise<void> | undefined;
let remoteTimer: NodeJS.Timeout | undefined;
async function close() {
  if (closing) return; closing = true;
  clearInterval(remoteTimer);
  await remotePump;
  try { await executionUI.closeReadPeers(); await app.close(); } finally {
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
  remoteTimer = setInterval(() => {
    if (closing || remotePump) return;
    remotePump = remote.pump().catch(error => {
      // Error type/code and frame locations only: no PG row, SQL parameters,
      // provider body, credential value or raw exception message is logged.
      const code = error && typeof error === 'object' && 'code' in error && typeof error.code === 'string' && /^[A-Za-z0-9_]+$/.test(error.code) ? error.code : 'unknown';
      const frames = error instanceof Error ? error.stack?.split('\n').slice(1).join('\n') : undefined;
      process.stderr.write(`Synthetic remote fixture pump failed (${error instanceof Error ? error.name : 'unknown'}, ${code}).\n${frames ?? ''}\n`);
    }).finally(() => { remotePump = undefined; });
  }, 250);
  process.stdout.write('Isolated browser test server ready on port 18555.\n');
} catch {
  await close();
  throw new Error('Isolated browser test server failed to start');
}
