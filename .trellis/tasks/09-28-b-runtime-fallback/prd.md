# Second Runtime and ordered fallback

## Goal

Continue the same Node/workspace using a second supported installed CLI and ordered fallback.

## Current status

Functional development is complete through `499cf78` (2026-10-11). OpenCode/Codex adapters, ordered selection/continuation and same-workspace reconciliation are implemented in 0bbbfec, 874647a and 4cdfbd6. Actual supported two-CLI installation acceptance remains deferred.

The task stays open for that acceptance. Local passing checks and prior evidence
are recorded in the [functional completion record](../../../docs/research/v1-functional-completion.md).

## Background and scope

Continue the same Node/workspace using a second supported installed CLI and ordered fallback.

Architecture modules remain authoritative. Functional code is implemented and pushed; the remaining gates concern actual installed host/CLI/provider/reboot acceptance deferred by the Owner.

## Dependencies and order

- [Stage A: Single-Node product loop](../09-28-stage-a-product-loop/prd.md)

These are completion/evidence gates, not automatic scheduler dependencies. Parent/child links express scope ownership only. Evidence inspection and planning may proceed earlier; implementation must resolve upstream failures first.

## Child tasks

Implementation and focused verification are recorded in the functional completion record. No new implementation task or session journal was created.

## Acceptance criteria

- [ ] Actual supported CLI installations reconstruct context from formal data.
- [ ] Fallback preserves Node/workspace identity and reconciles old writers; no shared opaque session assumption.

## Out of scope

No team abstractions, generic workflow engine, cross-Runner migration/failover, permanent disk-loss recovery, mandatory live steering or native session resume. Do not alter the accepted architecture to bypass a failed feasibility gate. This task does not own unrelated roadmap packages or bootstrap-guidelines.

## Remaining acceptance

Resume the concrete installed-environment checks when the Owner returns to native
acceptance. Preserve existing fixtures, receipts and ownership; do not repeat
unchanged broad suites or treat a deferred native check as missing feature code.

## Source contracts

- [Architecture](../../../ARCHITECTURE.md)
- [Implementation sequence and acceptance matrices](../../../docs/09-first-executable-slice.md)
- [Readiness gates](../../../docs/10-architecture-readiness.md)
- [Invariants](../../../docs/08-principles-and-non-goals.md)
- [Engineering specs](../../spec/index.md)
