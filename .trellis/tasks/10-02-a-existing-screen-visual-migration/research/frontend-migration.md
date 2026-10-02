# Research: Existing-screen visual migration

- Query: Identify exact legacy Login/Settings/Todo/Discussion/preview presentation and the smallest primitive/composition migration preserving state, commands and lifecycle.
- Scope: internal source/spec/test inspection; no product edits, tests, services or deployment
- Date: 2026-10-02
- Task: `.trellis/tasks/10-02-a-existing-screen-visual-migration`

## Findings

### Scope and existing shared baseline

The preceding Execution UI leaf already owns neutral tokens, 256px shell, mobile navigation Dialog/Sheet, compact `PageHeader`, shared Button/Input/Textarea/Label/NativeSelect and full Task/Board. This migration should reuse them and replace the remaining legacy interiors, not rebuild the shell or Task lifecycle. Earlier research/handoff is historical: its statements that Button is the only installed primitive and Task is read-only are now superseded by current source.

Read sources: `ARCHITECTURE.md`; `docs/08-principles-and-non-goals.md`; `docs/07-owner-review-and-ui.md:47–235`; task PRD; frontend index, visual-design, component, directory, hook, state, quality specs; `.trellis/tasks/archive/2026-09/09-30-frontend-visual-standards/migration-handoff.md`; `.trellis/tasks/archive/2026-10/09-30-a-execution-ui/research/frontend-seams.md`. Prior handoff scope is satisfied jointly by the two leaves, not by rewriting its historical status.

Smallest product boundary: presentation-only Web changes. No API/schema/DB changes, new route/state library, new services, planner invocation, Runtime inference or delivery functionality is needed. Do not expand the Task-only sessionStorage exception to credentials/configuration/Todo during a visual migration.

### Files found and exact seams

| File / anchor | Finding and proposed change |
| --- | --- |
| `apps/web/src/styles.css:12–17` | Neutral semantic token authority already exists; retain values and map all migrated surfaces to these variables. |
| `apps/web/src/styles.css:19–27` | Legacy global 32px h1, old shell/chrome, form/record/card palette, 42px page padding, green notices, policies and login remain. Many shell declarations are superseded at line 77+, while interiors remain green. Replace/consolidate, not add another final override slab. |
| `apps/web/src/styles.css:30–75` | Todo workspace/card/discussion rules; two-column layout, mobile list/detail visibility, back button. Keep behavior selectors while updating geometry/surfaces. |
| `apps/web/src/styles.css:77–132` | Accepted neutral shell/mobile/page header rules. Preserve behavior and compare new Task/Board screenshots after shared reset changes. |
| `apps/web/src/components/forms.tsx:7–15` | `Field` uses native input/textarea/label; `Select` uses native select; `PageHeading` uses uppercase eyebrow plus large h1. Swap internals to owned primitives without changing call signatures, IDs, callbacks or validation. Compose `PageHeader` for heading; use a quiet description/toolbar beneath when helpful. |
| `apps/web/src/components/forms.tsx:17` | `EditorActions` centralizes save/reload/dirty status; normalize its spacing/border without moving actions outside the original form/fieldset. |
| `apps/web/src/components/page-header.tsx:3` | Existing compact heading/action contract; reuse instead of another settings header skin. |
| `apps/web/src/components/ui/{input,textarea,label,native-select,button,dialog}.tsx` | Already owned primitives. NativeSelect intentionally preserves standard native select semantics, compatible with existing `selectOption` tests. |
| `apps/web/src/app/app.tsx:24–26` | Login remains a two-column green marketing panel with rings and oversized copy. Replace with neutral focused brand/labelled password form, concise heading/helper text and local error; preserve submit/busy/password clearing/session refresh behavior. |
| `apps/web/src/app/app.tsx:50–64` | `legacy-page` wrapper can become a neutral settings/Todo layout class. Settings and Todos remain mounted using `hidden`; do not replace with conditional mounts. Global save/error notices must remain reachable. |
| `apps/web/src/features/projects.tsx:18–41` | Record list/editor, repository subforms/picker, Role selection and archive checkbox. Flatten list with separators; bound meaningful repository groups; compact empty copy. Preserve IDs/drafts/fieldsets/query enablement. |
| `apps/web/src/features/roles.tsx:19–28` | Same record/editor pattern; replace native archive/custom-policy checkboxes; keep draft maps and basis untouched. |
| `apps/web/src/features/execution.tsx:16–31` | Planner guidance form, Runner list and policies appear as separate bulky cards; align shared section treatments and remove independent palette. Preserve distinct form submissions. |
| `apps/web/src/features/policy-editor.tsx:10–21` | Shared Runtime/Runner/model/thinking/fallback editor; Field/Select migration covers all text/select controls. Keep omitted versus empty optional policy fields and fallback ordering unchanged. |
| `apps/web/src/features/github.tsx:15–22` | App configuration, secret field, key fingerprint, setup prose and access check. Neutral aligned form plus quiet help. Retain synthetic/live evidence boundary and private-key clearing/keep-current behavior. |
| `apps/web/src/features/todos.tsx:103–157` | Large PageHeading, card capture, card selected-detail and separate card Discussion. Compose a compact list/selected workspace with Original Capture, organization disclosure, Discussion and composer as distinct sections without nested floating cards. |
| `apps/web/src/features/todos.tsx:119` | Raw capture textarea and label; replace with owned Textarea/Label while forwarding `captureInput` ref, required/maxLength/aria-describedby. |
| `apps/web/src/features/discussion.tsx:67–104` | Message list, preview, attention, Current understanding and composer remain in one mounted component. Normalize body/meta typography; replace raw composer textarea/label and preserve ref. |
| `apps/web/src/features/task-preview.tsx:33–60` | Lightweight bounded proposal/created card. Retain full exact Specification, Project choice, eligibility reason, creation/recovery/cancel controls. Use neutral tag for PLANNING; positive styling is reserved for factual success. |
| `apps/web/test/*.e2e.ts` | Existing real-backend and explicit-fixture interactions already cover drafts, uncertain receipt recovery, conflicting clients, focus, overflow and proposal semantics. Extend screenshots in these flows rather than new fake application/services. |

### Legacy CSS to remove or normalize

Current `styles.css` compresses many selectors onto one line; line references identify grouped blocks, not one selector per line.

- Line 19: 32px/negative-tracking global h1 and default heading hierarchy; use compact shared chrome and 16–18px section headings, with long prose at 14–15px/20–22px.
- Lines 20–22: old green focus (`#7dbb95`), sidebar (`#17251f`), topbar/page padding, uppercase `.eyebrow`, `.record` hover/selection (`#edf1e9/#e8eee3`), green card borders and 28px `.editor` padding. Remove dead superseded shell declarations; preserve current shell lines 77+.
- Line 22: `.field input,.field textarea,.field select` globally override primitive colors/padding/height. Remove skinning when Field uses owned controls; keep only layout wrappers and supported readonly treatment. `.checkbox input` accent-color and fixed 16px hit area become an owned checkbox plus a mobile-sized label target.
- Line 22: `.card`, `.resource`, `.editor-actions`, `.empty-state`, `.empty-symbol`, `.inline-note` produce repeated large bordered/green groups. Use flat row/list surfaces and 6–8px radii for actual groups. Remove marketing empty-state titles in Projects/Roles; concise empty prompt + existing create action suffices.
- Line 23: `.notice.success/.error/.uncertain`, `.save-progress`, `.form-error`, footer/loading colors. Use shared success/warning/destructive/foreground tokens, readable contrast and explicit text; status color must reflect facts. Do not erase success/error distinction or alert/status semantics.
- Line 24: Runner/runtime/policy/fallback/settings help/key/access/repository-picker colors and independent padding. All need semantic variables and consistent section spacing; long IDs/fingerprints/repository names must wrap.
- Line 25: Login green illustration panel, rings, oversized intro and form typography. Replace with a restrained responsive sign-in form using the same tokens.
- Lines 26–27 vs 67–75 vs 113+: competing breakpoints at 760/767 and global `.record-list` horizontal scrolling. Consolidate a 767px compact baseline where possible. Keep settings record selection usable on mobile; avoid a hidden only route or page-wide overflow.
- Line 36 `.todo-capture [data-slot=button] {width:100%}` is intentional composition sizing, but avoid broad future padding/height overrides. Empty `[data-slot=button] {}` rules and superseded visual declarations should be removed.
- `.task-detail`/`.task-link` legacy selectors may still affect full Task. Remove only after usage inspection; do not delete shared classes merely because their old component was replaced.

### Minimal component/composition changes

1. **Shared forms first:** retain `Field`, `Select`, `EditorActions` APIs; use Input/Textarea/Label/NativeSelect; remove CSS that overrides those primitives. Add an owned Base UI Checkbox (installed `@base-ui/react` 1.8.0) and a small labelled checkbox composition if it genuinely reduces repeated semantics. Do not add Radix or another selection system.
2. **Checkbox semantics:** migrate Project Role/archive, Role hidden/custom policy, and global/Planner policy checkboxes. Preserve `checked` boolean, existing mutation function and native fieldset disabled semantics. Base UI root/hidden input must remain accessible to `getByRole('checkbox')`/`getByLabel().check()`; label entire row with at least 44px mobile target. Record validation after primitive integration rather than assuming all native disabled behavior transfers.
3. **Header/interior wrapper:** compact shared PageHeader at aligned 16px gutter. Settings interiors may use 16–24px padding. Prefer common `.settings-content`/`.settings-section`/`.record-list` compositions only where actually shared. Avoid negative-margin header hacks or a new universal form framework.
4. **Settings:** preserve list/editor information architecture; neutral selected row with semantic selection (add `aria-pressed`/appropriate existing selection state where absent). Meaningful repository/policy groups remain bounded but not every subsection a card. Keep new/save/reload actions in predictable positions, inline dirty/conflict/uncertain feedback. Replace unprompted marketing prose with concise purpose text.
5. **Todo workspace:** list remains visible on desktop and selected pane contains identity, lightweight distinct Original Capture, initially collapsed organization controls, Discussion and composer. Preserve mobile drill-in/back flow. Long Original Capture/messages remain fully accessible and do not become fake chat or silently clipped approval text. If using contained scroll, ensure composer/actions remain reachable and avoid nesting multiple competing scroll regions.
6. **Discussion/preview:** use the accepted Task conversation's neutral hierarchy as visual reference, not its command hooks. Maintain regular message sequence, source Project attribution, current-source queued/interrupted/settling panel, Current understanding disclosure and exact preview card. Do not collapse full proposal text behind an unchecked summary before confirmation.
7. **Login:** neutral page canvas and small bounded form, same control tokens, 20px or similarly restrained form title. Preserve labels/autocomplete/minLength/maxLength/error/busy state and one submit path. The setup helper remains factual; no backend onboarding work is added.

### State/behavior contracts that must survive

- `app.tsx:60–64` uses `hidden` mounted sections so configuration record drafts and Todo controllers survive view switches. Keep this; visual routing rewrites must not remount on selected settings/Todo changes.
- Projects/Role maps retain each draft's original `basis`; only explicit Reload or matching successful receipt clears it (`roles.tsx:9–18`, analogous Projects code). Do not make CSS/selection changes key the editor to query refresh.
- `use-command.ts:8–35` keeps exact pending configuration request and same-tick guard; uncertainty blocks new configuration saves until receipt resolution. This is separate from Task persistence. Private GitHub key remains only transient form/pending command data and never enters browser storage.
- Todo filter/selection/drafts/capture refs and focus rules are in `todos.tsx:25–101`. Capture/open causes no Planner command. Archive/assignment removing selection restores capture focus only when appropriate; back restores selected row focus. Preserve stable `todo-row-*` IDs and heading/capture refs.
- `Discussion` is deliberately always mounted (`discussion.tsx:33–38`, `todos.tsx:156`), even when returning null for no Todo. `useDiscussion` owns per-Todo drafts/pending commands; `useTaskPreviews` owns per-Todo/proposal multi-step exact confirmation/create envelopes. Do not mount these controllers inside selected Todo article or paginated preview cards.
- Preview Project selection is local and affects its query/digest. Pending reads disable Create; created canonical association overrides stale local Project selection (`task-preview.tsx:21–31,48–59`). Cancel proposal is not Task Cancel; Continue discussing only focuses composer.
- Existing Task/Board and Task sessionStorage controls remain accepted downstream behavior. Broad styles/reset changes require their current browser regression, not a rewrite of their hooks or accepted backend contracts.
- Do not add Todo recent-message summaries/unread/rename/search API work because product docs show future examples. Current row uses canonical `label`, Project and discussion activity time; visual migration can preserve that exact payload.

### Suggested file ownership for implementation

| Responsibility | Exclusive files / boundary |
| --- | --- |
| Shared visual + Settings implementer | `styles.css`, `components/forms.tsx`, necessary `components/ui/checkbox.tsx`, `components/page-header.tsx` if needed, Login/wrapper-only edits in `app/app.tsx`, `features/{projects,roles,execution,policy-editor,github}.tsx` |
| Todo/Discussion implementer (if split) | `features/{todos,discussion,task-preview}.tsx`; propose class needs to shared owner, do not concurrently edit `styles.css` or hooks |
| Reviewer/test owner | Targeted screenshot/interaction additions to `test/{configuration,todos,discussion,task-preview}.e2e.ts` and optional single visual evidence test file using existing fixture; fixes coordinated with file owners |

Sequential implementation is also reasonable because most changes meet in shared forms/styles. If split, shared primitives/header contract should land first; otherwise Todo worker may copy another skin. No workers should edit protocol/server/hooks by default. Separate ownership does not permit reverting the in-progress Execution UI final fixes.

### Existing verification and fixture reuse

`apps/web/playwright.config.ts` serves built Web through `apps/server/test/fixtures/web-server.ts`, one worker, loopback `127.0.0.1:18555`. It creates a unique `web_test_<uuid>` PostgreSQL schema, has SIGTERM/15s graceful shutdown and drops only that schema. Use the root-established private DB environment wrapper if still available; do not print credentials, create another permanent service or delete prefix-matching schemas. `apps/web/README.md` documents the fixture; some prose about read-only Task/sole Button is historical and may need a scoped freshness edit after acceptance.

Existing seed endpoints: `/__test__/discussion-proposal`, `/__test__/task-specification`, `/__test__/execution-scenario`, `/__test__/execution-settle`, `/__test__/execution-reset` (`web-server.ts:29–37`). These are test-only. Create ordinary Projects/Todos through real authenticated APIs already used in tests. Reuse Discussion status/reply and GitHub repository route fixtures for synthetic projection cases; label them as such. No model/Runner/GitHub operation is necessary for visual acceptance.

| Suite | Existing regression to retain |
| --- | --- |
| `configuration.e2e.ts:20,67,77,94,106,122` | Real save/reload, Role/Project/policy/provider, two-tab stale versions, lost save/malformed lookup, duplicate submit, per-record/view drafts, session outage/revocation, skip-link focus |
| `todos.e2e.ts:36,61,121,139,160,177` | Exact passive capture, empty initial selection, keyboard open, scopes/archive/restore/focus, lost/unknown receipt replay, stale organization, mobile back/no overflow |
| `discussion.e2e.ts:25,44,72,101,124` | Independent Todo drafts, persisted queue, availability reasons, scoped uncertain request, bounded recent history, exact recovery controls/attributed replies |
| `task-preview.e2e.ts:39,87,103,121,134` | Full exact preview/project choice, two clients one Task, lost confirm/create stages, cancellation/stale input, canonical created association, Task/Todo navigation and current Spec |
| `execution.e2e.ts` | Shared shell/primitive regressions, local REVIEW, Task draft/session handling, exact Owner exits and mobile controls |

No new tests are needed for CSS values or implementation-shaped markup. Add assertions only where composition introduces risk: Checkbox fieldset/keyboard semantics, Login error association, new scroll/focus behavior, compact control targets and overflow. Existing role/label selectors should remain valid; do not rewrite tests merely to weaken behavior after a semantic regression.

### Screenshot/evidence matrix

Capture and **inspect** each representative state at desktop **1440×1000** and mobile **390×844**, with route, fixture identity/state, tested source/build identity, reference comparison and intentional deviations. Use viewport screenshots for chrome/composer reachability plus full-page when needed for long forms; long full-page files alone do not prove mobile usability.

| Surface | Required representative states and reusable source |
| --- | --- |
| Login | Default empty password; wrong-password error; in-flight disabled submit; narrow keyboard/focus. Use real login with synthetic fixture credentials, delay response only for busy capture. |
| Projects | Empty configuration; populated Project with repositories/Role choices; repository picker loading/error/empty; archived/unavailable choices; long name/URL/context. Existing configuration fixture/mocked GitHub list. |
| Roles | Empty list; selected saved Role; retained dirty Role/custom policy/fallbacks; disabled settings during pending save; long instructions. Existing configuration commands. |
| Execution settings | No Runner report; populated Runner/tool observations; infrastructure error; policy disabled/selected and long IDs/fallbacks. Fixture/injected read responses are projection evidence, not real installation readiness. |
| GitHub | Not configured; saved fingerprint/blank keep-current key; access error/busy/success; disabled Check without config; long fingerprint. Never screenshot real private keys. |
| Settings recovery | Two-client version conflict and lost save result with original draft visible and Check save result usable. Existing real-write route-abort tests. |
| Todo list | Empty scope/no selected Todo; populated cross-Project and Project filter; long label; retained quick-capture draft; save uncertainty; selected/keyboard row. Existing Todo commands/suites. |
| Selected Todo | Distinct Original Capture, initially collapsed organization, expanded dirty assignment, long capture; mobile back/focus and draft survival. No chat when merely opened. |
| Discussion | Empty before first explicit message; populated Owner/Planner attribution; queued normal wait and unavailable reason; interrupted/settling controls; read error/uncertain write; long message/Current understanding/composer. Existing real queue and explicit projection fixtures. |
| Preview | Exact full proposal+Project selector; eligible/disabled missing/stale Project; cancelled; lost confirmation/create recovery; long specification/title; canonical created Task card. Existing proposal seed and preview suite. |
| Integrated visual handoff | Todo → exact preview → created Task → existing full Task local REVIEW. Use existing execution scenario/settlement fixture for REVIEW and clearly record browser fixture evidence, not native CLI execution. Check shared chrome/forms look coherent with current Execution UI evidence. |

Queueing is not applicable to Login or ordinary config forms: use saving/disabled state rather than inventing Planner work. Empty fields with required validation are not execution errors. Use full text access for original capture, saved messages and approval Specification, with purposeful wrapping and contained code scrolling; no page-wide overflow.

Quality commands after implementation: root `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm protocol:check`, `pnpm build`, full `pnpm --filter @monos/web test:e2e` under private `MONOS_TEST_WEB_DATABASE_URL`. Reuse current environment; tests must leave zero newly owned fixture schemas. No broad repeated native backend acceptance is warranted for a visual-only diff.

## Caveats / Not Found

- This research inspected a shared workspace while Execution UI was finishing; line anchors and small selector details can move. Preserve final source edits and rebase composition on the completed leaf rather than old archived examples.
- Checkbox is the one missing owned form primitive actually needed. No new selection/dialog dependency is required; `@base-ui/react` is already 1.8.0, React 19.3.0, Tailwind 4.3.3, Playwright 1.63.0 (`apps/web/package.json`). Use current Base UI API, not Radix `asChild` conventions.
- No screenshots were generated/inspected and no tests run by this research. Existing saved screenshots prove earlier state only; migration needs new build-bound inspection.
- A two-panel Login is not inherently forbidden, but the current green marketing layout conflicts with the specified workspace direction; a focused neutral form is the smallest defensible change.
- Final acceptance should document any intentionally retained long-form scroll/section padding differences. Shared token replacement alone does not complete flat-list, hierarchy, accessibility or integrated-flow evidence.

## External references

The frontend visual spec is self-contained and records the inspected Multica reference at `44ea3b40c8b4f54f4c76d1dd3e3c92e0c0cabd19`: UI tokens, 48px header/toolbar, 16px gutters and 256px sidebar. No external network lookup was needed. Use this reference as presentation guidance; no Multica organization/team abstractions or runtime dependency is introduced.
