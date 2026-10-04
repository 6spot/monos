# Controlled publication candidate

## Goal

Build an exact result-tree delivery candidate with verified public parents and bounded publication-range findings.

## Planning status

Reviewed local preparation scope. The user delegates successive task execution and routine decisions autonomously; this standing authorization covers activation, implementation, scoped commits and bookkeeping. Product Owner override receipts still require actual authenticated Owner commands.

## Dependencies and order

- [10-03-a-local-result-review](../archive/2026-10/10-03-a-local-result-review/prd.md).

## Requirements

- Keep private Agent ancestry internal; the candidate has the exact result tree and only recorded verified public parents. Persist immutable source-to-candidate identity for replay.
- Scan every newly reachable commit and introduced/changed file version, including later-deleted content, plus the final tree. Record candidate/parents/rule/configuration identity.
- Report tracked-ignore, publication size, credential-pattern and workflow-permission findings with sensitive matching values redacted. Exact eligible override receipts cannot bypass provider hard limits or missing permissions.
- Candidate construction and scans perform no remote write and remain available in after-acceptance mode.
- Admit preparation automatically from canonical current modified Git results when local REVIEW is settled, using durable Delivery operations independent of Runtime Attempts. Replay after restart/reconnect preserves the original operation and candidate.
- Keep original result attribution separate from effective Specification/Plan/evidence applicability. Old candidates, scans and receipts remain inspectable without granting current authority.
- Provide exact local retry and eligible finding override commands with immutable authenticated receipts. Hard provider limits, unknown/missing workflow permission and incomplete coverage are never eligible.

## Acceptance Criteria

- [x] Repeated preparation preserves exact candidate identity and never incorporates private ancestry or rewrites published history.
- [x] Deleted historical sensitive content is detected; changed parents/rules/candidate invalidate prior findings and overrides.
- [x] Local REVIEW shows bounded, redacted findings and exact candidate/result mapping at desktop/mobile sizes.
- [x] Actual PostgreSQL competing workers/recovery and actual Git durable construction/scanning prove automatic admission and immutable replay; stale replies cannot regain applicability.
- [x] Exact eligible override replay is idempotent; cross-scan, stale and mixed hard/eligible selections reject atomically.
- [x] Repository-free/no-change results create no delivery item; both preparation modes run local checks without remote writes, write-token minting or Runtime capacity use.

## Scope boundary

Implement this leaf only after its upstream evidence is accepted. Preserve [architecture](../../../ARCHITECTURE.md) and [invariants](../../../docs/08-principles-and-non-goals.md); no generic workflow engine, new Git Task states, team abstraction, remote source push, distributed workspace transfer or permanent disk-loss recovery.
