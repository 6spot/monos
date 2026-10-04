# Publication candidate Web verification

2026-10-04. Assigned Web/acceptance-fixture implementation only; no commits,
provider/model/host actions, schema generation or backend/Runner product edits.
Other agents' framework, AGENTS and product changes were preserved.

## Changes

- `apps/web/src/features/publication-candidate.tsx`: local candidate beside the
  exact Git result; distinct head/tree/public parents and original/effective
  provenance; canonical current/scan applicability; operation history pages and
  direct candidate selection; preparing/offline/unsupported/missing/no-change,
  incomplete/complete and after-acceptance states. Known published exposure is a
  separate immutable blocking history, including a later clean scan with zero
  findings. It has no waiver/remediation action.
- `apps/web/src/lib/publication-api.ts`: generated-schema validation, exact
  task/source/candidate/scan/digest/page binding, contextual finding identity,
  fixed sensitive-path redaction, authenticated no-store reads and AbortSignal
  fences. `publication-api.test.ts` covers the boundary and receipt contract.
- `task-api.ts` / `use-task-command.ts`: all four local commands use the existing
  session-bound pending journal and authoritative receipt recovery. Retry may
  return a new operation. Each override step requires its actual receipt fields.
- `task-overview.tsx` / `task-ui.css`: neutral composition, bounded findings list,
  literal React text and wrapping IDs/paths, 44px mobile finding/history targets.
- `apps/web/test/publication.e2e.ts`: built-SPA interaction and screenshot driver.
- `apps/server/test/fixtures/{execution-ui-fixture,web-server}.ts`: isolated,
  authenticated test-only publication peer. Each scenario has its own Runner;
  no production seed endpoint/fixture flag was added. Capability negotiation,
  actual Delivery admission, immutable paged settlement, reads, retries and
  Owner override commands use the real PostgreSQL/server/WSS implementation.
  Candidate OIDs, retained completion data and scanner findings are explicitly
  synthetic. The peer never executes Start/effect/provider/model work.

The exact override review stores only selected IDs and immutable
head/tree/parents/scan/configuration/effective-basis bindings in the existing
scoped session journal. Preparation, confirmation and application require
separate explicit clicks. Reload or lost responses recover the original request;
fresh applicability changes disable the retained review rather than refreshing
its authority. Hard size/workflow/published-credential findings stay disabled.
An eligible policy receipt does not clear known public exposure or erase findings.

## Gates

Commands ran from the repository root except Playwright, which ran in `apps/web`.
The isolated URL was loaded privately from the root referenced by
`/tmp/monos-local-review-pg-path` into `MONOS_TEST_WEB_DATABASE_URL`; no URL/session
credential was printed or stored in tracked evidence.

| Command | Scope/result |
| --- | --- |
| `pnpm exec vitest run apps/web/src/lib/publication-api.test.ts apps/web/src/lib/task-api.test.ts apps/web/src/lib/task-storage.test.ts` | Initial scoped pass: 23 tests. Later required exposure guard added one test. |
| `pnpm exec vitest run apps/web/src/lib` | Final API/storage boundary: 9 files, **50 passed**, 308ms. Relevant library/schema inputs unchanged afterwards. |
| `pnpm --filter @monos/web typecheck` | PASS after final owned source edits. |
| `pnpm exec tsc --noEmit` | PASS, including owned server fixtures; later edits changed only Web labels and browser screenshot/session driver. |
| `pnpm exec eslint apps/web apps/server/test/fixtures/execution-ui-fixture.ts apps/server/test/fixtures/web-server.ts --max-warnings 0` | PASS after final owned source edits. |
| `pnpm --filter @monos/web build` | PASS after final edits; 2213 modules, 165ms. Existing >500kB bundle notice retained. |
| `pnpm exec playwright test publication.e2e.ts execution.e2e.ts results.e2e.ts` | **34 passed**, 1.5m: 4 publication + 24 execution + 6 exact-result regressions. [Final log](evidence/frontend-browser-final-v3.log). |
| `git diff --check -- apps/web apps/server/test/fixtures/execution-ui-fixture.ts apps/server/test/fixtures/web-server.ts` | PASS. |

Full root/backend/Go/shared-generation gates belong to main/backend/Runner
owners. No additional host/native/provider claim is made by these browser tests.
The final combined run was already started when main instructed reuse of the
unchanged 30 prior browser results; it was allowed to finish normally. No further
optional repeats were run.

## Actual browser assertions

1. 70 contextual redacted findings are retrieved as 64+6. Credential filename
   and content canary is absent from the inspected UI, publication responses,
   console and session journal. Hard provider, unknown workflow and published
   exposure are disabled. Keyboard selection works. Findings retain literal
   angle-bracket filename text and a long safe path.
2. Prepare commits but its response is replaced by an incompatible response.
   Reload retains the exact draft/pending request; receipt recovery, confirmation
   and final application produce exactly three actual POST commands, without a
   duplicate prepare. Selected IDs stay identical. Task control version, state,
   Specification and Plan do not change. No Accept/Prepare PR control appears.
3. 33 actual terminal-incomplete Retry commands produce 34 distinct operation /
   scan runs over **one unchanged candidate**. History paging reaches all 34;
   direct candidate read selects its latest scan. A further clean scan has zero
   findings but retains a positive known-public-exposure guard. Selecting an
   earlier operation preserves its immutable historical scan.
4. Preparing, offline, unsupported, retained-unavailable and no-change remain
   truthful; exact result inspection remains available. A Runner reconnect can
   complete a genuinely empty current scan with no known exposure.
5. Ordinary authenticated Owner Specification editing makes the open candidate
   historical and disables its prepared override without replacing its bytes.
   A held findings page cannot resurrect the old private view/draft after logout
   and another tab replaces the authenticated session.
6. Existing execution and result suites cover cookie replacement after command
   preflight, uncertain-receipt replay, two-client races, scoped drafts, pagination,
   actual result-read cancellation, literal content, cached-file applicability,
   deletion/binary/oversized/empty results and mobile navigation/overflow.

Direct selection of a distinct older candidate is covered by the focused API
boundary test. Browser history stress uses real Retry over one candidate; it
does not fabricate 33 distinct source lifecycles. Physical Git construction and
scanner behavior are proved separately by the Runner owner.

## Final build and screenshots

Last owned source edit: **2026-10-04T01:18:42.928937Z**, before the final build.
Final test module collection: **2026-10-04T01:19:58.418Z**. The candidate is dirty;
Git HEAD is supplemental and does not identify the tested bundle.

- Recorded source inventory SHA256:
  `59f989f0c0558d819ad490e35f06290ecd6fda2dd3d7bbd1cd408abc676c31f2`.
- Actual CSS/JS asset inventory SHA256:
  `8c01cd86ca33e61a57fdeb6af555953f69bee02b9b21f380c2c3e6d149fe8898`.
- `index-DW7YYRBm.js`: `b90300a014b63b083aba6f8e95ea87d04401fa0f8a812ef9b7c00f74e0f22ab7`
  (809.67kB, 211.44kB gzip); CSS 47.50kB / 9.46kB gzip.
- Frozen schema:
  `a0068f53fe67643a367e82726ac9b4257ce4d9203416a408e9029cbbbbe84e75`.
- [Final inventory](evidence/frontend-final-manifest-v1.json) binds all actual
  source/fixture/schema/server/migration/dependency inputs, assets, index.html,
  PNG and route/state metadata. Every recorded source/asset hash was compared
  against disk after the run and still matched. [Owned source hashes](evidence/frontend-owned-source-v1.json).

Final images:
`screenshots/59f989f0c055-8c01cd86ca33-20261004011958418/`.
**48 PNGs**: 12 states × desktop1440×1000/mobile390×844 × viewport/full-page;
12 companion JSONs retain state, route, source/asset hashes and viewport/scroll.
All **24 viewport images were actually opened and inspected**; full-page
companions are retained without claiming separate inspection of every companion.

States inspected: paged findings, exact prepared review, recorded receipt,
incomplete, clean-with-known-exposure, preparing, offline, complete empty without
known exposure, unsupported, missing retained source, no-change, historical.
The clean-with-known-exposure viewport now shows the current scan and guard;
the already verified 35-row history is collapsed before capture.

Reference comparison uses `.trellis/spec/frontend/visual-design.md`, based on
Multica `44ea3b40c8b4f54f4c76d1dd3e3c92e0c0cabd19`. Inspection confirms neutral
shell, flat separators, compact type, aligned controls, clear disabled reasons,
mobile wrapping and contained finding scroll. Task result/candidate provenance
and exact policy receipts are intentional monos content; no Multica team/org
abstractions or green navigation were introduced. Desktop uses the existing
256px navigation; mobile retains its accessible menu and 44px actions.

## Preserved intermediate evidence and cleanup

- First publication-only run: 4/4 PASS, 46s. Its two source-digest folders share
  the earlier asset digest `a66da75eec44…`; the screenshot driver was extended
  while the original test module was already running. These are **intermediate**,
  not final-source evidence.
- Next combined run: 33/34 PASS. The added session test incorrectly expected a
  same-page login to navigate to Todos despite the retained Task URL. Corrected
  to authenticate a second `#todos` tab and test replacement of the old cookie.
  This was an observer expectation failure; the final actual replacement test
  passes. Private failure trace retained at
  `/tmp/monos-publication-browser-session-failure-v1/trace.zip`, SHA256
  `efe76dac398b98420800bd9858cdcf6f057fafd87fc38384cd89410ef2b9a64a`;
  error-context SHA256
  `38fd511bff4656ab212becc29b9f3f9ff85a703d2e71ba462a68e8601e8b6af4`.
  Credentials are not copied from that trace into the task.
- Initial API work encountered the backend's then-unfinished AJV strict-required
  schema conditionals and an overly broad fixture rule string. Backend generation
  and the exact fixture enum corrected those inputs before the recorded passes.
- The existing result screenshot script names its original task. Only the two
  **newly generated regression folders** from this leaf were relocated under
  `screenshots/regression-runs/`; accepted/archive evidence was untouched.
  [Relocation record](evidence/relocation-v1.json) retains exact old→new paths and
  all byte hashes. Original immutable JSONs were not rewritten.
- [Initial isolated-PG schema inventory](evidence/frontend-browser-schema-baseline.json)
  copies main's retained root baseline (`[]`); the independently queried final
  matching `web_test_` prefix is also empty at 01:23:16Z:
  [cleanup observation](evidence/frontend-browser-cleanup-v3.json).
  The source creates one random namespace and its verified graceful shutdown
  drops **that same exact variable**, then closes both pools. Individual UUIDs
  were not observed/logged and are not invented here. Other backend schemas were
  neither dropped nor treated as ours. Port18555 has no remaining listener.

Ready for main's independent source/selected-PNG review and integrated gates.
