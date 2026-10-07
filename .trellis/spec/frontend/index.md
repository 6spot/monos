# Frontend Development

Current stage: [pre-use development](../../../docs/12-product-naming-and-upgrades.md). Historical architecture, version and data compatibility are not required; implement and verify the current version. Current-run recovery and ownership contracts still apply.

Status: protected Owner configuration, Todo capture/organization, ordered Discussion and scoped execution reads are implemented in `apps/web`. Exact Task preview/creation, Execution Board and the Task workspace are implemented; current-task functional and visual gates remain recorded in task verification artifacts. Sources: [UI](../../../docs/07-owner-review-and-ui.md), [technology](../../../docs/11-technology-and-deployment.md).

The [visual contract](visual-design.md) governs the shared neutral shell, controls
and screen interiors. Board/Task and existing-screen migration have separate task
evidence; source changes alone do not establish their final visual acceptance.

## Pre-Development Checklist

- [Visual design](visual-design.md): Multica reference, measurable tokens/layout and responsive states.
- [Structure](directory-structure.md): destinations and dependency boundaries.
- [Components](component-guidelines.md): shadcn/ui + Base UI, accessibility.
- [Hooks](hook-guidelines.md): queries, commands and stream cleanup.
- [State](state-management.md): canonical facts versus local UI state.
- [Execution UI](execution-ui.md): scoped storage, exact controls, session binding and histories.
- [Result content reads](../backend/result-content-reads.md): on-demand exact file/diff inspection, fresh applicability, session fencing and text bounds.
- [Publication candidates](../backend/publication-candidates.md): current/history scans, exact finding receipts, retained public exposure and local retry.
- [Remote preparation](../backend/remote-preparation.md): immutable operation history, current-head checks, original-effect reconciliation and terminal cleanup Retry.
- [Types](type-safety.md): generated contracts and runtime validation.
- [Quality](quality-guidelines.md): interaction and reconnect assertions.
- Command changes also read [protocol](../protocol/commands.md) and [delivery](../backend/delivery-contracts.md).

## Quality Check

Use one Base UI component family, add components/dependencies only as needed, preserve keyboard/focus behavior, and reflect server authorization. No optimistic formal state transitions. Later chat does not disable Retry or stall accepted delivery. Run established frontend checks once scaffolded; document unavailable checks truthfully.
