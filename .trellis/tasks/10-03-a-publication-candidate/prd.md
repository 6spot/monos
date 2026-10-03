# Controlled publication candidate

## Goal

Build an exact result-tree delivery candidate with verified public parents and bounded publication-range findings.

## Planning status

Backlog leaf; refine source-backed design, execution checklist and contexts before implementation. The user delegates successive task execution and routine decisions autonomously.

## Dependencies and order

- [10-03-a-local-result-review](../10-03-a-local-result-review/prd.md).

## Requirements

- Keep private Agent ancestry internal; the candidate has the exact result tree and only recorded verified public parents. Persist immutable source-to-candidate identity for replay.
- Scan every newly reachable commit and introduced/changed file version, including later-deleted content, plus the final tree. Record candidate/parents/rule/configuration identity.
- Report tracked-ignore, publication size, credential-pattern and workflow-permission findings with sensitive matching values redacted. Exact eligible override receipts cannot bypass provider hard limits or missing permissions.
- Candidate construction and scans perform no remote write and remain available in after-acceptance mode.

## Acceptance Criteria

- [ ] Repeated preparation preserves exact candidate identity and never incorporates private ancestry or rewrites published history.
- [ ] Deleted historical sensitive content is detected; changed parents/rules/candidate invalidate prior findings and overrides.
- [ ] Local REVIEW shows bounded, redacted findings and exact candidate/result mapping at desktop/mobile sizes.

## Scope boundary

Implement this leaf only after its upstream evidence is accepted. Preserve [architecture](../../../ARCHITECTURE.md) and [invariants](../../../docs/08-principles-and-non-goals.md); no generic workflow engine, new Git Task states, team abstraction, remote source push, distributed workspace transfer or permanent disk-loss recovery.
