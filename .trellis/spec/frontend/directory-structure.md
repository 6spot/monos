# Frontend Structure

Sources: [layout](../../../docs/11-technology-and-deployment.md), [information architecture](../../../docs/07-owner-review-and-ui.md).

## Destination and ownership

Web lives in `apps/web`: a React/Vite TypeScript SPA served by the backend under the same origin. It consumes API contracts from `packages/protocol`, never `packages/db`, server secrets or Runner filesystem paths.

Current organization:

```text
apps/web/src/
  app/             # providers, navigation, route composition
  features/        # projects, roles, execution policies, GitHub
  components/ui/   # owned shadcn Base UI source
  lib/             # API/stream adapters and genuinely shared utilities
```

The four settings views use URL hash navigation in `app/app.tsx`. Hidden mounted views preserve scoped drafts. `lib/api.ts` validates reads/receipts and `lib/use-command.ts` retains pending commands. Keep feature queries, local components and behavior together. Extract shared components only for stable repeated contracts.

## Product surfaces

Todo list + selected Discussion remain one desktop workspace, responsive to small screens. Execution Board owns execution attention. Task detail separates Conversation, Overview, Timeline and diagnostics. Settings owns Roles/Planner/Runtime configuration. Do not add a duplicate Activity dashboard, a normal-user DAG or a business Team layer.

## Shared visual ownership

Apply the [visual contract](visual-design.md) through the app shell and shared page header/toolbar primitives under `components/`; keep owned shadcn primitives in `components/ui/`. `styles.css` owns semantic theme and typography tokens plus document-level resets. Feature components compose these primitives and own domain-specific list, Board and conversation layouts; they must not redefine the global palette or page chrome. These are target responsibilities for migration/new UI, not a claim those shared layout components already exist.

Keep Todo selection/drafts and Task routes intact when changing layout. Visual similarity to Multica must not introduce a new route, state store or product entity by itself.

## Dependency rules

Use shadcn with Base UI and Tailwind. Add only necessary components and inspect generated changes. Do not create an empty universal design-system package before reuse warrants it. A client router or rendering library must be chosen for concrete requirements, not assumed installed by this spec.

Wrong: a Task component imports a Drizzle table.
Correct: it renders a validated API projection and invokes authenticated commands.
