import { database } from '../../../../packages/db/src/index.ts';
import { TaskSpecification } from '../../src/task-specification.ts';
import { validate } from '../../../../packages/protocol/src/index.ts';

type Crash = 'before' | 'after' | 'before-publication' | 'after-publication';
const db = database(process.env.DATABASE_URL!);
// All work below is sequential, using the same one connection in this child.
const pid = (await db.pool.query('SELECT pg_backend_pid() pid')).rows[0].pid;
process.send!({ type: 'ready', pid });
process.once('message', async (input: { mode: 'command' | 'pump'; token?: string; body?: unknown; crash?: Crash }) => {
  try {
    if (input.mode === 'command') validate('TaskSpecificationCommand', input.body);
    // The only SIGKILL path is the selected production transaction hook.
    // Do not schedule this asynchronously: before-commit must die before COMMIT.
    const die = () => { process.kill(process.pid, 'SIGKILL'); };
    const service = new TaskSpecification(db, {
      ...(input.crash === 'before' ? { beforeCommit: die } : {}),
      ...(input.crash === 'after' ? { afterCommit: die } : {}),
      ...(input.crash === 'before-publication' ? { beforePublicationCommit: die } : {}),
      ...(input.crash === 'after-publication' ? { afterPublicationCommit: die } : {}),
    });
    const result = input.mode === 'command' ? await service.command(input.token!, input.body) : await service.pump();
    process.send!({ type: input.crash ? 'unexpected-survival' : 'done', pid, result });
  } catch (error) {
    const value = error as { code?: string; detail?: { code?: string } };
    process.send!({ type: 'error', code: value.detail?.code ?? value.code ?? 'worker_error' });
    process.exitCode = 1;
  } finally {
    await db.pool.end();
    process.disconnect();
  }
});
