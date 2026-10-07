import fs from 'node:fs';
import {createRequire} from 'node:module';
import {randomUUID} from 'node:crypto';
import {spawn} from 'node:child_process';

const require = createRequire('/app/packages/db/package.json');
const {Client} = require('pg');
const evidence = '/evidence';
const secret = process.env.MONOS_DATABASE_URL_FILE;
if (!secret) throw new Error('Private database URL file is required');
const url = new URL(fs.readFileSync(secret, 'utf8').trim());
const client = new Client({connectionString: url.toString()});
const schema = 'delivery_build_' + randomUUID().replaceAll('-', '');
const command = ['exec', 'vitest', 'run',
  'apps/server/test/postgres-publication.test.ts',
  'apps/server/test/postgres-owner-delivery.test.ts',
  '-t', 'upgrades populated version21|upgrades exact version23 to version25',
  '--reporter=json', '--outputFile=/evidence/targeted-vitest.json'];
const schemas = async () => (await client.query(
  "SELECT nspname FROM pg_namespace WHERE nspname NOT LIKE 'pg_%' ORDER BY nspname",
)).rows.map(row => row.nspname);
let before, exit = 1, created = false, failure, version;
await client.connect();
try {
  before = await schemas();
  version = (await client.query('SHOW server_version')).rows[0].server_version;
  if (!version.startsWith('17.11')) throw new Error('Pinned PostgreSQL version mismatch');
  await client.query(`CREATE SCHEMA ${schema}`);
  created = true;
  url.searchParams.set('options', `-c search_path=${schema}`);
  exit = await new Promise((resolve, reject) => {
    const child = spawn('pnpm', command, {
      cwd: '/app', stdio: ['ignore', 'inherit', 'inherit'],
      env: {...process.env, DATABASE_URL: url.toString(), MONOS_TEST_DATABASE: '1'},
    });
    child.once('error', reject);
    child.once('exit', (code, signal) => resolve(signal ? 1 : code ?? 1));
  });
} catch (error) {
  failure = error.name;
} finally {
  if (created) await client.query(`DROP SCHEMA ${schema} CASCADE`);
  const after = await schemas();
  const preserved = JSON.stringify(before) === JSON.stringify(after);
  let passed = 0, skipped = 0;
  if (fs.existsSync(evidence + '/targeted-vitest.json')) {
    const report = JSON.parse(fs.readFileSync(evidence + '/targeted-vitest.json', 'utf8'));
    passed = report.numPassedTests;
    skipped = report.numPendingTests;
    if (!report.success || passed !== 2) exit = 1;
  } else exit = 1;
  const summary = {exit, passed, skipped, schema_set_preserved: preserved,
    schema_count_before: before?.length, schema_count_after: after.length,
    test_schema_removed: !after.includes(schema), node: process.version,
    selected_command: ['pnpm', ...command], failure, postgres_version: version};
  fs.writeFileSync(evidence + '/targeted-postgres-summary.json', JSON.stringify(summary, null, 2) + '\n', {flag: 'wx', mode: 0o600});
  await client.end();
  if (!preserved || failure || process.version !== 'v24.21.0') exit = 1;
}
process.exitCode = exit;
