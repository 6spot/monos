import { database } from '../../../../packages/db/src/index.ts';
import { submission } from '../../../../packages/protocol/src/index.ts';
import type { CommandEnvelope, OwnerCommand } from '../../../../packages/protocol/src/index.ts';
import { BoundaryService } from '../../src/service.ts';
import { OwnerCommands } from '../../src/owner-commands.ts';

const db = database(process.env.DATABASE_URL!);
process.send!({ type: 'ready', pid: Number((await db.pool.query('SELECT pg_backend_pid() pid')).rows[0].pid) });
process.once(
  'message',
  async (input: {
    instance: string;
    key: string;
    token: string;
    command: CommandEnvelope | OwnerCommand;
    owner: boolean;
  }) => {
    try {
      const service = new BoundaryService(db, { signingKey: input.key });
      Object.defineProperty(service, 'instanceId', { value: input.instance });
      if (input.owner) await new OwnerCommands(db).confirm(input.token, input.command);
      else await service.admit(input.token, submission(input.command as CommandEnvelope));
      process.send!({ type: 'done' });
    } catch (error) {
      process.send!({
        type: 'rejected',
        code: (error as { detail?: { code: string } }).detail?.code ?? 'unexpected_error',
      });
    } finally {
      await db.pool.end();
      process.disconnect();
    }
  }
);
