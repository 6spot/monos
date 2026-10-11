# Setup and settings UI completion

The Web audit found three functional gaps: setup diagnosis existed only as an API
and local CLI, Runtime discovery could remove necessary policy controls, and the
GitHub repository picker lacked search and an explicit failed-page retry.

## Implemented boundary

Execution settings now read the authenticated `SetupReport`, scoped to the Owner
session and saved configuration version. Its current Planner and Project Role
diagnoses lead to the existing policy, Role and Project settings, or expand local
Runner enrollment and recovery instructions. Refresh and failed-read retry do not
change formal execution state. A failed refresh labels retained data as the last
successful observation. Unauthorized reads leave the private workspace through
the existing session handler.

Database and Runner storage facts retain their observation time and currentness.
Missing/expired reports remain explicit. Free space, thresholds, execution limits
and retention periods are observations; the five existing unverified capabilities
remain visible, including storage durability and host recovery. Storage attention
opens repair instructions and points back to existing Task retry controls.

Policy editors offer the currently implemented OpenCode and Codex adapters before
installation discovery. Both require an explicit model; Codex thinking is optional.
The Owner can retain/edit these values while a Runner is offline or has no report.
Observations are displayed per Runner, filtered to a hard pin when selected, and
never borrow the first matching report to decide which common fields are editable.
Unsupported saved Runtime values remain visible for correction. Backend scheduling
and setup diagnosis remain authoritative about accepted target values.

GitHub search explicitly filters names on the current page. Pagination already
existed and remains available even when the current page has no search match.
Failures offer an explicit retry of the same page. Reopening the picker, switching
Project or changing the connected installation resets its local listing context.
This is not an installation-wide search and adds no provider/API contract.

The existing capture, Discussion, Task creation/start, execution controls, review,
delivery retry/cancel, managed Artifact and result-inspection entry points were
present. This change does not duplicate those flows. Runner grant issuance and
host CLI authentication remain local administration, as already specified in the
[enrollment recipe](../../infra/runner/enrollment.md).

## Validation scope

Use scoped Web typecheck/lint/build and the existing configuration interaction
suite's focused setup, policy and picker cases, with its isolated PostgreSQL
fixture. Provider and host observations are explicit browser fixtures. Inspect
representative desktop/mobile captures of the three changed compositions against
the repository's self-contained visual contract. Native host/CLI/model/provider
acceptance and a broad application matrix remain deferred by the user.

The change adds no dependency, command, backend endpoint or formal lifecycle state.

## Verification results

- `pnpm --filter @monos/web typecheck`: passed with the generated storage report
  contract.
- Scoped `pnpm exec eslint` over the changed TypeScript/TSX files, including the
  configuration interaction tests, with `--max-warnings 0`: passed.
- `pnpm --filter @monos/web build`: passed. The existing bundle-size advisory
  remains; no new dependency was added.
- `pnpm --filter @monos/web test:e2e test/configuration.e2e.ts --grep
  'real login|setup status retries|policy editing supports|GitHub picker retries'`:
  four passed in 10.4 seconds. The fixture used a fresh isolated PostgreSQL schema
  and shut down normally. These cases cover actual settings persistence, required
  model input, no-report Codex editing, selected-Runner observation isolation,
  failed setup/page retries, stale storage labeling, recovery focus, and explicit
  current-page search across pagination.
- `git diff --check -- apps/web docs/research/setup-settings-ui.md`: passed.

Inspected the `setup-recovery`, `policy-observations`, and `github-page-search`
desktop/mobile captures under `apps/web/test-results/`, including their full-page
companions. Route metadata records the built assets `index-BXKVPEcS.js` and
`index-BcYgj7Oe.css`; viewports were 1440×1000 and 390×844. Shared neutral surfaces,
16px gutters, compact headings and owned controls follow the self-contained
[visual contract](../../.trellis/spec/frontend/visual-design.md). Long commands,
Runner IDs and hints wrap on mobile, navigation stays reachable, and the browser
assertions found no page overflow. The settings-specific diagnostics and inline
recovery instructions intentionally use the existing flat Settings composition.
No Multica checkout was accessed. Native acceptance and the full application
regression matrix were not run.

## Completed Task retention follow-up

Execution settings now use the existing configuration command/receipt flow for
`save_retention`, defaulting to enabled with seven days when the optional snapshot
field is absent. The editor preserves its draft basis and reload behavior, and
disabling cleanup retains the selected interval. Already queued/running cleanup
continues with its original settings. The UI describes disposable worktree and
dependency cleanup while preserving formal Artifacts, results and history;
cancelled Tasks retain their private work.

Setup cleanup counts distinguish pending, completed and attention. The bounded
attention list shows the actual reason, Task and Runner with a link to the existing
Task execution view. Missing independent result evidence or an oversized request
is displayed as retained private work, never as successful cleanup.

The additional focused persistence interaction passed (`--grep 'completed Task
cleanup settings persist'`, one case in 2.5 seconds), exercising disable/save/
reload and re-enable/reload with a 14-day interval. After the attention-list UI and
current generated contracts, Web typecheck and build passed again; the current
bundle is `index-DbhekMtE.js` with `index-BcYgj7Oe.css`. No additional browser matrix
was run for the reason labels. The earlier screenshots were inspected in-session;
the subsequent focused test cleaned Playwright's standard output directory, so
those images are not retained final-build visual-acceptance artifacts. Native and
integrated visual acceptance remain deferred.
