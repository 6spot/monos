import { statfs } from 'node:fs/promises';
import { isAbsolute } from 'node:path';
import type { Database } from '../../../packages/db/src/index.ts';
import { validate } from '../../../packages/protocol/src/index.ts';
import type { StorageHealth } from '../../../packages/protocol/src/index.ts';

export interface DatabaseStorageConfig { path: string; minimum: number }

export function databaseStorageConfig(env: NodeJS.ProcessEnv): DatabaseStorageConfig | undefined {
  const path = env.MONOS_DATABASE_STORAGE_PATH;
  if (path === undefined) {
    if (env.MONOS_STORAGE_MIN_FREE_BYTES !== undefined) throw new Error('Database storage path is required for its threshold');
    return undefined;
  }
  const minimum = Number(env.MONOS_STORAGE_MIN_FREE_BYTES ?? 1073741824);
  if (!isAbsolute(path) || !Number.isSafeInteger(minimum) || minimum < 1)
    throw new Error('Invalid database storage observation configuration');
  return { path, minimum };
}

export async function observeDatabaseStorage(config: DatabaseStorageConfig): Promise<StorageHealth> {
  const unknown: StorageHealth = { scope: 'database', status: 'unknown', min_free_bytes: config.minimum };
  try {
    const stats = await statfs(config.path, { bigint: true });
    const total = stats.blocks * stats.bsize, available = stats.bavail * stats.bsize;
    if (total <= 0n || available < 0n || available > total || total > BigInt(Number.MAX_SAFE_INTEGER)) return unknown;
    return validate('StorageHealth', { ...unknown, status: available < BigInt(config.minimum) ? 'low' : 'ok',
      free_bytes: Number(available), total_bytes: Number(total) });
  } catch { return unknown; }
}

// This path is an explicitly mounted database filesystem. It is never inferred
// from a Runner path, and only statfs is used; database files are not opened.
export async function recordDatabaseStorage(db: Database, instanceId: string, config: DatabaseStorageConfig): Promise<void> {
  const observation = await observeDatabaseStorage(config);
  await db.pool.query(`INSERT INTO backend_storage_observations(instance_id,observation) VALUES($1,$2)
    ON CONFLICT(instance_id) DO UPDATE SET observation=EXCLUDED.observation,observed_at=clock_timestamp()`, [instanceId, observation]);
}
