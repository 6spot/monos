# Review correction integrated verification

Date: 2026-10-07, Asia/Singapore. Affected implementation checks are complete;
independent final review is recorded in [integrated review](integrated-review.md).
This leaf does not close the installed delivery gate.

## Scope

Main integrates genuine Owner correction, immutable revocation, source-bound
semantic decisions, original effect recovery and protected Web. Standing user
delegation covers ordered development and marked synthetic verification. It does
not create product Owner acceptance of real work.

The [final source manifest](integration-inputs.json) binds 87 actual implementation,
generated contract, fixture and execution inputs. Unrelated dirty Trellis/framework
files are excluded from this task. Final migration 25 SHA-256 is
`b3bca7c345ac49f39795ca4f4e5f99abf6fecf094833ccb88c7befcd84266f18`.

## Acceptance evidence

| Criterion | Evidence and boundary |
| --- | --- |
| AC1 — Owner/SQL authority | Genuine authenticated Request Changes/replay; complete current local evidence independent of Accept; receipt-backed revocation and exact pointer guards. Real command transaction substitutions and direct SQL negatives reject forged membership/Artifact/proposal/kind, guard clearing, initial terminal inserts, foreign successors and source/pointer rewrites. Fresh migration and populated 24→25/idempotent startup preserve prior checksums and immutable Task/Spec history. |
| AC2 — effects/order | Root six PG cases observe independent actual Task-lock contention in both winners. Held merge grants produce zero stale PUT; unknown/finalized merges refuse correction. Sent/unsent pregrant push has zero write grants, immutable original reconnect/result/ACK recovery, correctly ordered successor dispatch and permanently denied old accepted link after genuine Withdrawal/fresh approval. An actually admitted original push settles before source creation. Synthetic provider/absence bytes prove database orchestration, not live provider or physical isolation. |
| AC3 — semantics | Source-bound real Agent Rework retains Task/Node lineage and invalidates evidence; genuine review/input Replan and exact prepared requirements/adoption/Owner-confirmed publication execute. Reconsideration proposals cannot publish before actual same-feedback adoption and cannot be mere drafts. Fresh exact acceptance does not inherit the revoked approval. Same-PR/public-ref preservation is asserted in root fixture; new installed/native same-lineage coding remains next gate. |
| AC4 — exits | Actual Issue/Answer Retry, missing-outcome failure Retry, running Withdrawal and generic Cancel retire source authority while keeping original Stop/process capacity. Dismiss creates an exact immutable successor. Historical Dismiss survives requirement transfer/Withdrawal and blocks repetition until an actual later recorded Owner answer. Generic input request_replan is rejected without changing input/op/Attempt/Runner; canonical resolve_review_input Replan transfer and successor resolution pass. |
| AC5 — inputs/Cancel truth | Actual replied, failed and queued pending late inputs retain complete original rows, attribution, reply and order; fresh decisions append no second reply. Original Conversation Retry/Stop/Withdraw rejects and read capabilities are suppressed. Cancel retains terminal state through original unknown merge recovery, preserves final commit and exposes original reconciliation separately; PR cleanup waits for unknown effects and retains branches. |
| AC6 — wire/Web | Strict generated protocol and affected TS/Go consumers; protected HTTP auth/Origin/no-store/nosniff and exact replay/session/logout. Four current built-SPA behaviors demonstrate actual issue/receipt/Rework, accepted revocation/input successor exits, main Dismiss/Cancel and held-response fences. Six desktop/mobile images inspected; all six exact owned schemas independently absent. API/journal inputs reuse 37 valid checks. See the [Web report](evidence/web-review-verification.md). |

## Main findings and repairs

- Fresh acceptance or ordinary preparation could remain blocked by a genuinely
  revoked pre-effect preparation. A new operation ID now requires actual original
  revocation, no possible effect/claim and current guards. Historical accepted
  operation links remain permanently fenced.
- A sent pregrant push retained a Go intent/result but server rejected its result
  after revocation, preventing ACK and all future pushes. The original no-effect
  result now has immutable read-only observation/ACK recovery. Current authenticated
  Runner reconnect can replay it. No revoked row, write grant or published proof
  is restored. A successor frame waits for the retained original result; Go still
  requires actual result, absence and ACK before its real push.
- Ordinary `cancel_task` in Node and initial-planning control now explicitly calls
  `cancelReviewOperations`; accepted-delivery Cancel already uses that path.
  Logical cancellation retains original Stop/process settlement obligations.
- A transaction-race fixture initially replaced `Pool.connect` directly and
  interfered with callback-based `Pool.query`. Its worker-only connection wrapper
  now preserves real pool methods and observes actual database lock contention.
  This fixture repair does not weaken product locking.
- Reconsidered original inputs still exposed old Conversation controls. Receipt
  recovery stays first; new old-input commands now reject and canonical old read
  actions are suppressed. Actual replied/failed/pending preservation covers it.
- Generic `request_replan` was incorrectly available to input reconsideration,
  bypassing its canonical transfer body. Backend and Runner now deny it for that
  purpose; only `resolve_review_input.routing.kind=replan` transfers the input.
  The existing full input Replan/Dismiss case and CLI purpose case prove the delta.

## Retained checks and limits

- Strict final protocol generation check passed after the paired review-origin
  RequirementProposalDetail fields. The 338 affected protocol/domain cases and Go
  source/CLI/recovery/shared-fixture consumer checks retain their earlier valid
  evidence; unchanged inputs do not require another full suite.
- `TestReviewRevokedPregrantPushRequiresOriginalACKBeforeSuccessor`: PASS on actual
  local Go/Git journals. No write before original ACK; immutable original replay;
  exactly one successor push after ACK. This does not claim native Linux isolation.
- 12:02:09: `pnpm exec vitest run` on `postgres-review-delivery-effects.test.ts`,
  `postgres-review-http.test.ts`, `postgres-owner-delivery-worker.test.ts`:
  **14 PASS** (6/1/7), 7.30 seconds, genuine isolated PG. This includes unknown and
  finalized refusal and cancelled late-finality item reconciliation assertions in
  the existing worker cases. No unaffected provider matrix was repeated.
- 12:05:00: `pnpm exec vitest run apps/server/test/postgres-review-correction.test.ts`:
  **13 PASS**, 19.80 seconds, including populated upgrade and command-transaction
  SQL negatives. The later purpose fix reran only the existing input Replan/Dismiss
  case at 12:07:05: **1 PASS**, 12 intentionally unselected, 1.62 seconds. Other
  cases do not invoke the now-denied alternative path and retain their evidence.
- `pnpm build`: PASS, compiled server plus built SPA. Only backend source changed
  afterward; `pnpm exec tsc -p tsconfig.build.json` refreshes that affected output.
  Current JS `index-mkoA3kwR.js` SHA-256 is
  `1f5275cc68455ccd9d5a70ad80f0eddbd060a6db6f1b243df4ea2191a7db18f5`;
  CSS retains `90913bdae0315da53398e57a8ae6f76c4cbaf2493692e8a6bda01a0b9a364f64`.
- Current TypeScript no-emit and Web typecheck: PASS. Root 59 executable paths
  received scoped ESLint; the later added Conversation read path and backend
  deltas received owning scoped lint. Actual native Node 26.3 imports of app/review
  coordinator and compiled app: PASS. Task contexts validate (23 entries each);
  owning spec links and `git diff --check`: PASS.
- Final Go purpose delta: `go test ./internal/local ./internal/adapter -run
  'TestTaskReview|TestReviewInput|TestReplan' -count=1`: PASS. Canonical input Replan
  stays available, generic input Replan rejects, and main-feedback authority stays
  intact. Prior source/immutable journal/Stop/shared-schema consumers retain their
  valid results. No full Linux/native/race matrix was repeated.

Earlier migration alias failures, initial integration failures and browser findings
are retained as diagnostic history. They are not counted as passing evidence.
Private database URLs and credentials enter child environments/stdin only.

## Final acceptance and delivery decision

All six criteria have current or explicitly bounded reused evidence. Main proceeds
to the scoped work commit, archive/journal and next ordered combined installed
acceptance leaf after the independent integrated READY decision.
Provider/Runtime/physical absence inputs in PG/browser fixtures are explicitly
synthetic. Prior accepted physical publication/process/provider evidence is reused
only at unchanged boundaries. No new live GitHub mutation is required for this leaf.
Production App issuance and installed new-source/native delivery remain the next
combined acceptance task; parent package and Stage A remain open.
