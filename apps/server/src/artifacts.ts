import { validateHandledGuidance } from './task-guidance.ts';
import type { Transaction, Database } from '../../../packages/db/src/index.ts';
import { transaction } from '../../../packages/db/src/index.ts';
import { CommandError } from '../../../packages/domain/src/commands.ts';
import {
  canonicalJSON,
  digest,
  validate,
  MAX_BODY_BYTES,
  MAX_ITEM_BYTES,
} from '../../../packages/protocol/src/index.ts';
import type {
  ArtifactMetadata,
  ArtifactRecord,
  ArtifactPage,
  CommandEnvelope,
} from '../../../packages/protocol/src/index.ts';
import { authenticateOwner } from './owner-commands.ts';
import { planningEvent, planningText } from './task-planning-state.ts';
import type { NodeSource } from './node-execution-state.ts';
interface ArtifactRow {
  id: string;
  task_id: string;
  node_id: string;
  node_activation: string;
  attempt_id: string;
  specification_id: string;
  plan_id: string;
  title: string;
  content: string;
  media_type: string;
  size_bytes: number;
  content_digest: string;
  external_references: ArtifactMetadata['references'];
  supersedes: string | null;
  created_at: Date;
}
function metadata(row: ArtifactRow): ArtifactMetadata {
  return {
    artifact_id: row.id,
    task_id: row.task_id,
    node_id: row.node_id,
    node_activation: Number(row.node_activation),
    attempt_id: row.attempt_id,
    specification_id: row.specification_id,
    plan_id: row.plan_id,
    title: row.title,
    media_type: row.media_type,
    size_bytes: row.size_bytes,
    content_digest: row.content_digest,
    references: row.external_references,
    created_at: row.created_at.toISOString(),
    ...(row.supersedes ? { supersedes: row.supersedes } : {}),
  };
}
export async function readArtifact(tx: Transaction, taskId: string, artifactId: string): Promise<ArtifactRecord> {
  const row = (await tx.query<ArtifactRow>('SELECT * FROM artifacts WHERE id=$1 AND task_id=$2', [artifactId, taskId]))
    .rows[0];
  if (!row) throw new CommandError('denied_scope', 'Artifact is outside Task scope');
  const record = { metadata: metadata(row), content: { text: row.content, media_type: row.media_type } };
  if (Buffer.byteLength(JSON.stringify(record)) > MAX_ITEM_BYTES - 8192)
    throw new CommandError('unmet_precondition', 'Artifact exceeds encoded response budget');
  return validate('ArtifactRecord', record);
}
export async function publishArtifact(tx: Transaction, source: NodeSource, command: CommandEnvelope): Promise<string> {
  const p = command.payload;
  planningText(p.title!);
  if (Buffer.byteLength(p.content!.text) > 262144)
    throw new CommandError('invalid_input', 'Artifact text exceeds 256 KiB');
  for (const reference of p.references ?? []) {
    try {
      const url = new URL(reference.url);
      if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password) throw new Error('scope');
    } catch {
      throw new CommandError(
        'invalid_input',
        'Artifact references require valid external HTTP(S) URLs without credentials'
      );
    }
  }
  if (Buffer.byteLength(JSON.stringify(p)) > MAX_ITEM_BYTES - 16384)
    throw new CommandError('invalid_input', 'Artifact content exceeds encoded read budget');
  if ((await tx.query('SELECT 1 FROM artifacts WHERE id=$1', [p.artifact_id])).rowCount)
    throw new CommandError('payload_conflict', 'Artifact identity already exists');
  if (p.supersedes) await readArtifact(tx, source.task_id, p.supersedes);
  const count = Number(
    (
      await tx.query<{ count: string }>('SELECT count(*) FROM artifacts WHERE attempt_id=$1', [
        source.planned_attempt_id,
      ])
    ).rows[0]!.count
  );
  if (count >= 256) throw new CommandError('unmet_precondition', 'Attempt Artifact count limit reached');
  const inserted = await tx.query(
    `INSERT INTO artifacts(id,task_id,node_id,node_activation,attempt_id,source_id,specification_id,plan_id,title,media_type,content,size_bytes,content_digest,external_references,supersedes) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15) ON CONFLICT(id) DO NOTHING`,
    [
      p.artifact_id,
      source.task_id,
      source.node_id,
      source.node_activation,
      source.planned_attempt_id,
      source.id,
      source.specification_id,
      source.plan_id,
      p.title,
      p.content!.media_type,
      p.content!.text,
      Buffer.byteLength(p.content!.text),
      digest(p.content!.text),
      JSON.stringify(p.references ?? []),
      p.supersedes ?? null,
    ]
  );
  if (!inserted.rowCount) throw new CommandError('payload_conflict', 'Artifact identity already exists');
  await planningEvent(
    tx,
    source.task_id,
    'artifact_published',
    { artifact_id: p.artifact_id, title: p.title },
    source.planned_attempt_id
  );
  return p.artifact_id!;
}
export async function freezeManifest(
  tx: Transaction,
  source: NodeSource,
  command: CommandEnvelope
): Promise<{ manifest: object; hash: string }> {
  const summary = command.payload.summary!;
  if (!/[^\s\u0085]/u.test(summary) || Buffer.byteLength(summary) > 262144)
    throw new CommandError('invalid_input', 'Completion summary must be nonblank and at most 256 KiB');
  const ids =
    command.payload.artifact_ids ??
    (
      await tx.query<{ id: string }>('SELECT id FROM artifacts WHERE attempt_id=$1 ORDER BY id', [
        source.planned_attempt_id,
      ])
    ).rows.map((r) => r.id);
  if (ids.length > 256 || new Set(ids).size !== ids.length)
    throw new CommandError('invalid_input', 'Completion Artifact selection is too large or duplicated');
  const valid = (
    await tx.query<{ id: string }>(
      'SELECT id FROM artifacts WHERE id=ANY($1::text[]) AND task_id=$2 AND node_id=$3 AND node_activation=$4',
      [ids, source.task_id, source.node_id, source.node_activation]
    )
  ).rows;
  if (valid.length !== ids.length)
    throw new CommandError('denied_scope', 'Completion output must belong to this Node activation');
  const handled=command.payload.handled_guidance_ids??[];
  await validateHandledGuidance(tx,source.id,handled);
  const manifest = {
    manifest_version:2,handled_guidance_ids:handled,
    task_id: source.task_id,
    node_id: source.node_id,
    node_activation: Number(source.node_activation),
    attempt_id: source.planned_attempt_id,
    source_id: source.id,
    specification_id: source.specification_id,
    plan_id: source.plan_id,
    summary: command.payload.summary!,
    artifact_ids: ids,
  };
  return { manifest, hash: digest(canonicalJSON(manifest)) };
}
export async function storeManifest(
  tx: Transaction,
  source: NodeSource,
  operationId: string,
  frozen: { manifest: object; hash: string }
): Promise<void> {
  const manifest = frozen.manifest as { summary: string; artifact_ids: string[]; handled_guidance_ids:string[] };
  await tx.query(
    'INSERT INTO completion_manifests(operation_id,task_id,node_id,node_activation,attempt_id,source_id,specification_id,plan_id,summary,artifact_ids,content_digest,manifest_version,handled_guidance_ids) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,2,$12)',
    [
      operationId,
      source.task_id,
      source.node_id,
      source.node_activation,
      source.planned_attempt_id,
      source.id,
      source.specification_id,
      source.plan_id,
      manifest.summary,
      JSON.stringify(manifest.artifact_ids),
      frozen.hash,
      JSON.stringify(manifest.handled_guidance_ids),
    ]
  );
}
export async function ownerArtifact(
  db: Database,
  token: string,
  taskId: string,
  artifactId: string
): Promise<ArtifactRecord> {
  validate('Id', taskId);
  validate('Id', artifactId);
  return transaction(db, async (tx) => {
    await authenticateOwner(tx, token);
    return readArtifact(tx, taskId, artifactId);
  });
}
export async function ownerArtifacts(
  db: Database,
  token: string,
  taskId: string,
  cursor?: string
): Promise<ArtifactPage> {
  validate('Id', taskId);
  if (cursor) validate('Id', cursor);
  return transaction(db, async (tx) => {
    await authenticateOwner(tx, token);
    if (!(await tx.query('SELECT 1 FROM tasks WHERE id=$1', [taskId])).rowCount)
      throw new CommandError('denied_scope', 'Unknown Task');
    const rows = (
      await tx.query<ArtifactRow>('SELECT * FROM artifacts WHERE task_id=$1 AND id>$2 ORDER BY id LIMIT 65', [
        taskId,
        cursor ?? '',
      ])
    ).rows;
    const page: ArtifactPage = { schema_version: 1, task_id: taskId, artifacts: [] };
    for (const row of rows.slice(0, 64)) {
      const next = metadata(row);
      if (Buffer.byteLength(JSON.stringify({ ...page, artifacts: [...page.artifacts, next] })) > MAX_BODY_BYTES - 256)
        break;
      page.artifacts.push(next);
    }
    if (rows.length > page.artifacts.length) page.next_cursor = page.artifacts.at(-1)!.artifact_id;
    return validate('ArtifactPage', page);
  });
}
