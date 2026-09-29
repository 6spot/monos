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
  if (['Frame', 'CommandEnvelope', 'OwnerCommand', 'OwnerLogin', 'ConfigurationCommand', 'TodoCommand', 'DiscussionCommand'].includes(name) && value && typeof value === 'object' && 'schema_version' in value && value.schema_version !== 1) throw new ProtocolVersionError('Unsupported schema version');
  let validator = validators.get(name);
  if (!validator) {
    validator = ajv.compile({ $ref: `${schema.$id}#/definitions/${name}` });
    validators.set(name, validator);
  }
  if (!validator(value)) throw new ProtocolValidationError(`Invalid ${name}: ${ajv.errorsText(validator.errors, { dataVar: 'body' })}`);
  const limit = ['Frame', 'RunnerInventory'].includes(name) ? MAX_FRAME_BYTES : ['Dispatch', 'Operation', 'OperationResult'].includes(name) ? MAX_ITEM_BYTES : undefined;
  if (limit !== undefined && new TextEncoder().encode(JSON.stringify(value)).length > limit) throw new ProtocolValidationError(`${name} exceeds the encoded wire byte limit`);
  return value as T;
}
