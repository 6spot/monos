# Existing-screen migration independent review

## Scope and checkpoint

Reviewed the task PRD/design/implementation notes, frontend contracts, all changed
product paths and added browser assertions. This review covers Login, shared form
controls, settings, Todo/Discussion/preview and shared CSS effects on Board/Task.
It does not extend the predecessor's acceptance to native execution or delivery.

**ACCEPT for this presentation migration.** Source review, independent mechanical
checks, complete browser coverage across the recorded runs, inspected visual
evidence and source/build/image identity checks support the scoped requirements.
No confirmed product defect or unresolved review finding remains. This does not
accept the next task's native execution or delivery scope.

## Findings (fixed)

No migration product fixes were necessary in this review. Root fixed a test-only
Login interception race: wait for the authenticated Projects heading before
removing the route whose pending request was released. This preserves the busy
state assertion and avoids a request being handled twice. Root also added explicit
checkbox label-click coverage alongside keyboard Space and uncertain-save locking.

Root also made the later-input requirement test wait for the visible exact
confirmation receipt before submitting another command. The original test raced
two versioned operations. The added assertion establishes the intended scenario;
explicit deferral, enabled exact apply, canonical Specification change and retained
later input assertions remain intact. No product behavior or assertion was removed.

Root corrected the newly added Todo scope test from the nonexistent option `active`
to the existing `all` value. Its empty-scope screenshot now waits for the observable
`No archived Todos.` state. The prior loading image is honestly retained as
`todos-archived-loading`, and a focused passing rerun supplies the actual empty
state. Passive-capture, exact text, no-Planner and mobile focus/draft assertions
remain intact. These are test/evidence corrections; product/build stayed unchanged.

The predecessor's independent test-type correction is recorded in its archived
review and isolated commit `333c9e3`; it is not a migration product change.

## Findings (not fixed)

None. Reviewed root's frontend spec/README synchronization: it describes installed
primitives, neutral source composition and Task-scoped recovery without claiming
native or delivery acceptance. No architectural, interface or out-of-scope product
change was needed.

## Source findings

- `app.tsx` keeps the authenticated views mounted with `hidden`. Configuration,
  Todo, Discussion and Task command-controller lifetimes are unchanged. Login keeps
  the same password clearing, busy lifecycle and session refresh; its error is now
  associated with the password field.
- `forms.tsx` retains stable IDs, constraints, change callbacks and native field
  behavior while using owned Input/Textarea/Label/NativeSelect. CheckField uses a
  labelled native-button Base UI Checkbox, forwards disabled state, and preserves
  boolean updates. No form framework or second primitive library was introduced.
- Projects/Roles preserve record drafts and immutable version basis; global and
  Planner policies preserve separate optional values and forms. GitHub preserves
  transient private-key input, blank-key keep-current semantics, successful-save
  clearing and committed receipt recovery.
- Capture/composer refs, IDs and handlers remain intact. Todo mobile back behavior,
  exact Original Capture, per-Todo drafts, passive navigation and always-mounted
  Discussion behavior are unchanged. Preview exact content/eligibility/recovery
  semantics are unchanged; created PLANNING now uses a neutral status treatment.
- Shared CSS retains one semantic token authority, `[hidden]` precedence, neutral
  navigation, compact headers, visible focus and responsive navigation. Settings
  and Todo use flat separators with bounded resources/policies/proposals. Important
  text wraps; long editable fields retain their native scroll behavior. Reduced
  motion removes transitions. Task/Board feature styles and hooks were not changed.
- Added tests inspect real persisted interaction and exact command recovery where
  applicable. Provider, Runner and local execution projections remain explicitly
  synthetic. The new visual helper records SPA asset paths and captures both
  viewport and full-page images at desktop1440×1000/mobile390×844.

## Verification

- Independent Web TypeScript (`pnpm --filter @monos/web typecheck`): PASS, including
  current `migration.e2e.ts` and `visual.ts`.
- Independent full Web source/test ESLint with `--max-warnings 0`: PASS.
- Repeated both independent checks after the final Login route teardown, checkbox
  label toggle and later-input exact-confirmation test changes: PASS.
- Repeated full Web source/test ESLint and Web TypeScript after the final Todo
  scope/loaded-empty assertions: PASS.
- Root full lint/type, unit/schema (290 PASS /334 database SKIPPED), protocol drift
  and production build: PASS. Skipped database cases are not claimed as passing.
- Browser: initial 50-case run had 41 PASS /3 test-only failures /6 not run;
  corrected configuration + later-input case + all Todo tests then passed9/9.
  All50 unique cases are covered; this is not described as a single green full run.
  Loaded-empty image correction then passed its additional focused1/1 rerun.
- Root's final isolated-schema cleanup query: `remaining_browser_schemas=0`.
- Final repository `git diff --check`: PASS; finalized verification/visual notes
  match the observed counts, corrections, metadata limits and scoped acceptance.
- Build: JS `index-DVkmoQ-z.js`, CSS `index-CIqFVtS4.css`. Independently checked
  [manifest.json](screenshots/manifest.json): all 2 assets, 55 source files and 164 PNG
  SHA-256 hashes match; all 164 PNG dimensions match, with no missing file.
- Manifest contains 41 states with desktop1440×1000/mobile390×844 viewport/full-page
  variants. It identifies the supplying run, exact route metadata when retained,
  and test/source route-pattern evidence when older helper metadata was not retained.
  No unavailable exact route was invented.

## Independent image inspection

Opened actual PNGs from the current run for Login empty desktop, settings uncertain
mobile full-page, Discussion queued desktop/mobile full-page, and Task local REVIEW
mobile full-page. These show neutral shared surfaces, labelled controls, readable
status/recovery copy and reachable actions. Original Capture remains distinct from
Discussion; the local result explicitly avoids claiming PR/delivery/Owner acceptance.
No clipping or unusable action was seen in this sample. Root inspected the full-page
desktop/mobile pairs for all41 retained states. The retained inventory and
[visual verification](visual-verification.md) record reference comparison and
intentional monos differences; viewport companions supplement those full-page views.

Additional independent PNG inspection covered the complete long-preview mobile
page, source Todo with created REVIEW Task mobile, integrated local REVIEW desktop,
and populated Runner/policy mobile. The full repeated Specification is visible,
followed by the Project-required explanation, disabled Create, Cancel, Continue
discussing and the retained composer draft. The created association reports REVIEW
and links to the same Task. Runner installation and local result labels retain
their explicit limits; policy fields/buttons remain contained and reachable.

The configuration follow-up also supplied inspected Projects populated
desktop and GitHub configured mobile full-page images. Repository identities remain
visibly read-only, form groups align, and GitHub shows the blank private-key field,
keep-current help, public fingerprint and explicit repository-access action/result.
The long Todo mobile full-page image preserves the complete Original Capture,
wraps the title and keeps its independently scrollable draft plus send/back actions.

Finally opened the retained `todos-empty-scope-mobile-full.png` and separately
labelled `todos-archived-loading-mobile-full.png`: they show their stated completed
empty and loading states respectively. Together with the source review, passing
interaction coverage and complete identity check, the inspected images support the
neutral shared composition and Todo→preview→Task→local REVIEW presentation gate.
