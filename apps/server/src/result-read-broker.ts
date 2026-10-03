import { randomUUID } from 'node:crypto';
import { canonicalJSON, validate } from '../../../packages/protocol/src/index.ts';
import type { Frame, ResultReadRequest, ResultReadResponse } from '../../../packages/protocol/src/index.ts';

interface Connection { incarnation: number; socket: object; capable: boolean; send: (frame: Frame) => boolean }
interface Pending { connection: Connection; request: ResultReadRequest; finish: (value: ResultReadResponse) => void }
export const resultReadOutcome = (request: ResultReadRequest, status: ResultReadResponse['status']): ResultReadResponse => ({ schema_version: 1, request, status });
// Ephemeral reads have no command receipt and never outlive their connection.
export class ResultReadBroker {
  private connections = new Map<string, Connection>();
  private pending = new Map<string, Pending>();
  private deadlineMs: number;
  constructor(deadlineMs = 10_000) {this.deadlineMs=deadlineMs;}
  register(runner: string, incarnation: number, socket: object, capable: boolean, send: Connection['send']) {
    const old = this.connections.get(runner);
    if (old && old.incarnation > incarnation) return;
    if (old) this.disconnect(runner, old.socket);
    this.connections.set(runner, { incarnation, socket, capable, send });
  }
  disconnect(runner: string, socket: object) {
    const connection = this.connections.get(runner);
    if (!connection || connection.socket !== socket) return;
    this.connections.delete(runner);
    for (const value of this.pending.values()) if (value.connection === connection) value.finish(resultReadOutcome(value.request, 'offline'));
  }
  shutdown() { for (const [runner, c] of this.connections) this.disconnect(runner,c.socket); }
  async read(request: ResultReadRequest, incarnation?: number): Promise<ResultReadResponse> {
    const c = this.connections.get(request.identity.runner_id);
    if (!c || incarnation!==undefined && c.incarnation!==incarnation) return resultReadOutcome(request,'offline');
    if (!c.capable) return resultReadOutcome(request,'unsupported');
    if (this.pending.size >= 8 || [...this.pending.values()].filter(p=>p.connection===c).length >= 4) return resultReadOutcome(request,'busy');
    const correlation_id = randomUUID();
    return new Promise(resolve=>{
      const timer = setTimeout(()=>finish(resultReadOutcome(request,'timeout')),this.deadlineMs);
      const finish = (value: ResultReadResponse) => { if (!this.pending.delete(correlation_id)) return; clearTimeout(timer); resolve(value); };
      this.pending.set(correlation_id,{connection:c,request,finish});
      try {
        if (!c.send({schema_version:1,type:'result_read',incarnation:c.incarnation,correlation_id,result_read:request})) finish(resultReadOutcome(request,'offline'));
      } catch { finish(resultReadOutcome(request,'offline')); }
    });
  }
  response(runner: string, socket: object, frame: Frame) {
    const c=this.connections.get(runner), p=this.pending.get(frame.correlation_id ?? '');
    if (!c || !p || c.socket!==socket || p.connection!==c || frame.incarnation!==c.incarnation || !frame.result_read_result) return;
    const value=validate<ResultReadResponse>('ResultReadResponse',frame.result_read_result);
    if (canonicalJSON(value.request)!==canonicalJSON(p.request) || value.current!==undefined) return;
    p.finish(value);
  }
}
