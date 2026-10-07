import fs from 'node:fs';
import {createHash} from 'node:crypto';
import {createRequire} from 'node:module';
import {database} from '/app/packages/db/src/index.ts';
import {migrate} from '/app/packages/db/src/migrate.ts';

const require = createRequire('/app/packages/db/package.json');
const {Client} = require('pg');
const url = new URL(fs.readFileSync('/run/clone-url', 'utf8').trim());
if (url.hostname !== '127.0.0.1' || url.pathname !== '/acceptance_clone' || url.username !== 'acceptance_clone') {
  throw new Error('Isolated clone identity mismatch');
}
const client = new Client({connectionString: url.toString()});
const hash = value => createHash('sha256').update(value).digest('hex');
const quote = name => '"' + name.replaceAll('"', '""') + '"';
const output = '/evidence/populated-upgrade.json';
const report = {
  scope: 'Isolated actual populated database clone migration only; no primary database upgrade, coordinated backup, service replacement, App or native execution claim',
  node: process.version,
  checks: {},
};
let db;
try {
  await client.connect();
  report.database = (await client.query('SELECT current_database() AS name')).rows[0].name;
  report.postgres = (await client.query('SHOW server_version')).rows[0].server_version;
  if (report.database !== 'acceptance_clone' || !report.postgres.startsWith('17.11') || process.version !== 'v24.21.0') {
    throw new Error('Pinned isolated environment mismatch');
  }
  await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
  const tables = (await client.query("SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename")).rows.map(row => row.tablename);
  const columns = {};
  const before = {};
  for (const table of tables) {
    columns[table] = (await client.query('SELECT column_name FROM information_schema.columns WHERE table_schema=$1 AND table_name=$2 ORDER BY ordinal_position', ['public', table])).rows.map(row => row.column_name);
    const body = (await client.query(`SELECT coalesce(jsonb_agg(to_jsonb(r) ORDER BY to_jsonb(r)::text),'[]')::text AS body FROM (SELECT ${columns[table].map(quote).join(',')} FROM public.${quote(table)}) r`)).rows[0].body;
    before[table] = {count: JSON.parse(body).length, sha256: hash(body)};
  }
  const migrations = (await client.query('SELECT version,checksum FROM schema_migrations ORDER BY version')).rows;
  if (migrations.length !== 21 || migrations.at(-1)?.version !== 21) throw new Error('Expected populated source schema21');
  report.before = before;
  report.original_migrations = migrations;
  await client.query('COMMIT');

  db = database(url.toString());
  await migrate(db);
  await migrate(db);
  await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
  const after = {};
  for (const table of tables) {
    const restriction = table === 'schema_migrations' ? ' WHERE version<=21' : '';
    const body = (await client.query(`SELECT coalesce(jsonb_agg(to_jsonb(r) ORDER BY to_jsonb(r)::text),'[]')::text AS body FROM (SELECT ${columns[table].map(quote).join(',')} FROM public.${quote(table)}${restriction}) r`)).rows[0].body;
    after[table] = {count: JSON.parse(body).length, sha256: hash(body)};
  }
  report.after_original_columns = after;
  report.final_migrations = (await client.query('SELECT version,checksum FROM schema_migrations ORDER BY version')).rows;
  const newTables = (await client.query("SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename")).rows.map(row => row.tablename).filter(table => !tables.includes(table));
  report.new_tables = {};
  for (const table of newTables) {
    report.new_tables[table] = Number((await client.query(`SELECT count(*) AS n FROM public.${quote(table)}`)).rows[0].n);
  }
  await client.query('COMMIT');
  report.checks = {
    old_rows_original_columns_and_multiplicity_preserved: JSON.stringify(before) === JSON.stringify(after),
    original_21_checksums_preserved: JSON.stringify(report.final_migrations.slice(0, 21)) === JSON.stringify(migrations),
    exact_schema25: report.final_migrations.length === 25 && report.final_migrations.at(-1)?.version === 25,
    new_delivery_review_tables_empty_without_pumps: Object.values(report.new_tables).every(count => count === 0),
  };
  report.outcome = Object.values(report.checks).every(Boolean) ? 'pass' : 'fail';
} catch (error) {
  report.outcome = 'fail';
  report.failure = {name: error.name, code: error.code ?? null};
  process.exitCode = 1;
} finally {
  if (db) await db.pool.end();
  await client.end();
  const fd = fs.openSync(output, 'wx', 0o600);
  try {
    fs.writeFileSync(fd, JSON.stringify(report, null, 2) + '\n');
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
  const parent = fs.openSync('/evidence', 'r');
  try {fs.fsyncSync(parent);} finally {fs.closeSync(parent);}
  if (report.outcome !== 'pass') process.exitCode = 1;
}
