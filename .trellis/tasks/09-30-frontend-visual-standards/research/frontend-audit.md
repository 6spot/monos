# Frontend specification and task audit

Date: 2026-09-30. Read-only source inspection; no rendered comparison or browser run claimed.
Multica reference: local `/Users/me/IdeaProjects/multica`, HEAD `44ea3b40c8b4f54f4c76d1dd3e3c92e0c0cabd19`. Findings describe the inspected working files, not a verified clean commit snapshot.

## Findings

1. **Component baseline exists, but permits inconsistent presentation.** `docs/11-technology-and-deployment.md:29` requires shadcn/Base UI while allowing native form controls. `.trellis/spec/frontend/component-guidelines.md:7` requires Base UI and shared semantic tokens, but does not define component coverage or a visual baseline. `apps/web/components.json:3` selects base-nova; only `components/ui/button.tsx` exists. `apps/web/src/components/forms.tsx:8` implements native input/textarea/select wrappers. Native semantic HTML is not itself a violation; the missing contract is consistent shared component presentation.
2. **Current visual direction differs from the requested reference.** `apps/web/src/styles.css:11` supplies green theme values, `:15` a dark green sidebar, and `:16` spacious card/page styling. Many colors bypass semantic tokens despite the component spec. A global `[data-slot=button]` rule at `:14` overrides component sizing. `components.json` saying neutral does not control these authored styles.
3. **Multica has concrete reusable visual contracts.** Reference `packages/ui/styles/tokens.css:89` defines semantic typography (caption 12/16, label 13/18, body 14/20); `:120` defines neutral shell/canvas/surface/overlay tiers. `packages/views/layout/page-header.tsx:17` owns 16px page gutters; header and toolbar use 48px height. `collection-page.tsx` uses compact icon/title/count/actions and shared empty states. `packages/ui/components/ui/sidebar.tsx:29` defaults to 256px; mobile uses a sheet. These are reference observations to translate into monos, not reasons to copy its navigation/domain or every interaction.
4. **UI backlog has behavior gates without visual gates.** `.trellis/tasks/09-30-a-execution-ui/prd.md:7` covers Board, controls and canonical state; `:16` covers recovery/accessibility without a visual reference. Its implement/check manifests are empty because it is explicitly a backlog leaf, not evidence of a failed active dispatch.
5. **Screenshots exist, visual acceptance does not.** `apps/web/test/configuration.e2e.ts:37`, `todos.e2e.ts:58`, `discussion.e2e.ts:170`, and `task-preview.e2e.ts:56` save screenshots. No `toHaveScreenshot` match was found in apps/web; the quality spec requires interaction/accessibility evidence but no reference-based visual review. Saving a screenshot alone does not establish style alignment. Automated pixel comparison is optional; explicit inspected visual evidence is required in the proposed gate.
6. **Do not misassign backend work.** Task conversation PRD lines 95–97 explicitly defer execution UI. Its backend/Runner context is appropriate; visual work belongs to the execution UI leaf and existing-screen migration ownership.

## Proposed specification changes

- `docs/07-owner-review-and-ui.md`: declare Multica application workspace visual/layout reference while retaining monos Todo, Execution Board, Task sections and Settings semantics.
- `docs/11-technology-and-deployment.md`: clarify that native form semantics/local React state do not authorize a second unthemed component system; use owned shadcn Input/Textarea/Label and appropriate selection primitives on demand, preserving Base UI.
- Add `.trellis/spec/frontend/visual-design.md`: neutral shell/canvas/surface hierarchy; shared compact header/toolbar/gutter; typography and spacing tokens; restrained borders/shadows/status colors; Todo split workspace; Task conversation/details composition; Board; Settings; responsive navigation and empty/loading/error/disabled states. Document source anchors and explicit monos adaptations.
- Update frontend index, component, directory and quality guidelines to require the visual contract; define exceptions for native semantic HTML and custom domain compositions. Forbid arbitrary per-page colors and global overrides that silently defeat primitive variants. Keep components on demand, not a bulk library install.
- Browser acceptance should inspect representative desktop 1440x1000 and mobile 390x844 views against the chosen reference, include populated/empty/error/long-content states, and record intentional deviations. Preserve functional keyboard/focus/draft/recovery checks.

## Task alignment map (proposed, not applied)

| Task | Required update |
| --- | --- |
| `09-30-a-execution-ui` | Explicit visual contract for Board and Task sections, shared shell/components, responsive states and inspected screenshot evidence; populate manifests during its planning gate. |
| `09-28-a-task-execution` | Cross-child frontend acceptance and prerequisite link to visual baseline/migration evidence. |
| `09-30-a-task-execution-acceptance` | Verify actual execution UI meets visual contract alongside canonical behavior. |
| `09-28-a-review-delivery` | Require later review/diff/acceptance/recovery screens to use the same visual system in child planning. |
| `09-28-a-integration-acceptance` | Stage A gate includes coherent Todo→Task→Review screenshots and shared shell. |
| `09-28-v1-install-operations` | Settings/first-run UI inherits shared visual contract. |
| `09-28-v1-release-evidence` | Release visual coverage is traceable to actual builds/screenshots. |
| Existing Login/Settings/Todos/Discussion/preview/minimal Task screens | Assign explicit migration ownership after scope decision; changing future-task requirements alone will not restyle these screens. |

Archived task evidence remains historical. Do not rewrite completed PRDs to pretend they met a new visual requirement. Preserve all existing backend and domain acceptance criteria.

## Resolved scope decision

The Owner selected specifications and active-task alignment first. Existing-screen migration is a separate future deliverable, documented through a scoped handoff and acceptance dependency. No product files or shared specifications were changed during this audit.
