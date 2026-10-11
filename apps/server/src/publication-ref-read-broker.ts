import { randomUUID } from 'node:crypto';
import { canonicalJSON, digest, validate } from '../../../packages/protocol/src/index.ts';
import type { Frame, PublicationRefReadRequest, PublicationRefReadResponse } from '../../../packages/protocol/src/index.ts';

interface Connection { incarnation: number; socket: object; capable: boolean; send: (frame: Frame) => boolean }
export type PublicationRefReadOutcome = { status: 'ok'; response: PublicationRefReadResponse; issued_at: string; received_at: string }
  | { status: 'offline' | 'unsupported' | 'busy' | 'timeout' };
interface Pending { connection: Connection; request: PublicationRefReadRequest; issuedAt: number; finish: (value: PublicationRefReadOutcome) => void }

// Fresh observations are ephemeral, bounded reads. Only the caller's subsequent
// authority-checked transaction can turn one into retained publication evidence.
export class PublicationRefReadBroker {
  private connections = new Map<string, Connection>();
  private pending = new Map<string, Pending>();
  private readonly deadlineMs: number;
  constructor(deadlineMs = 10_000) { this.deadlineMs = deadlineMs; }
  register(runner: string, incarnation: number, socket: object, capable: boolean, send: Connection['send']) {
    const old = this.connections.get(runner);
    if (old && old.incarnation > incarnation) return;
    if (old) this.disconnect(runner, old.socket);
    this.connections.set(runner, { incarnation, socket, capable, send });
  }
  disconnect(runner: string, socket: object) {
    const c = this.connections.get(runner); if (!c || c.socket !== socket) return;
    this.connections.delete(runner);
    for (const p of this.pending.values()) if (p.connection === c) p.finish({ status: 'offline' });
  }
  shutdown() { for (const [runner, c] of this.connections) this.disconnect(runner, c.socket); }
  async read(request: PublicationRefReadRequest, incarnation?: number): Promise<PublicationRefReadOutcome> {
    validate('PublicationRefReadRequest', request);
    if (digest(canonicalJSON(request.push)) !== request.push_request_digest) throw new Error('Publication push digest differs');
    const c = this.connections.get(request.push.runner_id);
    if (!c || incarnation !== undefined && incarnation !== c.incarnation) return { status: 'offline' };
    if (!c.capable) return { status: 'unsupported' };
    if (this.pending.size >= 8 || [...this.pending.values()].filter(p => p.connection === c).length >= 2) return { status: 'busy' };
    const correlation_id = randomUUID(), issuedAt = Date.now();
    return new Promise(resolve => {
      const timer = setTimeout(() => finish({ status: 'timeout' }), this.deadlineMs);
      const finish = (value: PublicationRefReadOutcome) => { if (!this.pending.delete(correlation_id)) return; clearTimeout(timer); resolve(value); };
      this.pending.set(correlation_id, { connection: c, request, issuedAt, finish });
      try { if (!c.send({ schema_version: 1, type: 'publication_ref_read', incarnation: c.incarnation, correlation_id, publication_ref_read: request })) finish({ status: 'offline' }); }
      catch { finish({ status: 'offline' }); }
    });
  }
  response(runner: string, socket: object, frame: Frame) {
    const c = this.connections.get(runner), p = this.pending.get(frame.correlation_id ?? '');
    if (!c || !p || c.socket !== socket || p.connection !== c || frame.incarnation !== c.incarnation || !frame.publication_ref_read_result) return;
    const response = validate<PublicationRefReadResponse>('PublicationRefReadResponse', frame.publication_ref_read_result);
    if (canonicalJSON(response.request) !== canonicalJSON(p.request) || digest(canonicalJSON(response.observation)) !== response.observation_digest) return;
    const received = Date.now();
    if (received - p.issuedAt > this.deadlineMs) { p.finish({ status: 'timeout' }); return; }
    p.finish({ status: 'ok', response, issued_at: new Date(p.issuedAt).toISOString(), received_at: new Date(received).toISOString() });
  }
}
