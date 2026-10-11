import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
import { database, transaction } from './index.ts';
import type { Database } from './index.ts';

export async function migrate(db: Database): Promise<void> {
  const sources = await Promise.all(['0001_boundary_probe.sql', '0002_connection_instance.sql', '0003_capture_failure.sql', '0004_owner_commands.sql', '0005_task_records.sql', '0006_dispatch_queue.sql', '0007_owner_access.sql', '0008_project_configuration.sql', '0009_runtime_provider_configuration.sql', '0010_runtime_selection.sql', '0011_attempt_logs.sql', '0012_owner_recovery.sql', '0013_todos.sql', '0014_todo_discussion.sql', '0015_task_creation.sql', '0016_serial_workspaces.sql', '0017_task_initial_planning.sql', '0018_node_execution.sql', '0019_task_conversation.sql', '0020_task_specification.sql', '0021_task_replan.sql', '0022_publication_candidates.sql', '0023_remote_preparation.sql', '0024_owner_delivery.sql', '0025_review_correction.sql', '0026_runtime_continuations.sql', '0027_node_rework.sql', '0028_repository_inspection.sql', '0029_multi_node_replan.sql', '0030_parallel_workspaces.sql', '0031_multi_repository_completion.sql', '0032_multi_repository_delivery.sql', '0033_git_https_credentials.sql', '0034_plain_git_delivery.sql', '0035_runner_enrollment.sql'].map(async (name, index) => {
    const sql = await readFile(new URL(`../migrations/${name}`, import.meta.url), 'utf8');
    return { version: index + 1, sql, checksum: createHash('sha256').update(sql).digest('hex') };
  }));
  await transaction(db, async (tx) => {
    await tx.query('SELECT pg_advisory_xact_lock(1296843074)');
    await tx.query('CREATE TABLE IF NOT EXISTS schema_migrations (version integer PRIMARY KEY, checksum text NOT NULL)');
    const versions = await tx.query<{ version: number; checksum: string }>('SELECT * FROM schema_migrations ORDER BY version');
    if (versions.rows.some((row, index) => row.version !== index + 1 || row.checksum !== sources[index]?.checksum)) throw new Error('Incompatible or modified migration; reconciliation required');
    for (const source of sources.slice(versions.rows.length)) {
      await tx.query(source.sql);
      await tx.query('INSERT INTO schema_migrations(version,checksum) VALUES ($1,$2)', [source.version, source.checksum]);
    }
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required');
  const db = database(process.env.DATABASE_URL);
  try { await migrate(db); process.stdout.write('Database migration version 35 is ready.\n'); } finally { await db.pool.end(); }
}
