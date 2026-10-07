# Review correction Web implementation handoff

Active task: `10-03-a-review-correction`. Web implementer owns the files below;
protocol, database and backend integration remain with their assigned writers.
No commit or task lifecycle operation was performed.

## Implemented behavior

- `apps/web/src/features/review-correction.tsx` reads canonical correction status,
  feedback details and operation capability. Request Changes captures the actual
  independent review digest, control/Specification/Plan basis and exact accepted
  batch when present. Opening/reading/closing the dialog sends no command. Saved
  feedback remains scoped to Task/session and never silently adopts a new basis.
- Issue answers bind the actual issue and current operation capability. Retry
  retains the same operation; independent input reconsideration Retry/Withdraw
  includes its exact reconsideration identity. Withdrawal is an explicit dialog
  decision. Full feedback, independent bounded histories, source/predecessor and
  original Stop identities remain readable. No formal state is updated optimistically.
- `apps/web/src/lib/review-correction-api.ts` protects read scope, issue/source
  identity, cursor progress, independent reconsideration membership and aborted or
  replaced sessions. Generic Task read hooks also use session query keys, signals
  and a post-await epoch fence.
- `apps/web/src/lib/task-api.ts`, `task-storage.ts` and `use-task-command.ts` use
  the existing bounded journal for the new strict review command family. Success
  requires the real action-specific Task/request/feedback/operation/version fields;
  accepted correction additionally requires the exact original batch revocation.
  Unknown recovery replays only original bytes after a valid authoritative lookup.
- The local `TaskIntent.replan.review_origin` pair is accepted only for Dismiss.
  It is never transmitted or used as server authority. Its receipt must identify
  the selected feedback and predecessor and a distinct real successor. Old journal
  records without this metadata remain valid.
- Replan request/proposal and linked requirement reads check the actual selected
  request, proposal and source before enabling decisions. Dismiss explains feedback
  preservation. Overview hosts correction decisions; Conversation links those
  formal decisions and preserves the original accepted attribution of later input.
- Owner delivery treats a canonical cleared pointer as cleared, retaining revoked
  history without granting old Retry/Cancel authority. It renders the actual
  revocation settlement, original reconciliation category, PR and verified final
  commit. Terminal Task state is not inferred from remote cleanup progress.

## Writable paths

Changed existing Web paths:

- `apps/web/src/features/owner-delivery.tsx`
- `apps/web/src/features/task-conversation.tsx`
- `apps/web/src/features/task-decisions.tsx`
- `apps/web/src/features/task-overview.tsx`
- `apps/web/src/features/task-shared.tsx`
- `apps/web/src/lib/owner-delivery-api.ts`
- `apps/web/src/lib/owner-delivery-api.test.ts`
- `apps/web/src/lib/task-api.ts`
- `apps/web/src/lib/task-storage.ts`
- `apps/web/src/lib/use-task-command.ts`

Added Web paths:

- `apps/web/src/features/review-correction.tsx`
- `apps/web/src/lib/review-correction-api.ts`
- `apps/web/src/lib/review-correction-api.test.ts`
- `apps/web/test/review-correction-server.ts`
- `apps/web/test/review-correction.e2e.ts`
- `apps/web/review-correction.playwright.config.ts`

Existing accepted-batch Task Controls gating remains valid; no extra controls file
edit was needed for this leaf. Generic Cancel lifecycle is backend authority.

## Verification status

Web boundary passes on 2026-10-07. See `research/evidence/web-review-verification.md` for exact commands, current source/build hashes, retained failed observations, four valid focused browser cases, six inspected desktop/mobile images and independent absence of all 6 owned test namespaces.

Final independent review found that immutable transferred reconsiderations could hide current successor Retry/Withdraw controls. `ReconsiderationCard` now uses actual selected operation purpose/capabilities. The affected real browser case proves input-origin transfer→Dismiss→successor Issue/Answer Retry→Withdraw while retaining Transferred history. Main-feedback Dismiss/Cancel and other unaffected cases reuse the passing current-build run.

Focused owned lint, Web typecheck and build pass. The 37 affected API tests are reused because their API/journal inputs did not change. No native/provider matrix was repeated.

## Evidence boundaries

The isolated loopback fixture serves the current Vite build through `createApp`.
It migrates genuine owned PostgreSQL schemas and executes protected Owner routes
and canonical source-bound Agent commands. Source outcomes and receipts are never
inserted by test-only SQL. Test helpers advance mutable scheduling due times and
acknowledge synthetic Runtime/process absence through the real service API.
Permission/Git preparation comes from explicitly synthetic upstream fixtures.
This evidence does not claim native Runtime or live provider execution. No full
historical native/provider/browser matrix was repeated.
