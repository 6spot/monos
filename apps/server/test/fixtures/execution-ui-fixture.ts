import { replacementImpact } from './task-replan-fixture.ts';
import { createHash, generateKeyPairSync, randomUUID } from 'node:crypto';
import WebSocket from 'ws';
import { transaction } from '../../../../packages/db/src/index.ts';
import type { Database } from '../../../../packages/db/src/index.ts';
import { canonicalJSON, submission, validate } from '../../../../packages/protocol/src/index.ts';
import type { CommandEnvelope, Dispatch, Frame, OwnerCommand, PrepareReplan, PublicationAccessResult, PublicationFinding, PublicationPrepareRequest, PublicationPushRequest, PublicationResult, PublicationResultPage, ResultChange, ResultObject, ResultReadRequest, ResultReadResponse, TaskActionBasis, TaskSpecificationStatus, WorkspaceMetadata, Operation, EffectResult } from '../../../../packages/protocol/src/index.ts';
import { Todos } from '../../src/todos.ts';
import { TaskPreviews } from '../../src/task-previews.ts';
import { prepareProposalFixture } from './task-preview-fixture.ts';
import { Configuration } from '../../src/configuration.ts';
import { authenticateOwner, OwnerCommands } from '../../src/owner-commands.ts';
import { enrollFixture } from '../../src/fixtures.ts';
import { DispatchQueue } from '../../src/dispatch-queue.ts';
import { TaskPlanning } from '../../src/task-planning.ts';
import { NodeExecution } from '../../src/node-execution.ts';
import { TaskConversation } from '../../src/task-conversation.ts';
import { TaskSpecification } from '../../src/task-specification.ts';
import { TaskReplan } from '../../src/task-replan.ts';
import { replanImpact } from '../../src/task-replan-state.ts';
import { initializeTask } from '../../src/task-records.ts';
import type { BoundaryService } from '../../src/service.ts';
import { PublicationPreparation } from '../../src/publication-candidates.ts';
import { PublicationCommands } from '../../src/publication-commands.ts';
import { credentialPath, publicationDigest } from '../../src/publication-policy.ts';
import { GitHub } from '../../src/github.ts';
import { remoteProfile, RemoteProviderError } from '../../src/github-remote.ts';
import type { AcquireGitHubRemoteGrant } from '../../src/github-remote.ts';

const scenarios = ['ready', 'board_pages', 'queued', 'planning_issue', 'node_queued', 'running', 'running_workspace', 'review_git', 'result_inspection', 'result_empty', 'log_pages', 'blocked', 'review', 'completion_recovery', 'replan', 'multi_replan', 'replan_issue', 'joint', 'specification', 'guidance', 'input_issue', 'parallel_review', 'parallel_conflict', 'multi_repository_review'] as const;
type Scenario = typeof scenarios[number];
interface Context { task: string; spec: string; plan: string; node: string; project: string; role: string; runner: string; incarnation: number; resource_id?: string }
interface Agent { dispatch: Dispatch; credential: string }

const literalText = '<script>window.resultInjected = true</script>\n  exact whitespace\n' + 'long code '.repeat(120) + '\n';
const longPath = 'src/' + 'a-long-literal-path-'.repeat(12) + ': final.txt';
const blob = (oid = '1'.repeat(40), mode: ResultObject['mode'] = '100644', size = Buffer.byteLength(literalText)): ResultObject => ({ oid, mode, ...(mode === '160000' ? {} : { size }) });
const resultChanges: ResultChange[] = [
  { path: 'src/literal.txt', status: 'M', old: blob('1'.repeat(40), '100644', Buffer.byteLength('before\n')), new: blob('2'.repeat(40)) },
  { path: 'deleted.txt', status: 'D', old: blob('1'.repeat(40), '100644', Buffer.byteLength('before\n')) },
  { path: 'empty.txt', status: 'A', new: blob('3'.repeat(40), '100644', 0) },
  { path: 'binary.dat', status: 'A', new: blob('4'.repeat(40), '100644', 12) },
  { path: 'oversized.txt', status: 'A', new: blob('5'.repeat(40), '100644', 65537) },
  { path: 'link', status: 'A', new: blob('6'.repeat(40), '120000', 20) },
  { path: 'submodule', status: 'A', new: blob('7'.repeat(40), '160000') },
  { path: longPath, status: 'A', new: blob() },
  ...Array.from({ length: 62 }, (_, index): ResultChange => ({ path: `more/file-${String(index).padStart(2, '0')}.txt`, status: 'A', new: blob() })),
];
interface ReadPeer { socket: WebSocket; heartbeat: NodeJS.Timeout; held: Frame[]; hold: boolean; status?: ResultReadResponse['status']; requests: ResultReadRequest[]; empty: boolean }
const publicationModes = ['findings', 'clean', 'incomplete', 'unavailable', 'no_change', 'preparing', 'offline', 'unsupported'] as const;
// Private synthetic filename/content input; only redacted path and full-content digest leave the peer.
const publicationCanary = 'ghp_' + 'X'.repeat(36), publicationRawPath = `private/${publicationCanary}.txt`;
const publicationRawContent = `synthetic prefix\n${publicationCanary}\nsynthetic suffix\n`;
type PublicationMode = typeof publicationModes[number];
interface PublicationPeer { mode: PublicationMode; held: Map<string, Frame>; requests: Map<string, PublicationPrepareRequest>; results: Map<string, PublicationResultPage[]>; unexpected: string[] }
const remoteModes = ['prepared', 'preparing', 'unsupported', 'offline', 'access_denied', 'rate_limited', 'no_checks', 'unknown', 'blocked'] as const;
type RemoteMode = typeof remoteModes[number];
interface RemotePeer { mode: RemoteMode; resource: string; head?: string; review?: Record<string, unknown>; calls: { method: string; path: string }[]; grants: string[]; pushes: Map<string, PublicationPushRequest>; held: Map<string, Frame>; results: Map<string, Frame>; }

// Browser-only canonical scenarios with explicitly synthetic Runtime acknowledgements.
// No Runtime or provider is contacted; fixture Tasks never leave the isolated schema.
export class ExecutionUIFixture {
  readonly db: Database;
  readonly service: BoundaryService;
  readonly contexts = new Map<string, Context>();
  private readonly workspaceSnapshots = new Map<string, { workspace_id: string; metadata: WorkspaceMetadata }[]>();
  private readonly legacyBoardTasks: Context[] = [];
  private readonly runnerCredentials = new Map<string, string>();
  private readonly readPeers = new Map<string, ReadPeer>();
  private readonly readCompletions = new Map<string, string>();
  private readonly publicationPeers = new Map<string, PublicationPeer>();
  private readonly remotePeers = new Map<string, RemotePeer>();
  private remoteInstallation = 10000;
  constructor(db: Database, service: BoundaryService) { this.db = db; this.service = service; }

  // Explicitly synthetic HTTP/grant responses. Real coordinator, Owner commands,
  // durable PG records and authenticated Runner transport remain in use.
  readonly remoteGrant: AcquireGitHubRemoteGrant = async (scope, profile) => {
    const state = [...this.remotePeers.values()].find(peer => peer.resource === scope.resource_id);
    if (!state || scope.repository_id !== '42' || scope.repository_identity !== 'github.com/example/execution-ui' || !scope.config) throw new RemoteProviderError('access_denied');
    state.grants.push(profile);
    if (state.mode === 'access_denied') throw new RemoteProviderError('access_denied');
    return { token: 'synthetic-browser-ephemeral-grant', expires_at: new Date(Date.now() + 3600000).toISOString(), repository_id: '42', permissions: remoteProfile(scope, profile) };
  };

  readonly remoteFetch: typeof fetch = async (input, init) => {
    const url = new URL(String(input)), method = init?.method ?? 'GET';
    if (url.origin !== 'https://api.github.com' || !url.pathname.startsWith('/repos/example/execution-ui/')) throw new Error('Synthetic provider scope mismatch');
    const authorization = new Headers(init?.headers).get('Authorization');
    if (authorization !== 'Bearer synthetic-browser-ephemeral-grant') throw new Error('Synthetic provider grant mismatch');
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;
    const branch = url.pathname.includes('/git/ref/') ? decodeURIComponent(url.pathname.split('/git/ref/')[1]!) : method === 'POST' ? body?.head : url.searchParams.get('head')?.split(':')[1];
    const state = [...this.remotePeers.entries()].find(([task, peer]) => branch?.includes(task) || peer.review && url.pathname.endsWith('/pulls/' + peer.review.number) || peer.head && url.pathname.includes('/commits/' + peer.head + '/'))?.[1];
    if (!state) throw new Error('Synthetic provider item mismatch');
    state.calls.push({ method, path: url.pathname + url.search });
    if (state.mode === 'rate_limited') return new Response('', { status: 429, headers: { 'Retry-After': '60' } });
    if (url.pathname.includes('/git/ref/')) return state.head ? Response.json({ ref: 'refs/' + branch, object: { type: 'commit', sha: state.head } }) : new Response('', { status: 404 });
    if (url.pathname.endsWith('/pulls') && method === 'GET') return Response.json(state.review ? [state.review] : []);
    if (url.pathname.endsWith('/pulls') && method === 'POST') {
      if (state.review) throw new Error('Synthetic provider duplicate PR create');
      const number = 100 + [...this.remotePeers.values()].indexOf(state);
      state.review = { id: 10000 + number, number, title: body.title, body: body.body, state: 'open', merged_at: null, mergeable: null, html_url: `https://github.com/example/execution-ui/pull/${number}`, head: { ref: body.head, sha: state.head, repo: { id: 42 } }, base: { ref: body.base, sha: 'b'.repeat(40), repo: { id: 42 } } };
      return Response.json(state.review);
    }
    if (url.pathname.includes('/pulls/') && state.review) {
      if (method === 'PATCH') state.review = { ...state.review, ...body };
      return Response.json(state.review);
    }
    if (url.pathname.endsWith('/check-runs')) {
      const rows = state.mode === 'no_checks' ? [] : Array.from({ length: 70 }, (_, index) => ({ id: index + 1, name: index === 0 ? '<script>window.remoteInjected = true</script>' : index === 1 ? 'long-literal-check-name-'.repeat(10) : `Check ${index}`, head_sha: state.head, status: index % 6 === 0 ? 'in_progress' : 'completed', conclusion: ['success', 'neutral', 'skipped', 'cancelled', 'failure', null][index % 6] }));
      return Response.json({ total_count: rows.length, check_runs: rows });
    }
    if (url.pathname.endsWith('/statuses')) return Response.json([]);
    throw new Error('Unrecognized synthetic provider route');
  };

  async createRemote(token: string, input: { mode: RemoteMode }) {
    if (!remoteModes.includes(input.mode)) throw new Error('Invalid remote scenario');
    const github = new GitHub('synthetic-browser-test-service-signing-key');
    const config = new Configuration(this.db, github);
    const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048, privateKeyEncoding: { type: 'pkcs8', format: 'pem' }, publicKeyEncoding: { type: 'spki', format: 'pem' } });
    // Real cooldowns are installation-scoped. A fresh synthetic installation
    // isolates each scenario without deleting or bypassing retained cooldowns.
    await config.save(token, { schema_version: 1, request_id: randomUUID(), expected_control_version: (await config.read(token)).control_version, name: 'save_github', payload: { app_id: '123', installation_id: String(++this.remoteInstallation), private_key: privateKey } });
    const f = await this.create(token, { kind: 'result_inspection', title: 'Automatic remote review preparation' }, true);
    await this.closeReadPeer(f.task);
    const state: RemotePeer = { mode: input.mode, resource: f.resource_id!, calls: [], grants: [], pushes: new Map(), held: new Map(), results: new Map() };
    this.remotePeers.set(f.task, state);
    this.publicationPeers.set(f.task, { mode: 'clean', held: new Map(), requests: new Map(), results: new Map(), unexpected: [] });
    await new PublicationPreparation(this.db, this.service.instanceId).pump();
    await this.connectReadPeer(this.contexts.get(f.task)!);
    if (input.mode === 'offline') { await this.waitPublication(f.task); await this.closeReadPeer(f.task); }
    return f;
  }

  async remotePeer(token: string, task: string, action: 'observe' | 'mode' | 'release' | 'offline' | 'reconnect' | 'carry', mode?: RemoteMode) {
    await transaction(this.db, tx => authenticateOwner(tx, token));
    const state = this.remotePeers.get(task), f = this.contexts.get(task);
    if (!state || !f) throw new Error('Unknown synthetic remote peer');
    if (action === 'mode') { if (!mode || !remoteModes.includes(mode)) throw new Error('Unknown remote mode'); state.mode = mode; }
    if (action === 'release') { state.mode = 'prepared'; for (const frame of state.held.values()) await this.replyPush(this.readPeers.get(task)!, state, frame); state.held.clear(); }
    if (action === 'offline') await this.closeReadPeer(task);
    if (action === 'reconnect') { await this.closeReadPeer(task); await this.connectReadPeer(f); }
    if (action === 'carry') {
      // Existing formal Owner Specification command; no result/remote rows are
      // fabricated. The authenticated synthetic Runner handles the fresh scan.
      const specification = new TaskSpecification(this.db);
      const status = validate<TaskSpecificationStatus>('TaskSpecificationStatus', await specification.status(token, task));
      if (!status.impact.nodes?.length) throw new Error('Synthetic carry requires completed Node impact');
      const impact = { ...status.impact, nodes: status.impact.nodes.map(node => ({ ...node, disposition: 'carry' as const })) };
      await specification.command(token, { schema_version: 1, request_id: randomUUID(), task_id: task, name: 'edit_specification', payload: { proposal_id: randomUUID(), specification: '# Revised requirement\n\nRetain the verified completed result with its unchanged tree under this explicit requirement revision.', summary: 'Carry the completed result into the new exact Specification.', impact, basis: await this.basis(f), source_input_ids: [] } });
      await specification.pump();
      await new PublicationPreparation(this.db, this.service.instanceId).pump();
    }
    return { mode: state.mode, calls: state.calls, grants: state.grants, pushes: [...state.pushes.values()].map(request => ({ operation_id: request.operation_id, request_digest: publicationDigest(request), head: request.prepared.candidate!.head })), held: state.held.size, head: state.head, review_number: state.review?.number };
  }

  private async replyPush(peer: ReadPeer, state: RemotePeer, frame: Frame) {
    const request = frame.publication_push!;
    let response = state.results.get(request.operation_id);
    if (!response) {
      const blocked = state.mode === 'blocked', uncertain = state.mode === 'unknown';
      if (!blocked) {
        // Admission/claim/grant are real authenticated HTTP behavior. The token
        // reply is consumed privately and is never retained in fixture evidence.
        const access = await fetch(`http://127.0.0.1:18555/v1/runner/remote-preparation/${request.operation_id}/access`, { method: 'POST', headers: { Authorization: `Bearer ${this.runnerCredentials.get(request.runner_id)}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ schema_version: 1, request_digest: publicationDigest(request), incarnation: frame.incarnation, attempt_id: randomUUID(), purpose: 'push' }) });
        if (!access.ok) { await access.body?.cancel(); throw new Error(`Synthetic push admission failed ${access.status}`); }
        const grant = validate<PublicationAccessResult>('PublicationAccessResult', await access.json());
        if (grant.operation_id !== request.operation_id || grant.request_digest !== publicationDigest(request)) throw new Error('Synthetic push grant scope differs');
      }
      if (!blocked && !uncertain) state.head = request.prepared.candidate!.head;
      const observation = validate('PublicationRefObservation', { schema_version: 1, observation_id: randomUUID(), operation_id: request.operation_id, item_id: request.item_id, task_id: request.task_id, resource_id: request.resource_id, runner_id: request.runner_id, storage_id: request.storage_id, repository_identity: request.repository_identity, repository_id: request.repository_id, delivery_ref: request.delivery_ref, observed_at: new Date().toISOString(), status: state.head ? 'present' : 'absent', ...(state.head ? { head: state.head } : {}) });
      response = validate<Frame>('Frame', { schema_version: 1, type: 'publication_push_result', incarnation: frame.incarnation, publication_push_result: { schema_version: 1, operation_id: request.operation_id, request_digest: publicationDigest(request), item_id: request.item_id, candidate_manifest_digest: request.prepared.candidate_manifest_digest, candidate_head: request.prepared.candidate!.head, delivery_ref: request.delivery_ref, status: blocked ? 'blocked' : uncertain ? 'reconciliation_required' : 'published', push_started: !blocked, worker_absent: true, ...(blocked ? { reason: 'access_denied' } : uncertain ? { reason: 'provider_unavailable' } : {}), observation, observation_digest: publicationDigest(observation) } });
      state.results.set(request.operation_id, response);
    }
    if (peer.socket.readyState === WebSocket.OPEN) peer.socket.send(JSON.stringify({ ...response, incarnation: frame.incarnation }));
  }

  async createPublication(token: string, input: { mode: PublicationMode }) {
    if (!publicationModes.includes(input.mode)) throw new Error('Invalid publication scenario');
    const f = await this.create(token, { kind: 'result_inspection', title: 'Exact local publication candidate' });
    await this.closeReadPeer(f.task);
    this.publicationPeers.set(f.task, { mode: input.mode, held: new Map(), requests: new Map(), results: new Map(), unexpected: [] });
    await new PublicationPreparation(this.db, this.service.instanceId).pump();
    await this.connectReadPeer(this.contexts.get(f.task)!);
    if (input.mode === 'offline') await this.closeReadPeer(f.task);
    return f;
  }

  async publicationPeer(token: string, task: string, action: 'observe' | 'mode' | 'release' | 'offline' | 'reconnect' | 'history', mode?: PublicationMode) {
    await transaction(this.db, tx => authenticateOwner(tx, token));
    const state = this.publicationPeers.get(task), f = this.contexts.get(task);
    if (!state || !f || !['observe', 'mode', 'release', 'offline', 'reconnect', 'history'].includes(action)) throw new Error('Unknown publication peer');
    if (action === 'mode') { if (!mode || !publicationModes.includes(mode)) throw new Error('Unknown publication mode'); state.mode = mode; }
    if (action === 'offline') await this.closeReadPeer(task);
    if (action === 'reconnect') { await this.closeReadPeer(task); await this.connectReadPeer(f); }
    if (action === 'release') { if (state.mode === 'preparing') state.mode = 'findings'; for (const frame of state.held.values()) this.replyPublication(this.readPeers.get(task)!, state, frame); state.held.clear(); }
    if (action === 'history') {
      state.mode = 'incomplete';
      for (let run = 0; run < 33; run++) {
        const prior = await this.waitPublication(task);
        await new PublicationCommands(this.db).command(token, { schema_version: 1, task_id: task, request_id: randomUUID(), name: 'retry_publication_preparation', payload: { operation_id: prior.id, operation_digest: prior.request_digest } });
      }
      await this.waitPublication(task);
    }
    return { requests: [...state.requests.values()].map(request => ({ operation_id: request.operation_id, scan_run_id: request.scan_run_id, candidate_id: request.construction.candidate_id, source_digest: request.source_digest, request_digest: publicationDigest(request) })), held: state.held.size, unexpected: state.unexpected };
  }

  private async waitPublication(task: string): Promise<{ id: string; request_digest: string }> {
    for (let check = 0; check < 400; check++) {
      const row = (await this.db.pool.query("SELECT id,request_digest,state FROM delivery_operations WHERE task_id=$1 ORDER BY created_at DESC,id DESC LIMIT 1", [task])).rows[0];
      if (row?.state === 'terminal') return row;
      await new Promise(resolve => setTimeout(resolve, 10));
    }
    throw new Error('Synthetic publication did not settle');
  }

  private replyPublication(peer: ReadPeer, state: PublicationPeer, frame: Frame) {
    const request = frame.publication_prepare!;
    let pages = state.results.get(request.operation_id);
    if (!pages) {
      const base = { schema_version: 1, operation_id: request.operation_id, request_digest: publicationDigest(request) };
      let result: PublicationResult;
      let findings: PublicationFinding[] = [];
      if (state.mode === 'no_change') result = { ...base, status: 'not_applicable', reason: 'no_change' };
      else if (state.mode === 'unavailable') result = { ...base, status: 'unavailable', reason: 'retained_unavailable' };
      else {
        // Synthetic OIDs/content establish UI and transport binding only, never physical Git construction.
        const mappingProof = request.published && request.published.candidate.tree === request.source.git_tree ? request.published : undefined;
        const candidate = mappingProof?.candidate ?? { schema_version: 1, candidate_id: request.construction.candidate_id, construction_id: request.construction.construction_id, construction_digest: request.construction_digest, source_digest: request.source_digest, head: publicationDigest(request.construction).slice(0, 40), tree: request.source.git_tree, parents: request.construction.parents.map(parent => parent.commit) as [string, ...string[]] };
        const candidateDigest = publicationDigest(candidate);
        if (state.mode !== 'clean') findings = Array.from({ length: 70 }, (_, ordinal) => {
          const kind: PublicationFinding['kind'] = (['credential_pattern', 'published_credential', 'provider_hard_size', 'workflow_permission', 'publication_policy_size'] as const)[ordinal] ?? 'tracked_ignore';
          const rules = { credential_pattern: 'github_classic_token', published_credential: 'github_classic_token', provider_hard_size: 'provider_blob_size', workflow_permission: 'workflow_permission', publication_policy_size: 'policy_blob_size', tracked_ignore: 'tracked_ignore' } as const;
          const messages = { credential_pattern: 'Credential pattern matched; value redacted.', published_credential: 'Previously published credential exposure requires remediation.', provider_hard_size: 'Blob exceeds provider hard limit.', workflow_permission: 'Workflow write permission is not verified.', publication_policy_size: 'Blob exceeds local publication policy.', tracked_ignore: 'Tracked file matches ignore rules.' } as const;
          const redacted = ordinal < 2 && credentialPath(publicationRawPath);
          const path = ordinal < 2 ? (redacted ? '[redacted credential path]' : publicationRawPath) : ordinal === 3 ? '.github/workflows/change.yml' : ordinal === 5 ? 'src/' + 'long-safe-path-'.repeat(14) + '<literal>.txt' : `tracked/file-${ordinal}.txt`;
          const facts = { occurrence_ordinal: ordinal, kind, rule_id: rules[kind], scope: 'final_tree' as const, commit: candidate.head, path, path_redacted: redacted, override_eligible: ['credential_pattern', 'publication_policy_size', 'tracked_ignore'].includes(kind), message: messages[kind], blob: '9'.repeat(40), content_digest: ordinal < 2 ? createHash('sha256').update(publicationRawContent).digest('hex') : '8'.repeat(64),
            ...(kind === 'published_credential' ? { baseline_commit: request.source.base_commit, baseline_path: '[redacted credential path]', baseline_path_redacted: true } : {}),
            ...(kind === 'provider_hard_size' || kind === 'publication_policy_size' ? { size: (kind === 'provider_hard_size' ? request.configuration.provider_blob_limit : request.configuration.local_blob_limit) + 1, limit: kind === 'provider_hard_size' ? request.configuration.provider_blob_limit : request.configuration.local_blob_limit } : {}),
          };
          return { ...facts, finding_id: publicationDigest({ candidate_manifest_digest: candidateDigest, configuration_digest: request.configuration_digest, scan_run_id: request.scan_run_id, finding_facts_without_id: facts }) };
        });
        const scan = { schema_version: 1, scan_id: request.scan_run_id, candidate_manifest_digest: candidateDigest, configuration_digest: request.configuration_digest, ...(this.remotePeers.has(request.source.task_id) ? { workflow_changes: false } : {}), status: state.mode === 'incomplete' ? 'incomplete' as const : 'complete' as const, ...(state.mode === 'incomplete' ? { reason: 'timeout' as const } : {}), coverage: { commits: mappingProof ? 0 : 1, paths: 70, versions: 70, unique_blob_bytes: this.remotePeers.has(request.source.task_id) ? 70 : 157286420 }, findings_count: findings.length, findings_bytes: Buffer.byteLength(canonicalJSON(findings)), findings_digest: publicationDigest(findings) };
        const mapping = mappingProof ? { schema_version: 1, mapping_id: request.operation_id, operation_id: request.operation_id, request_digest: base.request_digest, item_id: mappingProof.item_id, source: request.source, source_digest: request.source_digest, effective_basis: request.effective_basis, effective_basis_digest: request.effective_basis_digest, published: mappingProof, published_digest: request.published_digest!, candidate_manifest_digest: candidateDigest, reused_head: mappingProof.candidate.head, result_tree: request.source.git_tree, configuration_digest: request.configuration_digest } : undefined;
        result = { ...base, status: mapping ? 'mapped' : 'prepared', candidate, candidate_manifest_digest: candidateDigest, scan, scan_digest: publicationDigest(scan), ...(mapping ? { mapping, mapping_digest: publicationDigest(mapping) } : {}) };
      }
      const pageCount = Math.max(1, Math.ceil(findings.length / 64));
      pages = Array.from({ length: pageCount }, (_, index) => {
        const rows = findings.slice(index * 64, (index + 1) * 64);
        return validate<PublicationResultPage>('PublicationResultPage', { schema_version: 1, result, page_index: index, page_count: pageCount, findings: rows, page_digest: publicationDigest(rows) });
      });
      state.results.set(request.operation_id, pages);
    }
    for (const page of pages) if (peer.socket.readyState === WebSocket.OPEN) peer.socket.send(JSON.stringify({ schema_version: 1, type: 'publication_result', incarnation: frame.incarnation, publication_result: page }));
  }

  async create(token: string, input: { kind: Scenario; title?: string }, automatic = false) {
    await transaction(this.db, (tx) => authenticateOwner(tx, token));
    if (!scenarios.includes(input.kind) || (input.title !== undefined && (typeof input.title !== 'string' || input.title.length > 256))) throw new Error('Invalid browser scenario');
    const f: Context = { task: randomUUID(), spec: randomUUID(), plan: randomUUID(), node: randomUUID(), project: randomUUID(), role: randomUUID(), runner: randomUUID(), incarnation: 0 };
    const parallel = input.kind === 'parallel_review' || input.kind === 'parallel_conflict';
    const resource_id = ['running_workspace', 'review_git', 'result_inspection', 'result_empty', 'multi_repository_review'].includes(input.kind) || parallel ? randomUUID() : undefined;
    const resourceIds = resource_id ? [resource_id, ...(input.kind === 'multi_repository_review' ? [randomUUID()] : [])] : [];
    const config = new Configuration(this.db);
    await config.save(token, { schema_version: 1, request_id: randomUUID(), expected_control_version: (await config.read(token)).control_version, name: 'save_role', payload: { id: f.role, name: 'Careful builder', description: 'Synthetic browser scenario', instructions: 'Implement the exact requirement and report evidence.', archived: false } });
    await config.save(token, { schema_version: 1, request_id: randomUUID(), expected_control_version: (await config.read(token)).control_version, name: 'save_project', payload: { id: f.project, name: `Execution UI · ${input.kind}`, context: 'Isolated browser fixture; no real Runtime execution.', resources: resourceIds.map((id, index) => ({ id, remote_url: `https://github.com/example/${index ? 'execution-ui-tools' : 'execution-ui'}.git`, remote_preparation: automatic ? 'automatic' as const : 'after_acceptance' as const, ...(automatic ? { provider: 'github' as const, provider_repo_id: String(42 + index) } : {}), default_branch: 'main' })), role_ids: [f.role], archived: false } });
    const todo_id = randomUUID();
    await new Todos(this.db).command(token, { schema_version: 1, request_id: randomUUID(), name: 'capture_todo', payload: { todo_id, original_capture: 'Execution UI browser scenario' } });
    const taskProposal = await prepareProposalFixture(this.db, this.service, token, todo_id);
    const proposal = await taskProposal.commit(input.title ?? `Execution ${input.kind}`, '# Exact execution requirement\n\nPreserve the Owner’s intent, independently verified output and clear recovery.\n\n- Keep current and historical evidence separate.\n- Support keyboard and small-screen use.');
    const previews = new TaskPreviews(this.db);
    const preview = await previews.read(token, todo_id, proposal.proposal_message_id, f.project);
    const confirmed = await previews.command(token, { schema_version: 1, request_id: randomUUID(), todo_id, name: 'confirm_task_preview', payload: { proposal_message_id: proposal.proposal_message_id, project_id: f.project, content_digest: preview.content_digest } });
    const created = await previews.command(token, { schema_version: 1, request_id: randomUUID(), todo_id, name: 'create_execution_task', payload: { proposal_message_id: proposal.proposal_message_id, confirmation_id: confirmed.confirmation_id, content_digest: preview.content_digest } });
    if (!created.task_id || !created.specification_id) throw new Error('Browser fixture Task creation failed');
    f.task = created.task_id; f.spec = created.specification_id;
    const runnerCredential = randomUUID();
    await enrollFixture(this.db, f.runner, runnerCredential, 2);
    this.runnerCredentials.set(f.runner, runnerCredential);
    f.incarnation = await this.service.connect(f.runner, 'execution-ui-fixture');
    await this.service.touch(f.runner, f.incarnation, true, [{ runtime_id: 'opencode', executable: '/synthetic/opencode', availability: 'detected', supports_model: true, supports_thinking: false, model_ids: [] }]);
    // Pin synthetic preparation to its own fixture Runner; no deployed policy is read.
    await this.db.pool.query('UPDATE execution_policies SET policies=$1', [{ global: { default_target: { runtime_id: 'opencode', model_id: 'opencode/longcat-2.5-preview-free', runner_id: f.runner }, fallback_targets: [] } }]);
    this.contexts.set(f.task, f);
    const planning = new TaskPlanning(this.db, this.service.instanceId);
    const execution = new NodeExecution(this.db, this.service.instanceId);
    if (input.kind === 'ready') return f;
    if (input.kind === 'board_pages') {
      const task_ids = [f.task];
      for (let index = 1; index <= 33; index++) {
        const legacy = { ...f, task: randomUUID(), spec: randomUUID() };
        await transaction(this.db, (tx) => initializeTask(tx, {
          task_id: legacy.task, specification_id: legacy.spec, project_id: f.project,
          specification: { fixture: 'Legacy Board pagination', index },
        }));
        this.legacyBoardTasks.push(legacy); task_ids.push(legacy.task);
      }
      return { ...f, task_ids, total_tasks: task_ids.length };
    }
    if (input.kind === 'guidance' || input.kind === 'input_issue') {
      const conversation = new TaskConversation(this.db, this.service.instanceId);
      await conversation.command(token, { schema_version: 1, request_id: randomUUID(), task_id: f.task, name: 'submit_task_message', payload: { message_id: randomUUID(), content: 'Keep the requested output readable and verify the exact behavior.' } });
      await conversation.pump(); const agent = await this.promote(f);
      const source = agent.dispatch.task_conversation_source!;
      const result = await this.agent(f, agent, 'commit_task_turn', { source_id: source.source_id, input_id: source.input_id, source_watermark: source.source_watermark, reply: input.kind === 'guidance' ? 'The guidance is retained for future work.' : 'Which behavior should be verified?', routing: { kind: input.kind === 'guidance' ? 'guidance' : 'issue', text: input.kind === 'guidance' ? 'Keep output readable.' : 'Which behavior should be verified?', basis: await this.basis(f) } });
      await this.finish(f, result.operation_id!, agent.dispatch.attempt_id);
      return { ...f, obligation_id: result.result?.obligation_id };
    }
    if (input.kind === 'specification') {
      const conversation = new TaskConversation(this.db, this.service.instanceId);
      const sent = await conversation.command(token, { schema_version: 1, request_id: randomUUID(), task_id: f.task, name: 'submit_task_message', payload: { message_id: randomUUID(), content: 'Please propose a complete requirement update with a readable exact scope.' } });
      await conversation.pump(); const agent = await this.promote(f);
      const basis = await this.basis(f); const proposal_id = randomUUID();
      const status = validate<TaskSpecificationStatus>('TaskSpecificationStatus', await new TaskSpecification(this.db).status(token, f.task));
      await this.agent(f, agent, 'prepare_specification_revision', { proposal_id, specification: '# Revised exact requirement\n\nKeep every original safeguard and add explicit keyboard recovery.\n\nDo not publish remote changes.', summary: 'Add explicit keyboard recovery while retaining the existing work boundary.', basis, impact: status.impact, source_input_ids: [sent.input_id!] });
      const source = agent.dispatch.task_conversation_source!;
      const result = await this.agent(f, agent, 'commit_task_turn', { source_id: source.source_id, input_id: source.input_id, source_watermark: source.source_watermark, reply: 'Please review the complete proposed requirement and its effect before confirming.', routing: { kind: 'specification_proposal', proposal_id, basis } });
      await this.finish(f, result.operation_id!, agent.dispatch.attempt_id);
      return { ...f, proposal_id };
    }
    await this.owner(token, f, 'start_task', { specification_id: f.spec });
    await planning.pump();
    if (input.kind === 'queued') return f;
    const multiSuccessor = randomUUID();
    const planner = await this.promote(f);
    const planned = await this.agent(f, planner, input.kind === 'planning_issue' ? 'raise_planning_issue' : 'publish_execution_plan', input.kind === 'planning_issue' ? { planning_intent_id: planner.dispatch.task_planning_source!.intent_id, reason: 'Which output should be authoritative? Please describe the expected behavior.' } : { planning_intent_id: planner.dispatch.task_planning_source!.intent_id, plan_id: f.plan, nodes: [{ node_id: f.node, role_id: f.role, goal: 'Implement and verify the exact requested behavior', dependencies: [], expected_outputs: ['A verified local result with a readable summary'] }, ...(input.kind === 'multi_replan' || parallel ? [{ node_id: multiSuccessor, role_id: f.role, goal: 'Extend the original behavior', dependencies: parallel ? [] : [f.node] }] : [])] });
    await this.finish(f, planned.operation_id!, planner.dispatch.attempt_id);
    if (input.kind === 'planning_issue') return f;
    await execution.pump();
    if (input.kind === 'node_queued') return f;
    let node = await this.promote(f);
    if (parallel) {
      const first = node;
      let second = await this.promote(f);
      const open = async (agent: Agent) => {
        const requested = await this.agent(f, agent, 'open_workspace', { resource_id: resource_id! });
        const op = await this.service.recoverOperation(f.runner, requested.operation_id!), w = op.workspace!;
        const metadata: WorkspaceMetadata = { generation: 1, storage_id: 'synthetic-browser-storage', lease_id: w.lease_id,
          repository_identity: w.resource.repository_identity, provider_metadata: { github: { repository_id: '42' } },
          base_commit: 'a'.repeat(40), target_branch: 'main', target_commit: 'b'.repeat(40),
          finalized_commit: w.basis?.finalized_commit ?? 'a'.repeat(40),
          isolation: { allocation_id: w.isolation!.allocation_id, start_commit: w.basis?.finalized_commit ?? 'a'.repeat(40) } };
        await this.service.finishOperation(f.runner, f.incarnation, { operation_id: op.operation_id, attempt_id: agent.dispatch.attempt_id,
          success: true, result: { workspace_id: w.workspace_id, path: `/synthetic/${w.isolation!.allocation_id}/worktree`, instruction_files: [], workspace_metadata: metadata } });
        return { workspace_id: w.workspace_id, metadata };
      };
      const finish = async (agent: Agent, opened: Awaited<ReturnType<typeof open>>, conflict: boolean, revision: string) => {
        const requested = await this.agent(f, agent, 'complete_node', { summary: `Parallel work produced revision ${revision.repeat(40)}; validation applies to that private result.` });
        const op = await this.service.recoverOperation(f.runner, requested.operation_id!);
        const integration = { outcome: conflict ? 'conflict' as const : 'integrated' as const, start_commit: opened.metadata.isolation!.start_commit,
          node_commit: revision.repeat(40), node_tree: 'd'.repeat(40), expected_task_commit: op.workspaces![0]!.integration!.expected_task_commit,
          task_commit: conflict ? op.workspaces![0]!.integration!.expected_task_commit : (revision === 'c' ? 'e' : 'f').repeat(40), task_tree: '1'.repeat(40) };
        await this.service.finishOperation(f.runner, f.incarnation, { operation_id: op.operation_id, attempt_id: agent.dispatch.attempt_id,
          success: true, result: { writer_absent: true, completion_outcome: conflict ? 'conflict' : 'finalized', workspace_results: [{resource_id: resource_id!, workspace_id: opened.workspace_id, integration, capture: { start_commit: integration.start_commit, node_commit: integration.node_commit, node_tree: integration.node_tree },
            workspace_metadata: { ...opened.metadata, finalized_commit: conflict ? opened.metadata.finalized_commit : integration.task_commit },
            ...(!conflict ? { git_commit: integration.task_commit, git_tree: integration.task_tree } : {}) }] } });
      };
      const a = await open(first); let b = await open(second);
      await finish(first, a, false, 'c');
      for (let index = 0; index < (input.kind === 'parallel_conflict' ? 3 : 1); index++) {
        await finish(second, b, input.kind === 'parallel_conflict', 'b');
        if (input.kind === 'parallel_conflict' && index < 2) { await execution.pump(); second = await this.promote(f); b = await open(second); }
      }
      return { ...f, node: second.dispatch.node_id!, resource_id, attempt_id: second.dispatch.attempt_id };
    }
    if (input.kind === 'multi_replan') {
      const done = await this.agent(f, node, 'complete_node', { summary: 'Verified existing behavior, retained by the replacement Plan.' });
      await this.finish(f, done.operation_id!, node.dispatch.attempt_id);
      await execution.pump(); node = await this.promote(f);
    }
    if (input.kind === 'running') return f;
    if (input.kind === 'log_pages') {
      for (let sequence = 1; sequence <= 70; sequence++) {
        const text = `Synthetic log entry ${String(sequence).padStart(3, '0')}: observed output only; formal results use the Tool Protocol.\n`;
        await this.service.event(f.runner, f.incarnation, {
          attempt_id: node.dispatch.attempt_id, dispatch_id: node.dispatch.dispatch_id,
          stream_id: 'stdout', sequence, order_sequence: sequence, kind: 'output', text,
          data_base64: Buffer.from(text).toString('base64'),
        });
      }
      return { ...f, attempt_id: node.dispatch.attempt_id, log_count: 70 };
    }
    for (const resource_id of resourceIds) {
      const opened = await this.agent(f, node, 'open_workspace', { resource_id });
      const operation = await this.service.recoverOperation(f.runner, opened.operation_id!);
      const workspace = operation.workspace!;
      const metadata: WorkspaceMetadata = {
        generation: 1, storage_id: 'synthetic-browser-storage', lease_id: workspace.lease_id,
        repository_identity: workspace.resource.repository_identity, provider_metadata: { github: { repository_id: '42' } },
        base_commit: 'a'.repeat(40), target_branch: 'main', target_commit: 'b'.repeat(40), finalized_commit: 'a'.repeat(40),
      };
      await this.service.finishOperation(f.runner, f.incarnation, {
        operation_id: operation.operation_id, attempt_id: node.dispatch.attempt_id, success: true,
        result: { workspace_id: workspace.workspace_id, path: '/synthetic/private/worktree', instruction_files: [], workspace_metadata: metadata },
      });
      this.workspaceSnapshots.set(node.dispatch.attempt_id, [...(this.workspaceSnapshots.get(node.dispatch.attempt_id) ?? []), { workspace_id: workspace.workspace_id, metadata }]);
      if (input.kind === 'running_workspace') return { ...f, resource_id, attempt_id: node.dispatch.attempt_id, workspace_id: workspace.workspace_id };
    }
    if (input.kind === 'blocked') {
      const blocked = await this.agent(f, node, 'block_node', { reason: 'Choose the intended fallback behavior before implementation continues.' });
      await this.finish(f, blocked.operation_id!, node.dispatch.attempt_id); return f;
    }
    if (['review', 'review_git', 'result_inspection', 'result_empty', 'completion_recovery', 'multi_repository_review'].includes(input.kind)) {
      const artifact_id = randomUUID();
      await this.agent(f, node, 'publish_artifact', { artifact_id, title: 'Verification notes', content: { media_type: 'text/markdown', text: '# Local verification\n\nThe synthetic fixture completed its formal result. No real Runtime or provider ran.\n\n<script>this must remain inert</script>' } });
      const completed = await this.agent(f, node, 'complete_node', { summary: 'The requested local result is ready for Owner review. Verification notes are attached.', artifact_ids: [artifact_id] });
      if (input.kind === 'completion_recovery') await this.service.finishOperation(f.runner, f.incarnation, { operation_id: completed.operation_id!, attempt_id: node.dispatch.attempt_id, success: false, failure_kind: 'recoverable', result: { writer_absent: true } });
      else await this.finish(f, completed.operation_id!, node.dispatch.attempt_id);
      if (input.kind === 'result_inspection' || input.kind === 'result_empty' || input.kind === 'multi_repository_review') {
        this.readCompletions.set(f.task, completed.operation_id!);
        await this.connectReadPeer(f, input.kind === 'result_empty');
      }
      return { ...f, resource_ids: resourceIds, artifact_id, operation_id: completed.operation_id, ...(resource_id ? { resource_id, attempt_id: node.dispatch.attempt_id, workspace_id: this.workspaceSnapshots.get(node.dispatch.attempt_id)![0]!.workspace_id, git_commit: 'c'.repeat(40), git_tree: 'd'.repeat(40) } : {}) };
    }
    const requested = await this.agent(f, node, 'request_replan', { reason: 'The current work definition needs replacement to satisfy the requested outcome.' });
    await this.finish(f, requested.operation_id!, node.dispatch.attempt_id);
    const replan = new TaskReplan(this.db, {}, this.service.instanceId); await replan.pump();
    const agent = await this.promote(f); const binding = agent.dispatch.task_replan_source!;
    if (input.kind === 'replan_issue') {
      const issue = await this.agent(f, agent, 'raise_planning_issue', { replan_request_id: binding.request_id, source_id: binding.source_id, reason: 'Which replacement outcome should be authoritative?' });
      await this.finish(f, issue.operation_id!, agent.dispatch.attempt_id);
      return { ...f, request_id: binding.request_id };
    }
    const task = (await this.db.pool.query('SELECT * FROM tasks WHERE id=$1', [f.task])).rows[0];
    const replacement = randomUUID();
    const sourceImpact = await transaction(this.db, (tx) => replanImpact(tx, task));
    const impact = replacementImpact(sourceImpact, replacement);
    if (input.kind === 'multi_replan') {
      const retained = sourceImpact.nodes.find(n => n.node_id === f.node)!;
      impact.nodes = validate<PrepareReplan['impact']>('ReplanImpact', { ...impact, nodes: [retained, ...impact.nodes.filter(n => n.node_id !== f.node)].sort((a, b) => a.node_id.localeCompare(b.node_id)) }).nodes;
    }
    const retainedDefinition = input.kind === 'multi_replan' ? (await this.db.pool.query('SELECT definition FROM plan_nodes WHERE plan_id=$1 AND node_id=$2', [task.plan_id, f.node])).rows[0].definition : undefined;

    const payload = validate<PrepareReplan>('PrepareReplan', { replan_request_id: binding.request_id, source_id: binding.source_id, proposal_id: randomUUID(), plan_id: randomUUID(), basis: await this.basis(f), nodes: [...(retainedDefinition ? [retainedDefinition] : []), { node_id: replacement, role_id: f.role, goal: 'Replace the formal work with the complete revised outcome', dependencies: retainedDefinition ? [f.node] : [] }, ...(retainedDefinition ? [{ node_id: randomUUID(), role_id: f.role, goal: 'Verify the complete integrated result', dependencies: [replacement] }] : [])], summary: 'Replace the work definition; retain private history without claiming previous completion.', impact, ...(input.kind === 'joint' ? { requirement: { proposal_id: randomUUID(), specification: '# Joint exact requirements\n\nReplace the previous outcome with independently verified accessible recovery.', summary: 'Update requirements together with the replacement Plan.' } } : {}) });
    const prepared = await this.agent(f, agent, 'prepare_replan', payload as CommandEnvelope['payload']);
    await this.finish(f, prepared.operation_id!, agent.dispatch.attempt_id);
    return { ...f, request_id: binding.request_id, proposal_id: payload.proposal_id, requirement_proposal_id: payload.requirement?.proposal_id };
  }

  async settle(token: string, taskId: string) {
    await transaction(this.db, (tx) => authenticateOwner(tx, token));
    const f = this.contexts.get(taskId); if (!f) throw new Error('Unknown browser fixture Task');
    const operations = (await this.db.pool.query("SELECT o.id,o.attempt_id FROM operations o JOIN attempts a ON a.id=o.attempt_id WHERE a.task_id=$1 AND o.state NOT IN ('succeeded','cancelled') ORDER BY o.created_at,o.id", [taskId])).rows;
    for (const operation of operations) await this.finish(f, operation.id, operation.attempt_id);
    await new TaskSpecification(this.db).pump();
    return { settled: operations.length };
  }

  async reset(token: string) {
    await transaction(this.db, (tx) => authenticateOwner(tx, token));
    for (const legacy of this.legacyBoardTasks) await this.owner(token, legacy, 'cancel_task', { specification_id: legacy.spec });
    this.legacyBoardTasks.length = 0;
    for (const f of this.contexts.values()) {
      await this.closeReadPeer(f.task);
      // Terminal Task questions are intentionally still schedulable. Resolve
      // fixture inputs explicitly so a later scenario cannot dispatch old chat.
      const conversation = new TaskConversation(this.db, this.service.instanceId);
      const inputs = (await this.db.pool.query("SELECT id,version FROM task_inputs WHERE task_id=$1 AND status IN ('pending','failed') ORDER BY created_at,id", [f.task])).rows;
      for (const input of inputs) await conversation.command(token, { schema_version: 1, request_id: randomUUID(), task_id: f.task, name: 'withdraw_task_input', expected_version: Number(input.version), payload: { operation_id: input.id } });
      const task = (await this.db.pool.query('SELECT state,specification_id,plan_id,initial_planning_intent_id FROM tasks WHERE id=$1', [f.task])).rows[0];
      if (!['COMPLETED', 'CANCELLED'].includes(task.state)) await this.owner(token, f, 'cancel_task', { specification_id: task.specification_id, ...(task.plan_id ? { plan_id: task.plan_id } : task.initial_planning_intent_id ? { planning_intent_id: task.initial_planning_intent_id } : {}) });
      await this.settle(token, f.task);
      await this.service.disconnect(f.runner, f.incarnation);
    }
    this.contexts.clear(); this.workspaceSnapshots.clear(); this.runnerCredentials.clear(); this.readCompletions.clear(); this.publicationPeers.clear(); this.remotePeers.clear(); return { reset: true };
  }

  // Only this test process owns synthetic read bytes. Authentication, socket
  // incarnation, broker routing and canonical result identity use createApp.
  private async connectReadPeer(f: Context, empty = false) {
    const socket = new WebSocket('ws://127.0.0.1:18555/v1/runner', { headers: { Authorization: `Bearer ${this.runnerCredentials.get(f.runner)}` } });
    const peer: ReadPeer = { socket, heartbeat: setInterval(() => {
      if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ schema_version: 1, type: 'heartbeat', incarnation: f.incarnation }));
    }, 1000), held: [], hold: false, requests: [], empty };
    peer.heartbeat.unref(); this.readPeers.set(f.task, peer);
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Synthetic read peer handshake timed out')), 5000);
      socket.once('error', () => { clearTimeout(timer); reject(new Error('Synthetic read peer connection failed')); });
      socket.on('message', data => {
        const frame = validate<Frame>('Frame', JSON.parse(data.toString()));
        if (frame.type === 'welcome') {
          f.incarnation = frame.incarnation!;
          const publication = this.publicationPeers.get(f.task);
          const remote = this.remotePeers.get(f.task);
          socket.send(JSON.stringify({ schema_version: 1, type: 'ready', incarnation: f.incarnation, log_modes: ['ordered_v1'], result_read_modes: ['git_objects_v1'], ...(publication && publication.mode !== 'unsupported' ? { publication_modes: ['local_candidate_v1'] } : {}), ...(remote && remote.mode !== 'unsupported' ? { remote_preparation_modes: ['github_review_v1'] } : {}) }));
          clearTimeout(timer); resolve();
        } else if (frame.type === 'publication_prepare') {
          const publication = this.publicationPeers.get(f.task), request = frame.publication_prepare!;
          if (!publication || request.source.task_id !== f.task || request.source.runner_id !== f.runner || request.source.operation_id !== this.readCompletions.get(f.task)) { socket.close(4003, 'Synthetic publication peer scope mismatch'); return; }
          publication.requests.set(request.operation_id, request);
          if (publication.mode === 'preparing') publication.held.set(request.operation_id, frame); else this.replyPublication(peer, publication, frame);
        } else if (frame.type === 'publication_push') {
          const remote = this.remotePeers.get(f.task), request = frame.publication_push!;
          if (!remote || request.task_id !== f.task || request.runner_id !== f.runner || request.resource_id !== remote.resource || request.preparation.source.operation_id !== this.readCompletions.get(f.task)) { socket.close(4003, 'Synthetic push peer scope mismatch'); return; }
          remote.pushes.set(request.operation_id, request);
          if (remote.mode === 'preparing' || remote.mode === 'offline') remote.held.set(request.operation_id, frame); else void this.replyPush(peer, remote, frame).catch(() => socket.close(4003, 'Synthetic push admission failed'));
        } else if (frame.type === 'result_read') {
          if (frame.result_read?.identity.task_id !== f.task || frame.result_read.identity.runner_id !== f.runner || frame.result_read.identity.operation_id !== this.readCompletions.get(f.task)) {
            socket.close(4003, 'Synthetic read peer scope mismatch'); return;
          }
          peer.requests.push(frame.result_read!);
          if (peer.hold) peer.held.push(frame); else this.replyRead(peer, frame);
        } else if (!['publication_ack', 'publication_push_ack', 'pong', 'ack'].includes(frame.type)) {
          this.publicationPeers.get(f.task)?.unexpected.push(frame.type);
        }
      });
      socket.once('open', () => socket.send(JSON.stringify({ schema_version: 1, type: 'hello', runner_id: f.runner, boot_id: 'synthetic-result-read-peer' })));
    });
    for (let index = 0; index < 100; index++) {
      const row = (await this.db.pool.query('SELECT ready,incarnation FROM runners WHERE id=$1', [f.runner])).rows[0];
      if (row?.ready && Number(row.incarnation) === f.incarnation) return;
      await new Promise(resolve => setTimeout(resolve, 10));
    }
    throw new Error('Synthetic read peer did not become ready');
  }
  private replyRead(peer: ReadPeer, frame: Frame) {
    const request = frame.result_read!;
    const response: ResultReadResponse = { schema_version: 1, request, status: peer.status ?? 'available' };
    if (response.status === 'available') {
      if (request.mode === 'changes') {
        const rows = peer.empty ? [] : resultChanges;
        const start = request.cursor ? (JSON.parse(Buffer.from(request.cursor, 'base64url').toString()).after as number) : 0;
        response.changes = rows.slice(start, start + 64); response.total_changes = rows.length;
        if (start + 64 < rows.length) response.next_cursor = Buffer.from(JSON.stringify({ after: start + 64, identity: request.identity_digest, version: 1 })).toString('base64url');
      } else {
        const change = resultChanges.find(row => row.path === request.path);
        const object = request.side === 'base' ? change?.old : change?.new;
        if (request.mode === 'diff') response.text = `--- a/${request.path}\n+++ b/${request.path}\n@@ -1 +1 @@\n-before\n+${literalText}`;
        else if (!object) response.status = 'absent';
        else if (request.path === 'binary.dat') { response.status = 'binary'; response.object = object; }
        else if (request.path === 'oversized.txt') { response.status = 'oversized'; response.object = object; }
        else {
          response.object = object;
          if (object.mode !== '160000') response.text = request.path === 'empty.txt' ? '' : request.path === 'link' ? '/outside/not-followed' : request.side === 'base' ? 'before\n' : literalText;
        }
      }
    }
    validate('ResultReadResponse', response);
    if (peer.socket.readyState === WebSocket.OPEN) peer.socket.send(JSON.stringify({ schema_version: 1, type: 'result_read_result', incarnation: frame.incarnation, correlation_id: frame.correlation_id, result_read_result: response }));
  }
  private async closeReadPeer(task: string) {
    const peer = this.readPeers.get(task); if (!peer) return;
    clearInterval(peer.heartbeat); this.readPeers.delete(task);
    if (peer.socket.readyState === WebSocket.CLOSED) return;
    await new Promise<void>(resolve => { peer.socket.once('close', () => resolve()); peer.socket.close(); });
  }
  async readPeer(token: string, task: string, action: 'observe' | 'hold' | 'release' | 'offline' | 'reconnect' | 'status', status?: ResultReadResponse['status']) {
    await transaction(this.db, tx => authenticateOwner(tx, token));
    if (!['observe', 'hold', 'release', 'offline', 'reconnect', 'status'].includes(action)) throw new Error('Invalid synthetic read peer action');
    const f = this.contexts.get(task); if (!f) throw new Error('Unknown synthetic read Task');
    const peer = this.readPeers.get(task);
    if (action === 'offline') { await this.closeReadPeer(task); await this.service.disconnect(f.runner, f.incarnation); return { offline: true }; }
    if (action === 'reconnect') { await this.closeReadPeer(task); await this.connectReadPeer(f); return { reconnected: true }; }
    if (!peer) throw new Error('Synthetic read peer is offline');
    if (action === 'hold') peer.hold = true;
    if (action === 'status') {
      if (!status || !['available', 'unavailable', 'scan_limit', 'unsupported_path', 'unsupported', 'busy', 'timeout'].includes(status)) throw new Error('Invalid synthetic read status');
      peer.status = status;
    }
    if (action === 'release') { peer.hold = false; for (const frame of peer.held.splice(0)) this.replyRead(peer, frame); }
    return { held: peer.held.length, requests: peer.requests, synthetic: true };
  }
  async closeReadPeers() { for (const task of this.readPeers.keys()) await this.closeReadPeer(task); }

  private async basis(f: Context): Promise<TaskActionBasis> {
    const task = (await this.db.pool.query('SELECT * FROM tasks WHERE id=$1', [f.task])).rows[0];
    const node = (await this.db.pool.query('SELECT * FROM nodes WHERE id=$1', [f.node])).rows[0];
    return { control_version: Number(task.control_version), specification_id: task.specification_id, plan_id: task.plan_id, ...(node ? { node_id: node.id, node_activation: Number(node.activation), source_id: node.execution_source_id } : {}) };
  }
  private async owner(token: string, f: Context, name: OwnerCommand['name'], payload: OwnerCommand['payload']) { return new OwnerCommands(this.db).confirm(token, { schema_version: 1, request_id: randomUUID(), scope_id: f.task, expected_control_version: (await this.basis(f)).control_version, name, payload }); }
  private async promote(f: Context): Promise<Agent> {
    await this.service.touch(f.runner, f.incarnation, true);
    const dispatch = await new DispatchQueue(this.db).promoteNext(f.runner, this.service.instanceId, f.incarnation);
    if (!dispatch || dispatch.task_id !== f.task) throw new Error('Browser fixture dispatch scope mismatch');
    const grant = await this.service.authorize(f.runner, f.incarnation, dispatch.dispatch_id);
    if (!grant) throw new Error('Browser fixture grant unavailable');
    return { dispatch, credential: grant.credential };
  }
  private agent(f: Context, agent: Agent, name: CommandEnvelope['name'], payload: CommandEnvelope['payload']) { return this.service.admit(agent.credential, submission({ schema_version: 1, request_id: randomUUID(), scope_id: f.task, expected_control_version: agent.dispatch.control_version, name, payload })); }
  private completedResult(operation: Operation, attemptId: string): EffectResult {
    return { writer_absent: true, completion_outcome: 'finalized', workspace_results: operation.workspaces!.map(input => {
      const snapshot = this.workspaceSnapshots.get(attemptId)?.find(value => value.workspace_id === input.workspace.workspace_id);
      if (!snapshot) throw new Error('Missing synthetic completion member snapshot');
      const capture = { start_commit: snapshot.metadata.isolation?.start_commit ?? snapshot.metadata.finalized_commit, node_commit: 'c'.repeat(40), node_tree: 'd'.repeat(40) };
      const integration = input.integration ? { ...capture, outcome: 'integrated' as const, expected_task_commit: input.integration.expected_task_commit, task_commit: capture.node_commit, task_tree: capture.node_tree } : undefined;
      return { resource_id: input.workspace.resource_id, workspace_id: snapshot.workspace_id, workspace_metadata: { ...snapshot.metadata, finalized_commit: capture.node_commit }, capture, git_commit: capture.node_commit, git_tree: capture.node_tree, ...(integration ? { integration } : {}) };
    }) };
  }
  private async finish(f: Context, operation_id: string, attempt_id: string) {
    const operation = await this.service.recoverOperation(f.runner, operation_id);
    if (operation.kind === 'complete_node') {
      return this.service.finishOperation(f.runner, f.incarnation, { operation_id, attempt_id, success: true, result: this.completedResult(operation, attempt_id) });
    }
    if (operation.kind === 'settle_completion') {
      const original = await this.service.recoverOperation(f.runner, operation.completion_operation_id!);
      return this.service.finishOperation(f.runner, f.incarnation, { operation_id, attempt_id, success: true, result: { writer_absent: true }, completion_settlement: { completion_operation_id: original.operation_id, disposition: 'already_finalized', completion_result: { operation_id: original.operation_id, attempt_id, success: true, result: this.completedResult(original, attempt_id) } } });
    }
    const snapshot = this.workspaceSnapshots.get(attempt_id)?.find(value => value.workspace_id === operation.workspace?.workspace_id);
    if (operation.kind === 'stop' && snapshot) {
      return this.service.finishOperation(f.runner, f.incarnation, { operation_id, attempt_id, success: true, result: { writer_absent: true, workspace_id: snapshot.workspace_id, workspace_metadata: { ...snapshot.metadata, checkpoint: { operation_id, head_commit: 'e'.repeat(40), tree_id: 'f'.repeat(40), commit_id: 'e'.repeat(40) } } } });
    }
    return this.service.finishOperation(f.runner, f.incarnation, { operation_id, attempt_id, success: true, result: { writer_absent: true } });
  }
}
