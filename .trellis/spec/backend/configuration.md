# Project and Role configuration

## 1. Scope / Trigger
Owner configuration, canonical Project association, Plan Role validation and resource removal/admission guards. Owning code: `configuration.ts`, `configuration-guards.ts`, migration 8 and protocol schemas.

## 2. Signatures
- GET `/v1/owner/configuration` -> `ConfigurationSnapshot`.
- POST `/v1/owner/configuration/commands` -> `ConfigurationResult`.
- GET `/v1/owner/configuration/commands/:request_id` -> prior result or `unknown`.
- `initializeTask(tx, {task_id,specification_id,specification,project_id?})`; missing Project remains internal probe compatibility only.

## 3. Contracts
Command: `schema_version=1`, `request_id`, `expected_control_version`, `name=save_project|save_role`, exact typed payload. Snapshot is complete and bounded to 2 MiB, 1024 Projects/1024 Roles, 128 resources/selected Roles per Project. An edit exceeding these limits rolls back. No hidden truncation.

Acquire Owner session share lock, then singleton configuration update lock. Check receipt before version, mutate, increment shared control version and persist receipt in one transaction. All configuration reads hold the share lock for a coherent complete snapshot. The version intentionally spans both Projects and Roles; never silently replace a stale expected version.

New canonical Task creation checks active Project. Plan publication and resource admission acquire configuration share lock BEFORE Runner/Task locks. Configuration writers inspect references under the exclusive lock. Future Start/Replan/Workspace paths must obey this barrier. Existing probe Task.resource_id is compatibility data, never a new Task resource model.

Roles are directly selected; hiding preserves existing selection and historical Plan references. Plan definitions hold Role IDs, never instructions. Resource IDs retain remote/project identity, even after removal; GitHub HTTPS/SSH/case aliases normalize to one repository identity. No local/credentialed/query/fragment/percent-encoded remotes. Resource settings affect future workspace defaults only. Admission of open_workspace reserves use; inspect_repository alone does not. Removal rejects unfinished Tasks and also unsettled writers/operations after terminalization. There is no permanent-delete API.

Plain Git resources require exact HTTPS URLs and an explicit `default_branch`;
generic SSH/HTTP and `merge_method` are rejected on save. `repositoryAdapter`
preserves canonical providerless GitHub HTTPS/SSH aliases as the GitHub adapter.
Generic endpoint paths and ports are retained exactly for access; the normalized
repository identity is never used to reconstruct a URL. `default_ref` remains an
optional checkout ref independent of the configured target branch.
The finite HTTPS grammar admits literal ASCII paths shared by JavaScript and Go
URL parsing and rejects numeric IPv4 aliases, raw Unicode/IDNA host aliases,
noncanonical IP spellings and IPv4-mapped IPv6. ASCII punycode hosts and canonical
IPv4/IPv6 remain available. Unsupported spellings fail on save, before Runner use.

`save_git_https_credential` takes `{resource_id,username,token}` for an active saved
plain resource; `clear_git_https_credential` takes `{resource_id}`. The safe
`credential_change` response uses `action:saved|cleared`; saved evidence includes
username, opaque material generation and stable scope digest. Receipts contain
the exact command digest and safe response, never the input envelope or token.
Replay is checked before version and never reinstalls old material after rotation.
Snapshot `git_https_credentials` is a required array of active resource statuses,
without encrypted or plaintext material. Storage and receipt authority are covered
by [infrastructure configuration](infrastructure-configuration.md).

## 4. Validation & Error Matrix
| Condition | Result |
| --- | --- |
| Missing/revoked/non-Owner session | unauthorized |
| Same request/content | recorded result, even after later edits |
| Same request, changed content | payload_conflict |
| Stale configuration version | version_conflict with current version |
| Duplicate resource/alias or malformed ref | invalid_input |
| Repoint/transfer resource or replacement alias ID | payload_conflict |
| Missing/newly selected hidden Role | unmet_precondition |
| Effective unfinished Plan uses removed Role | unmet_precondition |
| Reserved workspace/uncertain writer uses removed resource | unmet_precondition |
| Open after resource removal | denied_scope, no operation |
| Generic SSH/HTTP, missing plain target, or plain merge method | invalid_input |
| Credential save/clear for inactive or unknown resource | denied_scope |
| Generic credential applied to GitHub resource | invalid_input; retain GitHub App authority |

## 5. Good / Base / Bad Cases
Good: replay a lost edit response with the original request. Base: archive and restore a Project without deleting its history. Bad: overwrite another tab's edit or repoint a stable resource to another remote.

## 6. Tests Required
`postgres-configuration.test.ts` verifies restart reads, identical retries, competing versions, DB-induced receipt failure rollback, identity guards, hidden Role/Plan references, terminal writer retention, workspace admission denial and auth/CSRF. Shared JSON fixtures reject mixed command payloads, Role-bound Runtime and team fields. Full migration suite includes populated preexisting records.

## 7. Wrong vs Correct
Wrong: lock Task, then configuration; remove resources by checking only Task terminal status.
Correct: configuration barrier precedes Runner/Task; preserve unresolved physical writer/operation ownership even after terminal status.

## Completed-Task retention settings

`save_retention` uses the same Owner/CSRF, expected control version and receipt
transaction as other configuration commands. Its exact payload is
`{enabled:boolean,completed_task_days:integer}` with 1–3650 days. The initial
policy is enabled at seven days and is included in the coherent configuration
snapshot. Disabling preserves the selected interval. Readiness includes cleanup
counts and up to 16 recent blocked Task/Runner reasons; it exposes no host paths.

`TaskCleanup` takes the configuration barrier before Runner/Task locks, rechecks
formal completion age and unsettled local/provider ownership, then persists one
immutable request per Task/Runner. Policy changes apply only to new admissions.
The rotating candidate cursor must advance past unresolved or lock-busy Tasks.
Match retained results by the entire workspace/resource/storage/generation/Runner
identity and current finalized commit before freezing the request. `cleaned_at`
is a storage observation in workspace details, never a new Task lifecycle state.
See [maintenance](../../../infra/runner/operations.md).
