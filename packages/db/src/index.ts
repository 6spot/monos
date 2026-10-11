import pg from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import type { PoolClient } from 'pg';
import { and, eq } from 'drizzle-orm';
import { runners } from './schema.ts';

export function database(url: string) {
  const pool = new pg.Pool({ connectionString: url, max: 8, application_name: 'monos-boundary-probe' });
  return { pool, orm: drizzle(pool) };
}

export type Database = ReturnType<typeof database>;
export type Transaction = PoolClient;

export async function runnerForCredential(db: Database, hash: string): Promise<string | undefined> {
  const rows = await db.orm.select({ id: runners.id }).from(runners).where(and(eq(runners.credentialHash, hash), eq(runners.credentialRevoked, false))).limit(1);
  return rows[0]?.id;
}

export async function transaction<T>(db: Database, action: (tx: Transaction) => Promise<T>): Promise<T> {
  const tx = await db.pool.connect();
  try {
    await tx.query('BEGIN');
    const result = await action(tx);
    await tx.query('COMMIT');
    return result;
  } catch (error) {
    await tx.query('ROLLBACK');
    throw error;
  } finally {
    tx.release();
  }
}
