import { readFile } from 'node:fs/promises';
import { database } from '../../../packages/db/src/index.ts';
import { migrate } from '../../../packages/db/src/migrate.ts';
import { issueRunnerEnrollment, verifyRunnerEnrollment } from './runner-enrollment.ts';

// The grant is intentional private administrative output. Input, database errors
// and unsuccessful responses never echo credentials or configuration values.
try {
  const verifying = process.argv.length === 3 && process.argv[2] === '--verify';
  if (process.argv.length !== 2 && !verifying) throw new Error('Unsupported option');
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
    if (!verifying) await migrate(db);
    const result = verifying ? await verifyRunnerEnrollment(db, input) : await issueRunnerEnrollment(db, input);
    process.stdout.write(JSON.stringify(result) + '\n');
  } finally { await db.pool.end(); }
} catch {
  process.stderr.write('Runner enrollment administration failed; check database configuration and bounded command JSON on stdin.\n');
  process.exitCode = 1;
}
