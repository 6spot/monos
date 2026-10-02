# Existing-screen visual migration

## Goal

Make existing Login, Settings and Todo/preview interiors coherent with the neutral
shared shell and controls delivered by the Execution UI leaf.

## Scope and ordering

This separately planned leaf follows [Execution UI](../09-30-a-execution-ui/prd.md)
and precedes [execution integration acceptance](../09-30-a-task-execution-acceptance/prd.md).
It implements the outstanding interiors from the
[original migration handoff](../archive/2026-09/09-30-frontend-visual-standards/migration-handoff.md).
The execution leaf owns shared shell/tokens/chrome/mobile navigation and primitives
needed for Board/full Task. This leaf owns Login, Projects/Roles/Execution/GitHub
settings, Todo list/detail, Original Capture, Discussion, preview and remaining
legacy forms/styles. Shared files may be refined after the execution leaf is closed.

## Requirements

- Apply the frontend visual contract to these existing interiors, retaining their
  exact authenticated command, conflict, uncertainty and scoped draft behavior.
- Preserve Todo capture/open without Planner execution, source navigation, selection,
  mounted editors and terminal independent-Task semantics.
- Remove remaining legacy visual overrides in this scope; use owned shadcn Base UI
  controls and the shared neutral palette/chrome rather than feature palettes.
- Keep backend execution capabilities unchanged; this is not a delivery feature.

## Acceptance

- [ ] Inspected desktop 1440×1000 and mobile 390×844 screenshots cover populated,
  empty, error/uncertain and long-content states against the Multica-derived contract.
- [ ] Keyboard/focus, mobile navigation, original drafts, version conflicts and
  immutable request recovery pass the full existing browser regression suite.
- [ ] Combined Todo→preview→Task→local REVIEW presentation is coherent alongside
  accepted new-execution UI evidence; no screenshot-only claim of native execution.

## Planning status

Backlog only. Complete research, design, implementation plan and curated context
before activation. Standing Owner authorization covers routine task progression.
