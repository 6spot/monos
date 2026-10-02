import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
import { transaction } from '../../../packages/db/src/index.ts';
import type { Database } from '../../../packages/db/src/index.ts';
import { CommandError } from '../../../packages/domain/src/commands.ts';
import { digest } from '../../../packages/protocol/src/index.ts';
import { authenticateOwner, issueOwnerSessionInTransaction } from './owner-commands.ts';

function passwordInput(value: string) {
  if (typeof value !== 'string' || /[\uD800-\uDFFF]/u.test(value) || [...value].length < 12 || Buffer.byteLength(value) > 1024) throw new CommandError('invalid_input', 'Password must have at least 12 characters and at most 1024 bytes');
}
function derive(password: string, salt: string): Promise<Buffer> {
  return new Promise((resolve, reject) => scrypt(password, Buffer.from(salt, 'hex'), 64, { N: 32768, r: 8, p: 1, maxmem: 64 * 1024 * 1024 }, (error, key) => error ? reject(error) : resolve(key)));
}

// Local administrative entrypoint only. Rotation is explicit and atomically
// invalidates existing browser/automation sessions; there is no public signup.
export async function bootstrapOwner(db: Database, password: string, rotate = false): Promise<void> {
  passwordInput(password);
  const salt = randomBytes(32).toString('hex'); const hash = (await derive(password, salt)).toString('hex');
  await transaction(db, async (tx) => {
    await tx.query('SELECT pg_advisory_xact_lock(1296843075)');
    const prior = await tx.query('SELECT singleton FROM owner_access FOR UPDATE');
    if (prior.rowCount && !rotate) throw new CommandError('unmet_precondition', 'Owner access already initialized; use explicit rotation');
    await tx.query('INSERT INTO owner_access(singleton,password_salt,password_hash) VALUES(true,$1,$2) ON CONFLICT(singleton) DO UPDATE SET password_salt=$1,password_hash=$2,failures=0,window_started=now()', [salt, hash]);
    if (prior.rowCount) await tx.query('UPDATE owner_sessions SET revoked=true WHERE NOT revoked');
  });
}

export class OwnerAccess {
  readonly db: Database;
  constructor(db: Database) { this.db = db; }

  async login(password: string) {
    passwordInput(password);
    const outcome = await transaction(this.db, async (tx) => {
      const row = (await tx.query<{ password_salt: string; password_hash: string; failures: number; expired: boolean }>("SELECT password_salt,password_hash,failures,(window_started<=clock_timestamp()-interval '1 minute') AS expired FROM owner_access FOR UPDATE")).rows[0];
      if (!row) return { status: 'unauthorized' as const };
      if (row.expired) await tx.query('UPDATE owner_access SET failures=0,window_started=clock_timestamp()');
      const failures = row.expired ? 0 : row.failures;
      if (failures >= 5) return { status: 'rate_limited' as const };
      const hash = await derive(password, row.password_salt);
      if (!timingSafeEqual(hash, Buffer.from(row.password_hash, 'hex'))) {
        await tx.query('UPDATE owner_access SET failures=failures+1');
        return { status: 'unauthorized' as const };
      }
      await tx.query('UPDATE owner_access SET failures=0,window_started=clock_timestamp()');
      return { status: 'authenticated' as const, session: await issueOwnerSessionInTransaction(tx) };
    });
    if (outcome.status !== 'authenticated') throw new CommandError(outcome.status, outcome.status === 'rate_limited' ? 'Too many sign-in attempts; retry after one minute' : 'Invalid Owner credentials');
    return outcome.session;
  }

  async session(token: string) {
    return transaction(this.db, async (tx) => {
      await authenticateOwner(tx, token);
      const row = (await tx.query<{ id: string; expires_at: Date }>('SELECT id,expires_at FROM owner_sessions WHERE token_digest=$1', [digest(token)])).rows[0]!;
      return { schema_version: 1 as const, authenticated: true, session_id: row.id, expires_at: row.expires_at.toISOString() };
    });
  }

  async logout(token: string): Promise<void> {
    if (!/^owner\.v1\.[0-9a-f]{64}$/.test(token)) throw new CommandError('unauthorized', 'Owner session required');
    await this.db.pool.query('UPDATE owner_sessions SET revoked=true WHERE token_digest=$1', [digest(token)]);
  }
}
