import { TaskSpecification } from './task-specification.ts';
import { TaskConversation } from './task-conversation.ts';
import { readFile } from 'node:fs/promises';
import { database } from '../../../packages/db/src/index.ts';
import { migrate } from '../../../packages/db/src/migrate.ts';
import { createApp } from './app.ts';
import { BoundaryService } from './service.ts';
import { NodeExecution } from './node-execution.ts';
import { TaskPlanning } from './task-planning.ts';
import { Discussion } from './discussion.ts';
import { fileURLToPath } from 'node:url';

const required = (name: string): string => { const value = process.env[name]; if (!value) throw new Error(`${name} is required`); return value; };
const databaseURL = process.env.MONOS_DATABASE_URL_FILE ? (await readFile(process.env.MONOS_DATABASE_URL_FILE, 'utf8')).trim() : required('DATABASE_URL');
const db = database(databaseURL);
await migrate(db);
const signingKey = (await readFile(required('MONOS_SIGNING_KEY_FILE'), 'utf8')).trim();
const service = new BoundaryService(db, { signingKey });
const specifications=new TaskSpecification(db);
const execution = new NodeExecution(db, service.instanceId);
const planning = new TaskPlanning(db, service.instanceId);
const discussion = new Discussion(db, service.instanceId);
const app = createApp(service, {
  key: await readFile(required('MONOS_TLS_KEY_FILE')),
  cert: await readFile(required('MONOS_TLS_CERT_FILE')),
}, fileURLToPath(new URL('../../web/dist', import.meta.url)));
let scheduling: Promise<void> | undefined;
let discussionTimer: ReturnType<typeof setInterval> | undefined = undefined;
const conversation = new TaskConversation(db,service.instanceId);
const pump = () => scheduling ??= Promise.allSettled([discussion.pump(), planning.pump(), execution.pump(), conversation.pump(), specifications.pump()]).then((results) => { if (results.some((result) => result.status === 'rejected')) app.log.warn('Scheduling pass failed; durable input retained'); }).finally(() => { scheduling = undefined; });
app.addHook('onClose', async () => { clearInterval(discussionTimer); await scheduling; });
await app.listen({ host: process.env.MONOS_LISTEN_HOST ?? '127.0.0.1', port: Number(process.env.MONOS_PORT ?? 18443) });
discussionTimer = setInterval(() => { void pump(); }, 1000); discussionTimer.unref();
void pump();
for (const signal of ['SIGINT', 'SIGTERM'] as const) process.on(signal, () => { void app.close().then(() => db.pool.end()); });
