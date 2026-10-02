# Research: Execution UI frontend seams

- Query: Locate reusable frontend state/API/layout seams, visual references and browser fixture paths for Board and full Task control views; investigate reload-safe exact commands with session isolation.
- Scope: internal source inspection plus local external Multica reference
- Date: 2026-10-02

## Findings

### 1. Existing structure and recommended ownership

| File | Existing responsibility / relevant seam |
| --- | --- |
| `apps/web/src/app/app.tsx` | Authenticated shell, native hash routing, session lifecycle and permanently mounted Todo/settings views. |
| `apps/web/src/features/task-detail.tsx` | Minimal TaskOverview read, effective Specification and source Todo backlink. Replace/extend this entry for full Task surfaces. |
| `apps/web/src/features/execution.tsx` | Execution **settings** (policies, installed tools and Runners), not the execution Board. |
| `apps/web/src/features/discussion.tsx` | Mounted Todo-scoped controller, paginated ordered messages and factual queued/interrupted/settling states. |
| `apps/web/src/lib/api.ts` | Validated same-origin fetch, exact Owner command submit/recovery and operation read. |
| `apps/web/src/lib/use-discussion.ts` | Per-Todo drafts/pending commands, same-tick guard and definitive-versus-uncertain failure handling. |
| `apps/web/src/lib/use-task-previews.ts` | Multi-step exact confirmation/creation; stores the second envelope before sending it. |
| `apps/web/src/lib/task-preview-api.ts` | Strict proposal identity/digest checks and independent `readTask`. |
| `apps/web/src/lib/attempt-logs.ts` | Scoped log cursor read and explicit acknowledgement seam, currently unused by a visible component. |
| `apps/web/src/components/ui/button.tsx` | Only owned shadcn/Base UI primitive currently installed. |
| `apps/web/src/components/forms.tsx` | Legacy native fields/select and spacious settings heading. Do not propagate this visual treatment into new Task views. |
| `apps/web/src/styles.css` | Theme authority plus legacy green styles, shared reset and conflicting global primitive overrides. |
| `apps/web/test/*.e2e.ts` | Real HTTP/DB tests, transport interruption patterns, scope drafts, two clients and screenshots. |
| `apps/server/test/fixtures/web-server.ts` | Browser-only service with unique schema, real backend and built SPA; safe place for explicit Task fixture routes. |

Keep native hash routing: `app.tsx:17-18,25-26` already supports direct `#task?task_id=...`, Todo source links and history changes. Add a distinct Board route, for example `#board`, with optional Project/attention/history filters encoded in the hash. Preserve the existing `#execution` settings route; navigation may label it “Execution settings” to distinguish it from Board. A router dependency is unnecessary for these requirements. Task section selection can use a Task hash parameter with Conversation as the default.

`app.tsx:40` currently keeps Todos and all settings mounted but conditionally mounts Task detail. A Task-local controller inside that conditional component would lose every draft on Board/settings navigation. Own the scoped Task controller in the mounted Workspace (or an always-mounted Task workspace) and key it by Task plus operation/proposal/input identity. Render only selected Task read surfaces; avoid enabling polling for every historical Task merely to retain drafts. Preserve the existing Todo/settings mounts.

**Parent-approved scope option:** this leaf owns the necessary shared shell, neutral tokens, compact chrome and on-demand primitives used by Board/Task. The parent will separately create/link the existing-screen migration backlog and assign the handoff before UI activation. That migration retains Login/Settings/Todo/preview **internals** and their full visual acceptance. Full Task detail supersedes the current minimal Task detail here. Record shared-file ownership explicitly in design; do not silently claim full old-screen migration from a shared-token change.

The archived handoff at `.trellis/tasks/archive/2026-09/09-30-frontend-visual-standards/migration-handoff.md:18-20` requires separate planning and says integrated visual acceptance depends on both scopes. New Task/Board screenshot acceptance can pass while the broader Todo→Task integrated visual gate remains outstanding. Shell changes still require existing navigation/draft/keyboard functional regression checks.

### 2. Query and API composition

`api.ts:11-24` validates every JSON body with the browser-safe shared AJV entry and distinguishes definitive `APIError` from uncertain writes. Reuse it rather than adding fetch/validation infrastructure. Import generated types and `packages/protocol/src/validation.ts`; never bring the server crypto entry, DB or service code into the browser.

`api.ts:43-59` already implements `/v1/owner/commands`, scoped receipt recovery and Owner operation reads. Recovery first queries the exact receipt; only an authoritative `unknown` replays the original immutable envelope. Malformed/unavailable receipt reads remain uncertain. Existing generic Owner helpers verify request identity; new family adapters should also validate Task/scope and expected returned entity/outcome identities where the wire response supplies them, following `task-preview-api.ts:4-15,34-48`.

Task-scoped endpoints already registered in `apps/server/src/app.ts:132-168` include:

| View need | Existing endpoint seam |
| --- | --- |
| Task identity/effective Specification/counts | `GET /v1/owner/tasks/:task_id` (`TaskOverview`) |
| Initial planning/actions and immutable Plan | `GET .../:task_id/planning`, `GET .../:task_id/plans/:plan_id` |
| Conversation | `GET .../:task_id/conversation`, `.../messages?cursor=&query=`, `.../operations`, guidance recipient pagination |
| Node controls/status/result | `GET .../:task_id/nodes/:node_id/execution` |
| Specification proposal/revision/change history | `.../:task_id/specification`, `/proposals`, `/proposals/:proposal_id`, `/revisions`, `/revisions/:revision_id`, `/changes/:change_id` |
| Replan requests/proposals/effects | `.../:task_id/replan`, `/requests/:id`, `/proposals/:id` |
| Timeline source | `GET .../:task_id/events?cursor=` plus formal artifact list/details |
| Execution details | Task attempt list/detail/log endpoints; Owner operation detail endpoint |

Conversation, Specification and Replan each have dedicated POST command paths and scoped receipt paths (`app.ts:141-153`). Add small typed family adapters and co-located hooks; do not send their commands through the generic Owner envelope. The existing hooks are patterns, not a generic framework to force onto all families.

**Missing Board read:** there is no authenticated Task collection/Board endpoint in the registered routes inspected. `TaskOverview` supplies per-Task facts (`generated/types.ts:1445`), but the browser cannot enumerate all Tasks from this. The leaf needs a bounded server collection projection, server-controlled filters/cursor and sufficient factual attention pointers. Do not derive the global Board by crawling loaded Todo preview cards or fan out unbounded Task reads. The backend researcher owns exact projection design.

Use TanStack keys such as `['tasks', taskId, 'conversation', 'messages', search]`, `['tasks', taskId, 'replan', requestId]` and `['board', filters]`. Include all filter/identity/cursor dimensions. Invalidate the affected Task and Board after command acknowledgement; never overwrite canonical state with an old receipt snapshot. Existing session query uses window-focus revalidation (`app.tsx:45`); private reads must invoke the same unauthorized handling.

`discussion.tsx:41-46,54-56` provides a useful bounded recent-history pattern: load earlier pages explicitly, merge immutable message IDs and let a refreshed canonical disposition replace an older projection. Task search must get a separate query key. Current frontend uses polling, not SSE. Bounded polling while the selected scope is visible is an established option; no new stream client is required solely for this UI. If adding SSE, satisfy cursor-gap reset and cleanup requirements explicitly.

### 3. Exact mutation and draft behavior

`useDiscussion:16-29` blocks same-tick duplicate submission with an in-flight Set, retains a pending envelope by Todo and clears a draft only when its current content still equals the successfully submitted message. This prevents a later draft from disappearing after a slow response. `useTaskPreviews:19-39` uses a synchronous ref mirror and stores each stage before sending; apply that pattern to exact Specification/Replan confirmation→publication sequences, including jointly confirmed requirement/Plan content. Do not re-confirm after an uncertain publication or replace expected versions after conflict.

Maintain one pending chain per actionable scope (Task or narrower proposal/input) and allow unrelated Tasks to remain usable. A proposal waiting for Owner confirmation is not a pending transport command and must not disable the Task composer. New submission, polling or mount must never implicitly Start/Continue execution. Accepted operations show admitted/settling separately from final effects; polling authoritative operation/status reads completes their presentation.

Fresh API reads and two-client behavior must be tested, not only local controls. On version conflict preserve the draft and original basis, refresh canonical facts, and require an explicit new intent before constructing a replacement command. A historical result belonging to an old source/activation must not enable actions on the current activation.

#### Reload persistence: existing limitation and bounded exception

Existing drafts/pending envelopes are memory-only (`use-command.ts:8-20`, `use-discussion.ts:17-34`, `use-task-previews.ts:19-29`); whole-page reload loses them. `.trellis/spec/frontend/state-management.md:65-66,97` explicitly prohibits persistent pending commands in the current configuration/Todo implementation. Existing browser recovery tests cover scope navigation, not a reload while a request is uncertain (`task-preview.e2e.ts:101-116`). This leaf's reload-safe requirement therefore needs an explicit design/spec exception; it cannot be reported as existing behavior.

The parent is considering a **Task-only bounded sessionStorage envelope/draft exception**, never configuration/provider credentials. Recommended constraints:

1. Persist only allowlisted Task command families, exact payload/basis/request IDs, current chain stage and scoped drafts. No Owner password/token, provider keys, configuration payloads, raw logs or cross-Task shared composer. Treat stored content as private Task data, not as a credential. Do not use localStorage.
2. Bind every record to a server-issued **non-authenticating session identity**. Validate version, identities, exact command schema and storage byte/count/age limits before use. Treat corrupt/incompatible records as an explicit recoverability error; do not silently convert them into a new command.
3. Write a pending envelope successfully **before** transmitting a new mutation. If storage is unavailable/full, fail closed for a reload-guaranteed new command with a useful message; avoid claiming refresh recovery without a retained envelope. Never evict unresolved pending commands to satisfy a draft cap. Bound drafts separately and define an explicit retention policy.
4. On reload, hydrate only after successful session validation for the matching session ID; query the original receipt, then offer recovery. No automatic POST in mount effects. If authoritative receipt is unknown, user recovery may replay the identical envelope; unavailable/malformed receipts must not replay. Chain stages and confirmation identities survive reload.
5. Clear owned records on logout/revocation and on a verified session change; leave unrelated storage untouched. Session read outages preserve already-mounted memory editors. Do not revive storage on an unauthenticated/unknown session.
6. A sessionStorage copy in a duplicated tab can contain the same envelope. Backend idempotency makes duplicate exact recovery safe; tests should explicitly check this, as well as distinct new-command IDs from independent clients.

**Session gap and exact change seam:** `OwnerSessionStatus` currently exposes only `authenticated`, `expires_at` and schema version (`generated/types.ts:748`, `schemas/v1/contracts.json:2750`). `OwnerAccess.session()` queries only expiry (`apps/server/src/owner-access.ts:53-57`); login response at `app.ts:123` also omits identity. `issueOwnerSessionInTransaction()` already creates a random UUID independent of the secret token and returns `session_id` (`owner-commands.ts:25-29`). Expose that non-authenticating UUID (or a dedicated random public cache identity) in authenticated login/session projections. No DB migration is needed if existing session UUID is chosen. A timestamp such as `expires_at` is not a reliable unique session identity.

Use that identity to key/remount Workspace after a verified session change and to partition/clear Task persistence and private query cache. This handles another tab logging in under a new cookie while the current tab has old mounted pending work. `App` presently only unmounts on unauthenticated status, so a true→true session replacement would retain old state. Session-sensitive storage tests must cover logout/relogin, remote revoke, cross-tab cookie replacement and transient revalidation outage. Never expose token/token_digest to achieve binding.

### 4. Surface recommendations grounded in existing contracts

- **Board:** compact shared header/filter toolbar; Ready to start, Running, Review and Done/history. Map PLANNING→Ready, RUNNING/BLOCKED/REPLAN_REQUIRED→Running, REVIEW→Review, COMPLETED→Done, CANCELLED→history. Capacity queueing is normal waiting, not attention (`docs/07-owner-review-and-ui.md:356-397`). A card may show one primary reason but must make all active blockers discoverable. Do not invent percent/ETA or infer work from model prose.
- **Task header:** identity, Project/source link, factual state and the stage-appropriate action. Keep `#todos?todo_id=...` backlink and direct reload. Add Board navigation without discarding source provenance. Heading focus should happen on Task identity changes, not every polling refresh (`task-detail.tsx:9-12`).
- **Conversation:** selected Task messages, exact source input and routing receipts; persist drafts by Task. Distinguish saved/queued/processing/awaiting Owner/settling/effective. Exact proposals must show full content, effect and reason before confirmation; other chat stays usable. Terminal Task conversation can answer read-only questions but never create/preview a new Task (`docs/07:688-704`).
- **Overview:** effective Markdown Specification with exact revision identity/history; current effective Plan work in human-readable groups; formal outputs; required Owner decisions (`docs/07:401-443`). Avoid raw JSON as the normal presentation of output/impact. Do not substitute initial Specification for current text; preserve explicit legacy Markdown unavailable state.
- **Timeline:** formal events/artifacts and decisions only. `TaskEventPage` has cursor and `reset_required`; honor reset and dedupe sequence. Runtime output, heartbeat and ordinary workspace operations belong in diagnostics (`docs/07:447-465`). Unknown event kinds can retain a readable factual fallback with advanced structured details, not fabricate semantic summaries.
- **Execution Details:** select a Node, render its current/latest execution and log directly; compact Previous executions only if needed. Planner execution is shown before a Plan exists. Hide infrastructure IDs/raw payloads under advanced details (`docs/07:516-603`). Preserve exact result commits/trees/paths as diagnostics when exposed by backend; do not fabricate unavailable diffs.
- **Local REVIEW:** show exact local result and evidence. This task's backend has no completed publication/Owner acceptance delivery flow; do not label it delivered, PR-created, merged or V1 complete, and do not add unimplemented Accept/Merge actions merely because the eventual product document describes them.

**Log cursor caveat:** `attempt-logs.ts:7-15` defaults to saving only the cursor in sessionStorage. Persisting a cursor while discarding its rendered entries makes previous output disappear after reload. Pass a storage adapter coupled to retained entries, or keep cursor+entries in the selected view's memory and intentionally begin a fresh bounded read after reload. Acknowledge only after retaining entries. `has_more=false` means caught up for that read, not final output; continue polling active/reconciling execution and show reported gaps. Do not copy raw logs into Conversation or Timeline.

### 5. Shared visual implementation seams

Selected dependencies are already present: React/React DOM 19.3.0, `@base-ui/react` 1.8.0, TanStack Query 5.104.0, Tailwind 4.3.3, Vite 8.3.1, Playwright 1.63.0 (`apps/web/package.json`). `components.json` explicitly selects shadcn `base-nova`, neutral base color and aliases.

Install/copy only used owned primitives under `components/ui`: Input, Textarea, Label, NativeSelect or selected Base UI Select, Dialog/Sheet for exact proposals/mobile navigation, Tabs if used for section navigation, and Checkbox only if a real interaction needs it. Preserve the selected Base UI family; no Radix mixing or hand-built focus-trap overlay. Native semantic links/forms/lists and domain row buttons remain appropriate. New shared `PageHeader`/toolbar/navigation components belong under `components/`, lifecycle behavior stays in features.

`styles.css:11-16` currently defines green tokens, 230px dark sidebar, 66px topbar, 42px page gutter and a global `[data-slot=button]` minimum/padding override. Lines 20-21 add mobile layouts and further button overrides. These defeat the Button's owned 32/28/36px size variants (`components/ui/button.tsx:21-32`). Necessary shell/token integration must remove/scope these overrides for new surfaces and let the primitive API own sizes. Avoid recreating the forbidden override in a feature namespace.

Use one neutral token authority, 256px desktop navigation, 48px header/toolbar, 16px aligned horizontal gutter, compact 14/20 UI body and 15/22 message text. Main/Board columns need `min-width: 0`; mobile below 768px gets a Base UI menu/sheet and reachable route back, 44px touch actions and purposeful contained Board/code scrolling. Keep focus visible and reduced-motion behavior. Existing login/settings skins may remain explicitly deferred internally; shared theme changes still require contrast and layout spot checks there.

### 6. Multica reference paths and visual inspection

Reference source checkout is `/Users/me/IdeaProjects/multica`; the visual spec records inspected HEAD `44ea3b40c8b4f54f4c76d1dd3e3c92e0c0cabd19` on 2026-09-30. This researcher did not perform Git operations or assert current working-tree cleanliness. Source files were re-read:

- `/Users/me/IdeaProjects/multica/packages/ui/styles/tokens.css:87-170`: type scale and semantic neutral tiers.
- `/Users/me/IdeaProjects/multica/packages/views/layout/page-header.tsx:16-26,83-95`: shared 16px gutter, 48px header/toolbar, leading navigation and trailing actions.
- `/Users/me/IdeaProjects/multica/packages/views/layout/collection-page.tsx:44-78`: compact icon/title/count/actions.
- `/Users/me/IdeaProjects/multica/packages/ui/components/ui/sidebar.tsx`: supporting sidebar/mobile sheet reference cited by the local visual spec.

Usable local images (files exist; first three were opened and visually inspected in this research):

| Absolute path | Size | Useful comparison |
| --- | --- | --- |
| `/Users/me/IdeaProjects/multica/apps/docs/public/images/docs/workspace-overview.webp` | 1600×900 | Neutral sidebar/canvas, compact Board column headers and cards, light status accents; best Board reference. |
| `/Users/me/IdeaProjects/multica/apps/docs/public/images/docs/tutorial-issue-engineer-working.webp` | 1600×1004 | Compact long-title detail header, readable central content, composer and quiet diagnostic side column; contains red tutorial arrows, not target UI. |
| `/Users/me/IdeaProjects/multica/apps/docs/public/images/docs/task-transcript.webp` | 940×400 | Dense diagnostic event rows and compact toolbar; cropped overlay, not a whole Task screen. |
| `/Users/me/IdeaProjects/multica/apps/docs/public/images/docs/tutorial-empty-workspace.webp` | 1600×1004 | Candidate empty-workspace reference; located and dimensions checked, not visually inspected here. |
| `/Users/me/IdeaProjects/multica/apps/docs/public/images/docs/chat-conversation.webp` | Not measured | Candidate conversation reference; located, not visually inspected here. |
| `/Users/me/IdeaProjects/multica/apps/docs/public/images/docs/tutorial-execution-log.webp` | Not measured | Candidate diagnostics reference; located, not visually inspected here. |

Do not copy Multica team/member/squad navigation, issue states, assignment, marketing assets or its run timeline bar into monos. The repository visual contract is authoritative for current token/geometry choices; documentation screenshots may represent an older render and include unrelated product fields. Record any deliberate monos difference, including three primary execution states plus Done/history and distinct Conversation/Timeline.

### 7. Verification commands, fixture setup and test additions

Existing commands from repo root:

```sh
pnpm lint
pnpm typecheck
pnpm test
pnpm protocol:check
pnpm build
pnpm --filter @monos/web exec playwright install chromium
pnpm --filter @monos/web test:e2e
```

Use Node >=24 <27 and the locked pnpm 12.6.0 environment. `pnpm build` must precede the browser suite because its server serves `apps/web/dist`; no Vite development server is used by browser acceptance. Set `MONOS_TEST_WEB_DATABASE_URL` privately in the process environment, never print credentials or put them in command arguments. PostgreSQL needs CREATE SCHEMA permission. Port 18555 must be available. The parent owns any actual server/tunnel operations; none were started for this research.

`apps/web/playwright.config.ts:3-5` runs tests serially (one worker), desktop viewport 1440×1000, retains failure traces, starts the fixture at loopback 18555 and sends SIGTERM with 15-second cleanup. `apps/server/test/fixtures/web-server.ts:12-21,33-51` creates/migrates a unique `web_test_<uuid>` schema, serves actual Fastify and built SPA, uses synthetic Owner password `monos-browser-test-password`, and drops only its own schema. Do not change this to reuse/decorate deployed native acceptance Tasks. Verify no new owned test schema remains after fixture lifecycle changes; never indiscriminately delete prefix matches.

Current browser fixtures have `/__test__/discussion-proposal` and `/__test__/task-specification` only (`web-server.ts:26-32`). `task-preview-fixture.ts:16-33` seeds formal proposals through real Discussion/queue/grant/Tool Protocol admission with **synthetic Runtime facts**. New Task scenarios should use authenticated same-origin fixture-only routes, deterministic IDs returned to tests and real service transitions where feasible. Keep them out of production `createApp/main`.

`task-conversation-fixture.ts:16-32` and `task-replan-fixture.ts:8-18` provide rich canonical execution/spec/Replan setup patterns but are **not drop-in browser helpers**: the conversation fixture opens its own `DATABASE_URL`, schema and Owner session. Extract/reuse setup logic parameterized by the existing browser `db`, `service` and authenticated token; do not call the nested-schema constructor from browser routes or bootstrap another service. Browser fixture evidence proves UI/HTTP/formal persistence, not actual native CLI behavior.

Test patterns to reuse:

- Lost response after real persistence: `task-preview.e2e.ts:105` calls `route.fetch()` then `route.abort('failed')`; capture the request before forwarding.
- Malformed receipt, no replay: `task-preview.e2e.ts:109-115` asserts write count and original command chain.
- Authoritative unknown then exact replay: `todos.e2e.ts:139-150` records envelopes and allows the second exact submission.
- Independent second Owner session: `task-preview.e2e.ts:85-98` uses `browser.newContext` and signs in separately; shared-cookie tabs use `context.newPage` in configuration tests.
- Session outage/revocation: `configuration.e2e.ts:104-117` proves transient failures preserve editor drafts and revoked sessions clear them.
- Scope-preserving drafts: Discussion/Task preview tests navigate via hashes without unmounting the owner controller.
- Mobile overflow/focus: Todo tests at `todos.e2e.ts:177-188`, skip-link test at `configuration.e2e.ts:120-124`.

Add focused `execution.e2e.ts` (or similarly named) and family API-boundary tests. Required browser cases: Board direct reload/filter/history; initial planning issue and queued state; Stop/Continue/Retry with exact activation; Conversation draft isolation and terminal read-only questions; input/guidance withdrawal; full exact spec/replan proposal confirmation/publication and dismissal; two-client stale decisions; lost response **across actual page reload**, malformed/unavailable receipt and exact unknown replay; admitted settlement; local REVIEW labels/results; current vs historical Node output; diagnostics log reconnect; all menu/dialog keyboard focus and mobile reachability. Mock only error/transport/projection states that cannot be seeded reasonably, and label those cases separately.

Focused invocation after adding the new file:

```sh
pnpm --filter @monos/web test:e2e test/execution.e2e.ts
```

Before full acceptance run the whole web suite because shared shell/session/primitive changes affect existing mounted screens. Root protocol/backend tests are also required if adding Board projection or public session identity. Do not rerun unrelated native Replan acceptance just to validate frontend work.

Save screenshots with `info.outputPath(...)` to ignored `apps/web/test-results/`, following existing tests. Capture **actual build** at 1440×1000 and 390×844, covering Board/Task populated, empty, queued/loading, disabled reason, recoverable error/uncertain, long titles/messages/proposals and local REVIEW; record non-applicable states honestly. Open and inspect each required image. Record source/build identity, route, fixture IDs/state, reference image/source, observed geometry/contrast/overflow/focus and intentional deviations. Existing screenshots without inspection do not prove visual acceptance; a screenshot of a synthetic fixture does not prove native execution.

## External references

- shadcn Base UI support: https://ui.shadcn.com/docs/changelog/2026-01-base-ui
- Base UI Dialog composition: https://ui.shadcn.com/docs/components/base/dialog
- Local Multica source/images above; prior recorded source revision comes from the repository visual spec, not a fresh Git check.
- Installed library versions listed in section 5 are from `apps/web/package.json`; no external upgrade or registry lookup was needed for this research.

## Related specs

Read: `.trellis/workflow.md`; every file linked from `.trellis/spec/frontend/index.md` (visual-design, directory-structure, component-guidelines, hook-guidelines, state-management, type-safety, quality-guidelines); `ARCHITECTURE.md`; relevant `docs/07-owner-review-and-ui.md` sections and `docs/08-principles-and-non-goals.md`; the archived migration handoff. Parent/backend research must supply exact per-command backend availability/basis contracts before implementation.

## Caveats / Not Found

- No code, services, deployment, tests or Git operations were performed. This is a source/reference research artifact only.
- No Board/task-collection read exists in the inspected route registry; server work is required.
- No full Task UI, Task command hook, Task sessionStorage store or public session identity exists yet. Reload-safe commands require reviewed design/spec changes and meaningful tests.
- Existing tests asserting all storage is empty (`configuration.e2e.ts:106`) should continue to prove configuration/provider secrets are absent; any new Task-only exception must not weaken that guarantee.
- Global shared styles are legacy and substantial; scope ownership must be settled before touching them. Broad existing-screen visual migration and integrated visual acceptance remain separate.
- Native Runtime execution, real provider delivery and real GitHub behavior are outside browser fixture evidence.
