import { execFileSync, spawn } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createServer as httpServer } from 'node:http';
import type { IncomingHttpHeaders, RequestListener, ServerResponse } from 'node:http';
import { createServer as httpsServer } from 'node:https';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { validate } from '../../../packages/protocol/src/index.ts';
import type { SetupReport } from '../../../packages/protocol/src/index.ts';
import { diagnoseSetup } from '../src/setup-doctor.ts';

const password = 'synthetic-doctor-owner-password';
const token = `owner.v1.${'a'.repeat(64)}`;
const session = { schema_version: 1, authenticated: true, session_id: 'doctor-session', expires_at: '2099-01-01T00:00:00.000Z' };
const reportPath = '/v1/owner/setup-readiness';
const source = fileURLToPath(new URL('../src/setup-doctor.ts', import.meta.url));

function readyReport(): SetupReport {
  return {
    schema_version: 1, observed_at: '2026-10-11T00:00:00.000Z', configuration_version: 1,
    schema: { status: 'current', current_version: 35, expected_version: 35 },
    planner: { status: 'available', source: 'planner', runner_id: 'runner-a', target: { runtime_id: 'opencode', runner_id: 'runner-a', model_id: 'model-a' } },
    projects: [{ project_id: 'project-a', name: 'Project A', status: 'configured', roles: [{ role_id: 'role-a', name: 'Role A', policy: { status: 'available', source: 'role', runner_id: 'runner-a', target: { runtime_id: 'opencode', runner_id: 'runner-a', model_id: 'model-a' } } }] }],
    runners: [{ runner_id: 'runner-a', capacity: 2, online: true, runtimes: [{ current: true, observed_at: '2026-10-11T00:00:00.000Z', installation: { runtime_id: 'opencode', availability: 'detected', executable: '/usr/bin/opencode', version: 'synthetic', supports_model: true, supports_thinking: false, model_ids: ['model-a'] } }] }],
    unverified: ['storage', 'cli_authentication', 'model_execution', 'git_read', 'git_write'],
  };
}

type Stage = 'login' | 'report' | 'logout';
type Observed = { stage: Stage; path: string; method: string; headers: IncomingHttpHeaders; body: string };
type Override = (response: ServerResponse, observation: Observed) => void;
let directory: string;
let certificate: Buffer;
let privateKey: Buffer;
beforeAll(async () => {
  directory = await mkdtemp(join(tmpdir(), 'monos-doctor-'));
  execFileSync('/usr/bin/openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-subj', '/CN=127.0.0.1', '-addext', 'subjectAltName=IP:127.0.0.1', '-days', '1', '-keyout', join(directory, 'key.pem'), '-out', join(directory, 'cert.pem')], { stdio: 'ignore' });
  [certificate, privateKey] = await Promise.all([readFile(join(directory, 'cert.pem')), readFile(join(directory, 'key.pem'))]);
});
afterAll(async () => { if (directory) await rm(directory, { recursive: true, force: true }); });

async function service(overrides: Partial<Record<Stage, Override>> = {}, options: { secure?: boolean; report?: SetupReport } = {}) {
  const requests: Observed[] = [];
  const cookie = `${options.secure ? '__Host-monos' : 'monos'}=${token}`;
  const handler: RequestListener = async (request, response) => {
    const stage = request.url === '/v1/owner/login' ? 'login' : request.url === reportPath ? 'report' : request.url === '/v1/owner/logout' ? 'logout' : undefined;
    if (!stage) { response.writeHead(404).end(); return; }
    const chunks: Buffer[] = [];
    for await (const chunk of request) chunks.push(Buffer.from(chunk));
    const observation: Observed = { stage, path: request.url!, method: request.method!, headers: request.headers, body: Buffer.concat(chunks).toString('utf8') };
    requests.push(observation);
    if (stage === 'login') response.setHeader('Set-Cookie', `${cookie}; Path=/; HttpOnly; SameSite=Strict${options.secure ? '; Secure' : ''}`);
    if (overrides[stage]) { overrides[stage](response, observation); return; }
    response.setHeader('Content-Type', 'application/json');
    response.end(JSON.stringify(stage === 'login' ? session : stage === 'logout' ? { schema_version: 1, authenticated: false } : options.report ?? readyReport()));
  };
  const server = options.secure ? httpsServer({ key: privateKey, cert: certificate, minVersion: 'TLSv1.2' }, handler) : httpServer(handler);
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Missing controlled server address');
  return {
    endpoint: `${options.secure ? 'https' : 'http'}://127.0.0.1:${address.port}`, cookie, requests,
    close: async () => { server.closeAllConnections(); await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())); },
  };
}

async function cli(input: unknown, args: string[] = []): Promise<{ code: number | null; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [source, ...args], { stdio: ['pipe', 'pipe', 'pipe'] });
    let stdout = '', stderr = '';
    child.stdout.setEncoding('utf8').on('data', (chunk: string) => { stdout += chunk; });
    child.stderr.setEncoding('utf8').on('data', (chunk: string) => { stderr += chunk; });
    child.once('error', reject);
    child.once('close', code => resolve({ code, stdout, stderr }));
    child.stdin.on('error', () => { /* An early bounded-input rejection closes stdin. */ });
    child.stdin.end(Buffer.isBuffer(input) ? input : JSON.stringify(input));
  });
}

describe('setup doctor temporary Owner session', () => {
  it('runs the native CLI, returns the full report and revokes only its temporary session', async () => {
    const server = await service();
    try {
      const result = await cli({ endpoint: `${server.endpoint}/`, password });
      expect(result.code).toBe(0);
      expect(result.stderr).toBe('');
      expect(validate('SetupReport', JSON.parse(result.stdout))).toEqual(readyReport());
      expect(result.stdout).not.toContain(password);
      expect(result.stdout).not.toContain(token);
      expect(server.requests.map(request => [request.method, request.path])).toEqual([['POST', '/v1/owner/login'], ['GET', reportPath], ['POST', '/v1/owner/logout']]);
      for (const request of server.requests) {
        expect(request.headers.origin).toBe(server.endpoint);
        expect(request.headers.authorization).toBeUndefined();
      }
      expect(JSON.parse(server.requests[0]!.body)).toEqual({ schema_version: 1, password });
      expect(server.requests[0]!.headers.cookie).toBeUndefined();
      for (const request of server.requests.slice(1)) {
        expect(request.headers.cookie).toBe(server.cookie);
        expect(request.headers['x-monos-session']).toBe(request.stage === 'report' ? session.session_id : undefined);
        expect(request.body).toBe('');
      }
    } finally { await server.close(); }
  });

  for (const attention of ['schema', 'planner', 'projects', 'missing_roles', 'runtime_unavailable', 'offline'] as const) it(`returns attention for ${attention} while retaining explicit unverified checks`, async () => {
    const report = readyReport();
    if (attention === 'schema') report.schema = { status: 'mismatch', current_version: 34, expected_version: 35 };
    if (attention === 'planner') report.planner = { status: 'unavailable', source: 'planner', reason: 'policy_missing', action: 'configure_policy' };
    if (attention === 'projects') report.projects = [];
    if (attention === 'missing_roles' || attention === 'runtime_unavailable') report.projects[0]!.status = attention;
    if (attention === 'offline') report.runners[0]!.online = false;
    const server = await service({}, { report });
    try {
      const result = await diagnoseSetup({ endpoint: server.endpoint, password });
      expect(result.exitCode).toBe(2);
      expect(result.report).toEqual(report);
      expect(result.report.unverified).toHaveLength(5);
      expect(server.requests.at(-1)?.stage).toBe('logout');
    } finally { await server.close(); }
  });

  it('uses exit code 2 and complete JSON for native CLI attention', async () => {
    const report = readyReport(); report.projects = [];
    const server = await service({}, { report });
    try {
      const result = await cli({ endpoint: server.endpoint, password });
      expect(result.code).toBe(2);
      expect(JSON.parse(result.stdout)).toEqual(report);
      expect(result.stderr).toBe('');
    } finally { await server.close(); }
  });

  for (const failure of ['wrong-auth', 'bad-login', 'bad-report', 'oversize', 'private-value', 'wrong-cookie', 'logout-failure'] as const) it(`sanitizes ${failure} and attempts standard logout`, async () => {
    const overrides: Partial<Record<Stage, Override>> = {};
    if (failure === 'wrong-auth') overrides.login = response => { response.removeHeader('Set-Cookie'); response.writeHead(401).end(password); };
    if (failure === 'wrong-auth') overrides.logout = response => { response.writeHead(401).end(); };
    if (failure === 'bad-login') overrides.login = response => { response.end(token); };
    if (failure === 'bad-report') overrides.report = response => { response.end(JSON.stringify({ error: password, credential: token })); };
    if (failure === 'oversize') overrides.report = response => { response.end(Buffer.alloc(2 * 1024 * 1024 + 1, ' ')); };
    if (failure === 'private-value') overrides.report = response => { const report = readyReport(); report.projects[0]!.name = password; response.end(JSON.stringify(report)); };
    if (failure === 'wrong-cookie') overrides.login = response => { response.setHeader('Set-Cookie', `other=${token}`); response.end(JSON.stringify(session)); };
    if (failure === 'logout-failure') overrides.logout = response => { response.writeHead(500).end(`${password} ${token}`); };
    const server = await service(overrides);
    try {
      const result = await cli({ endpoint: server.endpoint, password });
      expect(result.code).toBe(1);
      expect(result.stdout).toBe('');
      expect(result.stderr.length).toBeLessThan(256);
      expect(result.stderr).not.toContain(password);
      expect(result.stderr).not.toContain(token);
      if (failure === 'wrong-auth') expect(result.stderr).toContain('authentication failed');
      expect(server.requests.at(-1)?.stage).toBe('logout');
      if (failure === 'bad-login') expect(server.requests.at(-1)?.headers.cookie).toBe(server.cookie);
      if (failure === 'wrong-auth' || failure === 'wrong-cookie') expect(server.requests.every(request => request.stage !== 'report')).toBe(true);
    } finally { await server.close(); }
  });

  for (const stage of ['login', 'report', 'logout'] as const) it(`never follows a ${stage} redirect or sends credentials to its target`, async () => {
    const target = await service();
    const server = await service({ [stage]: (response: ServerResponse) => { response.writeHead(307, { Location: `${target.endpoint}/v1/owner/login` }).end(); } });
    try {
      await expect(diagnoseSetup({ endpoint: server.endpoint, password })).rejects.toThrow(/Doctor/);
      expect(target.requests).toEqual([]);
      expect(server.requests.at(-1)?.stage).toBe('logout');
    } finally { await Promise.all([server.close(), target.close()]); }
  });

  it('bounds a continually active report by an absolute deadline and still logs out', async () => {
    let closed = false;
    const server = await service({ report: response => {
      response.writeHead(200, { 'Content-Type': 'application/json' });
      response.write(' ');
      const timer = setInterval(() => response.write(' '), 5);
      response.once('close', () => { clearInterval(timer); closed = true; });
    } });
    try {
      const started = Date.now();
      await expect(diagnoseSetup({ endpoint: server.endpoint, password }, { requestDeadlineMs: 80 })).rejects.toThrow(/Doctor/);
      expect(Date.now() - started).toBeLessThan(1500);
      expect(server.requests.at(-1)?.stage).toBe('logout');
      expect(closed).toBe(true);
    } finally { await server.close(); }
  });

  it('bounds cleanup after a successful report instead of reporting unrevoked success', async () => {
    const server = await service({ logout: response => { response.writeHead(200); response.write(' '); } });
    try {
      await expect(diagnoseSetup({ endpoint: server.endpoint, password }, { requestDeadlineMs: 80 })).rejects.toThrow(/cleanup/);
      expect(server.requests.at(-1)?.stage).toBe('logout');
    } finally { await server.close(); }
  });

  it('revokes by cookie after the active-session report fence expires', async () => {
    let revoked = false;
    const server = await service({
      report: response => { response.writeHead(401).end(); },
      logout: (response, observation) => {
        // Model app's active-session hook: it would reject this header before
        // the idempotent cookie-based logout can run on an expired session.
        if (observation.headers['x-monos-session']) { response.writeHead(401).end(); return; }
        expect(observation.headers.cookie).toBe(`monos=${token}`);
        revoked = true;
        response.end(JSON.stringify({ schema_version: 1, authenticated: false }));
      },
    });
    try {
      await expect(diagnoseSetup({ endpoint: server.endpoint, password })).rejects.toThrow('readiness report failed');
      expect(server.requests.find(request => request.stage === 'report')?.headers['x-monos-session']).toBe(session.session_id);
      expect(revoked).toBe(true);
    } finally { await server.close(); }
  });

  it('augments TLS trust with the supplied CA and retains hostname verification', async () => {
    const server = await service({}, { secure: true });
    try {
      const input = { endpoint: server.endpoint, password, ca_file: join(directory, 'cert.pem') };
      expect((await diagnoseSetup(input)).exitCode).toBe(0);
      expect(server.requests.slice(1).every(request => request.headers.cookie === server.cookie)).toBe(true);
      await expect(diagnoseSetup({ ...input, endpoint: server.endpoint.replace('127.0.0.1', 'localhost') })).rejects.toThrow(/Doctor/);
      expect(server.requests).toHaveLength(3);
    } finally { await server.close(); }
  });

  it('rejects untrusted TLS before sending credentials and rejects malformed explicit CA', async () => {
    const server = await service({}, { secure: true });
    try {
      await expect(diagnoseSetup({ endpoint: server.endpoint, password })).rejects.toThrow(/Doctor/);
      expect(server.requests).toEqual([]);
      await writeFile(join(directory, 'bad-ca.pem'), password);
      await expect(diagnoseSetup({ endpoint: server.endpoint, password, ca_file: join(directory, 'bad-ca.pem') })).rejects.toThrow(/Doctor/);
      expect(server.requests).toEqual([]);
    } finally { await server.close(); }
  });

  it('rejects unsafe origins and strict stdin shape before network access', async () => {
    const server = await service();
    try {
      for (const endpoint of [`${server.endpoint}/path`, `${server.endpoint}?`, `${server.endpoint}#`, server.endpoint.replace('http://', 'http://user:secret@'), `${server.endpoint}\\`, ` ${server.endpoint}`, 'ftp://example.test']) {
        await expect(diagnoseSetup({ endpoint, password })).rejects.toThrow(/Doctor/);
      }
      for (const input of [{ endpoint: server.endpoint, password, extra: true }, { endpoint: server.endpoint, password: 'short' }, { endpoint: server.endpoint, password, ca_file: null }]) {
        const result = await cli(input);
        expect(result.code).toBe(1);
        expect(result.stdout).toBe('');
        expect(result.stderr).not.toContain(password);
      }
      for (const input of [Buffer.alloc(16 * 1024 + 1, ' '), Buffer.from([0xff]), Buffer.from('{"endpoint":')]) {
        expect((await cli(input)).code).toBe(1);
      }
      const result = await cli({}, [`--password=${password}`]);
      expect(result.code).toBe(1);
      expect(result.stderr).not.toContain(password);
      expect(server.requests).toEqual([]);
    } finally { await server.close(); }
  });
});
