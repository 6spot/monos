# Existing-screen visual migration

## Goal

Make Login, Settings and Todo/preview interiors coherent with the accepted neutral
Execution Board and Task workspace, while retaining all existing command/recovery
and scoped-draft behavior.

## Background and ownership

Follows [Execution UI](../09-30-a-execution-ui/prd.md), accepted in
`d28fd8b`, and precedes [execution integration acceptance](../../../09-30-a-task-execution-acceptance/prd.md).
This leaf completes the outstanding interiors from the
[original migration handoff](../../2026-09/09-30-frontend-visual-standards/migration-handoff.md).
The predecessor supplied shared neutral tokens, shell/mobile navigation, PageHeader
and owned controls. Remaining green skins, oversized headings and native field
skins are in existing interiors. The Owner's standing authorization covers routine
planning, implementation, review, test and commit decisions without repeat approval.

## Requirements

1. Reuse the frontend visual contract and owned shadcn Base UI controls for Login,
   Projects, Roles, Execution/GitHub settings, Todo list/detail, Original Capture,
   Discussion and preview. Consolidate obsolete global styles; retain one semantic
   token authority, compact chrome and meaningful flat sections/bounded groups.
2. Preserve authenticated session behavior, exact immutable requests/receipts,
   two-client conflict handling, original command basis and per-record/Todo drafts.
   Keep existing views/controllers mounted; no new command on navigation/mount.
3. Keep Todo list and selected workspace together on desktop; mobile list/detail
   back and navigation remain accessible. Original Capture is distinct from chat;
   full important messages/proposed Specification remain readable. Compose quiet
   empty, queued, unavailable, error and uncertainty states with reachable actions.
4. Retain Project/Role/policy/provider meaning, private-key clearing and keep-current
   behavior, fieldset locking while saves are uncertain, labelled keyboard controls
   and explicit reload/save. Use existing snapshots without new configuration APIs.
5. Verify Login/Settings/Todo/preview and downstream Task/local REVIEW share coherent
   typography, surfaces, chrome and controls at desktop and mobile widths. Preserve
   all accepted Task recovery/control semantics and honest local-result labels.

## Acceptance criteria

- [x] All scoped interiors use neutral semantic surfaces, shared compact headings
  and owned controls; obsolete global primitive overrides/green skins are removed.
- [x] Actual-build1440×1000 and390×844 screenshots are inspected for populated,
  empty, loading/queued/disabled, error/uncertain and long-content states, with
  source/build identity, reference comparison and intentional differences recorded.
- [x] Existing browser regression passes: keyboard/focus/mobile back/menu, passive
  capture, scoped drafts, exact uncertain recovery, conflicts, session cleanup and
  downstream Task controls. Added checkbox integration preserves disabled locking.
- [x] Combined Todo→preview→Task→local REVIEW presentation is coherent with accepted
  execution evidence; fixture screenshots are not claimed as native execution.
- [x] Relevant lint/type/unit/protocol/build checks and independent full-scope review
  pass; test schemas are cleaned and no new permanent service is introduced.

## Out of scope

No backend execution/API/schema capability, Task lifecycle/command-hook redesign,
Todo persistent storage, new routing/state library, Role/team taxonomy, delivery
feature, Runtime installation or native integration acceptance. Existing product
contracts decide behavior; this leaf changes presentation and its verification.
