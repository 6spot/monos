import {OwnerDeliveryCommands} from './owner-delivery-commands.ts';
import {OwnerDeliveryReads} from './owner-delivery-reads.ts';
import {ownerDeliveryHooks} from './owner-delivery-control.ts';
import {TaskReviewCommands} from './task-review-commands.ts';
import {TaskReviewReads} from './task-review-reads.ts';
import {ownerReviewHooks} from './owner-review-control.ts';
import { PublicationPreparation } from './publication-candidates.ts';
import { PublicationCandidateReads } from './publication-candidate-reads.ts';
import { PublicationCommands } from './publication-commands.ts';
import {RemotePreparation} from './remote-preparation.ts';
import {RemotePreparationReads} from './remote-preparation-reads.ts';
import {RemotePreparationCommands} from './remote-preparation-commands.ts';
import {RemotePreparationAccess} from './remote-preparation-access.ts';
import {GitHubRemote} from './github-remote.ts';
import { ResultReadBroker } from "./result-read-broker.ts";
import { resultContent } from "./result-content-reads.ts";
import { TaskReplan } from './task-replan.ts';
import { TaskSpecification } from './task-specification.ts';
import { TaskConversation } from './task-conversation.ts';
import Fastify from 'fastify';
import { WebSocketServer, WebSocket } from 'ws';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { CommandError } from '../../../packages/domain/src/commands.ts';
import { RemoteProviderWaiting } from './remote-preparation-state.ts';
import { MAX_BODY_BYTES, MAX_FRAME_BYTES, parseFrame, ProtocolValidationError, ProtocolVersionError, validate } from '../../../packages/protocol/src/index.ts';
import type { CommandResult, Frame, InventoryQuery } from '../../../packages/protocol/src/index.ts';
import type { BoundaryService } from './service.ts';
import { OwnerCommands } from './owner-commands.ts';
import { OwnerReads } from './owner-reads.ts';
import { taskBoard } from './task-board-reads.ts';
import { taskResults } from './task-result-reads.ts';
import { attemptWorkspace } from './task-workspace-reads.ts';
import { OwnerAccess } from './owner-access.ts';
import { Configuration } from './configuration.ts';
import { Todos } from './todos.ts';
import { Discussion } from './discussion.ts';
import { TodoAttemptReads } from './todo-attempt-reads.ts';
import { NodeExecution } from './node-execution.ts';
import { ownerArtifact, ownerArtifacts } from './artifacts.ts';
import { TaskPlanning } from './task-planning.ts';
import { TaskPreviews } from './task-previews.ts';
import { GitHub } from './github.ts';
import fastifyStatic from '@fastify/static';
import { join } from 'node:path';

function bearer(request: { headers: { authorization?: string } }): string {
  const match = /^Bearer ([^\s]+)$/.exec(request.headers.authorization ?? '');
  if (!match) throw new CommandError('unauthorized', 'Bearer authentication required');
  return match[1]!;
}

function sameOrigin(request: FastifyRequest): void {
  let expected: string;
  try { expected = new URL(`${request.protocol}://${request.headers.host}`).origin; }
  catch { throw new CommandError('denied_scope', 'Same-origin request required'); }
  if (request.headers.origin !== expected) throw new CommandError('denied_scope', 'Same-origin request required');
}

function ownerCredential(request: FastifyRequest): string {
  if (request.headers.authorization !== undefined) return bearer(request);
  const cookies = (request.headers.cookie ?? '').split(';').map((item) => item.trim()).filter((item) => item.startsWith('__Host-monos='));
  if (cookies.length !== 1) throw new CommandError('unauthorized', 'Owner session required');
  if (!['GET', 'HEAD'].includes(request.method)) sameOrigin(request);
  return cookies[0]!.slice('__Host-monos='.length);
}

const sessionCookie = (token: string, maxAge: number) => `__Host-monos=${token}; Path=/; Secure; HttpOnly; SameSite=Strict; Max-Age=${maxAge}`;

function errorResult(error: unknown): CommandResult {
  if (error instanceof ProtocolVersionError) return { schema_version: 1, status: 'error', error: { code: 'unsupported_version', message: 'Unsupported protocol version' } };
  if (error instanceof ProtocolValidationError) return { schema_version: 1, status: 'error', error: { code: 'invalid_input', message: 'Request does not match the protocol schema' } };
  if (error && typeof error === 'object' && 'statusCode' in error && (error.statusCode === 400 || error.statusCode === 413 || error.statusCode === 415)) return { schema_version: 1, status: 'error', error: { code: 'invalid_input', message: 'Malformed, unsupported or oversized request body' } };
  return { schema_version: 1, status: 'error', error: error instanceof CommandError ? error.detail : { code: 'internal_error', message: 'Internal operation failed; reconcile existing request before retry' } };
}

export function createApp(service: BoundaryService, tls?: { key: Buffer; cert: Buffer }, webRoot?: string, options:{remoteProvider?:GitHubRemote}={}) {
  const app = Fastify({ ...(tls ? { https: tls } : {}), bodyLimit: MAX_BODY_BYTES, logger: { level: 'warn', redact: ['req.headers.authorization', 'req.headers.cookie', 'res.headers.set-cookie'] }, disableRequestLogging: true });
  app.setErrorHandler((error: unknown, request: FastifyRequest, reply: FastifyReply) => {
    if (webRoot && (request.url === '/' || request.url.startsWith('/assets/')) && error && typeof error === 'object' && 'statusCode' in error && typeof error.statusCode === 'number' && [400, 403, 404].includes(error.statusCode)) {
      void reply.header('Cache-Control', 'no-store').code(error.statusCode).send({ error: 'Static resource unavailable' });
      return;
    }
    const result = errorResult(error);
    const code = result.error!.code;
    if (code === 'rate_limited') void reply.header('Retry-After', error instanceof RemoteProviderWaiting ? String(error.retry_after_seconds) : '60');
    void reply.code(code === 'unauthorized' ? 401 : code === 'denied_scope' ? 403 : code === 'rate_limited' ? 429 : code === 'internal_error' ? 500 : 409).send(result);
  });
  app.addHook('onRequest', async (request, reply) => { if (request.url.startsWith('/v1/owner/')) {void reply.header('Cache-Control', 'no-store');if(request.url.includes('/remote-preparation')||request.url.includes('/delivery')||request.url.includes('/review'))void reply.header('X-Content-Type-Options','nosniff');} });
  app.get('/health', async () => { await service.db.pool.query('SELECT 1'); return { schema_version: 1, database: 'ready', probe: true }; });
  const resultReads = new ResultReadBroker();
  const publication = new PublicationPreparation(service.db,service.instanceId);
  const publicationReads = new PublicationCandidateReads(service.db,service.instanceId);
  const publicationCommands = new PublicationCommands(service.db);
  const ownerDeliveryCommands=new OwnerDeliveryCommands(service.db,ownerDeliveryHooks);
  const ownerDeliveryReads=new OwnerDeliveryReads(service.db);
  const reviewCommands=new TaskReviewCommands(service.db,ownerReviewHooks);
  const reviewReads=new TaskReviewReads(service.db);
  const remoteProvider=options.remoteProvider??new GitHubRemote(service.options.github??new GitHub(service.options.signingKey));
  const remote=new RemotePreparation(service.db,service.instanceId,remoteProvider);
  const remoteReads=new RemotePreparationReads(service.db,service.instanceId);
  const remoteCommands=new RemotePreparationCommands(service.db);
  const remoteAccess=new RemotePreparationAccess(service,remoteProvider);
  const owner = new OwnerCommands(service.db);
  const reads = new OwnerReads(service.db);
  const access = new OwnerAccess(service.db);
  app.addHook('onRequest', async request => {
    if (!request.url.startsWith('/v1/owner/') || request.headers['x-monos-session'] === undefined) return;
    const expected = validate<string>('Id', request.headers['x-monos-session']);
    const actual = await access.session(ownerCredential(request));
    if (expected !== actual.session_id) throw new CommandError('unauthorized', 'Owner session changed; reload the authenticated workspace');
  });
  const configuration = new Configuration(service.db, new GitHub(service.options.signingKey));
  const todos = new Todos(service.db);
  const discussion = new Discussion(service.db, service.instanceId);
  const todoAttempts = new TodoAttemptReads(service.db);
  const specifications = new TaskSpecification(service.db);
  const replans = new TaskReplan(service.db);
  const execution = new NodeExecution(service.db,service.instanceId);
  const conversation = new TaskConversation(service.db,service.instanceId);
  const planning = new TaskPlanning(service.db, service.instanceId);
  const taskPreviews = new TaskPreviews(service.db);
  if (webRoot) {
    void app.register(fastifyStatic, { root: join(webRoot, 'assets'), prefix: '/assets/', index: false, dotfiles: 'deny', immutable: true, maxAge: '1y' });
    app.get('/', async (_request, reply) => reply.header('Cache-Control', 'no-store').sendFile('index.html', webRoot, { cacheControl: false }));
  }
  app.post('/v1/owner/tasks/delivery/commands',async request=>ownerDeliveryCommands.command(ownerCredential(request),request.body));
  app.post('/v1/owner/tasks/review/commands',async request=>reviewCommands.command(ownerCredential(request),request.body));
  app.get<{Params:{task_id:string}}>('/v1/owner/tasks/:task_id/review',async request=>reviewReads.task(ownerCredential(request),request.params.task_id,request.query));
  app.get<{Params:{task_id:string;feedback_id:string}}>('/v1/owner/tasks/:task_id/review/feedback/:feedback_id',async request=>reviewReads.feedback(ownerCredential(request),request.params.task_id,request.params.feedback_id,request.query));
  app.get<{Params:{task_id:string;operation_id:string}}>('/v1/owner/tasks/:task_id/review/operations/:operation_id',async request=>reviewReads.operation(ownerCredential(request),request.params.task_id,request.params.operation_id));
  app.get<{Params:{task_id:string;request_id:string}}>('/v1/owner/tasks/:task_id/review/commands/:request_id',async request=>reviewCommands.status(ownerCredential(request),request.params.task_id,request.params.request_id));
  app.get<{Params:{task_id:string}}>('/v1/owner/tasks/:task_id/delivery',async request=>ownerDeliveryReads.task(ownerCredential(request),request.params.task_id,request.query));
  app.get<{Params:{task_id:string;proposal_id:string}}>('/v1/owner/tasks/:task_id/delivery/proposals/:proposal_id',async request=>ownerDeliveryReads.proposal(ownerCredential(request),request.params.task_id,request.params.proposal_id));
  app.get<{Params:{task_id:string;operation_id:string}}>('/v1/owner/tasks/:task_id/delivery/batches/:operation_id',async request=>ownerDeliveryReads.batch(ownerCredential(request),request.params.task_id,request.params.operation_id));
  app.get<{Params:{task_id:string;request_id:string}}>('/v1/owner/tasks/:task_id/delivery/commands/:request_id',async request=>ownerDeliveryCommands.status(ownerCredential(request),request.params.task_id,request.params.request_id));
  app.post('/v1/owner/tasks/publication/commands', async request => publicationCommands.command(ownerCredential(request),request.body));
  app.get<{Params:{task_id:string;request_id:string}}>('/v1/owner/tasks/:task_id/publication/commands/:request_id', async request => publicationCommands.receipt(ownerCredential(request),request.params.task_id,request.params.request_id));
  app.get<{Params:{task_id:string}}>('/v1/owner/tasks/:task_id/publication-candidates', async (request,reply) => {reply.header('X-Content-Type-Options','nosniff');return publicationReads.list(ownerCredential(request),request.params.task_id,request.query);});
  app.get<{Params:{task_id:string;candidate_id:string}}>('/v1/owner/tasks/:task_id/publication-candidates/:candidate_id', async (request,reply) => {reply.header('X-Content-Type-Options','nosniff');return publicationReads.candidate(ownerCredential(request),request.params.task_id,request.params.candidate_id);});
  app.get<{Params:{task_id:string;candidate_id:string}}>('/v1/owner/tasks/:task_id/publication-candidates/:candidate_id/findings', async (request,reply) => {reply.header('X-Content-Type-Options','nosniff');return publicationReads.findings(ownerCredential(request),request.params.task_id,request.params.candidate_id,request.query);});
  app.get<{Params:{task_id:string}}>('/v1/owner/tasks/:task_id/remote-preparation',async request=>remoteReads.list(ownerCredential(request),request.params.task_id,request.query));
  app.get<{Params:{task_id:string;item_id:string}}>('/v1/owner/tasks/:task_id/remote-preparation/:item_id',async request=>remoteReads.item(ownerCredential(request),request.params.task_id,request.params.item_id));
  app.get<{Params:{task_id:string;item_id:string;observation_id:string}}>('/v1/owner/tasks/:task_id/remote-preparation/:item_id/checks/:observation_id',async request=>remoteReads.checks(ownerCredential(request),request.params.task_id,request.params.item_id,request.params.observation_id,request.query));
  app.post('/v1/owner/tasks/remote-preparation/commands',async request=>remoteCommands.command(ownerCredential(request),request.body));
  app.get<{Params:{task_id:string;request_id:string}}>('/v1/owner/tasks/:task_id/remote-preparation/commands/:request_id',async request=>remoteCommands.receipt(ownerCredential(request),request.params.task_id,request.params.request_id));
  app.post<{Params:{operation_id:string}}>('/v1/runner/remote-preparation/:operation_id/access',{bodyLimit:16*1024,onRequest:async(_request,reply)=>{void reply.header('Cache-Control','no-store');}},async request=>remoteAccess.access(bearer(request),request.params.operation_id,request.body));
  app.post<{Params:{operation_id:string}}>('/v1/runner/publication-operations/:operation_id/permission',{bodyLimit:16*1024,onRequest:async(_request,reply)=>{void reply.header('Cache-Control','no-store');}},async request=>remoteAccess.permission(bearer(request),request.params.operation_id,request.body));
  app.get('/v1/owner/configuration', async (request) => configuration.read(ownerCredential(request)));
  app.get('/v1/owner/todos', async (request) => todos.list(ownerCredential(request), request.query));
  app.post('/v1/owner/task-previews/commands', async (request) => taskPreviews.command(ownerCredential(request), request.body));
  app.get<{ Params: { request_id: string } }>('/v1/owner/task-previews/commands/:request_id', async (request) => taskPreviews.receipt(ownerCredential(request), request.params.request_id));
  app.get<{ Params: { todo_id: string; message_id: string }; Querystring: { project_id?: string } }>('/v1/owner/todos/:todo_id/task-previews/:message_id', async (request) => {
    validate('TaskPreviewQuery', request.query); return taskPreviews.read(ownerCredential(request), request.params.todo_id, request.params.message_id, request.query.project_id);
  });
  app.post('/v1/owner/todos/discussion/commands', async (request) => discussion.command(ownerCredential(request), request.body));
  app.get<{ Params: { request_id: string } }>('/v1/owner/todos/discussion/commands/:request_id', async (request) => discussion.receipt(ownerCredential(request), request.params.request_id));
  app.get<{ Params: { todo_id: string } }>('/v1/owner/todos/:todo_id/discussion', async (request) => discussion.status(ownerCredential(request), request.params.todo_id));
  app.get<{ Params: { todo_id: string }; Querystring: { cursor?: string } }>('/v1/owner/todos/:todo_id/discussion/messages', async (request) => {
    validate('AttemptListQuery', request.query); return discussion.messages(ownerCredential(request), request.params.todo_id, request.query.cursor);
  });
  app.get<{ Params: { todo_id: string }; Querystring: { cursor?: string } }>('/v1/owner/todos/:todo_id/attempts', async (request) => {
    validate('AttemptListQuery', request.query); return todoAttempts.attempts(ownerCredential(request), request.params.todo_id, request.query.cursor);
  });
  app.get<{ Params: { todo_id: string; attempt_id: string } }>('/v1/owner/todos/:todo_id/attempts/:attempt_id', async (request) => todoAttempts.attempt(ownerCredential(request), request.params.todo_id, request.params.attempt_id));
  app.get<{ Params: { todo_id: string; attempt_id: string }; Querystring: { cursor?: string } }>('/v1/owner/todos/:todo_id/attempts/:attempt_id/logs', async (request) => {
    validate('AttemptListQuery', request.query); return todoAttempts.logs(ownerCredential(request), request.params.todo_id, request.params.attempt_id, request.query.cursor);
  });
  app.get<{ Params: { todo_id: string; operation_id: string } }>('/v1/owner/todos/:todo_id/operations/:operation_id', async (request) => todoAttempts.operation(ownerCredential(request), request.params.todo_id, request.params.operation_id));
  app.get<{ Params: { todo_id: string } }>('/v1/owner/todos/:todo_id', async (request) => todos.read(ownerCredential(request), request.params.todo_id));
  app.post('/v1/owner/todos/commands', async (request) => todos.command(ownerCredential(request), request.body));
  app.get<{ Params: { request_id: string } }>('/v1/owner/todos/commands/:request_id', async (request) => todos.status(ownerCredential(request), request.params.request_id));
  app.get('/v1/owner/infrastructure', async (request) => configuration.infrastructure(ownerCredential(request), service.instanceId));
  app.get<{ Querystring: { page?: string } }>('/v1/owner/github/repositories', async (request) => {
    if (Object.keys(request.query).some((key) => key !== 'page') || (request.query.page !== undefined && !/^[1-9][0-9]{0,3}$/.test(request.query.page))) throw new CommandError('invalid_input', 'Invalid repository page');
    return configuration.repositories(ownerCredential(request), Number(request.query.page ?? 1));
  });
  app.post('/v1/owner/configuration/commands', async (request) => configuration.save(ownerCredential(request), request.body));
  app.get<{ Params: { request_id: string } }>('/v1/owner/configuration/commands/:request_id', async (request) => configuration.status(ownerCredential(request), request.params.request_id));
  app.post('/v1/owner/login', { bodyLimit: 4096 }, async (request, reply) => {
    sameOrigin(request);
    const body = validate<{ schema_version: 1; password: string }>('OwnerLogin', request.body);
    const session = await access.login(body.password);
    void reply.header('Set-Cookie', sessionCookie(session.token, Math.max(0, Math.floor((Date.parse(session.expires_at) - Date.now()) / 1000))));
    return validate('OwnerSessionStatus', { schema_version: 1, authenticated: true, session_id: session.session_id, expires_at: session.expires_at });
  });
  app.get('/v1/owner/session', async (request) => validate('OwnerSessionStatus', await access.session(ownerCredential(request))));
  app.post('/v1/owner/logout', async (request, reply) => {
    if (request.body !== undefined) throw new CommandError('invalid_input', 'Logout does not accept a payload');
    await access.logout(ownerCredential(request));
    void reply.header('Set-Cookie', sessionCookie('', 0));
    return { schema_version: 1, authenticated: false };
  });
  app.get('/v1/owner/tasks', async request => taskBoard(service.db, ownerCredential(request), request.query));
  app.get<{ Params: { task_id: string }; Querystring: { cursor?: string } }>('/v1/owner/tasks/:task_id/results', async request => {
    validate('TaskResultQuery', request.query);
    return taskResults(service.db, ownerCredential(request), request.params.task_id, request.query.cursor);
  });
  for (const mode of ['changes','file','diff'] as const) app.get<{Params:{task_id:string;operation_id:string}}>(`/v1/owner/tasks/:task_id/results/:operation_id/${mode}`,async (request,reply)=>{
    reply.header('Cache-Control','no-store').header('X-Content-Type-Options','nosniff');
    return resultContent(service,resultReads,ownerCredential(request),request.headers['x-monos-session'] as string|undefined,request.params.task_id,request.params.operation_id,mode,request.query);
  });
  app.get<{ Params: { task_id: string; node_id:string } }>('/v1/owner/tasks/:task_id/nodes/:node_id/execution', async request => execution.status(ownerCredential(request),request.params.task_id,request.params.node_id));
  app.get<{ Params: { task_id: string }; Querystring: { cursor?:string } }>('/v1/owner/tasks/:task_id/artifacts', async request => ownerArtifacts(service.db,ownerCredential(request),request.params.task_id,request.query.cursor));
  app.get<{ Params: { task_id: string; artifact_id:string } }>('/v1/owner/tasks/:task_id/artifacts/:artifact_id', async (request,reply) => {reply.header('cache-control','no-store').header('x-content-type-options','nosniff');return ownerArtifact(service.db,ownerCredential(request),request.params.task_id,request.params.artifact_id);});
  app.get<{Params:{task_id:string};Querystring:{cursor?:string}}>('/v1/owner/tasks/:task_id/conversation/operations',async request=>{validate('AttemptListQuery',request.query);return conversation.operations(ownerCredential(request),request.params.task_id,request.query.cursor);});
  app.get<{Params:{task_id:string;guidance_id:string};Querystring:{cursor?:string}}>('/v1/owner/tasks/:task_id/conversation/guidance/:guidance_id/recipients',async request=>{validate('AttemptListQuery',request.query);return conversation.recipients(ownerCredential(request),request.params.task_id,request.params.guidance_id,request.query.cursor);});
  app.get<{Params:{task_id:string};Querystring:{cursor?:string}}>('/v1/owner/tasks/:task_id/specification/proposals',async request=>{validate('SpecificationHistoryQuery',request.query);return specifications.history(ownerCredential(request),request.params.task_id,'proposals',request.query.cursor);});
  app.get<{Params:{task_id:string};Querystring:{cursor?:string}}>('/v1/owner/tasks/:task_id/specification/revisions',async request=>{validate('SpecificationHistoryQuery',request.query);return specifications.history(ownerCredential(request),request.params.task_id,'revisions',request.query.cursor);});
  app.get<{Params:{task_id:string;revision_id:string}}>('/v1/owner/tasks/:task_id/specification/revisions/:revision_id',async request=>specifications.history(ownerCredential(request),request.params.task_id,'revisions',undefined,request.params.revision_id));
  app.get<{Params:{task_id:string;change_id:string};Querystring:{cursor?:string}}>('/v1/owner/tasks/:task_id/specification/changes/:change_id',async request=>{validate('SpecificationHistoryQuery',request.query);return specifications.change(ownerCredential(request),request.params.task_id,request.params.change_id,request.query.cursor);});
  app.post('/v1/owner/tasks/replan/commands',async request=>replans.command(ownerCredential(request),request.body));
  app.get<{Params:{task_id:string};Querystring:{cursor?:string}}>('/v1/owner/tasks/:task_id/replan',async request=>{validate('SpecificationHistoryQuery',request.query);return replans.status(ownerCredential(request),request.params.task_id,undefined,undefined,request.query.cursor);});
  app.get<{Params:{task_id:string;id:string};Querystring:{cursor?:string;effects_cursor?:string}}>('/v1/owner/tasks/:task_id/replan/requests/:id',async request=>{validate('ReplanReadQuery',request.query);return replans.status(ownerCredential(request),request.params.task_id,request.params.id,undefined,request.query.cursor,request.query.effects_cursor);});
  app.get<{Params:{task_id:string;id:string}}>('/v1/owner/tasks/:task_id/replan/proposals/:id',async request=>replans.status(ownerCredential(request),request.params.task_id,undefined,request.params.id));
  app.get<{Params:{task_id:string;request_id:string}}>('/v1/owner/tasks/:task_id/replan/commands/:request_id',async request=>replans.receipt(ownerCredential(request),request.params.task_id,request.params.request_id));
  app.post('/v1/owner/tasks/specification/commands',async request=>specifications.command(ownerCredential(request),request.body));
  app.get<{Params:{task_id:string}}>('/v1/owner/tasks/:task_id/specification',async request=>specifications.status(ownerCredential(request),request.params.task_id));
  app.get<{Params:{task_id:string;proposal_id:string}}>('/v1/owner/tasks/:task_id/specification/proposals/:proposal_id',async request=>specifications.status(ownerCredential(request),request.params.task_id,request.params.proposal_id));
  app.get<{Params:{task_id:string;request_id:string}}>('/v1/owner/tasks/:task_id/specification/commands/:request_id',async request=>specifications.receipt(ownerCredential(request),request.params.task_id,request.params.request_id));
  app.post('/v1/owner/tasks/conversation/commands' ,async request=>conversation.command(ownerCredential(request),request.body));
  app.get<{Params:{task_id:string}}>('/v1/owner/tasks/:task_id/conversation',async request=>conversation.status(ownerCredential(request),request.params.task_id));
  app.get<{Params:{task_id:string};Querystring:{cursor?:string;query?:string}}>('/v1/owner/tasks/:task_id/conversation/messages',async request=>{validate('TaskHistoryQuery',request.query);return conversation.messages(ownerCredential(request),request.params.task_id,request.query.cursor,request.query.query);});
  app.get<{Params:{task_id:string;request_id:string}}>('/v1/owner/tasks/:task_id/conversation/commands/:request_id',async request=>conversation.receipt(ownerCredential(request),request.params.task_id,request.params.request_id));
  app.get<{ Params: { task_id: string } }>('/v1/owner/tasks/:task_id/planning', async (request) => planning.status(ownerCredential(request), request.params.task_id));
  app.get<{ Params: { task_id: string; plan_id: string } }>('/v1/owner/tasks/:task_id/plans/:plan_id', async (request) => planning.plan(ownerCredential(request), request.params.task_id, request.params.plan_id));
  app.get<{ Params: { task_id: string } }>('/v1/owner/tasks/:task_id', async (request) => reads.overview(ownerCredential(request), request.params.task_id));
  app.get<{ Params: { task_id: string }; Querystring: { cursor?: string } }>('/v1/owner/tasks/:task_id/events', async (request) => {
    validate('TaskEventsQuery', request.query);
    return reads.events(ownerCredential(request), request.params.task_id, request.query.cursor);
  });
  app.get<{ Params: { task_id: string }; Querystring: { cursor?: string } }>('/v1/owner/tasks/:task_id/attempts', async (request) => {
    validate('AttemptListQuery', request.query);
    return reads.attempts(ownerCredential(request), request.params.task_id, request.query.cursor);
  });
  app.get<{ Params: { task_id: string; attempt_id: string } }>('/v1/owner/tasks/:task_id/attempts/:attempt_id', async (request) => reads.attempt(ownerCredential(request), request.params.task_id, request.params.attempt_id));
  app.get<{ Params: { task_id: string; attempt_id: string }; Querystring: Record<string, unknown> }>('/v1/owner/tasks/:task_id/attempts/:attempt_id/workspace', async request => {
    if (Object.keys(request.query).length) throw new CommandError('invalid_input', 'Workspace read does not accept query fields');
    return attemptWorkspace(service.db, ownerCredential(request), request.params.task_id, request.params.attempt_id);
  });
  app.get<{ Params: { task_id: string; attempt_id: string }; Querystring: { cursor?: string } }>('/v1/owner/tasks/:task_id/attempts/:attempt_id/logs', async (request) => {
    validate('AttemptLogsQuery', request.query);
    return reads.logs(ownerCredential(request), request.params.task_id, request.params.attempt_id, request.query.cursor);
  });
  app.post('/v1/owner/commands', async (request) => owner.confirm(ownerCredential(request), request.body));
  app.get<{ Params: { scope_id: string; request_id: string } }>('/v1/owner/scopes/:scope_id/commands/:request_id', async (request) => owner.status(ownerCredential(request), request.params.scope_id, request.params.request_id));
  app.get<{ Params: { task_id: string; operation_id: string } }>('/v1/owner/tasks/:task_id/operations/:operation_id', async (request) => owner.operation(ownerCredential(request), request.params.task_id, request.params.operation_id));
  app.post('/v1/commands', async (request) => service.admit(bearer(request), request.body));
  app.get<{ Params: { request_id: string } }>('/v1/commands/:request_id', async (request) => service.commandStatus(bearer(request), validate<string>('Id', request.params.request_id)));
  app.get<{ Querystring: InventoryQuery }>('/v1/runner/inventory', async (request) => {
    validate('InventoryQuery', request.query);
    return service.inventory(await service.authenticateRunner(bearer(request)), request.query.after, request.query.snapshot_id);
  });
  app.post<{ Params: { operation_id: string } }>('/v1/runner/operations/:operation_id/repository-access', {
    bodyLimit: 4096,
    onRequest: async (_request, reply) => { void reply.header('Cache-Control', 'no-store'); },
    errorHandler: (error, _request, reply) => {
      const detail = errorResult(error).error!;
      const prefix = detail.message.split(':')[0];
      const reason = ['unsupported_remote', 'credentials_missing', 'repository_denied'].includes(prefix!) ? prefix!
        : detail.code === 'unmet_precondition' ? 'repository_denied' : 'ownership_unresolved';
      return reply.header('Cache-Control', 'no-store').code(detail.code === 'unauthorized' ? 401 : detail.code === 'denied_scope' ? 403 : detail.code === 'internal_error' ? 500 : 409)
        .send(validate('RepositoryAccessError', { schema_version: 1, reason }));
    },
  }, async (request) => service.repositoryAccess(await service.authenticateRunner(bearer(request)), request.params.operation_id, request.body));
  app.get<{ Params: { attempt_id: string; request_id: string } }>('/v1/recovery/attempts/:attempt_id/commands/:request_id', async (request) => service.recoverCommand(await service.authenticateRunner(bearer(request)), validate<string>('Id', request.params.attempt_id), validate<string>('Id', request.params.request_id)));
  app.get<{ Params: { operation_id: string } }>('/v1/recovery/operations/:operation_id', async (request) => service.recoverOperation(await service.authenticateRunner(bearer(request)), validate<string>('Id', request.params.operation_id)));

  const sockets = new WebSocketServer({ noServer: true, maxPayload: MAX_FRAME_BYTES });
  app.server.on('upgrade', (request, socket, head) => {
    if (request.url !== '/v1/runner') { socket.destroy(); return; }
    void Promise.resolve().then(() => service.authenticateRunner(bearer(request))).then((runnerId) => {
      sockets.handleUpgrade(request, socket, head, (ws) => attach(ws, runnerId));
    }).catch(() => { socket.write('HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n'); socket.destroy(); });
  });

  function attach(ws: WebSocket, runnerId: string): void {
    let incarnation: number | undefined;
    let processing = Promise.resolve();
    let polling = false;
    let publicationSupported = false;
    let remoteSupported = false;
    let queuedMessages = 0;
    let queuedBytes = 0;
    const send = (frame: Frame) => {
      if (ws.readyState !== WebSocket.OPEN) return false;
      validate('Frame', frame);
      const body = JSON.stringify(frame);
      if (ws.bufferedAmount + Buffer.byteLength(body) > 4 * MAX_BODY_BYTES) { ws.close(4008, 'Control output backlog exceeded'); return false; }
      ws.send(body);
      return true;
    };
    const poll = setInterval(() => {
      if (incarnation === undefined || polling || ws.readyState !== WebSocket.OPEN) return;
      polling = true;
      void Promise.all([service.pending(runnerId, incarnation),publication.pending(runnerId,incarnation,publicationSupported),remote.pending(runnerId,incarnation,remoteSupported)]).then((groups) => groups.flat().forEach(send)).catch(() => ws.close(4001, 'Control connection unavailable')).finally(() => { polling = false; });
    }, 250);
    poll.unref();
    const helloDeadline = setTimeout(() => { if (incarnation === undefined) ws.close(4000, 'Version handshake required'); }, 5000);
    helloDeadline.unref();
    ws.on('message', (data) => {
      if (ws.readyState !== WebSocket.OPEN) return;
      const body = data.toString();
      const bytes = Buffer.byteLength(body);
      if (queuedMessages >= 64 || queuedBytes + bytes > 4 * MAX_BODY_BYTES) { ws.close(4008, 'Control input backlog exceeded'); return; }
      queuedMessages++; queuedBytes += bytes;
      processing = processing.then(async () => {
        // Closing a socket invalidates queued heartbeats/requests immediately;
        // draining a stalled queue must not revive its persisted availability.
        if (ws.readyState !== WebSocket.OPEN) return;
        let frame: Frame;
        try { frame = parseFrame(JSON.parse(body)); } catch { ws.close(4000, 'Invalid or incompatible frame'); return; }
        if(frame.type.startsWith('publication_') && bytes>512*1024){ws.close(4000,'Publication frame exceeds limit');return;}
        if (incarnation === undefined) {
          if (frame.type !== 'hello' || frame.runner_id !== runnerId) { ws.close(4003, 'Invalid Runner identity'); return; }
          incarnation = await service.connect(runnerId, frame.boot_id!);
          send({ schema_version: 1, type: 'welcome', runner_id: runnerId, incarnation });
          return;
        }
        if (frame.incarnation !== incarnation) throw new CommandError('stale_execution', 'Wrong connection incarnation');
        try {
          switch (frame.type) {
            case 'ready':
              if (!frame.log_modes?.includes('ordered_v1')) throw new CommandError('unmet_precondition', 'Runner does not support ordered execution logs');
              await service.touch(runnerId, incarnation, true, frame.runtimes);
              if(ws.readyState===WebSocket.OPEN){publicationSupported=frame.publication_modes?.includes('local_candidate_v1') ?? false;await service.db.pool.query('UPDATE runners SET publication_supported=$3 WHERE id=$1 AND incarnation=$2 AND connection_instance=$4',[runnerId,incarnation,publicationSupported,service.instanceId]);}
              if(ws.readyState===WebSocket.OPEN){remoteSupported=frame.remote_preparation_modes?.includes('github_review_v1')??false;await service.db.pool.query('UPDATE runners SET remote_preparation_supported=$3 WHERE id=$1 AND incarnation=$2 AND connection_instance=$4',[runnerId,incarnation,remoteSupported,service.instanceId]);}
              if (ws.readyState === WebSocket.OPEN) resultReads.register(runnerId,incarnation,ws,frame.result_read_modes?.includes("git_objects_v1") ?? false,send); break;
            case 'result_read_result':
              await service.touch(runnerId,incarnation);
              resultReads.response(runnerId,ws,frame); break;
            case 'publication_result': {
              await service.touch(runnerId,incarnation);
              const ack=await publication.finish(runnerId,incarnation,frame.publication_result);
              if(ack)send({schema_version:1,type:'publication_ack',incarnation,publication_ack:ack});break;
            }
            case 'publication_push_result': {
              await service.touch(runnerId,incarnation);
              const ack=await remote.finish(runnerId,incarnation,frame.publication_push_result);
              send({schema_version:1,type:'publication_push_ack',incarnation,publication_push_ack:ack});break;
            }
            case 'heartbeat': await service.touch(runnerId, incarnation); break;
            case 'authorize_dispatch': {
              const grant = await service.authorize(runnerId, incarnation, frame.dispatch_id!);
              send({ schema_version: 1, type: 'authorization', incarnation, correlation_id: frame.correlation_id!, allowed: grant !== null, ...(grant ?? {}) });
              break;
            }
            case 'event':
              await service.event(runnerId, incarnation, frame.event!);
              send({ schema_version: 1, type: 'event_ack', incarnation, attempt_id: frame.event!.attempt_id, stream_id: frame.event!.stream_id, sequence: frame.event!.sequence });
              break;
            case 'operation_result':
              await service.finishOperation(runnerId, incarnation, frame.operation_result!);
              send({ schema_version: 1, type: 'operation_ack', incarnation, operation_id: frame.operation_result!.operation_id });
              break;
            default: throw new CommandError('invalid_input', 'Frame is not a Runner request');
          }
        } catch (error) {
          send({ schema_version: 1, type: 'error', incarnation, error: errorResult(error).error!, ...(frame.correlation_id ? { correlation_id: frame.correlation_id } : {}) });
        }
      }).catch(() => ws.close(4001, 'Control request failed')).finally(() => { queuedMessages--; queuedBytes -= bytes; });
    });
    ws.on('error', () => { /* Close handler owns reconciliation; no raw errors or credentials logged. */ });
    ws.on('close', () => {
      resultReads.disconnect(runnerId,ws);
      clearInterval(poll); clearTimeout(helloDeadline);
      if (incarnation !== undefined) void service.disconnect(runnerId, incarnation).catch(() => undefined);
      // A hello already waiting on the database can finish after socket close.
      void processing.finally(async () => { if (incarnation !== undefined) { resultReads.disconnect(runnerId,ws); await service.disconnect(runnerId, incarnation); } }).catch(() => undefined);
    });
  }
  app.addHook('onClose', async () => {
    resultReads.shutdown();
    for (const ws of sockets.clients) ws.terminate();
    await new Promise<void>((resolve) => sockets.close(() => resolve()));
  });
  return app;
}
