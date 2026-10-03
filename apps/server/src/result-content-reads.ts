import { CommandError } from '../../../packages/domain/src/commands.ts';
import { canonicalJSON, validate } from '../../../packages/protocol/src/index.ts';
import type { ResultReadRequest, ResultReadResponse } from '../../../packages/protocol/src/index.ts';
import type { BoundaryService } from './service.ts';
import { OwnerAccess } from './owner-access.ts';
import { selectedTaskResult } from './task-result-reads.ts';
import { resultReadOutcome } from './result-read-broker.ts';
import type { ResultReadBroker } from './result-read-broker.ts';

export async function resultContent(service: BoundaryService, broker: ResultReadBroker, token: string, expectedSession: string | undefined, task: string, operation: string, mode: ResultReadRequest['mode'], query: unknown): Promise<ResultReadResponse> {
  const input=validate<Record<string,string>>(`ResultRead${mode[0]!.toUpperCase()+mode.slice(1)}Query`,query);
  if (input.cursor !== undefined) resultChangeCursor(input.identity_digest!,input.cursor);
  const access=new OwnerAccess(service.db);
  const session=await access.session(token);
  if (expectedSession && session.session_id!==expectedSession) throw new CommandError('unauthorized','Owner session changed');
  const selected=await selectedTaskResult(service.db,token,task,operation);
  if (input.identity_digest!==selected.item.git!.identity_digest) throw new CommandError('version_conflict','Selected result identity changed; refresh results');
  const request=validate<ResultReadRequest>('ResultReadRequest',{...input,mode,identity:selected.identity});
  const available=await service.db.pool.query<{incarnation:string}>('SELECT incarnation FROM runners WHERE id=$1 AND connected AND ready AND incarnation>0 AND connection_instance=$2',[selected.identity.runner_id,service.instanceId]);
  const response:ResultReadResponse=available.rowCount ? await broker.read(request,Number(available.rows[0]!.incarnation)) : {schema_version:1,request,status:'offline'};
  const after=await access.session(token);
  if (session.session_id!==after.session_id || expectedSession && after.session_id!==expectedSession) throw new CommandError('unauthorized','Owner session changed');
  const fresh=await selectedTaskResult(service.db,token,task,operation);
  if (canonicalJSON(fresh.identity)!==canonicalJSON(selected.identity)) throw new CommandError('version_conflict','Selected result identity changed');
  const value={...response,current:fresh.item.current};
  return validate('ResultReadResponse',Buffer.byteLength(JSON.stringify(value))>512*1024?{...resultReadOutcome(request,'oversized'),current:fresh.item.current}:value);
}

// The cursor is a canonical position bound to the selected immutable identity,
// never an authorization grant. Validate scope before sending a Runner request.
export function resultChangeCursor(identity: string, cursor: string): number {
  try {
    const value=JSON.parse(Buffer.from(cursor,'base64url').toString('utf8'));
    if (!value || Object.keys(value).sort().join(',')!=='after,identity,version' || value.version!==1 || typeof value.identity!=='string' || !Number.isSafeInteger(value.after) || value.after<0 || Buffer.from(canonicalJSON(value)).toString('base64url')!==cursor) throw new Error();
    validate('SHA256',value.identity);
    if (value.identity!==identity) throw new CommandError('denied_scope','Changes cursor belongs to another result');
    return value.after;
  } catch(error) {
    if (error instanceof CommandError) throw error;
    throw new CommandError('invalid_input','Invalid changed-files cursor');
  }
}
