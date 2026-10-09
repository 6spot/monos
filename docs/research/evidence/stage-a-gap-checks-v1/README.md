# Stage A focused gap checks

Completed 2026-10-10 (Asia/Singapore), from work commit `ae7bbd7` with the
test-only changes bound by [verification.json](verification.json).
No product source, deployed service, model policy or remote repository changed.

## Results

| Case | New retained assertion | Evidence boundary |
| --- | --- | --- |
| A25 | A progress-only reply preserves the started Node, source, Attempt, Start, control version, Spec/Plan and mutation authority. Its recorded observation matches the source; the original credential subsequently completes the same Node. | Real PostgreSQL; normalized fake Runner events and trusted settlement. No native process-liveness claim. |
| C02 | An independently killed backend process leaves either no committed proposal reply or one exact committed reply. Before COMMIT, the retained draft is unconfirmable; same-input Owner Retry after Stop/settlement creates a fresh source and exactly one eligible proposal. After COMMIT, exact receipt replay and Retry rejection prevent duplicates. | Actual SIGKILL and PostgreSQL rollback/COMMIT. Runner absence is a trusted fixture. |
| C03 | A settling change retains its writer and publication slot while a progress reply commits with exact observation provenance. A separate connection holds the slot row lock and another demonstrably waits on it throughout the reply. Original Stop settlement then permits exactly one publication. | Real PostgreSQL connections and observed lock contention; no native writer/model. |
| E01 | Two child fake Runners use different real roots over authenticated WebSockets. Logical Auto, ambiguity rejection, explicit placement, Task locality, foreign authorization denial and a revoked held Start are checked against canonical records and root-local markers. | Actual child processes, filesystem roots, backend transport and admission. Not Go daemon execution, permission isolation or cross-host transfer. |

The existing conversation test's fabricated accepted-delivery pointer failed the
current database constraint. It now prepares, confirms and accepts a completed
repository-free result through `OwnerDeliveryCommands` before checking reply-only
conversation. This repairs the fixture without bypassing the constraint.

The first C02 run passed 12 of 13 tests: the before-COMMIT recovery path omitted
the Runtime report for the new Runner incarnation. The fixture now reports its
existing Runtime after reconnecting. Final scoped checks passed on the resulting
files; no production defect was found or changed.

## Verification

Environment: Node 26.3.0, pnpm 12.6.0, PostgreSQL 17.11 (Homebrew), isolated local
temporary cluster. Each database fixture creates and drops its own schema.

With `MONOS_TEST_DATABASE=1` and the isolated `DATABASE_URL`:

- `pnpm exec vitest run apps/server/test/postgres-task-conversation.test.ts`:
  **18/18 passed**, after replacing the obsolete acceptance fixture.
- `pnpm exec vitest run apps/server/test/postgres-task-conversation-process.test.ts apps/server/test/postgres-task-specification-inputs.test.ts`:
  **13/13 passed**, after correcting the reconnect report.
- `pnpm exec vitest run apps/server/test/postgres-runner-roots.test.ts`:
  **1/1 passed**, reused from the implementer on unchanged inputs.
- ESLint passed for all five added/changed TypeScript files.
- `pnpm exec tsc --noEmit` passed for the integrated TypeScript inputs.
- The new Runner-root suite is included in the existing `test:db` entrypoint.

Total: **32 passing scoped cases**, including five added cases. Independent
read-only review covered A25, the acceptance-fixture repair and E01. The main
session reviewed and ran C02/C03 after the worker handoff. Unchanged product,
native and browser evidence is reused at its original revision; no full matrix,
model call, deployment, native process trial or browser run was repeated.

## Remaining acceptance

The [Stage A matrix](../../stage-a-acceptance.md) still leaves **A06** (closing
and reopening a browser during live Node execution) and **A30** (terminal
implementation request, semantic explanation, then an independent Task via Todo)
partial. The fixed OpenCode auto profile's A33 limitation is unchanged. These
checks do not declare Stage A or V1 complete or alter Trellis task lifecycle.
