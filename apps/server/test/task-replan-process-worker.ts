import { database } from '../../../packages/db/src/index.ts';
import { validate, submission } from '../../../packages/protocol/src/index.ts';
import { BoundaryService } from '../src/service.ts';
import type { CommandEnvelope } from '../../../packages/protocol/src/index.ts';
import { TaskReplan } from '../src/task-replan.ts';
const db = database(process.env.DATABASE_URL!);
const pid = (await db.pool.query('SELECT pg_backend_pid() pid')).rows[0].pid;
process.send!({ type: 'ready', pid });
process.once('message', async (input: { token: string; body: unknown; crash?: 'before' | 'after'; phase?: 'agent' | 'owner'; instance?: string }) => {
  try {
    validate(input.phase === 'agent' ? 'CommandEnvelope' : 'TaskReplanCommand', input.body);
    const die = () => { process.kill(process.pid, 'SIGKILL'); };
    const service = new TaskReplan(db, {
      ...(input.phase === 'owner' && input.crash === 'before' ? { beforeCommit: die } : {}),
      ...(input.phase === 'owner' && input.crash === 'after' ? { afterCommit: die } : {}),
      ...(input.crash === 'before' ? { beforePublicationCommit: die } : {}),
      ...(input.crash === 'after' ? { afterPublicationCommit: die } : {}),
    });
    const boundary = new BoundaryService(db, { signingKey: 'conversation-fixture-signing-key',
      ...(input.crash === 'before' ? { beforeAdmissionCommit: die } : {}),
      ...(input.crash === 'after' ? { afterAdmissionCommit: die } : {}) });
    Object.defineProperty(boundary, 'instanceId', { value: input.instance });
    const result = input.phase === 'agent' ? await boundary.admit(input.token, submission(input.body as CommandEnvelope)) : await service.command(input.token, input.body);
    process.send!({ type: input.crash ? 'unexpected-survival' : 'done', pid, result });
  } catch (error) {
    const e = error as { code?: string; detail?: { code?: string } };
    process.send!({ type: 'error', code: e.detail?.code ?? e.code ?? 'worker_error' });
  } finally { await db.pool.end(); process.disconnect(); }
});
