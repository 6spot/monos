# Installation, settings and operations

## Goal

Complete first-run bootstrap, settings, durable result access and single-host operations.

## Current status

Functional development is complete through `499cf78` (2026-10-11). First-install commands, settings/recovery UI, enrollment/rotation, resource guards and retention are implemented through 499cf78. Real Docker/systemd/account/reboot and final installed visual acceptance remain deferred.

The task stays open for that acceptance. Local passing checks and prior evidence
are recorded in the [functional completion record](../../../docs/research/v1-functional-completion.md).

## Background and scope

Complete first-run bootstrap, settings, durable result access and single-host operations.

Architecture modules remain authoritative. Functional code is implemented and pushed; the remaining gates concern actual installed host/CLI/provider/reboot acceptance deferred by the Owner.

## Dependencies and order

- [Stage B: Remaining V1 execution capabilities](../09-28-stage-b-v1-capabilities/prd.md)

These are completion/evidence gates, not automatic scheduler dependencies. Parent/child links express scope ownership only. Evidence inspection and planning may proceed earlier; implementation must resolve upstream failures first.

## Child tasks

Implementation and focused verification are recorded in the functional completion record. No new implementation task or session journal was created.

## Visual requirements

First-run and Settings UI follow the [visual contract](../../spec/frontend/visual-design.md) and shared component family. Future frontend leaf implementation/check contexts include visual, component and quality specs.

## Acceptance criteria

- [ ] First-run, Settings and operational recovery UI satisfy the [visual quality gate](../../spec/frontend/quality-guidelines.md) with inspected desktop/mobile states and accessible actions.

- [ ] Empty product state supports Owner authentication, Runner enrollment and required settings without database edits.
- [ ] Provider polling works without webhooks; managed artifacts remain accessible after cleanup; credential, tool and disk failures have actionable recovery.
- [ ] Fresh current-version initialization, persistent storage and backend/Runner/host restarts preserve the current execution's recoverable state. Historical version/data upgrades are outside pre-use scope under the [development policy](../../../docs/12-product-naming-and-upgrades.md).

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
