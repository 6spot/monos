import { X509Certificate } from 'node:crypto';
import { constants } from 'node:fs';
import { open } from 'node:fs/promises';
import { Agent as HTTPAgent, request as requestHTTP } from 'node:http';
import type { IncomingHttpHeaders } from 'node:http';
import { Agent as HTTPSAgent, request as requestHTTPS } from 'node:https';
import { resolve } from 'node:path';
import { getCACertificates } from 'node:tls';
import { fileURLToPath } from 'node:url';
import { canonicalJSON, validate } from '../../../packages/protocol/src/index.ts';
import type { OwnerSessionStatus, SetupReport } from '../../../packages/protocol/src/index.ts';

const INPUT_LIMIT = 16 * 1024;
const SESSION_LIMIT = 4096;
const REPORT_LIMIT = 2 * 1024 * 1024;
const REQUEST_DEADLINE = 15_000;
type Input = { endpoint: string; password: string; ca_file?: string };

class DoctorError extends Error {}

function inputValue(value: unknown): Input {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new DoctorError('Doctor input is invalid.');
  const body = value as Record<string, unknown>;
  if (Object.keys(body).some(key => !['endpoint', 'password', 'ca_file'].includes(key)) || typeof body.endpoint !== 'string' || typeof body.password !== 'string' ||
    Buffer.byteLength(body.endpoint) > 2048 || Buffer.byteLength(body.password) > 1024 ||
    'ca_file' in body && (typeof body.ca_file !== 'string' || !body.ca_file || Buffer.byteLength(body.ca_file) > 4096 || body.ca_file.includes('\0'))) throw new DoctorError('Doctor input is invalid.');
  canonicalJSON(value);
  validate('OwnerLogin', { schema_version: 1, password: body.password });
  return body as Input;
}

function origin(value: string): URL {
  if (!/^https?:\/\/[^/?#]+\/?$/u.test(value) || /[\\\s@]/u.test(value) || [...value].some(character => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127)) throw new DoctorError('Doctor requires an HTTP or HTTPS origin.');
  const parsed = new URL(value);
  if (!parsed.hostname || parsed.username || parsed.password || parsed.origin === 'null') throw new DoctorError('Doctor requires an HTTP or HTTPS origin.');
  return new URL(parsed.origin);
}

async function trustedCA(path: string): Promise<string[]> {
  const file = await open(path, constants.O_RDONLY | constants.O_NONBLOCK);
  try {
    if (!(await file.stat()).isFile()) throw new DoctorError('Doctor CA file is invalid.');
    const raw = Buffer.alloc(1024 * 1024 + 1);
    let length = 0;
    while (length < raw.length) {
      const { bytesRead } = await file.read(raw, length, raw.length - length, null);
      if (!bytesRead) break;
      length += bytesRead;
    }
    if (length === raw.length) throw new DoctorError('Doctor CA file exceeds its limit.');
    const pem = new TextDecoder('utf-8', { fatal: true }).decode(raw.subarray(0, length));
    const certificates = pem.match(/-----BEGIN CERTIFICATE-----[\s\S]*?-----END CERTIFICATE-----/gu);
    if (!certificates?.length) throw new DoctorError('Doctor CA file is invalid.');
    for (const certificate of certificates) new X509Certificate(certificate);
    return [...getCACertificates('default'), ...certificates];
  } finally { await file.close(); }
}

function json(raw: Buffer): unknown {
  const value: unknown = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(raw));
  canonicalJSON(value);
  return value;
}

type RequestOptions = {
  base: URL; agent: HTTPAgent | HTTPSAgent; path: string; method: 'GET' | 'POST';
  timeout: number; limit: number; cookie?: string; session?: string; body?: string;
  headers?: (headers: IncomingHttpHeaders) => void;
};

// The absolute deadline includes DNS, TLS, response headers and the entire body.
// Socket inactivity timeouts alone would allow an endless slow response.
function request(options: RequestOptions): Promise<Buffer> {
  return new Promise((resolveRequest, reject) => {
    let finished = false;
    const fail = () => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      req.destroy();
      reject(new DoctorError('Doctor request failed or exceeded its limits.'));
    };
    const transport = options.base.protocol === 'https:' ? requestHTTPS : requestHTTP;
    const req = transport(new URL(options.path, options.base), {
      method: options.method, agent: options.agent, maxHeaderSize: 16 * 1024,
      headers: {
        Origin: options.base.origin, Accept: 'application/json',
        ...(options.cookie ? { Cookie: options.cookie } : {}),
        ...(options.session ? { 'X-Monos-Session': options.session } : {}),
        ...(options.body !== undefined ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(options.body) } : {}),
      },
    }, response => {
      response.once('error', fail);
      response.once('aborted', fail);
      try { options.headers?.(response.headers); } catch { response.destroy(); fail(); return; }
      // Standard http/https clients never follow redirects; reject every non-200.
      if (response.statusCode !== 200) { response.destroy(); fail(); return; }
      const chunks: Buffer[] = [];
      let bytes = 0;
      response.on('data', (chunk: Buffer) => {
        if (finished) return;
        bytes += chunk.length;
        if (bytes > options.limit) { response.destroy(); fail(); return; }
        chunks.push(chunk);
      });
      response.once('end', () => {
        if (finished) return;
        finished = true;
        clearTimeout(timer);
        resolveRequest(Buffer.concat(chunks, bytes));
      });
    });
    const timer = setTimeout(fail, options.timeout);
    req.once('error', fail);
    req.end(options.body);
  });
}

function containsSecret(value: unknown, secrets: string[]): boolean {
  if (typeof value === 'string') return secrets.some(secret => value.includes(secret));
  if (Array.isArray(value)) return value.some(item => containsSecret(item, secrets));
  if (value && typeof value === 'object') return Object.values(value).some(item => containsSecret(item, secrets));
  return false;
}

export function configurationExitCode(report: SetupReport): 0 | 2 {
  return report.schema.status === 'current' && report.planner.status === 'available' &&
    report.projects.length > 0 && report.projects.every(project => project.status === 'configured') &&
    report.runners.some(runner => runner.online) ? 0 : 2;
}

// Login/logout only maintain this temporary Owner session. Diagnosis reads one
// report and never creates a Task/Attempt or invokes Runner/provider operations.
export async function diagnoseSetup(value: unknown, options: { requestDeadlineMs?: number } = {}): Promise<{ report: SetupReport; exitCode: 0 | 2 }> {
  let agent: HTTPAgent | HTTPSAgent | undefined;
  try {
    const input = inputValue(value);
    const base = origin(input.endpoint);
    const ca = input.ca_file === undefined ? undefined : await trustedCA(input.ca_file);
    agent = base.protocol === 'https:' ? new HTTPSAgent({ ca, minVersion: 'TLSv1.2', rejectUnauthorized: true, maxSockets: 1 }) : new HTTPAgent({ maxSockets: 1 });
    const timeout = options.requestDeadlineMs ?? REQUEST_DEADLINE;
    if (!Number.isFinite(timeout) || timeout <= 0 || timeout > REQUEST_DEADLINE) throw new DoctorError('Doctor request deadline is invalid.');
    const cookieName = base.protocol === 'https:' ? '__Host-monos' : 'monos';
    const cookies = new Set<string>();
    let session: string | undefined;
    let authenticated = false;
    let report: SetupReport | undefined;
    let failure: DoctorError | undefined;
    const common = { base, agent, timeout };
    try {
      const login = await request({ ...common, path: '/v1/owner/login', method: 'POST', limit: SESSION_LIMIT,
        body: JSON.stringify({ schema_version: 1, password: input.password }),
        headers: headers => {
          // Capture revocable tokens before parsing the body, including an
          // interrupted or malformed login response after session creation.
          for (const header of headers['set-cookie'] ?? []) {
            const pair = header.split(';', 1)[0]!;
            if (new RegExp(`^${cookieName}=owner\\.v1\\.[0-9a-f]{64}$`, 'u').test(pair)) cookies.add(pair);
          }
        },
      });
      const status = validate<OwnerSessionStatus>('OwnerSessionStatus', json(login));
      if (!status.authenticated || cookies.size !== 1) throw new DoctorError('Doctor authentication response is invalid.');
      session = status.session_id;
      authenticated = true;
      const body = await request({ ...common, path: '/v1/owner/setup-readiness', method: 'GET', limit: REPORT_LIMIT, cookie: [...cookies][0], session });
      report = validate<SetupReport>('SetupReport', json(body));
      if (containsSecret(report, [input.password, ...[...cookies].map(cookie => cookie.slice(cookieName.length + 1))])) throw new DoctorError('Doctor report contains private session material.');
    } catch { failure = new DoctorError(authenticated ? 'Doctor readiness report failed.' : 'Doctor authentication failed.'); }
    finally {
      // Cleanup has its own bounded deadline, including after the read times out.
      // With no received cookie, still attempt the ordinary logout endpoint;
      // an unknown/lost session can never be claimed as successfully revoked.
      const deadline = Date.now() + timeout;
      for (const cookie of cookies.size ? cookies : [undefined]) {
        try {
          const remaining = deadline - Date.now();
          if (remaining <= 0) { if (cookies.size) failure = new DoctorError('Doctor session cleanup could not be confirmed.'); break; }
          // Logout revokes the cookie idempotently even after expiry/rotation.
          // The optional active-session fence belongs only on the report read.
          const raw = await request({ ...common, timeout: remaining, path: '/v1/owner/logout', method: 'POST', limit: SESSION_LIMIT, cookie });
          const status = validate<OwnerSessionStatus>('OwnerSessionStatus', json(raw));
          if (status.authenticated && cookies.size) failure = new DoctorError('Doctor session cleanup could not be confirmed.');
        } catch { if (cookies.size) failure = new DoctorError('Doctor session cleanup could not be confirmed.'); }
      }
    }
    if (failure || !report) throw failure ?? new DoctorError('Doctor readiness report failed.');
    return { report, exitCode: configurationExitCode(report) };
  } catch (error) {
    throw error instanceof DoctorError ? error : new DoctorError('Doctor failed; check bounded stdin input, endpoint and trusted CA.');
  } finally { agent?.destroy(); }
}

async function main(): Promise<void> {
  try {
    if (process.argv.length !== 2) throw new DoctorError('Doctor accepts JSON on stdin and no command-line arguments.');
    const chunks: Buffer[] = [];
    let bytes = 0;
    for await (const chunk of process.stdin) {
      bytes += Buffer.byteLength(chunk);
      if (bytes > INPUT_LIMIT) throw new DoctorError('Doctor stdin exceeds its limit.');
      chunks.push(Buffer.from(chunk));
    }
    const { report, exitCode } = await diagnoseSetup(json(Buffer.concat(chunks)));
    process.stdout.write(`${JSON.stringify(report)}\n`);
    process.exitCode = exitCode;
  } catch (error) {
    process.stderr.write(`${error instanceof DoctorError ? error.message : 'Doctor input or execution failed.'}\n`);
    process.exitCode = 1;
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) await main();
