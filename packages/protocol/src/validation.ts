import { Ajv } from 'ajv';
import contracts from '../schemas/v1/contracts.json' with { type: 'json' };

export const MAX_BODY_BYTES = 2 * 1024 * 1024;
export const MAX_FRAME_BYTES = 1024 * 1024;
// Leave room for the inventory page/cursor or dispatch/result frame wrapper.
export const MAX_ITEM_BYTES = MAX_FRAME_BYTES - 4096;
export const schema = contracts;
const ajv = new Ajv({ strict: true, allErrors: false });
ajv.addSchema(schema);
const validators = new Map<string, ReturnType<typeof ajv.compile>>();

export class ProtocolVersionError extends Error {}
export class ProtocolValidationError extends Error {}

export function validate<T>(name: string, value: unknown): T {
  if (['Frame', 'CommandEnvelope', 'OwnerCommand', 'OwnerLogin', 'ConfigurationCommand', 'TodoCommand', 'DiscussionCommand', 'TaskPreviewCommand'].includes(name) && value && typeof value === 'object' && 'schema_version' in value && value.schema_version !== 1) throw new ProtocolVersionError('Unsupported schema version');
  let validator = validators.get(name);
  if (!validator) {
    validator = ajv.compile({ $ref: `${schema.$id}#/definitions/${name}` });
    validators.set(name, validator);
  }
  if (!validator(value)) throw new ProtocolValidationError(`Invalid ${name}: ${ajv.errorsText(validator.errors, { dataVar: 'body' })}`);
  const limit = ['GitHubRepositoryAccessResult','PublicationAccessRequest','PublicationAccessResult','PublicationPermissionRequest','PublicationPermissionResult'].includes(name) ? 16 * 1024 : name === 'ResultReadResponse' || name.startsWith('Publication') || name.startsWith('PublishedResult') || name.startsWith('RemotePreparation') ? 512 * 1024 : ['Frame', 'RunnerInventory'].includes(name) ? MAX_FRAME_BYTES : ['Dispatch', 'Operation', 'OperationResult'].includes(name) ? MAX_ITEM_BYTES : undefined;
  if (limit !== undefined && new TextEncoder().encode(JSON.stringify(value)).length > limit) throw new ProtocolValidationError(`${name} exceeds the encoded wire byte limit`);
  if (name.startsWith('Publication') || name.startsWith('PublishedResult') || name.startsWith('RemotePreparation') || name.startsWith('Result') || name === 'Frame' && value && typeof value === 'object' && 'type' in value && ['result_read','result_read_result','publication_prepare','publication_result','publication_ack','publication_push','publication_push_result','publication_push_ack'].includes(String(value.type))) {
    resultBytes(value);
    if(name === 'Frame' && value && typeof value === 'object' && 'type' in value && String(value.type).startsWith('publication_') && new TextEncoder().encode(JSON.stringify(value)).length>512*1024)throw new ProtocolValidationError('Publication frame exceeds encoded byte bounds');
    if (name === 'Frame' && value && typeof value === 'object' && 'result_read_result' in value) validate('ResultReadResponse',value.result_read_result);
  }
  return value as T;
}

function resultBytes(value: unknown, key = ''): void {
  if (typeof value === 'string') {
    if (/[\uD800-\uDFFF]/u.test(value)) throw new ProtocolValidationError('Result strings must contain well-formed Unicode');
    const bytes = new TextEncoder().encode(value).length;
    if (key === 'text' && (bytes > 64*1024 || value.includes('\0'))) throw new ProtocolValidationError('Result text exceeds raw byte bounds or is binary');
    if (['path','baseline_path'].includes(key) && bytes > 4096) throw new ProtocolValidationError('Result path exceeds byte bounds');
    if (key === 'body' && bytes > 64*1024) throw new ProtocolValidationError('Remote content exceeds raw byte bounds');
  } else if (Array.isArray(value)) value.forEach(v=>resultBytes(v,key));
  else if (value && typeof value === 'object') for (const [k,v] of Object.entries(value)) resultBytes(v,k);
}
