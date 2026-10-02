# Existing-screen migration verification

## Result and boundary

Web implementation and functional/visual gates PASS; independent final ACCEPT is
recorded in [ui-review.md](research/ui-review.md). Product changes are presentation
only: owned forms/Checkbox, neutral CSS, Login/Settings and Todo/Discussion/preview.
State hooks, Tool Protocol and backend are unchanged. No production deployment.

Predecessor Execution UI is accepted in `d28fd8b`; its final added browser test
needed narrowing correction `333c9e3`, transparently recorded in archived errata.
This task does not retroactively claim the uncorrected test passed TypeScript.

## Quality gates

- Root full lint and full TypeScript PASS. Final Todo test-only changes also passed
  affected ESLint and Web TypeScript. Independent full Web source/test lint and
  Web TypeScript PASS.
- Default suite: **290 PASS /334 database tests skipped** (19 passed files/31 skipped).
  Browser regression below uses real isolated PostgreSQL schemas.
- Protocol drift check PASS; production build PASS; `git diff --check` PASS.
- Build: `index-DVkmoQ-z.js`753.01kB /200.06kB gzip;
  `index-CIqFVtS4.css`44.99kB /9.03kB gzip. Standard large-chunk advisory retained.
- Full50-case invocation: **41 PASS,3 FAIL,6 not run** at max-failures3 (14.5min).
  Three test defects were corrected without changing product source or assertions:
  held-login route teardown raced `route.continue`; later-input submission raced
  exact requirements confirmation; added Todo screenshot step selected nonexistent
  `active` instead of actual `all`.
- Focused command `test:e2e configuration.e2e.ts:23 execution.e2e.ts:362 todos.e2e.ts`:
  **9/9 PASS** (1.2min), covering all three corrections and six previously unrun cases.
  Thus all **50 distinct cases** have passing results on the same product build;
  this is not a claim of one uninterrupted50-case green run.
- Image inspection found the empty Archived scope screenshot still displayed
  loading. Awaited `No archived Todos.` before capture and reran `todos.e2e.ts:39`:
  **1/1 PASS** (8.4s). Original loading image is retained with its honest label.
- Final schema query: **remaining_browser_schemas=0**. Playwright SIGTERM shutdown
  dropped each fixture's own schema. No prefix-wide deletion or new permanent service.

Full failed run/trace originals remain locally at
`/tmp/monos-migration-full-run-20261002`; first focused output at
`/tmp/monos-migration-focused-run-20261002`. Durable selected visual evidence is in
this task, independent of ignored/temporary Playwright results.

## Functional and visual evidence

Added assertions cover Checkbox Space, label-click and native disabled-fieldset
locking, associated Login error, long Todo/preview, mobile back/draft continuity,
and source Todo→same Task REVIEW handoff. Existing tests cover passive capture,
scoped draft/recovery, immutable receipt replay, conflicts, session cleanup,
exact Spec/Replan decisions, pagination, diagnostics and workspace/Git separation.

[Visual inspection](research/visual-verification.md) records the reference, state
matrix and intentional differences. [Manifest](research/screenshots/manifest.json)
retains **41 states /164 PNGs**, desktop1440×1000/mobile390×844 plus full-page pairs,
55 Web source/dependency file hashes and both built asset hashes. Root inspected
every retained full-page pair, with representative independent reviewer inspection;
viewport companion images are retained for fixed-size reproduction. Sources digest:
`43a1f4f2b5a4dfb98c755751271ba886aa0c75d657424f51f4c579c2cc4e1f27`.

Capture metadata is exact where the helper persisted it; the earlier full run's
attachment body was not retained, so those manifest entries explicitly use source-
backed route patterns and fixture names. The tests serve the actual built SPA from
Fastify/PostgreSQL, with synthetic Runtime/effect/provider observations.

Exact preview→created Task is one real browser path; source Todo→same REVIEW Task
is another canonical fixture path. Their coherence establishes this presentation
gate. **It does not claim native Runtime execution or remote delivery**. The next
execution integration leaf owns a fresh final installed native chain.

## Specs and handoff

Updated frontend component/structure/visual/quality guides and Web README to match
owned controls, shared interiors and accepted Board/Task behavior. Captured native
fieldset semantics, command-result waiting and route teardown ordering. Preserve
mounted controllers, refs, exact command bases, transient secret clearing and
visible recovery. No protocol/schema change or additional dependency was needed.

After independent ACCEPT: commit this task, archive/journal, then continue
`09-30-a-task-execution-acceptance` using its existing evidence/next-trial research.
