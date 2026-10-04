import type { Transaction } from '../../../packages/db/src/index.ts';
import { canonicalJSON, digest, validate } from '../../../packages/protocol/src/index.ts';
import type { PublicationScanConfiguration } from '../../../packages/protocol/src/index.ts';

export const publicationDigest = (value: unknown) => digest(canonicalJSON(value));
// Keep this finite path guard aligned with credential_rules_v1, including binary scanner rules.
export function credentialPath(path: string): boolean {
  return /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----|gh[pousr]_[A-Za-z0-9]{36}|github_pat_[A-Za-z0-9_]{22,255}|(?:AKIA|ASIA)[A-Z0-9]{16}/.test(path);
}
export async function publicationConfiguration(tx: Transaction, resourceId: string): Promise<PublicationScanConfiguration> {
  const github=(await tx.query('SELECT app_id,installation_id,key_fingerprint FROM github_configuration')).rows[0] ?? null;
  const resource=(await tx.query('SELECT repository_identity,settings FROM project_resources WHERE id=$1',[resourceId])).rows[0];
  return validate('PublicationScanConfiguration', {
    schema_version:1,policy_version:'local_publication_v1',rule_version:'credential_rules_v1',traversal_version:'all_parents_final_tree_v1',
    local_blob_limit:50*1024*1024,provider_blob_limit:100*1024*1024,max_commits:256,max_paths:8192,max_versions:32768,
    max_blob_bytes:128*1024*1024,max_aggregate_bytes:512*1024*1024,max_findings:4096,max_evidence_bytes:8*1024*1024,
    deadline_seconds:120,workflow_write:'unknown',permission_fingerprint:publicationDigest({github,repository_identity:resource?.repository_identity,provider:resource?.settings.provider ?? null,provider_repo_id:resource?.settings.provider_repo_id ?? null}),
  });
}
