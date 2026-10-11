import { describe, expect, it } from 'vitest';
import { validate } from '../src/index.ts';

const unavailable = { status: 'unavailable', source: 'global', reason: 'policy_missing', action: 'configure_policy' };
const available = { status: 'available', source: 'planner', target: { runtime_id: 'codex', model_id: 'gpt-6' }, runner_id: 'runner-1' };
const report = {
  schema_version: 1, observed_at: '2026-10-11T12:00:00.000Z', configuration_version: 1,
  schema: { status: 'current', current_version: 35, expected_version: 35 },
  planner: unavailable, projects: [], runners: [],
  unverified: ['storage', 'cli_authentication', 'model_execution', 'git_read', 'git_write'],
};

describe('installation readiness report contracts', () => {
  it('represents an empty installation without inventing verified capabilities', () => {
    expect(() => validate('SetupReport', report)).not.toThrow();
    expect(() => validate('SetupPolicyStatus', available)).not.toThrow();
  });
  for (const [name, value] of [
    ['available policy missing Runner', { ...available, runner_id: undefined }],
    ['available policy with an error', { ...available, reason: 'runner_offline' }],
    ['unavailable policy with Runner selection', { ...unavailable, runner_id: 'runner-1' }],
    ['unavailable policy missing recovery', { ...unavailable, action: undefined }],
    ['invented selection reason', { ...unavailable, reason: 'runtime_hung' }],
  ] as const) it(name, () => {
    expect(() => validate('SetupPolicyStatus', value)).toThrow();
  });
  for (const [name, value] of [
    ['unknown version', { ...report, schema_version: 2 }],
    ['credential field', { ...report, credential: 'private-secret' }],
    ['missing unverified scope', { ...report, unverified: report.unverified.slice(1) }],
    ['repeated unverified scope', { ...report, unverified: Array(5).fill('storage') }],
    ['invented verified storage', { ...report, unverified: [...report.unverified.slice(1), 'storage_ready'] }],
  ] as const) it(name, () => {
    expect(() => validate('SetupReport', value)).toThrow();
  });
});
