# Execution UI verification

## Scope and conclusion

Implementation and functional/visual gates are complete. Independent final verdict:
**ACCEPT**, with no unresolved findings. Final independent review
is recorded in [ui-design-review.md](research/ui-design-review.md). This evidence
accepts Board/full Task, shared shell/primitives, exact recovery and narrow reads.
Existing-screen interiors and native integration remain the next two leaves.
Predecessor Replan `087ac6d` was already accepted and was not rerun. No permanent
service, production deployment or real provider delivery was performed here.

## Final checks

| Gate | Result |
| --- | --- |
| Full lint and TypeScript | PASS after app Task-identity refresh; late-added joint test needed the subsequent narrowing correction below |
| Full default unit/schema suite | 290 PASS;334 database tests SKIPPED without DB opt-in |
| Protocol generation drift | PASS |
| Native server module import | PASS |
| Production build | PASS; final JS `index-D7bq4c-w.js`, CSS `index-B0ijfbLx.css` |
| Go full tests/generated consumers | PASS (implementer evidence) |
| Real PostgreSQL UI read suite | 8/8 PASS |
| Real PostgreSQL Owner/Node regression | 36/36 PASS |
| Correction settlement diagnostic cases | 3 PASS, including already-finalized and Cancel |
| Full actual-build browser suite | 46/46 PASS,13.1m;23 existing +23 Execution UI |
| Final-build focused browser | 4/4 PASS,2.3m; three Task-switch cases plus new all-stage joint recovery |
| Temporary browser-schema cleanup | 0 before runs,0 after full suite,0 after focused suite |
| Diff whitespace and curated contexts | PASS;34 real paths per context manifest |

The final browser inventory contains47 tests. The46-case full run used
`index-6eFJJQ-h.js`; the final production change only adds Task identity to an
existing configuration-refresh dependency. The focused final run verifies affected
Task switches and replaces their screenshots; the added47th test verifies lost
responses for all three joint approval/publication stages. Successful unrelated
checks were not repeated without another change. Vite reports the standard >500kB
chunk advisory: final JS745.94kB /197.35kB gzip; no bundle-size claim is made.

## Interaction and attribution evidence

- Board real32+2 keyset pages, filters/history, ready/queued/review mappings and
  legacy rows; canonical queued work is not an attention failure.
- Scoped drafts, navigation/reload, committed loss, unknown exact replay, malformed
  receipts, quota-safe retry, late logout callbacks, cookie replacement and two-client
  Start/version conflict. Private Task envelopes remain bound to the session UUID.
- Initial Stop/issue Retry; Node Stop/Continue/Retry/Cancel and completion recovery;
  input/guidance Retry/Withdraw/Stop; direct edit with retained basis; exact existing
  requirement confirmation/application; Replan Retry, independent dismissal and
  requirement withdrawal; joint exact approvals/publication; explicit input deferral.
- New final regression loses committed responses for `confirm_specification`,
  `confirm_replan` and `publish_replan` in one joint scenario. Each reload recovers
  its original receipt without another POST. Both confirmation IDs are retained;
  no Plan/Specification publication occurs before the explicit publish action;
  one published request and the same final Plan persist through another reload.
- Message/input65-item pagination, Planner execution history, formal Timeline cursor
  reset, ordered raw logs64+6 and diagnostic separation. Terminal questions keep
  the cancelled Task terminal and do not create or restart work.
- Real DB readers verify immutable successful completion evidence, current versus
  historical applicability and carried revision attribution, bounded diagnostics
  and exact completion-child metadata; running workspace and finalized Git UI
  display distinct evidence. Repo-free REVIEW has no fabricated Git result.

## Visual evidence

Root inspected15 state pairs at1440×1000 and390×844, plus full-page variants.
[Visual report](research/visual-verification.md) records routes, fixtures, reference
comparison, intentional layout differences and limitations. All60 PNGs are retained
with SHA256/dimensions/build labels in [manifest](research/screenshots/manifest.json).
Forty-four images belong to the full-suite build and16 to the final refresh build.
Final asset and Web source hashes are included. Mobile overflow assertions, menu
Escape/focus return and full important text/action reachability passed.

The reference is the locally inspected Multica workspace at recorded revision
`44ea3b40c8b4f54f4c76d1dd3e3c92e0c0cabd19`, translated through the repo's
neutral visual contract without teams/organization or new lifecycle semantics.
Task content's readable1100px maximum and mobile stacked Board are intentional.
Existing Todo/settings functionality passed the shared-shell regression; their
interior visual migration is not claimed here.

## Corrections and review findings resolved

- Actual Task command/receipt requests carry `X-Monos-Session`; a preliminary
  session GET alone did not close cookie replacement. Epoch/mount guards fence
  late callbacks, and each receipt must contain its command's required identity.
- Direct Owner requirement edit is explicitly Apply, with complete old/new/impact;
  editor draft and basis survive close/reopen. Joint decisions remain independent.
- Flow groups Node work and Planner activity; formal/raw history remains separate.
  Summary caps expose full history paths, and read errors offer retry.
- Workspace diagnostics use the successful completion settlement child where
  applicable, with its actual metadata operation ID and original completion pointer.
- Initial screenshots revealed a legacy950px Task width override and stale Project
  names on same-view navigation. Removed the override, refreshed configuration on
  Board/Task entry and Task switches, and recaptured loaded final-build states.
- Earlier browser rounds exposed stale labels, a dependent Cancel pressed before
  refreshed controls, and fixture cleanup leaving pending terminal inputs. Tests
  now wait for actual controls, and reset withdraws owned pending inputs before
  Cancel. The65-message history fixture seeds in5-write batches to avoid testing
  an unrelated remote lock timeout. Final complete/focused runs passed.

## Evidence boundaries and cleanup

Browser fixtures create actual capture→committed Discussion proposal→exact preview
confirmation→Task before service transitions. Runtime/effect acknowledgements are
explicitly synthetic; Git OIDs/repository examples are synthetic too. No constraint
was weakened and no fake Task-creation authority was added. Fixture reset withdraws
owned input, cancels created Tasks and settles exact synthetic workspace effects;
SIGTERM drops only that run's unique schema. No arbitrary schema cleanup occurred.
No native Runtime/model availability, remote PR, merge, delivery, Owner acceptance
or Stage A/V1 release is established by this browser evidence.

## Post-archive test-source correction

The successor's first Web TypeScript run exposed11 unchecked array-index accesses
in the final joint recovery test, which was added after the preceding TypeScript
run. Its browser4/4 and lint evidence remain valid, but the earlier wording
incorrectly implied that final test source had also passed TypeScript. Added
explicit missing-evidence guards and checked destructuring without changing any
runtime assertion. Root and independent reviewer reran Web TypeScript and targeted
ESLint successfully. No product code/build/image changed for this correction;
the successor's full browser regression will also retain this case.
