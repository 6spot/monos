# Frontend visual standards and task alignment

## Goal

Make frontend implementation and acceptance consistently follow the Owner-requested Multica application layout and visual style, using the selected shadcn/ui + Base UI + Tailwind stack.

## Background and decisions

The Owner approved task creation and planning on 2026-09-30, then selected specifications and task alignment first; existing-screen migration is a separate future deliverable. This task changes documentation and task requirements only.

Source-backed audit: [frontend audit](research/frontend-audit.md). `docs/11-technology-and-deployment.md:29` already selects shadcn/Base UI but permits native controls. `apps/web/components.json:3` selects base-nova; only Button is installed under components/ui. `apps/web/src/styles.css:11` defines a green palette; lines 15–16 implement a custom dark green sidebar and spacious card layout. Execution UI and integration acceptance requirements lack concrete Multica visual criteria.

## Requirements

- R1: Make the Multica application workspace the explicit visual/layout reference in the owning product UI document, preserving monos product semantics.
- R2: Clarify shared owned shadcn component coverage, native HTML exceptions, Base UI consistency, on-demand installation and semantic theme usage. Native semantics/local React state must not imply independent per-page visual systems.
- R3: Define concrete neutral surface, typography, spacing, header/toolbar, navigation, list/detail, Board, Task and Settings conventions; specify responsive and interaction states. Distinguish target conventions from existing implementation.
- R4: Update active UI and acceptance task requirements with applicable visual criteria and links. Record ordering and evidence expectations without changing current task statuses or completed historical claims.
- R5: Record the deferred existing-screen migration scope and the requirement that its evidence be available before integrated visual acceptance. Do not silently expand the execution UI leaf to own all existing Settings/Todo work.
- R6: Preserve Tool Protocol authority, canonical state, scoped drafts, recovery, accessibility and monos navigation; Multica is not a source of organization/team/domain requirements.

## Acceptance criteria

- [x] Source audit distinguishes missing rules from implementation divergence and maps affected tasks.
- [x] Owner selected specifications/task alignment only; existing-screen code changes are deferred.
- [x] AC1 (R1, R6): Product UI and technology docs consistently state the reference and stack without changing domain/API contracts.
- [x] AC2 (R2, R3): Frontend visual-design specification contains measurable layout/token conventions, concrete correct/incorrect usage examples and responsive states; frontend index/component/structure/quality guidance links to it.
- [x] AC3 (R4): Each active task in the audit map has applicable requirements/acceptance links; execution UI context manifests include real frontend visual/component/quality entries.
- [x] AC4 (R5): A scoped migration handoff identifies Login, shell, Settings, Todos, Discussion, preview and minimal Task detail, its future ownership and acceptance dependency. No new migration task or implementation begins in this task.
- [x] AC5 (R3, R4): Visual gate requires inspected desktop/mobile screenshots, representative populated/empty/error/long-content states, reference comparison and documented deviations; saving screenshots alone is insufficient.
- [x] AC6: Modified relative links and JSONL entries resolve, diff whitespace checks pass, and review finds no contradictory rules, altered task status or product-code edits.

## Out of scope and deferred items

Existing-screen migration, installing components/dependencies, building a design-system package, changing backend lifecycle or Tool Protocol, copying Multica team/organization concepts, rewriting archived task evidence, and promising rendered equivalence from static inspection. Theme switching, resizable sidebars and Multica-specific interactions are not added solely because the reference has them.

## Artifact status

The Owner explicitly approved the final plan. The task was activated, shared specifications and all mapped active tasks were updated, and migration ownership/evidence dependencies were recorded. Final documentation review and verification passed; work was committed as `99dc7b7` and this task was archived through the project workflow. Existing-screen implementation remains deferred.
