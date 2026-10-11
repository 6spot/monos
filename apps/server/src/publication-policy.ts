import { repositoryAdapter } from '../../../packages/domain/src/repositories.ts';
import type { Transaction } from '../../../packages/db/src/index.ts';
import { canonicalJSON, digest, validate } from '../../../packages/protocol/src/index.ts';
import { gitHTTPSCredentialScope, verifyGitHTTPSCredentialReceipt } from './git-https-credentials.ts';
import type { PublicationScanConfiguration,PublicationPermissionProof } from '../../../packages/protocol/src/index.ts';

export const publicationDigest = (value: unknown) => digest(canonicalJSON(value));
// Keep this finite path guard aligned with credential_rules_v1, including binary scanner rules.
export function credentialPath(path: string): boolean {
  return /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----|gh[pousr]_[A-Za-z0-9]{36}|github_pat_[A-Za-z0-9_]{22,255}|(?:AKIA|ASIA)[A-Z0-9]{16}/.test(path);
}
export async function publicationConfiguration(tx: Transaction, resourceId: string): Promise<PublicationScanConfiguration> {
  const resource=(await tx.query('SELECT repository_identity,remote_url,settings,active FROM project_resources WHERE id=$1',[resourceId])).rows[0];
  const github=resource && repositoryAdapter(resource.remote_url)==='github',scope=await permissionConfigurationFingerprint(tx,resourceId);
  const permission=(await tx.query<{proof:PublicationPermissionProof}>('SELECT proof FROM publication_permission_observations WHERE resource_id=$1 AND configuration_fingerprint=$2 ORDER BY observed_at DESC,id DESC LIMIT 1',[resourceId,scope])).rows[0]?.proof;
  return validate('PublicationScanConfiguration', {
    schema_version:1,policy_version:'local_publication_v1',rule_version:'credential_rules_v1',traversal_version:'all_parents_final_tree_v1',
    local_blob_limit:50*1024*1024,provider_blob_limit:github?100*1024*1024:null,max_commits:256,max_paths:8192,max_versions:32768,
    max_blob_bytes:128*1024*1024,max_aggregate_bytes:512*1024*1024,max_findings:4096,max_evidence_bytes:8*1024*1024,
    deadline_seconds:120,workflow_write:!github?'not_applicable':permission?.kind==='github_installation'&&permission.permissions?.workflows==='write'?'allowed':'unknown',permission_fingerprint:permission?.permission_fingerprint??scope,
  });
}
export async function permissionConfigurationFingerprint(tx:Transaction,resourceId:string):Promise<string> {
 const resource=(await tx.query('SELECT repository_identity,remote_url,settings,active FROM project_resources WHERE id=$1',[resourceId])).rows[0];
 if(resource && repositoryAdapter(resource.remote_url)!=='github') {
  const credential=resource.active?await gitHTTPSCredentialScope(tx,resourceId):undefined;
  return publicationDigest({kind:'git_https_configuration',resource_id:resourceId,repository_identity:resource?.repository_identity,remote_url:resource?.remote_url,scope_digest:credential?.scope_digest??null});
 }
 const github=(await tx.query('SELECT app_id,installation_id,key_fingerprint FROM github_configuration')).rows[0]??null;
 return publicationDigest({github,repository_identity:resource?.repository_identity,provider:resource?.settings.provider??null,provider_repo_id:resource?.settings.provider_repo_id??null});
}

export async function publicationPermissionCurrent(tx:Transaction,resourceId:string,proof:PublicationPermissionProof,workflowChanges=false):Promise<boolean> {
 const resource=(await tx.query('SELECT repository_identity,remote_url,settings,active FROM project_resources WHERE id=$1',[resourceId])).rows[0];
 if(!resource?.active||proof.resource_id!==resourceId||proof.repository_identity!==resource.repository_identity||proof.configuration_fingerprint!==await permissionConfigurationFingerprint(tx,resourceId))return false;
 if(!(await tx.query('SELECT 1 FROM publication_permission_observations WHERE id=$1 AND proof=$2 AND proof_digest=$3',[proof.observation_id,proof,publicationDigest(proof)])).rowCount)return false;
 if(proof.kind==='github_installation')return repositoryAdapter(resource.remote_url)==='github'&&proof.repository_id===resource.settings.provider_repo_id&&(!workflowChanges||proof.permissions?.workflows==='write');
 return repositoryAdapter(resource.remote_url)!=='github'&&proof.remote_url===resource.remote_url&&proof.permission_fingerprint===publicationDigest({kind:proof.kind,scope_digest:proof.scope_digest})&&await verifyGitHTTPSCredentialReceipt(tx,proof);
}
