import { bigint, boolean, integer, jsonb, pgTable, text, timestamp } from 'drizzle-orm/pg-core';

// Reviewed migration owns locking/constraints. These mappings support typed reads.
export const runners = pgTable('runners', {
  credentialRevoked: boolean('credential_revoked').notNull(),
  id: text('id').primaryKey(), credentialHash: text('credential_hash').notNull(), capacity: integer('capacity').notNull(),
  incarnation: bigint('incarnation', { mode: 'number' }).notNull(), connected: boolean('connected').notNull(), ready: boolean('ready').notNull(),
  bootId: text('boot_id'), lastSeen: timestamp('last_seen', { withTimezone: true }), connectionInstance: text('connection_instance'),
});
export const commandReceipts = pgTable('command_receipts', {
  attemptId: text('attempt_id').notNull(), scopeId: text('scope_id').notNull(), requestId: text('request_id').notNull(),
  commandName: text('command_name').notNull(), digest: text('digest').notNull(), schemaVersion: integer('schema_version').notNull(),
  envelopeJSON: text('envelope_json').notNull(), response: jsonb('response').notNull(), operationId: text('operation_id'),
});
