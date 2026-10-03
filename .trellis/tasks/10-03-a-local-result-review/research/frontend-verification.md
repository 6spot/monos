# Frontend implementation and verification

## Scope and changed files

Web ownership resumed the backend implementer's initial API/overview/inspector edits and completed them without reverting concurrent work. Changed product files: `apps/web/src/lib/api.ts`, `task-api.ts`, `features/task-overview.tsx`, new `features/result-inspector.tsx`, and `features/task-ui.css`. Tests: new `src/lib/result-api.test.ts`, new `test/results.e2e.ts`, and `apps/server/test/fixtures/{execution-ui-fixture.ts,web-server.ts}`. `styles.css` was returned to its original feature-free shape; inspector styles live in `task-ui.css`. No production backend/protocol/Runner edits, commits, host/model/provider/remote writes, or acceptance/delivery commands were performed by this worker.

The on-demand inspector binds the exact operation/digest/session/mode/path/side, validates the full echoed identity SHA256 and Owner `current` field, supports all 70 changes through the strict canonical cursor, and renders literal text in a focusable contained code region. Close/selection/session replacement cancel reads and discard private content from query memory; content is not persisted or polled. Base/deletion/empty/binary/oversized/symlink/gitlink states remain distinct. Fresh read applicability updates only the matching completion metadata; canonical `result.current` drives the label so old immutable cached content cannot keep a historical completion labelled Current. New browser regressions keep an opened file intact across both ordinary metadata polling and fresh changes-page applicability updates without another file/diff request.

## Fixture boundary

The two result scenarios own distinct synthetic Runner registrations and original formal completion descriptors. A test-only authenticated Runner WebSocket connects through the real app endpoint, enrollment token, hello/welcome incarnation, Ready capability, heartbeat and correlated broker. It serves only exact original Task/Runner/completion-scoped `result_read` frames, never Start/effect/Runtime work. Test controls hold/release/disconnect/reconnect or select explicit read outcomes. The browser uses real Owner authentication, PostgreSQL projection and GET routes. Git OIDs/content and Runtime acknowledgements remain explicitly synthetic; these tests do not establish physical Git/installed Linux/provider behavior. No product seed/bypass endpoint was added. Sizes in the final rich fixture match the available simulated file text (including the long-path file).

## Executed gates

Database URL was read privately from `/tmp/monos-local-review-pg-path` → its `database-url` into the child `MONOS_TEST_WEB_DATABASE_URL`; no URL/token/cookie was logged or retained.

| Command / scope | Result and input validity |
| --- | --- |
| `pnpm exec vitest run apps/web/src/lib` | 8 files, 44 tests passed, latest frozen schema/Web API inputs. Includes 5 exact response/path/identity/session/cancellation tests. |
| `pnpm --filter @monos/web typecheck` | Passed after final applicability fix and protocol generation. |
| `pnpm exec eslint apps/web apps/server/test/fixtures/execution-ui-fixture.ts apps/server/test/fixtures/web-server.ts --max-warnings 0` | Passed; final size-only fixture edit additionally passed scoped ESLint. |
| `pnpm protocol:check` | Passed earlier generation; final protocol checks owned by main/backend (no claim this earlier result proves their later newline fix). |
| `pnpm --filter @monos/web build` | Passed after final protocol freeze: `index-Dv0N0Khe.js` 769.80 kB (gzip 203.66), `index-CplncxAA.css` 46.32 kB (gzip 9.30). Existing >500 kB chunk notice remains. |
| `pnpm --filter @monos/web test:e2e test/results.e2e.ts test/execution.e2e.ts` | 30 passed in 46.0 s: 24 existing execution tests plus 6 new result tests on final product/schema. |
| `pnpm --filter @monos/web test:e2e test/results.e2e.ts` | 6 passed in 15.9 s after correcting only rich fixture text size; final screenshots below. Shared existing scenarios unchanged by this final fixture correction; retain 30-test combined evidence. |
| `git diff --check` | Passed after owned CSS EOF cleanup. |
| Read-only `pg_namespace` query after graceful fixture shutdown | `web_test_%` schemas=[] at 2026-10-03T08:29:20.777Z. Specifically observed combined-run schema `web_test_64e5db612532476abfa5d41658d1838c` is gone; no verification DDL/drop was run. [Cleanup evidence](screenshots/612e2e1d2fb0-709c322e2807-20261003082748662/schema-cleanup.json). |

The browser assertions cover no reads before opening; 64+6 continuation; keyboard selected-file control/code focus; HTML literal nonexecution; exact base/result/diff attribution; no page-wide overflow and actual horizontal code overflow; truthful explicit states and Retry; no Task writes during inspection; unchanged Task control/result rows; close/reopen/selection cancellation and late logout/session replacement; fresh current→historical binding with preserved operation/bytes.

Root lint/type/default tests/build, server real-PG/WSS and Go physical Git/race/vet gates are separately owned; this report does not claim those commands ran here.

## Final build/source and inspected screenshots

Final product/schema were frozen before this build. The last owned fixture-only correction preceded the final browser run starting 2026-10-03T08:27:48.662Z. No source edit followed capture; a post-run byte comparison verified every recorded source and asset hash still matches disk. The dirty candidate's Git HEAD is supplemental only.

- Source-set SHA256: `612e2e1d2fb0da9662e884ad57110884ff46df8e52a998da8b5c3305504e1441`.
- Built asset-set SHA256: `709c322e2807a6c183d948c430057636f72d95b49d72a8e19396ad1106a4bb4c`.
- Final schema SHA256: `53c4e81894eb365cac8868a68e841761cd35a18e10ea73c44e9785a495968e06`.
- [Manifest](screenshots/612e2e1d2fb0-709c322e2807-20261003082748662/manifest.json):44 PNG + 11 state JSON files; each state has 1440×1000 desktop and 390×844 mobile viewport and full-page captures, plus route, fixture state, code overflow, source-file and bundle hashes. Manifest SHA256 `c9ff09347891fdcb83787f9e08ea176ea093208fb66b3b1dfaccc0be535454b9`.

I inspected all 22 desktop/mobile viewport PNGs below plus the populated desktop/mobile full-page PNGs. Visual reference: `.trellis/spec/frontend/visual-design.md`, source-backed Multica checkout observations from 2026-09-30 at `44ea3b40c8b4f54f4c76d1dd3e3c92e0c0cabd19`. The screenshots retain neutral sidebar/page/bordered result/secondary code surfaces, compact sans-serif hierarchy, restrained headers, consistent gutters and selected/outline controls. Desktop uses an adjacent list/content pane; mobile stacks panes, wraps literal long path labels, bounds the file list and keeps 44 px controls/Retry reachable. Code preserves whitespace and scrolls inside its own focusable region. No page-wide overflow, active markup, displaced toolbar, overlaid sticky chrome or missing state label was found. Full-page capture starts at scroll 0; viewport capture deliberately scrolls to inspection and records that position.

Intentional monos differences: Task's formal Specification/current work/local immutable result/history and separate artifacts remain in the existing Task shell; no Multica team/organization navigation or publication controls are introduced. The inspector adds no composer. Agent queue/disabled command states belong to unchanged Task controls and are covered by existing execution regressions; this read-only surface has a held loading read and loading continuation instead of new Agent lifecycle states. Retry behavior is tested after releasing each unavailable/held condition; no screenshot claims loading means success.

| State | Desktop inspected | Mobile inspected |
| --- | --- | --- |
| Binary bytes withheld | [result-binary-desktop.png](screenshots/612e2e1d2fb0-709c322e2807-20261003082748662/result-binary-desktop.png) | [result-binary-mobile.png](screenshots/612e2e1d2fb0-709c322e2807-20261003082748662/result-binary-mobile.png) |
| Deleted result side absent; base available | [result-deleted-side-desktop.png](screenshots/612e2e1d2fb0-709c322e2807-20261003082748662/result-deleted-side-desktop.png) | [result-deleted-side-mobile.png](screenshots/612e2e1d2fb0-709c322e2807-20261003082748662/result-deleted-side-mobile.png) |
| Available zero-byte file | [result-empty-file-desktop.png](screenshots/612e2e1d2fb0-709c322e2807-20261003082748662/result-empty-file-desktop.png) | [result-empty-file-mobile.png](screenshots/612e2e1d2fb0-709c322e2807-20261003082748662/result-empty-file-mobile.png) |
| Fresh post-I/O applicability, exact original content | [result-historical-desktop.png](screenshots/612e2e1d2fb0-709c322e2807-20261003082748662/result-historical-desktop.png) | [result-historical-mobile.png](screenshots/612e2e1d2fb0-709c322e2807-20261003082748662/result-historical-mobile.png) |
| Held real WSS read, later released | [result-loading-desktop.png](screenshots/612e2e1d2fb0-709c322e2807-20261003082748662/result-loading-desktop.png) | [result-loading-mobile.png](screenshots/612e2e1d2fb0-709c322e2807-20261003082748662/result-loading-mobile.png) |
| Literal long path/colon/spaces | [result-long-path-desktop.png](screenshots/612e2e1d2fb0-709c322e2807-20261003082748662/result-long-path-desktop.png) | [result-long-path-mobile.png](screenshots/612e2e1d2fb0-709c322e2807-20261003082748662/result-long-path-mobile.png) |
| Available zero-change list | [result-no-changes-desktop.png](screenshots/612e2e1d2fb0-709c322e2807-20261003082748662/result-no-changes-desktop.png) | [result-no-changes-mobile.png](screenshots/612e2e1d2fb0-709c322e2807-20261003082748662/result-no-changes-mobile.png) |
| Real fixture socket disconnect and Retry | [result-offline-desktop.png](screenshots/612e2e1d2fb0-709c322e2807-20261003082748662/result-offline-desktop.png) | [result-offline-mobile.png](screenshots/612e2e1d2fb0-709c322e2807-20261003082748662/result-offline-mobile.png) |
| 65537 bytes, no partial file | [result-oversized-desktop.png](screenshots/612e2e1d2fb0-709c322e2807-20261003082748662/result-oversized-desktop.png) | [result-oversized-mobile.png](screenshots/612e2e1d2fb0-709c322e2807-20261003082748662/result-oversized-mobile.png) |
| 70 changes, literal HTML and long code | [result-populated-literal-desktop.png](screenshots/612e2e1d2fb0-709c322e2807-20261003082748662/result-populated-literal-desktop.png) | [result-populated-literal-mobile.png](screenshots/612e2e1d2fb0-709c322e2807-20261003082748662/result-populated-literal-mobile.png) |
| Storage unavailable, metadata retained | [result-unavailable-desktop.png](screenshots/612e2e1d2fb0-709c322e2807-20261003082748662/result-unavailable-desktop.png) | [result-unavailable-mobile.png](screenshots/612e2e1d2fb0-709c322e2807-20261003082748662/result-unavailable-mobile.png) |

## Intermediate failures and retained evidence

The first browser allocation had 3 passes / 1 failure because Playwright's API request did not automatically send the browser's Secure localhost cookie over HTTP for a read used by the assertion. The assertion now explicitly reuses the synthetic browser cookie privately; production auth was unchanged. Screenshot inspection also caught existing `.task-body pre/code` wrapping overriding the new code region; scoped higher-specificity whitespace rules fixed it. A transient TS narrowing error during the applicability correction was fixed by capturing the guarded boolean before the query updater, and final typecheck passed.

The reviewer subsequently found cached content.current overriding canonical/new changes applicability. The two new regressions and final render/response-order fix supersede the earlier 4-test build. The schema's final newline path guards also required a new bundle. Earlier screenshot directories remain preserved as intermediate evidence: `9b1e03870612-9c03f5f80626-20261003081158719`, `a8d6c46dc159-af7f169c1647-20261003081443024`, `7a28f434409f-af7f169c1647-20261003081714609`, `b0aba176f61c-af7f169c1647-20261003081957470`, `f1500579396b-1b581b19b0ca-20261003082506068`, and `3bd14efc4a55-709c322e2807-20261003082640735`. The last has the final product bundle but the superseded rich fixture size; none of these is the final visual acceptance set. Reversible test-results output may be replaced by Playwright across runs; durable task artifacts above are preserved.

No outstanding Web/fixture blocker remains. Native installed read inspection belongs to the later acceptance leaf; physical object correctness rests on the independently owned Go tests, not synthetic browser files.
