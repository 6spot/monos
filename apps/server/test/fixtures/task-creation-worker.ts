import { database } from '../../../../packages/db/src/index.ts';
import type { TaskPreviewCommand } from '../../../../packages/protocol/src/index.ts';
import { issueOwnerSession } from '../../src/owner-commands.ts';
import { TaskPreviews } from '../../src/task-previews.ts';

const db = database(process.env.DATABASE_URL!);
process.send!({ type: 'ready' });
process.once('message', async (input: { command: TaskPreviewCommand; crash: 'before' | 'after' }) => {
  try {
    const die = () => { process.kill(process.pid, 'SIGKILL'); };
    const service = new TaskPreviews(db, input.crash === 'before' ? { beforeCommit: die } : { afterCommit: die });
    await service.command((await issueOwnerSession(db)).token, input.command);
    process.send!({ type: 'unexpected-survival' });
  } catch {
    process.send!({ type: 'worker-error' }); process.exitCode = 1;
    await db.pool.end(); process.disconnect();
  }
});
