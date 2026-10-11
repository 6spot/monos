import { readFile } from 'node:fs/promises';
import { database } from '../../../packages/db/src/index.ts';
import { migrate } from '../../../packages/db/src/migrate.ts';
import { manageRunner } from './runner-management.ts';

try {
  if (process.argv.length !== 2) throw new Error('Unsupported option');
  const chunks: Buffer[] = []; let bytes = 0;
  for await (const chunk of process.stdin) {
    bytes += Buffer.byteLength(chunk);
    if (bytes > 4096) throw new Error('Input exceeds limit');
    chunks.push(Buffer.from(chunk));
  }
  const input: unknown = JSON.parse(Buffer.concat(chunks).toString('utf8'));
  const url = process.env.MONOS_DATABASE_URL_FILE ? (await readFile(process.env.MONOS_DATABASE_URL_FILE, 'utf8')).trim() : process.env.DATABASE_URL;
  if (!url) throw new Error('Database configuration required');
  const db = database(url);
  try {
    await migrate(db);
    process.stdout.write(JSON.stringify(await manageRunner(db, input)) + '\n');
  } finally { await db.pool.end(); }
} catch {
  process.stderr.write('Runner management failed; check database configuration, Runner ID and bounded command JSON on stdin.\n');
  process.exitCode = 1;
}
