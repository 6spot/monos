import { randomUUID } from 'node:crypto';
import { mkdir, readdir, realpath, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { WebSocket } from 'ws';
import { parseFrame } from '../../../../packages/protocol/src/index.ts';
import type { Dispatch, Frame, RuntimeInstallation } from '../../../../packages/protocol/src/index.ts';

export type RunnerCommand =
  | { type: 'connect'; endpoint: string; runner_id: string; token: string; installed: boolean }
  | { type: 'report'; installed: boolean }
  | { type: 'release'; dispatch_id: string }
  | { type: 'probe'; dispatch_id: string; correlation_id: string }
  | { type: 'snapshot'; correlation_id: string };

export interface StartMarker {
  runner_id: string; dispatch_id: string; attempt_id: string; task_id: string;
  runtime_id: string; root: string; executable: string; pid: number;
}

export type RunnerMessage =
  | { type: 'connected'; root: string; pid: number; incarnation: number; installation: RuntimeInstallation }
  | { type: 'held'; dispatch: Dispatch }
  | { type: 'authorization'; correlation_id: string; allowed: boolean; credential_present: boolean; marker?: StartMarker }
  | { type: 'snapshot'; correlation_id: string; dispatch_ids: string[]; marker_files: string[] }
  | { type: 'failure'; reason: string };

// A protocol peer, not a Runtime adapter: authorization gates a root-local marker.
// It has no database access and never invokes an Agent or claims writer isolation.
let socket: WebSocket | undefined;
let incarnation: number;
let runnerId: string;
let root: string;
let installation: RuntimeInstallation;
let heartbeat: ReturnType<typeof setInterval> | undefined;
const held = new Map<string, Dispatch>();
const pending = new Map<string, Dispatch | null>();
const released = new Set<string>();
const send = (message: RunnerMessage) => process.send?.(message);
const wire = (frame: Frame) => socket!.send(JSON.stringify(frame));
function fail(reason: string) { send({ type: 'failure', reason }); }
function report(installed: boolean) {
  wire({ schema_version: 1, type: 'ready', incarnation, log_modes: ['ordered_v1'], runtimes: installed ? [installation] : [] });
}

async function receive(frame: Frame, installed: boolean) {
  if (frame.type === 'welcome') {
    incarnation = frame.incarnation!;
    report(installed);
    heartbeat = setInterval(() => wire({ schema_version: 1, type: 'heartbeat', incarnation }), 1000);
    send({ type: 'connected', root, pid: process.pid, incarnation, installation });
  } else if (frame.type === 'start') {
    const dispatch = frame.dispatch!;
    if (dispatch.runner_id !== runnerId) throw new Error('Wrong Start recipient');
    if (!held.has(dispatch.dispatch_id)) {
      held.set(dispatch.dispatch_id, dispatch);
      send({ type: 'held', dispatch });
    }
  } else if (frame.type === 'authorization') {
    const correlation = frame.correlation_id!;
    if (!pending.has(correlation)) throw new Error('Unexpected authorization');
    const dispatch = pending.get(correlation);
    pending.delete(correlation);
    let marker: StartMarker | undefined;
    if (frame.allowed && dispatch) {
      if (!frame.credential || dispatch.runtime_id !== installation.runtime_id) throw new Error('Invalid grant');
      marker = {
        runner_id: runnerId, dispatch_id: dispatch.dispatch_id, attempt_id: dispatch.attempt_id,
        task_id: dispatch.task_id!, runtime_id: dispatch.runtime_id, root: await realpath(process.cwd()),
        executable: await realpath(installation.executable!), pid: process.pid,
      };
      await writeFile(join(root, 'starts', `${dispatch.dispatch_id}.json`), JSON.stringify(marker), { flag: 'wx', mode: 0o600 });
    }
    // Credentials stay in this process; only their presence is observable to tests.
    send({ type: 'authorization', correlation_id: correlation, allowed: frame.allowed === true, credential_present: Boolean(frame.credential), ...(marker ? { marker } : {}) });
  } else if (frame.type === 'error') {
    fail(`protocol_${frame.error?.code ?? 'error'}`);
  }
}

async function command(message: RunnerCommand) {
  switch (message.type) {
    case 'connect': {
      if (socket) throw new Error('Already connected');
      runnerId = message.runner_id;
      root = await realpath(process.cwd());
      await mkdir(join(root, 'bin'));
      await mkdir(join(root, 'starts'));
      const executable = join(root, 'bin', 'opencode');
      await writeFile(executable, '#!/bin/sh\nexit 99\n', { flag: 'wx', mode: 0o700 });
      installation = { runtime_id: 'opencode', executable, version: '2.0.20-fixture', availability: 'detected', supports_model: true, supports_thinking: false, model_ids: [] };
      socket = new WebSocket(message.endpoint, { headers: { authorization: `Bearer ${message.token}` } });
      socket.on('open', () => wire({ schema_version: 1, type: 'hello', runner_id: runnerId, boot_id: randomUUID() }));
      let processing = Promise.resolve();
      socket.on('message', (bytes) => {
        processing = processing.then(() => receive(parseFrame(JSON.parse(bytes.toString())), message.installed)).catch(() => fail('invalid_server_frame'));
      });
      socket.on('error', () => fail('socket_error'));
      socket.on('close', () => { clearInterval(heartbeat); fail('socket_closed'); });
      break;
    }
    case 'report': report(message.installed); break;
    case 'release': {
      const dispatch = held.get(message.dispatch_id);
      if (!dispatch || released.has(message.dispatch_id)) throw new Error('Start barrier is not held');
      released.add(message.dispatch_id);
      pending.set(message.dispatch_id, dispatch);
      wire({ schema_version: 1, type: 'authorize_dispatch', incarnation, dispatch_id: dispatch.dispatch_id, correlation_id: dispatch.dispatch_id });
      break;
    }
    case 'probe':
      pending.set(message.correlation_id, null);
      wire({ schema_version: 1, type: 'authorize_dispatch', incarnation, dispatch_id: message.dispatch_id, correlation_id: message.correlation_id });
      break;
    case 'snapshot':
      send({ type: 'snapshot', correlation_id: message.correlation_id, dispatch_ids: [...held.keys()].sort(), marker_files: (await readdir(join(root, 'starts'))).sort() });
      break;
  }
}

let commands = Promise.resolve();
process.on('message', (message: RunnerCommand) => { commands = commands.then(() => command(message)).catch(() => fail('fixture_command_failed')); });
process.on('disconnect', () => { clearInterval(heartbeat); socket?.terminate(); process.exit(0); });
