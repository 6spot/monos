# monos Engineering Specs

## Status and authority

The Stage A foundations implement `apps/server`, `packages/{domain,db,protocol}`, the Go `runner`, Owner configuration in `apps/web`, and deployment recipes under `infra`. Production Runtime integration passed combined real-host acceptance on 2026-09-29. Todo capture/Discussion, exact Task creation, initial planning and Single-Node execution with Artifacts/recovery are implemented. Task Conversation, revision workflows, execution UI and delivery remain later work. These specs connect accepted decisions to implementation; task verification reports distinguish deterministic tests from real Linux/CLI acceptance.

Read [ARCHITECTURE.md](../../ARCHITECTURE.md), the relevant [module](../../docs/README.md), and [invariants](../../docs/08-principles-and-non-goals.md) first. Domain rules belong there; this tree specifies implementation and verification. Update both when an accepted decision changes.

## Layers

| Entry | Destinations |
| --- | --- |
| [Backend](backend/index.md) | `apps/server`, `packages/domain`, `packages/db` |
| [Frontend](frontend/index.md) | `apps/web` (Owner access, configuration and Todo capture implemented) |
| [Protocol](protocol/index.md) | `packages/protocol`; HTTP/WSS/CLI boundaries |
| [Runner](runner/index.md) | Go `runner` and Linux host configuration |
| [Thinking guides](guides/index.md) | Cross-layer changes and reuse |

Keep this layer layout until real package structure warrants changing Trellis configuration. Do not register nonexistent packages. Task context manifests list relevant indexes and contract files.

## Dependency baseline

Follow [technology and dependency policy](../../docs/11-technology-and-deployment.md): React/Vite/TypeScript, Tailwind + shadcn/ui + Base UI, TanStack Query; Fastify, PostgreSQL/Drizzle; Go Runner and bundled CLI. Add only needed components. Do not preinstall Radix, another component suite, global-state/form/animation frameworks, external queues or a monorepo orchestrator.

Prefer standard APIs and existing dependencies. A new dependency needs a concrete use, alternatives, maintenance/version/license review and runtime/transitive cost in the change description. Do not replace mature security, protocol or accessibility behavior with ad hoc code simply to reduce package count. Pin concrete versions during scaffolding.

## Before development

1. Read the layer checklist and owning architecture module.
2. Identify the command boundary and required failure cases.
3. Preserve Task/Plan/Node/Attempt and admission/completion distinctions.
4. Follow [Stage A](../../docs/09-first-executable-slice.md): real Linux/CLI feasibility precedes broad product implementation.
5. Run the affected package checks: root `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm protocol:check`; Runner `go test -race ./...` and `go vet ./...`. PostgreSQL tests use the isolated Compose recipe. Never report an unrun real-host scenario as passing from unit tests.

Documentation is English. Current checks include `git diff --check`, local links, index coverage and unfilled-template scans.
