import { Ajv } from 'ajv';
import contracts from '../schemas/v1/contracts.json' with { type: 'json' };

export const MAX_BODY_BYTES = 2 * 1024 * 1024;
export const MAX_FRAME_BYTES = 1024 * 1024;
// Leave room for the inventory page/cursor or dispatch/result frame wrapper.
export const MAX_ITEM_BYTES = MAX_FRAME_BYTES - 4096;
// Complete acceptance evidence is rejected when it cannot fit; it is never clipped.
export const MAX_DELIVERY_BYTES = 512 * 1024;
// A fresh ref read echoes the push plus its observation and correlation fields.
export const MAX_PUBLICATION_PUSH_BYTES = 480 * 1024;
export const schema = contracts;
const ajv = new Ajv({ strict: true, allErrors: false });
ajv.addSchema(schema);
const validators = new Map<string, ReturnType<typeof ajv.compile>>();

export class ProtocolVersionError extends Error {}
export class ProtocolValidationError extends Error {}

export function validate<T>(name: string, value: unknown): T {
  if (['Frame', 'CommandEnvelope', 'OwnerCommand', 'OwnerDeliveryCommand', 'OwnerReviewCommand', 'OwnerLogin', 'ConfigurationCommand', 'TodoCommand', 'DiscussionCommand', 'TaskPreviewCommand'].includes(name) && value && typeof value === 'object' && 'schema_version' in value && value.schema_version !== 1) throw new ProtocolVersionError('Unsupported schema version');
  let validator = validators.get(name);
  if (!validator) {
    validator = ajv.compile({ $ref: `${schema.$id}#/definitions/${name}` });
    validators.set(name, validator);
  }
  if (!validator(value)) throw new ProtocolValidationError(`Invalid ${name}: ${ajv.errorsText(validator.errors, { dataVar: 'body' })}`);
  if (name.startsWith('Delivery') || name.startsWith('OwnerDelivery') || name.startsWith('OwnerReview') || name.startsWith('Review') || name.startsWith('TaskReview')) {
    if (new TextEncoder().encode(JSON.stringify(value)).length > MAX_DELIVERY_BYTES) throw new ProtocolValidationError(`${name} exceeds the encoded wire byte limit`);
    resultBytes(value);
  }
  const limit = name === 'PublicationPushRequest' ? MAX_PUBLICATION_PUSH_BYTES : ['RepositoryAccessResult','InspectionRepositoryAccessResult','PublicationAccessRequest','PublicationAccessResult','PublicationPermissionRequest','PublicationPermissionResult'].includes(name) ? 16 * 1024 : name === 'ResultReadResponse' || name.startsWith('Publication') || name.startsWith('PublishedResult') || name.startsWith('RemotePreparation') ? 512 * 1024 : ['Frame', 'RunnerInventory'].includes(name) ? MAX_FRAME_BYTES : ['Dispatch', 'Operation', 'OperationResult'].includes(name) ? MAX_ITEM_BYTES : undefined;
  if (limit !== undefined) {
    let encoded = JSON.stringify(value);
    // Go's JSON encoder escapes these characters when echoing a typed push.
    // Reserve against that larger representation before backend admission.
    if (name === 'PublicationPushRequest') encoded = encoded.replace(/[<>&\u2028\u2029]/gu, character => `\\u${character.charCodeAt(0).toString(16).padStart(4, '0')}`);
    if (new TextEncoder().encode(encoded).length > limit) throw new ProtocolValidationError(`${name} exceeds the encoded wire byte limit`);
  }
  // Schema validation above limits the frame union; every publication frame
  // must carry the same nested byte rules, including fresh ref-read echoes.
  const publicationFrame = name === 'Frame' && value && typeof value === 'object' && 'type' in value && String(value.type).startsWith('publication_');
  if (name.startsWith('Publication') || name.startsWith('PublishedResult') || name.startsWith('RemotePreparation') || name.startsWith('Result') || publicationFrame || name === 'Frame' && value && typeof value === 'object' && 'type' in value && ['result_read','result_read_result'].includes(String(value.type))) {
    resultBytes(value);
    if(publicationFrame && new TextEncoder().encode(JSON.stringify(value)).length>512*1024)throw new ProtocolValidationError('Publication frame exceeds encoded byte bounds');
    if (name === 'Frame' && value && typeof value === 'object' && 'result_read_result' in value) validate('ResultReadResponse',value.result_read_result);
  }
  // AJV follows nested schemas, but transport byte limits must also follow them.
  const nested = value as Record<string, unknown>;
  if (name === 'PublicationRefReadRequest') validate('PublicationPushRequest', nested.push);
  if (name === 'PublicationRefReadResponse') validate('PublicationRefReadRequest', nested.request);
  if (publicationFrame) {
    if ('publication_push' in nested) validate('PublicationPushRequest', nested.publication_push);
    if ('publication_ref_read' in nested) validate('PublicationRefReadRequest', nested.publication_ref_read);
    if ('publication_ref_read_result' in nested) validate('PublicationRefReadResponse', nested.publication_ref_read_result);
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
