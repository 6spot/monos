import { createCipheriv, createDecipheriv, hkdfSync, randomBytes, randomUUID } from 'node:crypto';
import type { Transaction } from '../../../packages/db/src/index.ts';
import { CommandError } from '../../../packages/domain/src/commands.ts';
import { repositoryAdapter } from '../../../packages/domain/src/repositories.ts';
import { canonicalJSON, digest, validate } from '../../../packages/protocol/src/index.ts';
import type { GitHTTPSCredentialInput, GitHTTPSCredentialStatus, RepositoryAuthentication } from '../../../packages/protocol/src/index.ts';

export interface GitHTTPSCredentialScope extends GitHTTPSCredentialStatus {
  repository_identity: string;
  remote_url: string;
  configuration_request_id: string;
}
type CredentialAuthority = Pick<GitHTTPSCredentialScope, 'resource_id' | 'repository_identity'>
  & Partial<Pick<GitHTTPSCredentialScope, 'remote_url' | 'username' | 'scope_digest' | 'configuration_request_id'>>;
interface Resource { resource_id: string; repository_identity: string; remote_url: string }

const keySalt = Buffer.from('6d6f6e6f6c61622d70726f7669646572', 'hex');
const credentialUnavailable = () => new CommandError('unmet_precondition', 'HTTPS Git credential cannot be read; re-enter the resource credential');

function scopeDigest(scope: Resource & { username: string }): string {
  return digest(canonicalJSON({ kind: 'git_https_configuration', resource_id: scope.resource_id,
    repository_identity: scope.repository_identity, remote_url: scope.remote_url, username: scope.username,
    allowed_system_use: ['read', 'observe', 'push'] }));
}

async function resource(tx: Transaction, resourceId: string): Promise<Resource> {
  const row = (await tx.query<Resource & { active: boolean }>(
    'SELECT id AS resource_id,repository_identity,remote_url,active FROM project_resources WHERE id=$1', [resourceId])).rows[0];
  if (!row?.active) throw new CommandError('denied_scope', 'HTTPS Git resource is not active');
  if (repositoryAdapter(row.remote_url) !== 'git_https') throw new CommandError('invalid_input', 'HTTPS credentials require a plain Git resource');
  return { resource_id: row.resource_id, repository_identity: row.repository_identity, remote_url: row.remote_url };
}

// Callers hold the configuration share lock before Runner/Task locks. Material
// generation can rotate while the resource's accepted authorization stays fixed.
export async function gitHTTPSCredentialScope(tx: Transaction, resourceId: string): Promise<GitHTTPSCredentialScope | undefined> {
  const current = await resource(tx, resourceId);
  const row = (await tx.query<GitHTTPSCredentialScope>(`SELECT resource_id,repository_identity,remote_url,username,generation,scope_digest,configuration_request_id
    FROM git_https_credentials WHERE resource_id=$1`, [resourceId])).rows[0];
  if (!row) return undefined;
  if (row.repository_identity !== current.repository_identity || row.remote_url !== current.remote_url || row.scope_digest !== scopeDigest(row)) throw credentialUnavailable();
  return row;
}

// Receipt material is immutable. A genuine earlier save may authorize renewed
// material only while the current resource, user and stable scope still match.
export async function verifyGitHTTPSCredentialReceipt(tx: Transaction, scope: CredentialAuthority): Promise<boolean> {
  if (!scope.remote_url || !scope.username || !scope.scope_digest || !scope.configuration_request_id) return false;
  const current = await gitHTTPSCredentialScope(tx, scope.resource_id);
  if (!current || current.repository_identity !== scope.repository_identity || current.remote_url !== scope.remote_url
    || current.username !== scope.username || current.scope_digest !== scope.scope_digest) return false;
  return (await tx.query<{ valid: boolean }>('SELECT git_https_credential_receipt_matches($1,$2,$3,$4) AS valid',
    [scope.configuration_request_id, scope.resource_id, scope.username, scope.scope_digest])).rows[0]?.valid === true;
}

export class GitHTTPSCredentials {
  private readonly key: Buffer;
  constructor(signingKey: string) {
    if (Buffer.byteLength(signingKey) < 32) throw new Error('HTTPS credential encryption requires the private service signing key');
    this.key = Buffer.from(hkdfSync('sha256', signingKey, keySalt, 'git-https-credential-v1', 32));
  }

  private aad(scope: Pick<GitHTTPSCredentialScope, 'resource_id' | 'remote_url' | 'username' | 'generation'>): Buffer {
    return Buffer.from(canonicalJSON({ kind: 'git-https-credential-v1', resource_id: scope.resource_id,
      remote_url: scope.remote_url, username: scope.username, generation: scope.generation }));
  }

  async configure(tx: Transaction, input: GitHTTPSCredentialInput, requestId: string): Promise<GitHTTPSCredentialStatus & { action: 'saved' }> {
    const { username, token } = input;
    if (!username || [...username].length > 256 || /[:\r\n]/.test(username) || username.includes('\0')
      || !token || Buffer.byteLength(token) > 4096 || /[\r\n]/.test(token) || token.includes('\0')
      || Buffer.from(username).toString('utf8') !== username || Buffer.from(token).toString('utf8') !== token) {
      throw new CommandError('invalid_input', 'Use a valid Basic username and a token of at most 4096 UTF-8 bytes without line breaks');
    }
    const target = await resource(tx, input.resource_id);
    const scope = { ...target, username, generation: randomUUID() };
    const scope_digest = scopeDigest(scope);
    const iv = randomBytes(12); const cipher = createCipheriv('aes-256-gcm', this.key, iv);
    cipher.setAAD(this.aad(scope));
    const encrypted = Buffer.concat([cipher.update(token, 'utf8'), cipher.final()]);
    const ciphertext = [iv, cipher.getAuthTag(), encrypted].map((part) => part.toString('base64url')).join('.');
    await tx.query(`INSERT INTO git_https_credentials(resource_id,repository_identity,remote_url,username,generation,scope_digest,encrypted_token,configuration_request_id)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT(resource_id) DO UPDATE SET username=$4,generation=$5,scope_digest=$6,encrypted_token=$7,configuration_request_id=$8`,
    [target.resource_id, target.repository_identity, target.remote_url, username, scope.generation, scope_digest, ciphertext, requestId]);
    return { action: 'saved', resource_id: target.resource_id, username, generation: scope.generation, scope_digest };
  }

  async clear(tx: Transaction, resourceId: string): Promise<{ action: 'cleared'; resource_id: string }> {
    await resource(tx, resourceId);
    await tx.query('DELETE FROM git_https_credentials WHERE resource_id=$1', [resourceId]);
    return { action: 'cleared', resource_id: resourceId };
  }

  async authentication(tx: Transaction, resourceId: string, expectedScopeDigest?: string): Promise<RepositoryAuthentication> {
    const scope = await gitHTTPSCredentialScope(tx, resourceId);
    if (!scope) {
      if (expectedScopeDigest !== undefined) throw new CommandError('unmet_precondition', 'Configure the accepted HTTPS Git credential scope before continuing');
      return { kind: 'anonymous' };
    }
    if (expectedScopeDigest !== undefined && scope.scope_digest !== expectedScopeDigest) throw new CommandError('unmet_precondition', 'HTTPS Git credential authorization scope changed');
    const row = (await tx.query<{ encrypted_token: string }>(`SELECT encrypted_token FROM git_https_credentials
      WHERE resource_id=$1 AND generation=$2 AND scope_digest=$3 AND git_https_credential_receipt_matches(configuration_request_id,resource_id,username,scope_digest,generation)`,
    [resourceId, scope.generation, scope.scope_digest])).rows[0];
    if (!row) throw credentialUnavailable();
    let token: string;
    try {
      const parts = row.encrypted_token.split('.');
      if (parts.length !== 3 || parts.some((part) => !/^[A-Za-z0-9_-]+$/.test(part))) throw new Error();
      const [iv, tag, encrypted] = parts.map((part) => Buffer.from(part, 'base64url'));
      if (iv!.length !== 12 || tag!.length !== 16) throw new Error();
      const cipher = createDecipheriv('aes-256-gcm', this.key, iv!);
      cipher.setAAD(this.aad(scope)); cipher.setAuthTag(tag!);
      token = Buffer.concat([cipher.update(encrypted!), cipher.final()]).toString('utf8');
    } catch { throw credentialUnavailable(); }
    // This expiry bounds local use of the static token; it does not describe the
    // upstream token lifetime or claim provider-enforced read-only attenuation.
    return validate('RepositoryAuthentication', { kind: 'https_basic', username: scope.username, token,
      expires_at: new Date(Date.now() + 5 * 60_000).toISOString() });
  }
}
