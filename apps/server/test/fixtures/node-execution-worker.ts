import { database } from '../../../../packages/db/src/index.ts';
import { NodeExecution } from '../../src/node-execution.ts';

const db = database(process.env.DATABASE_URL!);
const pid = Number((await db.pool.query('SELECT pg_backend_pid() AS pid')).rows[0].pid);
process.send!({ type: 'ready', pid });
process.once('message', async (input: { instance: string }) => {
  try {
    await new NodeExecution(db, input.instance).pump();
    process.send!({ type: 'done' });
  } catch (error) {
    process.send!({ type: 'failed', code: (error as { code?: string }).code ?? 'worker_error' });
  } finally {
    await db.pool.end();
    process.disconnect();
  }
});
