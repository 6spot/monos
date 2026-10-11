import { transaction } from '../../../packages/db/src/index.ts';
import type { Database, Transaction } from '../../../packages/db/src/index.ts';
import { canonicalJSON, digest, MAX_BODY_BYTES, validate } from '../../../packages/protocol/src/index.ts';
import type { ConfigurationCommand, ConfigurationResult, ConfigurationSnapshot, GitRepositoryResource, ProjectConfiguration, RoleConfiguration, PolicyConfiguration, GitHubConfigurationStatus, GitHTTPSCredentialStatus, InfrastructureSnapshot, RuntimeInstallation } from '../../../packages/protocol/src/index.ts';
import { CommandError } from '../../../packages/domain/src/commands.ts';
import { repositoryIdentity, validateRepositorySettings } from '../../../packages/domain/src/repositories.ts';
import { authenticateOwner } from './owner-commands.ts';
import { lockConfiguration } from './configuration-guards.ts';
import { discussionText } from './discussion-state.ts';
import type { GitHub, GitHubCredentials } from './github.ts';
import type { GitHTTPSCredentials } from './git-https-credentials.ts';

async function snapshot(tx: Transaction, version: number): Promise<ConfigurationSnapshot> {
  const roleRows = (await tx.query<RoleConfiguration & { execution_policy: RoleConfiguration['execution_policy'] | null }>('SELECT id,name,description,instructions,archived,execution_policy FROM roles ORDER BY id')).rows;
  const roles = roleRows.map(({ execution_policy, ...role }) => ({ ...role, ...(execution_policy ? { execution_policy } : {}) }));
  const policies = (await tx.query<{ policies: PolicyConfiguration }>('SELECT policies FROM execution_policies')).rows[0]!.policies;
  const github = (await tx.query<GitHubConfigurationStatus>('SELECT app_id,installation_id,key_fingerprint FROM github_configuration')).rows[0];
  const git_https_credentials = (await tx.query<GitHTTPSCredentialStatus>(`SELECT c.resource_id,c.username,c.generation,c.scope_digest
    FROM git_https_credentials c JOIN project_resources r ON r.id=c.resource_id WHERE r.active ORDER BY c.resource_id`)).rows;
  const projects = (await tx.query<Omit<ProjectConfiguration, 'resources' | 'role_ids'>>('SELECT id,name,context,archived FROM projects ORDER BY id')).rows;
  const resources = (await tx.query<{ project_id: string; settings: GitRepositoryResource }>('SELECT project_id,settings FROM project_resources WHERE active ORDER BY id')).rows;
  const selected = (await tx.query<{ project_id: string; role_id: string }>('SELECT project_id,role_id FROM project_roles ORDER BY role_id')).rows;
  const planner_guidance = (await tx.query<{ planner_guidance: string }>('SELECT planner_guidance FROM execution_policies')).rows[0]!.planner_guidance;
  const result = { schema_version: 1, control_version: version, roles, policies, planner_guidance, git_https_credentials, ...(github ? { github } : {}), projects: projects.map((project) => ({ ...project, resources: resources.filter((r) => r.project_id === project.id).map((r) => r.settings), role_ids: selected.filter((r) => r.project_id === project.id).map((r) => r.role_id) })) };
  if (Buffer.byteLength(JSON.stringify(result)) > MAX_BODY_BYTES) throw new CommandError('unmet_precondition', 'Configuration exceeds the current 2 MiB snapshot limit');
  return validate('ConfigurationSnapshot', result);
}

async function saveRole(tx: Transaction, role: RoleConfiguration): Promise<void> {
  if (!role.name.trim()) throw new CommandError('invalid_input', 'Role name is required');
  await tx.query('INSERT INTO roles(id,name,description,instructions,archived,execution_policy) VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(id) DO UPDATE SET name=$2,description=$3,instructions=$4,archived=$5,execution_policy=$6', [role.id, role.name, role.description, role.instructions, role.archived, role.execution_policy ?? null]);
}

async function saveProject(tx: Transaction, project: ProjectConfiguration): Promise<void> {
  if (!project.name.trim()) throw new CommandError('invalid_input', 'Project name is required');
  const selected = (await tx.query<{ role_id: string }>('SELECT role_id FROM project_roles WHERE project_id=$1', [project.id])).rows.map((row) => row.role_id);
  const roles = (await tx.query<{ id: string; archived: boolean }>('SELECT id,archived FROM roles WHERE id=ANY($1::text[])', [project.role_ids])).rows;
  if (project.role_ids.some((id) => !roles.some((role) => role.id === id && (!role.archived || selected.includes(id))))) throw new CommandError('unmet_precondition', 'Choose existing available Roles');
  const removedRoles = selected.filter((id) => !project.role_ids.includes(id));
  if ((await tx.query(`SELECT 1 FROM tasks t JOIN plan_nodes pn ON pn.plan_id=t.plan_id
    WHERE t.project_id=$1 AND t.state NOT IN ('COMPLETED','CANCELLED') AND pn.definition->>'role_id'=ANY($2::text[]) LIMIT 1`, [project.id, removedRoles])).rowCount) throw new CommandError('unmet_precondition', 'An unfinished Task still uses a removed Role');

  const ids = project.resources.map((resource) => resource.id);
  const identities = project.resources.map((resource) => repositoryIdentity(resource.remote_url));
  if (new Set(ids).size !== ids.length || new Set(identities).size !== identities.length) throw new CommandError('invalid_input', 'Duplicate repository resource or remote');
  const existing = (await tx.query<{ id: string; project_id: string; remote_url: string; repository_identity: string; settings: GitRepositoryResource }>('SELECT id,project_id,remote_url,repository_identity,settings FROM project_resources WHERE project_id=$1 OR id=ANY($2::text[])', [project.id, ids])).rows;
  for (const [index, resource] of project.resources.entries()) {
    validateRepositorySettings(resource);
    const old = existing.find((row) => row.id === resource.id);
    if (resource.provider && !identities[index]!.startsWith('github.com/')) throw new CommandError('invalid_input', 'GitHub metadata requires a GitHub remote');
    if (old?.settings.provider_repo_id && (old.settings.provider_repo_id !== resource.provider_repo_id || old.settings.provider !== resource.provider)) throw new CommandError('payload_conflict', 'Provider repository identity is immutable');
    if (resource.provider_repo_id && (existing.some((row) => row.project_id === project.id && row.id !== resource.id && row.settings.provider_repo_id === resource.provider_repo_id) || project.resources.some((row) => row.id !== resource.id && row.provider_repo_id === resource.provider_repo_id))) throw new CommandError('payload_conflict', 'Provider repository already has a resource ID');
    if (old && (old.project_id !== project.id || old.remote_url !== resource.remote_url)) throw new CommandError('payload_conflict', 'Resource identity is immutable; use a new ID for another remote');
    if (existing.some((row) => row.project_id === project.id && row.repository_identity === identities[index] && row.id !== resource.id)) throw new CommandError('payload_conflict', 'Repository already has a resource ID in this Project');
  }
  const removed = existing.filter((row) => row.project_id === project.id && !ids.includes(row.id)).map((row) => row.id);
  // Admission itself reserves use: an uncertain workspace operation is not safe
  // to remove. An inspection snapshot alone does not reserve a Task Workspace.
  if ((await tx.query(`SELECT 1 FROM operations o JOIN attempts a ON a.id=o.attempt_id JOIN tasks t ON t.id=a.task_id
    WHERE o.resource_id=ANY($1::text[]) AND o.kind='open_workspace' AND o.workspace_descriptor IS NULL AND (t.state NOT IN ('COMPLETED','CANCELLED') OR NOT a.process_released OR o.state NOT IN ('succeeded','cancelled')) LIMIT 1`, [removed])).rowCount) throw new CommandError('unmet_precondition', 'An unfinished Task still has a workspace for this resource');
  if ((await tx.query(`SELECT 1 FROM task_workspaces w JOIN tasks t ON t.id=w.task_id WHERE w.resource_id=ANY($1::text[])
    AND ((w.ever_materialized AND t.state NOT IN ('COMPLETED','CANCELLED'))
      OR EXISTS(SELECT 1 FROM workspace_leases l WHERE l.workspace_id=w.id AND l.state<>'released')
      OR EXISTS(SELECT 1 FROM operations o WHERE o.workspace_descriptor->>'workspace_id'=w.id AND o.state NOT IN ('succeeded','cancelled'))) LIMIT 1`, [removed])).rowCount) throw new CommandError('unmet_precondition', 'An unfinished Task or workspace lease still uses this resource');

  await tx.query('INSERT INTO projects(id,name,context,archived) VALUES($1,$2,$3,$4) ON CONFLICT(id) DO UPDATE SET name=$2,context=$3,archived=$4', [project.id, project.name, project.context, project.archived]);
  await tx.query('DELETE FROM project_roles WHERE project_id=$1', [project.id]);
  for (const id of project.role_ids) await tx.query('INSERT INTO project_roles(project_id,role_id) VALUES($1,$2)', [project.id, id]);
  await tx.query('UPDATE project_resources SET active=false WHERE project_id=$1', [project.id]);
  for (const [index, resource] of project.resources.entries()) await tx.query('INSERT INTO project_resources(id,project_id,repository_identity,remote_url,settings) VALUES($1,$2,$3,$4,$5) ON CONFLICT(id) DO UPDATE SET settings=$5,active=true', [resource.id, project.id, identities[index], resource.remote_url, resource]);
}

export class Configuration {
  readonly db: Database;
  private readonly github?: GitHub;
  private readonly gitHTTPS?: GitHTTPSCredentials;
  constructor(db: Database, github?: GitHub, gitHTTPS?: GitHTTPSCredentials) { this.db = db; this.github = github; this.gitHTTPS = gitHTTPS; }

  async read(token: string): Promise<ConfigurationSnapshot> {
    return transaction(this.db, async (tx) => { await authenticateOwner(tx, token); return snapshot(tx, await lockConfiguration(tx)); });
  }

  async save(token: string, body: unknown): Promise<ConfigurationResult> {
    const command = validate<ConfigurationCommand>('ConfigurationCommand', body);
    const json = canonicalJSON(command);
    if (Buffer.byteLength(json) > MAX_BODY_BYTES) throw new CommandError('invalid_input', 'Configuration command exceeds limit');
    const hash = digest(json);
    return transaction(this.db, async (tx) => {
      await authenticateOwner(tx, token);
      const version = await lockConfiguration(tx, true);
      const prior = (await tx.query<{ digest: string; response: ConfigurationResult }>('SELECT digest,response FROM configuration_receipts WHERE request_id=$1', [command.request_id])).rows[0];
      if (prior) {
        if (prior.digest !== hash) throw new CommandError('payload_conflict', 'Request ID has different immutable content');
        return prior.response;
      }
      if (version !== command.expected_control_version) throw new CommandError('version_conflict', 'Configuration changed; reload and review your edit', version);
      let credential_change: ConfigurationResult['credential_change'];
      switch (command.name) {
        case 'save_git_https_credential':
          if (!this.gitHTTPS) throw new CommandError('unmet_precondition', 'HTTPS credential storage is not configured');
          credential_change = await this.gitHTTPS.configure(tx, validate('GitHTTPSCredentialInput', command.payload), command.request_id); break;
        case 'clear_git_https_credential':
          if (!this.gitHTTPS) throw new CommandError('unmet_precondition', 'HTTPS credential storage is not configured');
          credential_change = await this.gitHTTPS.clear(tx, validate<{ resource_id: string }>('GitHTTPSCredentialClear', command.payload).resource_id); break;
        case 'save_planner_guidance': {
          const { guidance } = validate<{ guidance: string }>('PlannerGuidance', command.payload); discussionText(guidance, true);
          await tx.query('UPDATE execution_policies SET planner_guidance=$1', [guidance]); break;
        }
        case 'save_project': await saveProject(tx, validate('ProjectConfiguration', command.payload)); break;
        case 'save_role': await saveRole(tx, validate('RoleConfiguration', command.payload)); break;
        case 'save_policies': await tx.query('UPDATE execution_policies SET policies=$1', [validate('PolicyConfiguration', command.payload)]); break;
        case 'save_github':
          if (!this.github) throw new CommandError('unmet_precondition', 'Provider key storage is not configured');
          await this.github.configure(tx, validate('GitHubConfigurationInput', command.payload)); break;
      }
      await tx.query('UPDATE configuration_control SET version=version+1');
      await snapshot(tx, version + 1); // Bounded complete snapshots; failure rolls back this edit.
      const response = validate<ConfigurationResult>('ConfigurationResult', { schema_version: 1, request_id: command.request_id, status: 'committed', control_version: version + 1, entity_id: command.payload.id ?? command.name, ...(credential_change ? { credential_change } : {}) });
      await tx.query('INSERT INTO configuration_receipts(request_id,digest,response) VALUES($1,$2,$3)', [command.request_id, hash, response]);
      return response;
    });
  }

  async status(token: string, requestId: string): Promise<ConfigurationResult> {
    validate('Id', requestId);
    return transaction(this.db, async (tx) => {
      await authenticateOwner(tx, token);
      return (await tx.query<{ response: ConfigurationResult }>('SELECT response FROM configuration_receipts WHERE request_id=$1', [requestId])).rows[0]?.response ?? { schema_version: 1, request_id: requestId, status: 'unknown' };
    });
  }

  async repositories(token: string, page: number) {
    const config = await transaction(this.db, async (tx) => {
      await authenticateOwner(tx, token); await lockConfiguration(tx);
      return (await tx.query<GitHubCredentials>('SELECT app_id,installation_id,encrypted_key,key_fingerprint FROM github_configuration')).rows[0];
    });
    if (!config || !this.github) throw new CommandError('unmet_precondition', 'Configure a GitHub App installation first');
    // Network requests and short-lived tokens stay outside the DB transaction.
    return this.github.repositories(config, page);
  }

  async infrastructure(token: string, instanceId: string): Promise<InfrastructureSnapshot> {
    return transaction(this.db, async (tx) => {
      await authenticateOwner(tx, token);
      const rows = (await tx.query<{ runner_id: string; capacity: number; online: boolean; runtimes: { installation: RuntimeInstallation; observed_at: string; current: boolean }[] }>(`SELECT r.id AS runner_id,r.capacity,
        (r.connected AND r.ready AND r.connection_instance=$1 AND r.last_seen>clock_timestamp()-interval '15 seconds') AS online,
        COALESCE((SELECT jsonb_agg(jsonb_build_object('installation',i.observation,'observed_at',to_char(i.observed_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),'current',i.incarnation=r.incarnation) ORDER BY i.runtime_id) FROM runtime_installations i WHERE i.runner_id=r.id),'[]'::jsonb) AS runtimes
        FROM runners r ORDER BY r.id`, [instanceId])).rows;
      return validate('InfrastructureSnapshot', { schema_version: 1, runners: rows });
    });
  }
}
