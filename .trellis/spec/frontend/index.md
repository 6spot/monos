# Frontend Development

Status: protected Owner configuration, Todo capture/organization, ordered Discussion and scoped execution reads are implemented in `apps/web`. Task preview/creation and the full execution workflow remain later work. Sources: [UI](../../../docs/07-owner-review-and-ui.md), [technology](../../../docs/11-technology-and-deployment.md).

## Pre-Development Checklist

- [Structure](directory-structure.md): destinations and dependency boundaries.
- [Components](component-guidelines.md): shadcn/ui + Base UI, accessibility.
- [Hooks](hook-guidelines.md): queries, commands and stream cleanup.
- [State](state-management.md): canonical facts versus local UI state.
- [Types](type-safety.md): generated contracts and runtime validation.
- [Quality](quality-guidelines.md): interaction and reconnect assertions.
- Command changes also read [protocol](../protocol/commands.md) and [delivery](../backend/delivery-contracts.md).

## Quality Check

Use one Base UI component family, add components/dependencies only as needed, preserve keyboard/focus behavior, and reflect server authorization. No optimistic formal state transitions. Later chat does not disable Retry or stall accepted delivery. Run established frontend checks once scaffolded; document unavailable checks truthfully.
