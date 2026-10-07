# Schema21 prospective REVIEW inventory

Active task: `.trellis/tasks/10-03-a-delivery-acceptance`. Owned files are only this design and [legacy-review-inventory.py](legacy-review-inventory.py). Shared framework/task edits were present initially and preserved. This implements the immediate projection and legacy-seam portion of [ownership-observer-design.md](ownership-observer-design.md), without the nineteen historical ownership dimensions or later delivery/review ownership queries.

## Boundary and execution

Remote Python standard-library script, with no arguments or credential loading. Main owns independent review, any private SSH transfer, execution and immutable result retention. The delegate has performed no host/SQL execution. The script can run as a file or a `python3 -c` payload; it does not require a local source pathname. Main records the exact script SHA256 independently; the report also contains SHA256 of the complete fixed SQL.

One exact container: `monos-boundary-probe-database-1`. One `docker exec -i` starts `psql -X -qAt -v ON_ERROR_STOP=1` using the container's existing quoted `POSTGRES_USER` and `POSTGRES_DB` variables internally. There is no URL argument or environment/configuration dump. `PGOPTIONS=-c default_transaction_read_only=on` applies before connection. A single `BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY` encloses connection metadata, relation discovery, applied migration hashes, all REVIEW projections and the two legacy acceptance predicates. It commits before any report is emitted. Both SELECT results belong to that same snapshot.

The connection's original current schema must be public, with an expected public/default search path. These are reported as booleans rather than raw search-path text. After checking those snapshot facts, fixed SQL uses `SET LOCAL search_path=public`. Statement timeout15seconds, lock timeout2seconds and subprocess timeout25seconds bound the observer. No canonical locks, functions that change state, migrations, callbacks or scheduler actions are invoked.

## Expected schema and availability

This helper deliberately supports exact schema21, with ordered versions1–21 and every checksum equal to the frozen committed migrations. Source baseline is candidate `63eaa285ab90fdd6de018671a47ba5583f87bc75`. The embedded expected checksums come from those unchanged migration files, whose byte/mode preservation was independently established by the accepted candidate package.

Required ordinary tables in public: schema_migrations, tasks, task_inputs, task_publication_slots, replan_requests, attempts, workspace_leases, operations, completion_manifests, node_completions, task_workspaces, nodes, plan_nodes, project_resources, specification_node_applicability, replan_node_applicability and replan_publications. Discovery accepts only real/partitioned tables, not views. Missing relations/columns, unknown schema, noncontiguous or changed migration hashes and any schema other than21 cause exit2; no successful projection is emitted.

The17 future relations from the shared design are discovered through catalog names only. No absent relation is statically queried. Their introduction versions are22 publication,23 remote preparation,24 Owner delivery and25 review correction. Successful ordinary schema21 output retains `available=false, measured=false, value=null` for each future family. These nulls mean unmeasured/unavailable, never zero ownership. Unexpected partial/full future tables with migration21 are retained as availability facts and a blocker; report `ok=false` and exit2. Versions22–25 require their own observer implementation; this script refuses them rather than measuring incomplete later ownership. On any query/shape failure, every future availability/count is unknown/null.

## Projection and selected identities

The fixed latest-source selector copies [ensureLocalCandidate](../../../../apps/server/src/publication-candidates.ts:39): succeeded complete_node operation joined to its Attempt, completion manifest and finalized workspace, ordered by operation created_at/id descending. This shape does not search older completions when the selected latest source is noncurrent. Each REVIEW row is retained, including a null selected source.

Safe selected identities: Task, Project, current Spec/Plan, operation, resource, Runner, workspace/storage, source Spec/Plan, Node and activation. Digests are the immutable completion-manifest content digest and Git commit/tree hashes. No manifest body, launch/context/prompt, URL, raw resource settings, provider repository number, result body or credentials are serialized. Resource configuration is reduced internally to automatic/deferred mode, GitHub identity and numeric-provider-mapping booleans.

Currentness is a conservative SQL projection of [task-result-reads.ts](../../../../apps/server/src/task-result-reads.ts:54): exact current completed Node activation and effective Plan membership, manifest/operation/Attempt binding, matching immutable Node completion/lease and recursive exact completed-result carry ancestry through Specification and Replan publications. The source SELECT and booleans follow [localAdmissionAllowed](../../../../apps/server/src/publication-candidates.ts:26): no acceptance pointer/publication slot/pending Replan and no unreleased process/lease records.

Full [resolveCanonicalResult](../../../../apps/server/src/task-result-reads.ts:205) checks source/dispatch/descriptor/lease/digest identity beyond this projection; [sourceParent](../../../../apps/server/src/publication-candidates.ts:32) validates materialization ancestry. Neither function is invoked. Every row retains `canonical_source_validation_required`, `public_parent_and_configuration_validation_required` and `physical_absence_unverified`. All admission, source and Git blockers remain explicit. Therefore `prospective_local_candidate_projection=true` is potential automatic work after upgrade, not validated mutation authority. Automatic remote configuration also does not prove App issuance, scans, grants, parent pinning or remote readiness. Deferred remote mode does not suppress local candidate preparation.

Counts are complete for REVIEW Tasks and forbidden legacy seams; corresponding identities must have the same cardinality. At most1000 identities per collection and8MiB result are accepted. SQL selects1001 rows to detect an exceeded limit, then the script refuses the entire projection rather than silently truncating it. IDs follow the existing Tool Protocol Id shape; counters and Git/SHA256 values are validated before JSON output.

## Legacy acceptance migration blocker

[Migration0019](../../../../packages/db/migrations/0019_task_conversation.sql:8) introduced reserved acceptance seams. [Migration0024](../../../../packages/db/migrations/0024_owner_delivery.sql:1) explicitly rejects any Task with nonnull accepted operation OR cutoff, or any Task input with nonnull accepted operation. The observer uses those exact predicates over all Task states, not only REVIEW.

It retains both counts and exact Task/input/accepted-operation IDs, plus nullable cutoff counters. `legacy_acceptance_blocks_migration24=true` records any forbidden row. `ok=true` means a valid read-only measurement; it never clears this blocker or permits an upgrade. No seam is repaired, attributed to a invented batch, or erased.

## Error handling and limits

Docker/psql errors, statement/transport timeout, incomplete outputs, malformed or unsafe row values, missing schema/relations, mismatch with migration source or exceeded inventory bounds produce a fixed safe failure report and exit2. PostgreSQL stderr and exception values are discarded. The failure report carries no stale partial inventory, and future-family counts remain null. An unexpected future relation retains the valid measured snapshot but sets ok=false and exits2.

Neither released database flags nor this read transaction prove actual process absence. `canonical_authority=false`, `global_quiescence_checked=false` and `physical_ownership_checked=false` are always retained. No old record, Task state, Git storage or operational configuration is changed. Root must combine the eventual observation with actual native ownership, canonical source validation and admission exclusion before any installation decision.

## Verification

Delegate check: Python `compile(source, path, 'exec')` syntax only. No imports that execute the observer, SQL/host run, credentials, product lint/typecheck/tests or global nineteen-count implementation. Source/spec checks and documentation links/whitespace are checked locally. Actual read-only PostgreSQL execution and interpretation remain for main after independent review.
