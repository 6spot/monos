# Visual design: Multica application workspace

## Scope and reference

The [product UI contract](../../../docs/07-owner-review-and-ui.md) selects Multica's application workspace as the visual/layout reference. Apply this spec to new frontend work and explicitly scoped migration. The existing
screen migration now implements neutral interiors alongside Board/Task; acceptance
is recorded with inspected current-build evidence in the owning task. The previous
green-theme presentation is historical, not a pattern to reintroduce.

Reference inspected on 2026-09-30: local Multica checkout, HEAD `44ea3b40c8b4f54f4c76d1dd3e3c92e0c0cabd19`. The observations below came from working files; they are not a guarantee the checkout was clean. Reference paths:

- `packages/ui/styles/tokens.css`: neutral surface tiers and semantic typography.
- `packages/views/layout/page-header.tsx`: shared 16px gutter and 48px header/toolbar.
- `packages/views/layout/collection-page.tsx`: compact icon/title/count/actions and shared empty states.
- `packages/ui/components/ui/sidebar.tsx`: 256px desktop navigation baseline and mobile sheet.

This document is self-contained for implementation; the reference checkout is supporting evidence, not a runtime dependency. Reuse the visual approach without importing Multica teams, organization navigation, landing-page styling, or unrelated functionality. Do not require theme switching, sidebar resizing, or another component library solely because the reference includes it.

## Surface and token contract

Use semantic CSS variables exposed through Tailwind. Define values once in Web styles, then consume them in primitives and feature compositions. The following is the light-theme target, adapted from the reference; existing variable names may be retained through aliases if there is only one value authority.

| Token | Target / meaning |
| --- | --- |
| `--app-shell` | `oklch(0.964435 0.001327 286.375)`, quiet neutral outer navigation/frame |
| `--page-canvas` | `oklch(0.988087 0 0)`, lists, Boards and conversations |
| `--surface` / `--surface-raised` | white; bounded groups / ephemeral overlays |
| `--surface-hover` | `oklch(0.967 0.001 286.375)` |
| `--surface-selected` | `oklch(0.95 0.002 286.375)`; accompany selection with semantic state |
| `--foreground` | `oklch(0.141 0.005 285.823)` |
| `--muted-foreground` | `oklch(0.505 0.016 285.938)` |
| `--border` | `oklch(0.92 0.004 286.32)`; thin separators |
| `--primary` | `oklch(0.21 0.006 285.885)` with near-white foreground |

`--background` maps to page canvas; card/popover/sidebar tokens map to their semantic tiers. Use success/warning/destructive tokens for factual status only, not a green wash across navigation, text and surfaces. Keep focus rings visible and check actual text/focus contrast on composed surfaces. Never use color alone for status, error or selection.

Use a 4px spacing scale (4/8/12/16/24/32) and shared tokens for repeated geometry. Standard controls/groups use 6–8px corner radii; larger dialog/group radii may be 12px. Keep ordinary lists flat with separators; use bounded surfaces only for meaningful groups. Reserve pronounced shadow for overlays; a subtle group shadow may use `0 1px 2px rgb(15 23 42 / 0.04)`. Do not wrap every section in a large floating card.

## Typography and chrome

| Role | Font size / line height |
| --- | --- |
| Caption / metadata | 12px / 16px |
| Label | 13px / 18px |
| Body / compact page title | 14px / 20px |
| Long conversation text | 15px / 22px |
| Small section title | 16px / 24px |
| Section title | 18px / 28px |
| Dialog title | 20px / 28px |

Use a shared sans-serif stack with appropriate system/CJK fallbacks. Multica uses Inter, but adding a font dependency is not required for this task. A restrained medium-weight title belongs in page chrome; avoid recurring 32px marketing-style headers and uppercase eyebrow blocks on working views.

Desktop shell uses a roughly 256px navigation column and a flexible main region (`min-width: 0`). Page headers and immediate toolbars use 48px height and the same 16px horizontal gutter; title, list content and toolbar edges align. Place actions at the trailing edge; allow the title to truncate while keeping controls reachable. Detail/form interiors may use 16–24px padding for readable content; document justified deviations rather than changing the shared gutter page by page.

Use compact 32–36px desktop controls where appropriate; provide at least 44px touch targets for primary mobile interaction. Responsive multi-line content may grow instead of being forced into a fixed height.

## Surface composition

| Surface | Required layout and behavior |
| --- | --- |
| Navigation | Neutral shell; compact icon/label rows and visible selected state. Keep monos navigation and Settings grouping. |
| Todo workspace | Desktop list and selected Discussion share one workspace. Original Capture is distinct from messages; composer stays reachable. Small screens drill from list to detail with an explicit way back and scoped drafts preserved. |
| Execution Board | Compact header/filter toolbar, clear status columns/cards and attention indicators. Preserve canonical status mapping from the state spec. Mobile adapts columns or scrolling within the Board while actions remain reachable. |
| Task detail | Compact identity/status/actions; Conversation, Overview, Timeline and diagnostics remain distinct. Keep effective Specification and exact proposals readable. Logs and DAG remain diagnostics, not default progress UI. |
| Settings | Shared shell/chrome; aligned labels and controls, meaningful form sections and clear save/recovery state. Avoid independent visual skins for Projects, Roles, Execution and GitHub. |
| Login | Neutral palette, readable labelled form and focused sign-in action; use the same component tokens without requiring authenticated navigation. |

At compact widths (below 768px as the baseline), replace the permanent navigation column with an accessible menu/sheet trigger. Preserve keyboard focus and return, browser navigation and scoped editor/composer state. A small screen must not hide the only route back to navigation. Allow intentional contained Board/code scrolling; prevent accidental page-wide horizontal overflow.

## Components and examples

Follow [component guidelines](component-guidelines.md): shadcn/ui + Base UI source owned by Web, added on demand. Native semantics inside those primitives and domain compositions remain valid. Keep visual variants in shared components and lifecycle commands in features.

Illustrative target composition, not currently installed exports:

```tsx
<PageHeader>
  <h1 className="min-w-0 flex-1 truncate text-body font-medium">Execution</h1>
  <Button size="sm" variant="outline">Filter</Button>
</PageHeader>
```

Correct: `bg-surface text-foreground border-border` consume shared semantic tokens; a shared row component renders hover/selection/focus consistently.

Incorrect: each feature defines its own green/gray hex colors, header padding, input styling, or a global `[data-slot=button]` override that defeats size variants. Installing Button alone does not satisfy the whole visual contract.

## State and acceptance matrix

| Case | Observable requirement |
| --- | --- |
| Populated | Consistent shell/chrome, clear hierarchy, aligned gutters and usable actions |
| Empty | Same shell; concise explanation and relevant action, without marketing-style decoration |
| Loading / queued | Factual state, stable layout, usable independent controls; no fabricated percent or ETA |
| Error / uncertain | Concrete reason and available recovery near the affected action; drafts remain visible |
| Disabled | Reason is available without relying on color or a hover-only tooltip |
| Long content / mobile | Wrapping or purposeful truncation, full important content accessible, composer/actions reachable |

Use the [quality gate](quality-guidelines.md) for inspected desktop/mobile screenshots, reference comparison, build identity and intentional deviations. Preserve keyboard, focus, reduced-motion and functional recovery checks. Neither this spec nor historical screenshots establish completed migration.
