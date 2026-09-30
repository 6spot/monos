# Deferred existing-screen visual migration

## Status and ownership

The Owner selected standards/task alignment first on 2026-09-30. Existing-screen migration is deferred: no migration task has been created or started by this work. A future independently planned frontend migration leaf owns the surfaces below; the Task execution parent coordinates the integrated evidence gate. This handoff records scope, not implementation authorization or completion.

## Scope

- Shared shell, compact navigation, page header/toolbar and semantic tokens.
- Login and existing Projects/Roles/Execution/GitHub settings.
- Todo list/detail, Original Capture, Discussion and composers.
- Task preview and existing minimal Task detail.

Use the [visual contract](../../spec/frontend/visual-design.md), [component rules](../../spec/frontend/component-guidelines.md) and [quality gate](../../spec/frontend/quality-guidelines.md). Preserve all current command identity, drafts, session, conflict and recovery behavior. Do not add backend capabilities or claim unimplemented execution controls.

## Ordering and shared seams

Before UI implementation, create and plan the migration leaf separately, assigning ownership of shared styles/forms/app shell. Coordinate those shared files with the Execution Board and Task control UI leaf to prevent conflicting implementations. The execution UI leaf owns new Board and full Task control surfaces; it does not silently inherit a rewrite of every existing screen.

The standards must exist before either visual implementation starts. Shared shell/primitives should be delivered before dependent new surfaces integrate. Backend work may continue independently. Task execution integrated visual acceptance, Stage A visual acceptance and release visual acceptance require both migrated existing screens and the new UI evidence. Until a migration task is linked and its evidence passes, that visual gate remains outstanding.

## Acceptance handoff

- New migration PRD includes actual shared-file ownership and dependency links to the execution UI task.
- Existing surfaces use the neutral tokens, shared chrome, typography and owned controls; global primitive overrides and per-page palettes are removed in its scope.
- Inspected 1440×1000 / 390×844 screenshots cover representative populated/empty/error/long-content views, with source/build identity, reference comparison and documented deviations.
- Keyboard navigation, mobile back/menu access, labels, focus, retained drafts, version conflicts and uncertain-command recovery remain correct.
- Functional evidence and visual evidence are reported separately; no archived historical task is rewritten to imply compliance with this newly adopted standard.
