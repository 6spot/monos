# Delivery ownership observer design

2026-10-07. Active task `10-03-a-delivery-acceptance`. Read-only source research; this document is the sole writable path. No host/query execution, helper installation, tests, provider action, product edit or lifecycle operation occurred. Initial dirty paths are shared Trellis/framework and this task's planning/research. Root owns host transport, actual snapshots/backups, dependency review and implementation.

## Decision and source anchors

Retain all 19 historical ownership dimensions and add separately named schema-aware delivery/review dimensions. Physical ownership, durable pending authority, unresolved original effects, semantic Owner waits and prospective automatic work are separate facts. A terminal/revoked label or expired claim alone does not establish quiescence; historical mutation/claim fields alone do not establish live work.

The old `native-audit-v2.py` imports the host-only `monos_replan_audit_common_v3` and calls `a.idle(p)`. Its full implementation is not tracked here. Root independently extracted the 19 baseline definitions and verified the private source; do not copy/dump that file or its credential-like literal into task artifacts. Keep the old dimensions and compare new fields through explicit availability/version logic rather than asserting an unchanged 19-key set after schema expansion.

Owning sources: `publication-candidates.ts:26,39,99,107` (local eligibility/automatic creation/Runner dispatch), `remote-preparation.ts:45,74,108,159,187,231` (automatic admission, original recovery and settlement), `remote-preparation-state.ts:38` (canonical original-effect quiescence), `owner-delivery-worker.ts:127,145,248,272` (batch claim/pre-effect/finality), `task-review-state.ts:17,20,23,43` (guards/settlement/Cancel/successor), `task-review-coordinator.ts:15` (pending settlement/new sources). Review/Owner delivery/remote specs and verification-scope/collaboration govern this design.

## Schema 21 availability and immediate projection SQL

Run discovery in an explicitly read-only transaction. Preserve ordered applied migration versions/checksums, actual schema/search path and each required relation's availability. Version 21 has **none** of the following new families: publication version 22; remote version 23; Owner delivery version 24; review version 25. Missing-before-introduction is `available=false,value=null`, never a measured zero. Missing after its recorded migration is an observer failure. Do not use `CASE` around a static reference to an absent relation: PostgreSQL resolves the table before evaluating the branch. Execute new-table queries only after separate availability discovery.

```sql
SELECT version, checksum FROM schema_migrations ORDER BY version;
SELECT current_schema() AS schema_name, current_setting('search_path') AS search_path;
SELECT name,
       to_regclass(format('%I.%I',current_schema(),name)) IS NOT NULL AS available
FROM unnest(ARRAY[
 'delivery_operations','remote_preparation_items','remote_preparation_operations',
 'remote_preparation_observations','owner_delivery_batches',
 'owner_delivery_batch_items','owner_delivery_merge_operations','owner_delivery_observations',
 'owner_delivery_finalizations','task_review_feedback','task_review_operations',
 'task_review_sources','task_input_reconsiderations','owner_delivery_revocations',
 'owner_delivery_revocation_settlements','task_review_settlements',
 'task_review_input_successors'
]) AS names(name);
```

The following **schema-21-compatible projection** identifies the exact source selection shape used by `ensureLocalCandidate`, and why each old REVIEW Task can become newly actionable after installation. It reads no URL, credential or full settings/context. It is a conservative candidate inventory, not proof of permission to mutate remotely or final canonical source validity.

```sql
SELECT t.id AS task_id, t.project_id, t.control_version,
       t.specification_id, t.plan_id,
       t.accepted_delivery_operation_id IS NULL AS no_accepted_pointer,
       NOT EXISTS(SELECT 1 FROM task_publication_slots x WHERE x.task_id=t.id)
         AS no_publication_slot,
       NOT EXISTS(SELECT 1 FROM replan_requests x
                  WHERE x.task_id=t.id AND x.status='pending') AS no_pending_replan,
       NOT EXISTS(SELECT 1 FROM attempts x
                  WHERE x.task_id=t.id AND NOT x.process_released) AS processes_released,
       NOT EXISTS(SELECT 1 FROM workspace_leases x
                  WHERE x.task_id=t.id AND x.state<>'released') AS leases_released,
       src.operation_id AS selected_source_operation_id,
       src.resource_id, src.runner_id, src.workspace_id, src.storage_id,
       src.content_digest AS completion_manifest_digest,
       src.source_specification_id, src.source_plan_id,
       src.node_id, src.node_activation, src.current_node_activation,
       src.current_node_state,
       src.in_effective_plan,src.canonical_completion_current,
       src.git_commit, src.git_tree,
       COALESCE(src.remote_mode,'automatic') AS remote_preparation_mode,
       src.github_identity,
       src.has_numeric_provider_repository
FROM tasks t
LEFT JOIN LATERAL (
 SELECT o.id AS operation_id,o.resource_id,a.runner_id,w.id AS workspace_id,w.storage_id,
        m.content_digest,m.specification_id AS source_specification_id,
        m.plan_id AS source_plan_id,m.node_id,m.node_activation,
        n.activation AS current_node_activation,n.state AS current_node_state,
        EXISTS(SELECT 1 FROM plan_nodes pn WHERE pn.plan_id=t.plan_id AND pn.node_id=m.node_id)
          AS in_effective_plan,
        (m.task_id=t.id AND m.attempt_id=a.id AND o.completion_manifest_digest=m.content_digest
         AND n.activation=m.node_activation AND n.state='COMPLETED'
         AND EXISTS(SELECT 1 FROM plan_nodes pn WHERE pn.plan_id=t.plan_id AND pn.node_id=m.node_id)
         AND EXISTS(SELECT 1 FROM node_completions c WHERE c.operation_id=m.operation_id
                      AND c.node_id=m.node_id AND c.activation=m.node_activation
                      AND c.attempt_id=m.attempt_id)
         AND EXISTS(SELECT 1 FROM workspace_leases l WHERE l.id=o.workspace_lease_id
                      AND l.attempt_id=m.attempt_id AND l.workspace_id=w.id)
         AND (WITH RECURSIVE edges(old_spec,old_plan,new_spec,new_plan) AS (
          SELECT x.parent_id,x.plan_id,x.specification_id,x.plan_id
          FROM specification_node_applicability x
          WHERE x.task_id=m.task_id AND x.node_id=m.node_id AND x.node_activation=m.node_activation
            AND x.disposition='carry' AND x.completion_operation_id=m.operation_id
            AND x.completion_manifest_digest=m.content_digest
          UNION ALL
          SELECT p.old_specification_id,p.old_plan_id,p.new_specification_id,p.new_plan_id
          FROM replan_node_applicability x JOIN replan_publications p ON p.id=x.publication_id
          WHERE x.task_id=m.task_id AND x.node_id=m.node_id AND x.node_activation=m.node_activation
            AND x.target_node_id=m.node_id AND x.target_node_activation=m.node_activation
            AND x.disposition='carry' AND x.completion_operation_id=m.operation_id
            AND x.completion_manifest_digest=m.content_digest
         ), path(spec,plan) AS (
          SELECT m.specification_id,m.plan_id
          UNION SELECT e.new_spec,e.new_plan FROM path p JOIN edges e
             ON e.old_spec=p.spec AND e.old_plan=p.plan
         ) SELECT EXISTS(SELECT 1 FROM path WHERE spec=t.specification_id AND plan=t.plan_id)))
          AS canonical_completion_current,
        o.result->>'git_commit' AS git_commit,o.result->>'git_tree' AS git_tree,
        r.settings->>'remote_preparation' AS remote_mode,
        r.repository_identity LIKE 'github.com/%' AS github_identity,
        COALESCE(r.settings->>'provider_repo_id','') ~ '^[1-9][0-9]{0,15}$'
          AS has_numeric_provider_repository
 FROM operations o JOIN attempts a ON a.id=o.attempt_id
 JOIN completion_manifests m ON m.operation_id=o.id
 JOIN task_workspaces w ON w.id=o.workspace_descriptor->>'workspace_id'
 LEFT JOIN nodes n ON n.id=m.node_id AND n.task_id=t.id
 LEFT JOIN project_resources r ON r.id=o.resource_id
 WHERE a.task_id=t.id AND o.kind='complete_node' AND o.state='succeeded'
   AND w.finalized_commit=o.result->>'git_commit'
 ORDER BY o.created_at DESC,o.id DESC LIMIT 1
) src ON true
WHERE t.state='REVIEW'
ORDER BY t.id;
```

`localAdmissionAllowed` requires REVIEW, no accepted pointer/publication slot/pending Replan, released processes/leases. `ensureLocalCandidate` then selects the latest completion above and calls `resolveCanonicalResult`; a missing/noncurrent Git identity causes no candidate. Currentness additionally requires current Node activation/COMPLETED/effective Plan membership and exact immutable carry ancestry from `task-result-reads.ts:54–63,110–115`. Full source identity, descriptor/digest/dispatch/lease equality is checked in `resolveCanonicalResult:205+`; the projection does not bypass those checks. Root should retain all projected rows and blockers, then use read-only canonical source validation where necessary rather than promoting a SQL approximation to authority.

In particular, an old RELEASED REVIEW Task with a valid Git completion and no delivery rows will create a **new** candidate after upgrading to 25. A changed configuration creates a new scan; an identical inactive pending request can be reactivated; identical terminal incomplete/error result requires explicit Retry. Runner support/availability gates physical dispatch, not candidate creation. Deferred `after_acceptance` disables remote mutation but **does not disable local candidate preparation**. Ordinary remote admission also requires automatic mode, numeric GitHub repository mapping, exact current source/config/complete scan/waivers, no exposure and common input/review guards. Root must enumerate prospective old REVIEW work before installing; no fixture SQL or invented maintenance flag may suppress it.

Version 24 also explicitly rejects any legacy acceptance attribution; check this before migration, even when the old ownership counts are zero:

```sql
SELECT (SELECT count(*) FROM tasks WHERE accepted_delivery_operation_id IS NOT NULL
           OR accepted_delivery_input_cutoff IS NOT NULL) AS legacy_accepted_tasks,
       (SELECT count(*) FROM task_inputs WHERE accepted_delivery_operation_id IS NOT NULL)
         AS legacy_accepted_inputs;
```

## Additional counts after the owning migration exists

Each block is an independent read-only query, enabled only after discovering its relations. Counts deliberately overlap: never sum them as a unique-worker total. Pair every positive count with bounded IDs and safe scope metadata using the same predicate. Due dates, Runner connectivity/capability, permission expiry and cooldowns explain waiting; omitting these scheduling gates retains pending authority that will become actionable later. A blocked operation is not automatically history.

### Version 22: local publication

```sql
SELECT count(*) FILTER (WHERE state='pending' AND dispatch_active)
         AS publication_pending_active,
       count(*) FILTER (WHERE state='pending' AND NOT dispatch_active
                         AND (last_sent_at IS NOT NULL OR sent_incarnation IS NOT NULL))
         AS publication_inactive_sent_unsettled,
       count(*) FILTER (WHERE state='pending' AND NOT dispatch_active
                         AND last_sent_at IS NULL AND sent_incarnation IS NULL)
         AS publication_inactive_unsent_history,
       count(*) FILTER (WHERE state='terminal') AS publication_terminal_history
FROM delivery_operations;
```

The first two reject a globally settled-work claim. For the first, independently reconcile current source/basis/config through `effectiveResult`/`publicationConfiguration`; a stale active request is a conservative blocker until the actual owner deactivates it. The third alone is allowed retained history, **but** `ensureLocalCandidate` can reactivate it if its three digests equal the current source/basis/config. Thus the legacy REVIEW inventory remains necessary after migration: compare its canonical current source against latest same-resource requests and report `new_candidate`, `reactivate_pending`, `already_pending`, `terminal_reuse`, or `no_canonical_git_source`, with source/config/basis digest equality. Do not implement a different SQL digest scheme to invent equality with the protocol's canonical JSON hash.

Terminal database rows prove server result commitment; native journal ACK/absence must be independently observed for any operation actually sent. Database terminal counts alone do not prove physical release of a service child.

### Version 23: remote preparation and original effect recovery

```sql
SELECT count(*) FILTER (WHERE effect_owned) AS remote_effect_owned,
       count(*) FILTER (WHERE NOT worker_absent) AS remote_worker_not_absent,
       count(*) FILTER (WHERE may_have_mutated AND state NOT IN('settled','revoked'))
         AS remote_original_effect_unsettled,
       count(*) FILTER (WHERE active AND (state IN('pending','started','unknown')
                                         OR kind='push' AND state='failed'))
         AS remote_pending_or_recovery_authority,
       count(*) FILTER (WHERE state NOT IN('settled','revoked')
                         AND (claim_id IS NOT NULL OR claim_instance IS NOT NULL
                              OR claim_expires_at IS NOT NULL))
         AS remote_nonterminal_claim,
       count(*) FILTER (WHERE active AND kind<>'push' AND state='failed' AND NOT may_have_mutated
                         AND NOT effect_owned AND worker_absent)
         AS remote_owner_retry_wait,
       count(*) FILTER (WHERE state='settled' AND worker_absent AND NOT effect_owned
                         AND (claim_id IS NOT NULL OR claim_instance IS NOT NULL
                              OR claim_expires_at IS NOT NULL))
         AS remote_settled_retained_claim_history,
       count(*) FILTER (WHERE state NOT IN('settled','revoked','failed') AND NOT active)
         AS remote_inactive_nonterminal_anomaly
FROM remote_preparation_operations;

SELECT count(*) AS remote_settled_push_missing_published_proof
FROM remote_preparation_operations o
WHERE o.kind='push' AND o.state='settled'
  AND o.result->>'status'='reconciliation_required'
  AND NOT EXISTS(SELECT 1 FROM remote_preparation_observations p
                  WHERE p.operation_id=o.id AND p.kind='published');

SELECT count(*) AS remote_revoked_sent_push_needs_original_reply
FROM remote_preparation_operations o
WHERE o.kind='push' AND o.state='revoked' AND NOT o.active
  AND NOT o.may_have_mutated AND NOT o.effect_owned
  AND o.claim_id IS NULL AND o.claim_instance IS NULL AND o.claim_expires_at IS NULL
  AND o.last_sent_at IS NOT NULL AND o.sent_incarnation IS NOT NULL
  AND NOT EXISTS(SELECT 1 FROM remote_preparation_observations p
                  WHERE p.operation_id=o.id AND p.kind='ref'
                    AND p.observation ? 'revoked_push_result');

SELECT count(*) FILTER (WHERE cancel_requested AND cleanup_state IN('pending','attention'))
         AS remote_cancel_cleanup_unsettled,
       count(*) FILTER (WHERE cancel_requested AND cleanup_state='none')
         AS remote_cancel_without_cleanup_anomaly,
       count(*) FILTER (WHERE cancel_requested
                         AND cleanup_state IN('closed','not_needed','externally_merged'))
         AS remote_terminal_cleanup_history
FROM remote_preparation_items;
```

Effect, worker, original effect, pending/recovery authority, nonterminal claim, published-proof recovery, revoked-sent reply recovery and incomplete Cancel cleanup are blockers. `remoteItemQuiescent` only covers its two original-effect predicates; it is **not** a complete upgrade observer. A failed provider operation with no possible effect and actual worker absence is an Owner Retry wait, separately reported rather than mislabelled live execution. An active push in failed state remains in the Runner pending-frame selector, so it is counted as pending/recovery authority separately. Settled retained claims are history: `settleProvider` and push result settlement leave their claim fields immutable. Claim expiry never proves worker absence.

The revoked-sent query mirrors `RemotePreparation.pending:108–112`: replay denies a new push grant and completes the original journal result/ACK. A revoked unsent pregrant operation is passive history. A settled uncertain push remains reconciliation work until the exact original ref receives published proof; it never permits a replacement push. Existing PR check polling without an admitted operation is read-only observation, so do not make every `next_poll_at` or cooldown row a live mutation owner.

Prospective remote work also needs an inventory even when all these counts are zero. `RemotePreparation.pump:49` first selects latest **terminal prepared/mapped** rows per Task/resource, creates missing remote item identity, then attempts permission observation and admission. `admit` separately uses the latest local row of **any** state, not merely this discovery row. Read-only projection:

```sql
WITH discovered AS (
 SELECT DISTINCT ON(task_id,resource_id) id,task_id,resource_id,item_id,runner_id,
        created_at,result
 FROM delivery_operations
 WHERE state='terminal' AND result->>'status' IN('prepared','mapped')
 ORDER BY task_id,resource_id,created_at DESC,id DESC
)
SELECT d.task_id,d.resource_id,d.item_id,d.runner_id,d.id AS discovery_operation_id,
       latest.id AS latest_local_operation_id,latest.state AS latest_local_state,
       latest.result->>'status' AS latest_local_outcome,
       t.state AS task_state,t.accepted_delivery_operation_id,
       COALESCE(r.settings->>'remote_preparation','automatic') AS preparation_mode,
       r.repository_identity LIKE 'github.com/%' AS github_identity,
       COALESCE(r.settings->>'provider_repo_id','') ~ '^[1-9][0-9]{0,15}$'
         AS has_numeric_provider_repository,
       i.item_id IS NOT NULL AS remote_item_exists,i.cancel_requested,i.cleanup_state,
       i.pr_id IS NOT NULL AS has_owned_pr,
       i.last_published_proof->'candidate'->>'head' AS published_head,
       latest.result->'candidate'->>'head' AS candidate_head,
       latest.result->'scan'->>'status' AS scan_status,
       jsonb_typeof(latest.result->'scan'->'workflow_changes')='boolean'
         AS has_workflow_scope,
       EXISTS(SELECT 1 FROM remote_preparation_operations o WHERE o.item_id=d.item_id
                AND o.active AND o.state NOT IN('settled','revoked')) AS existing_remote_owner
FROM discovered d JOIN tasks t ON t.id=d.task_id
JOIN project_resources r ON r.id=d.resource_id
LEFT JOIN remote_preparation_items i ON i.item_id=d.item_id
LEFT JOIN LATERAL (SELECT id,state,result FROM delivery_operations o
                  WHERE o.task_id=d.task_id AND o.resource_id=d.resource_id
                  ORDER BY created_at DESC,id DESC LIMIT 1) latest ON true
ORDER BY d.task_id,d.resource_id;
```

This projection does not claim new-effect authority. Exact `ordinaryRemoteAdmission` requires automatic mode/current local terminal result, canonical current source and config, input/review guards, complete workflow scope, exact finding/waiver coverage and no known exposure. An accepted Task instead requires the actual unrevoked frozen batch authority (`frozenDeliveryRepository`). No old schema21 batch can be manufactured. Classify possible automatic identity/permission/local rescan/push/PR-content work individually, including changed local content; lack of current credentials explains a block but does not erase prospective work after App configuration.

### Version 24: Owner batch claims, merge effects and finality

```sql
SELECT count(*) FILTER (WHERE status IN('active','waiting','reconciling'))
         AS delivery_batch_pending_authority,
       count(*) FILTER (WHERE checkpoint->'claim' IS NOT NULL
                         AND checkpoint->'claim'<>'null'::jsonb)
         AS delivery_batch_checkpoint_claim,
       count(*) FILTER (WHERE status IN('failed','attention'))
         AS delivery_batch_owner_wait,
       count(*) FILTER (WHERE status IN('completed','cancelled','revoked'))
         AS delivery_batch_terminal_history
FROM owner_delivery_batches;

WITH classified AS (
 SELECT m.*,
  EXISTS(SELECT 1 FROM owner_delivery_finalizations f
         JOIN owner_delivery_batch_items i ON i.batch_id=f.batch_id AND i.item_id=f.item_id
           WHERE f.operation_id=m.id AND f.batch_id=m.batch_id AND f.item_id=m.item_id
             AND m.result->>'state'='merged' AND m.result->>'final_head'=f.final_commit
             AND f.fact->>'batch_id'=m.batch_id AND f.fact->>'item_id'=m.item_id
             AND f.fact->>'operation_id'=m.id AND f.fact->>'request_digest'=m.request_digest
             AND f.fact->>'accepted_head'=i.repository->'candidate'->>'head'
             AND f.fact->>'requested_method'=m.selected_method
             AND f.fact->>'final_commit'=f.final_commit AND f.fact->'evidence'=m.result)
    AS finalization_recorded,
  m.status='failed' AND m.result->>'state'='rejected'
    AND EXISTS(SELECT 1 FROM owner_delivery_observations e
                 WHERE e.operation_id=m.id AND e.batch_id=m.batch_id AND e.item_id=m.item_id
                   AND e.kind='merge' AND e.digest=m.result_digest AND e.observation=m.result)
    AS definitive_rejection_recorded
 FROM owner_delivery_merge_operations m
)
SELECT count(*) FILTER (WHERE effect_owned) AS merge_effect_owned,
       count(*) FILTER (WHERE claim IS NOT NULL OR backend_instance IS NOT NULL
                         OR claim_expires_at IS NOT NULL) AS merge_claim_not_cleared,
       count(*) FILTER (WHERE status IN('pending','started','unknown')) AS merge_pending_or_recovery,
       count(*) FILTER (WHERE may_have_mutated AND NOT
                         (status='succeeded' AND finalization_recorded
                          OR COALESCE(definitive_rejection_recorded,false)))
         AS merge_possible_effect_without_definitive_fact,
       count(*) FILTER (WHERE status='succeeded' AND NOT finalization_recorded)
         AS merge_succeeded_without_exact_finalization_anomaly,
       count(*) FILTER (WHERE status='succeeded' AND finalization_recorded
                         AND NOT effect_owned AND claim IS NULL
                         AND backend_instance IS NULL AND claim_expires_at IS NULL)
         AS merge_succeeded_history,
       count(*) FILTER (WHERE definitive_rejection_recorded AND NOT effect_owned
                         AND claim IS NULL AND backend_instance IS NULL AND claim_expires_at IS NULL)
         AS merge_definitively_rejected_history
FROM classified;

SELECT count(*) AS delivery_finalization_history FROM owner_delivery_finalizations;
```

Version24's query may mention `revoked` safely but will never contain such rows until version25 adds that status. Batch checkpoint claims exist **before** a merge row: omitting them misses worker/provider activity. Non-null expired claims remain ownership/recovery facts. `OwnerDeliveryWorker.pump` also recovers cancelled/revoked batches with started/unknown possible merge; the merge counts cover that branch independently of batch labels.

All pending batch/merge, uncleared claims, possible effects and integrity anomalies block a settled-work claim. Succeeded and exact rejected effects are allowed historical facts when effect/claims are clear; `may_have_mutated=true` remains immutable. Actual successful merge commits its matching finalization in the same transaction. Missing finalization is an integrity failure, never a reason to issue another merge. The immutable fact/receipt digest and exact batch request binding still require owning read-only validation; the existence projection alone is not a substitute for that authority. Finalization/terminal-history totals may be positive and must be preserved, not forced to zero.

### Version 25: review holds and exact source authority

```sql
SELECT count(*) FILTER (WHERE settlement_pending) AS review_settlement_pending,
       count(*) FILTER (WHERE status IN('settling','queued','running'))
         AS review_unresolved_execution_or_admission,
       count(*) FILTER (WHERE status IN('issue','failed')) AS review_owner_answer_retry_wait,
       count(*) FILTER (WHERE purpose='reconsider_input'
                         AND status IN('settling','queued','running','issue','failed'))
         AS review_input_current_guard
FROM task_review_operations;

SELECT (SELECT count(*) FROM task_review_feedback WHERE status='active')
         AS review_active_feedback_guard,
       (SELECT count(*) FROM task_input_reconsiderations WHERE status='pending')
         AS review_pending_original_input_guard,
       (SELECT count(*) FROM owner_delivery_revocations r WHERE NOT EXISTS
          (SELECT 1 FROM owner_delivery_revocation_settlements s WHERE s.revocation_id=r.id))
         AS review_revocation_original_settlement_missing,
       (SELECT count(*) FROM task_review_settlements) AS review_settlement_history,
       (SELECT count(*) FROM owner_delivery_revocation_settlements)
         AS review_revocation_settlement_history;

SELECT count(*) AS review_source_current_relational_authority
FROM task_review_sources s
JOIN task_review_operations o ON o.source_id=s.id
JOIN tasks t ON t.id=s.task_id
JOIN task_review_feedback f ON f.id=o.feedback_id
WHERE NOT s.done AND s.preparation_failure IS NULL
  AND o.status IN('queued','running') AND NOT o.settlement_pending
  AND o.version::text=s.source->>'operation_version'
  AND t.state='REVIEW' AND t.accepted_delivery_operation_id IS NULL
  AND t.specification_id=s.source->>'specification_id'
  AND t.plan_id=s.source->>'plan_id'
  AND t.control_version::text=s.source->>'control_version'
  AND NOT EXISTS(SELECT 1 FROM task_publication_slots p WHERE p.task_id=t.id)
  AND (o.purpose='route_feedback' AND f.status='active' AND f.current_operation_id=o.id
       OR o.purpose='reconsider_input' AND EXISTS
         (SELECT 1 FROM task_input_reconsiderations i WHERE i.id=o.reconsideration_id
           AND (i.operation_id=o.id AND i.status='pending' OR EXISTS
             (SELECT 1 FROM task_review_input_successors x
               WHERE x.reconsideration_id=i.id AND x.operation_id=o.id))));

SELECT count(*) AS review_attempt_unsettled
FROM attempts a WHERE a.task_review_source_id IS NOT NULL AND
 (a.state='QUEUED' OR NOT a.process_released OR NOT a.process_absent OR a.mutation_allowed
  OR EXISTS(SELECT 1 FROM operations o WHERE o.attempt_id=a.id
               AND o.state NOT IN('succeeded','cancelled')));

SELECT count(*) AS review_source_retained_not_done_inventory
FROM task_review_sources WHERE NOT done;
```

Settlement/admission/execution/current source/Attempt counts reject settled work. Unresolved feedback and issue/failed waits are semantic control obligations and block ordinary review/delivery/Node authority; report separately from actual live workers. Root's stronger final acceptance criterion requires disposition/settlement of its owned obligations, while an installation assessment must state any retained Owner waits honestly. Do not declare them released just because no Agent process is running.

The source query mirrors `assertReviewSource:42–44` relational generation/Task/current feedback or actual input successor authority. Full canonical source/prompt/context equality with the persisted launch remains essential. A `transferred` original reconsideration may have an actual unresolved successor after Replan Dismiss: count operations/successor bindings directly, not just original `status='pending'`. `done=true`, cancelled/withdrawn status or source detachment does not release the original Attempt/Stop/lease. The Attempt predicate remains enforced even for historical sources. A context preparation failure is an Owner wait and cannot create an Attempt; it is not a physical worker.

Settlement records are immutable version/phase facts. Count current `settlement_pending` and missing revocation marker, preserve prior markers, and validate exact recorded identity. Never re-evaluate an old marker against unrelated later Attempts to turn historical settlement into current work. Withdrawal can leave settlement pending and Request Changes can revoke an accepted batch without any new physical source yet.

## Baseline authority and native journal boundary

Keep the old19 predicates Root extracted: Attempts unreleased/absent/mutation/QUEUED; generic operations not succeeded/cancelled; unreleased leases; unfinished outboxes; actionable discussion controls/input/guidance/followup; requirement settlement/withdrawal/publication slot/obligation; unresolved Replan source/hold/reconciliation; and actual canonical runnable Node authority. No new PostgreSQL claim/lease table represents local publication service children.

For fresh Nodes, `node-execution.ts:165+` selects RUNNING/current Plan/PENDING/no source/publication unfrozen, with an actual `plan_published` event joined to its matching planning outbox/Attempt/Plan or genuine Replan publication. Dependency readiness requires canonical current completions. The version25 extension must also apply `reviewDispatchBlocked` before treating such a Node as runnable. Historical PENDING Nodes in superseded Plans, refresh-only applicability, stale activations or a fabricated Plan event are not runnable authority. Existing queued Attempts remain blockers even if current source authority was revoked; only the actual owner and physical Stop settlement can release them.

Native publication journals have intent/pages/result/absence/ACK facts outside PostgreSQL. `runner/internal/host/publication_remote_journal.go:74,127,190` admits a predecessor only with exact immutable result, physical absence and `ack.json`; a revoked server observation is original reply settlement, not proof that ACK reached disk. Root's physical observer must bind local/remote service work to exact Task/operation/request/result/Runner/storage identity and independently confirm actual child/unit/cgroup absence. Missing inaccessible journal or an expired claim is unknown, not released. Preserve terminal acknowledged journals as history. This research neither runs nor changes that host observer.

## Minimal observer negative cases and measurable gate

These are focused predicate cases for Root's observer implementation/review, not a new live native fault tour. Reuse accepted owner-layer fixtures/evidence where input hashes match; documentation itself does not justify running product suites.

| Case | Required observation |
| --- | --- |
| Installed21 missing new families | unavailable/null with version21; no absent-table SQL parse error and no invented zero |
| Applied25 missing a required table or changed applied checksum | observer failure; no installation admission |
| Old current Git REVIEW Task, no new rows; offline/unsupported Runner or deferred remote mode | prospective local candidate recorded; physical dispatch deferred independently |
| Latest complete operation stale activation or absent exact carry | conservative inventory retained but canonical eligibility false; no authority manufactured from PENDING/Plan labels |
| Local active pending vs inactive-unsent stale vs inactive-sent | first blocks; second history unless exact digests permit reactivation; third requires original settlement/journal |
| Remote settled with retained claims and may-have-mutated | zero live count with worker/effect cleared and exact proof; immutable claim/mutation history retained |
| Remote unknown or expired claim/worker-not-absent | blocker remains; elapsed time is not physical evidence |
| Revoked unsent push vs revoked sent push without original ref-result vs ACK lost | history vs original recovery blocker vs physical journal blocker; never new grant |
| Settled reconciliation-required push without published proof | recovery blocker despite terminal state |
| Cancel cleanup pending/attention vs closed/not-needed/externally-merged | incomplete cleanup blocks; terminal cleanup/history allowed; retained branch is not ownership |
| Batch checkpoint claim before a merge row | blocker detected independently of merge count |
| Cancelled/revoked batch with possible started/unknown merge | original reconciliation blocker; no automatic close/remerge |
| Succeeded merge with finalization vs failed rejected exact observation vs mismatched rejected evidence | first two history after claims/effects clear; mismatch blocks; absent finality fails integrity |
| Original transferred input with new successor queued/issue/failed | active successor/control guard detected while original disposition/history stays immutable |
| Review Withdraw/Cancel with source done and Attempt unreleased or settlement pending | blocker survives logical retirement |
| Unrelated old immutable settlement plus newer Attempt | old marker remains history; newer physical ownership independently blocks |
| Existing harmless PR readiness poll/cooldown, terminal acknowledged journal | history/read-only inventory, not a new write owner |

Gate evidence must include ordered migration/checksum equality; new availability flags; all19 baseline counts and scoped positive IDs; new named counts and exact predicate version/hash; every old REVIEW Task's selected source/currentness/digest classification and possible remote admission; actual matching native absence/ACK; preserved history multiplicities; maintenance stop identity; and a second read-only ownership snapshot with backend/Runner actually excluded before coordinated backup/install. Positive hard blockers, unknown/inaccessible physical evidence, canonical/proof anomalies or unexplained prospective work reject the gate. Explicitly enumerate any legitimate new append-only candidate facts planned for old REVIEW Tasks and bind their eventual settlement; a live zero sample alone does not exclude a later pump/admission.

## Verification and handoff

Source-only reads (`rg`, bounded `sed`) and initial `git status --short`; no query was executed, so SQL is a source-reviewed draft for Root's host observer, **not claimed runtime verification**. A local `python3` document check passed for 13 owning source paths, balanced code fences and no trailing whitespace; `git diff --check -- .trellis/tasks/10-03-a-delivery-acceptance/research/ownership-observer-design.md` returned zero (the path is untracked, so the direct whitespace check is the material check). Root independently validates actual schema21 projection, implements/version-binds the observer and reviews native/host exclusion before installation. No lint/typecheck/build/product tests, host/provider action, helper mutation or commit was performed for this documentation assignment.
