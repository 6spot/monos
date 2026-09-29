# Todo capture verification

Completed 2026-09-30 (Asia/Singapore). Capture and organization use formal Owner
commands; they never create Discussion input, Task, Attempt or Start outbox work.

## Evidence

- Full local gate: protocol generation check, lint, typecheck, build and 109 unit
  tests passed. Generated Go wire changes passed Linux race tests and vet.
- Real same-host Docker PostgreSQL suite: 108 tests passed across 13 files,
  including all 12 Todo tests. Coverage includes atomic rollback, immutable
  capture/receipts, concurrent replay, stale versions, Project archive races,
  bounded scoped pagination and authenticated routes.
- Final browser suite after focus correction: 12/12 passed in 32.9 seconds
  (settings and Todo workflows, real server and isolated PostgreSQL). Web build,
  lint, typecheck and Todo API tests passed after this correction. Desktop/mobile
  views were visually inspected. Browser assertions cover uncertain response
  recovery, retained drafts, navigation and focus after assignment/archive/restore.
- Final independent review found and fixed keyboard focus falling to the body
  after selected detail disappears. No remaining concrete findings.
- Existing test deployment updated without starting another standing service.
  [Deployment evidence](research/deployment.json) verifies migration, HTTPS health,
  authenticated Inbox reads, final built asset and reconnected Runner; zero queued
  or physically reserved Attempts and zero unresolved operations. Private host
  evidence is `/root/monos-todo-capture-evidence-v1/capture-deployment.json`.

## Test interruptions and limits

A transient SSH outage interrupted a focused DB rerun and left one isolated test
schema. Its migration checksum and synthetic contents were verified before that
schema alone was removed; [cleanup evidence](research/db-cleanup.json) records it.
The later full suite over the SSH tunnel had 104 passes and four existing-test
timeouts. The same-host rerun passed all 108 without increasing product/test
timeouts. Capture needs no model call; live Discussion belongs to the next task.

Drafts and uncertain immutable command identities are memory-only, as documented
in `apps/web/README.md`; reload persistence is not claimed. Migrations are additive
and old receipt snapshots remain unchanged after later organization edits.
