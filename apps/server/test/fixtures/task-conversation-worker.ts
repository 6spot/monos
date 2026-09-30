import { database } from '../../../../packages/db/src/index.ts';
import { TaskConversation } from '../../src/task-conversation.ts';
const db = database(process.env.DATABASE_URL!);
const pid = (await db.pool.query('SELECT pg_backend_pid() pid')).rows[0].pid;
process.send!({ type: 'ready', pid });
process.once(
  'message',
  async (input: { mode: 'submit' | 'pump'; token: string; body: unknown; instance: string }) => {
    try {
      const service = new TaskConversation(db, input.instance);
      if (input.mode === 'submit') await service.command(input.token, input.body);
      else await service.pump();
      process.send!({ type: 'done', pid });
    } catch (e) {
      process.send!({
        type: 'error',
        code:
          (e as { detail?: { code: string }; code?: string }).detail?.code ??
          (e as { code?: string }).code ??
          'error',
      });
    } finally {
      await db.pool.end();
      process.disconnect();
    }
  },
);
