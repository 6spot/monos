# monos Architecture

This file is the architecture map. Detailed rules live in the linked modules.

## Current development stage

monos is a new project that the Owner has not started using. Until actual use
begins, implement the current design directly: historical API, protocol, schema,
configuration and architecture compatibility are not requirements. Update current
producers/consumers together and validate a fresh development installation;
do not add compatibility layers or old-data migration gates. See the
[development and deployment policy](docs/12-product-naming-and-upgrades.md).
Current execution still requires exact authorization, durable receipts, recovery
and physical workspace ownership. These runtime invariants are unchanged.

## Selected implementation stack

React/Vite/TypeScript Web → Fastify/Node.js TypeScript modular monolith → PostgreSQL (Drizzle/SQL). A separate Go Runner on Linux directly invokes Owner-installed/authenticated host Agent CLIs and supervises their processes and system Git operations. Web uses HTTPS/SSE; Runner initiates a versioned authenticated WSS connection; Agents invoke the bundled `monos` CLI, which sends Attempt-scoped HTTPS commands through the Tool Protocol. No MCP bridge installation or registration is required. PostgreSQL outbox workers handle durable background work.

Initial deployment is one Linux host with backend/database in Docker Compose and a systemd-managed Go daemon. Adding Runners preserves this service boundary. See [Technology & Deployment](docs/11-technology-and-deployment.md) for ownership, repository layout, credentials and the local SQLite infrastructure journal.

## Product flow

```text
Project
  │
  └─ Todo
      ├─ Discussion
      ├─ Working Requirement State
      ├─ Execution Task A
      ├─ Execution Task B
      └─ ...
```

```text
Owner
  ↓
Todo / Discussion
  ↓
Planner
  ↓
Working Requirement State
  ↓  Owner expresses execution intent
Execution Task
  ↓
Planner
  ↓
Execution Plan
  ↓
Orchestrator
  ↓
Node(s)
  ↓
Execution Attempt(s)
  ↓
Runtime Adapter
  ↓
Codex / Claude Code / OpenCode / ...
```

## Execution data

```text
Execution Task   = what is being executed
Execution Plan   = how work is divided and ordered
Node             = durable collaboration/work unit
Attempt          = one concrete runtime execution
Execution Log    = raw execution process
Artifact         = formal semantic output
Task Event       = formal lifecycle history
Current Task State = small rebuildable current-state projection
Timeline         = UI projection of formal events and artifacts
```

## Workspace

```text
Project Context
  ↓
Node
  ↓
open_workspace(resource_id)
  ↓
Workspace Manager
  ├─ shared Task Workspace for serial execution
  └─ isolated Git Worktree for concurrent execution
```

Agents work freely inside the workspace. System state outside the workspace is controlled through the Tool Protocol. Planner inspects repositories only through read-only snapshots.

## UI

```text
Todo / Inbox
  → long-lived things to think about

Todo Detail
  → Discussion + independent Execution Tasks

Execution Board
  → global view of formal Execution Tasks

Execution Task Detail
  → Conversation / Overview / Timeline / Execution Details

Projects
  → long-lived project context and resources
```

The Execution Plan DAG is an internal execution/debugging structure, not normal user-facing UI.

## Code ownership

V1 may run as one application/service with one primary database. These are code/module ownership boundaries, not microservice boundaries.

```text
Project
├─ Project Context / Resources
└─ selected Role IDs

Role Library
└─ reusable Role profiles / execution policy

Todo
├─ Original Capture
├─ Discussion
└─ Working Requirement State
        │
        └─ creates Task with initial Specification revision

Execution Task
├─ Task Conversation
├─ immutable Specification revisions
├─ Execution Plan revisions
├─ Nodes
├─ Artifacts / Task Events
└─ Current Task State projection

Planner
└─ semantic control for Discussion / Task Conversation / requirement changes / Plan / Replan

Orchestrator
└─ deterministic Task / Node transitions and scheduling

Runtime
├─ Runner / Runtime registry
├─ Attempts / Sessions / Execution Logs
└─ Runtime adapters / fallback

Workspace
├─ Task Workspace / Node worktrees
└─ Git finalization / integration / cleanup

Delivery
└─ provider-neutral Git delivery + GitHub V1 adapter
```

Planner does not own execution state. Runtime does not own Task/Node semantics. Workspace does not decide orchestration. Orchestrator does not perform semantic planning.

UI reads canonical records plus rebuildable projections; it must not become another source of lifecycle truth.


## Modules

- [01 Product & Domain](docs/01-product-and-domain.md)
- [02 Planner & Planning](docs/02-planner-and-planning.md)
- [03 Runtime & Execution](docs/03-runtime-and-execution.md)
- [04 Workspace & Git](docs/04-workspace-and-git.md)
- [05 Tool Protocol](docs/05-tool-protocol.md)
- [06 State & Formal Data](docs/06-state-and-formal-data.md)
- [07 Owner Review & UI](docs/07-owner-review-and-ui.md)
- [08 Principles & Non-goals](docs/08-principles-and-non-goals.md)

## Execution consistency contracts

- Task identity persists across requirement changes; Specification revisions are immutable and Task Conversation can invoke Planner throughout delivery. Planner continuity is durable context, not a permanently running process. Task Conversation serves only its current Task; terminal conversations are read-only. New Tasks originate in Todo Discussion as independent execution chains, without inherited Task context.
- Plan revisions own immutable graph membership; stable Task-owned Nodes carry mutable lifecycle and activation generations.
- Rework invalidates current evidence while retaining history and correcting the existing integrated code.
- Replan publication waits for running work and workspace operations to settle, then atomically switches a confirmed graph.
- Workspace ownership includes physical writer isolation; Git/database completion uses recoverable, idempotent operations.
- REVIEW exposes the integrated local result even when remote PR preparation fails.
- Owner confirmations bind exact content/results and are enforced by command authorization. Delivery may partially succeed across repositories.
- Owner acceptance freezes a delivery batch and its input cutoff. Later chat remains available without blocking that batch; subsequent implementation uses an independent Task after delivery. Explicit correction/cancellation obeys delivery guards.
- Delivery exports the exact result tree with controlled public ancestry, scans the actual candidate publication range, and never rewrites already-pushed delivery history. Private execution commits stay internal.
- Owner-blocking control waits — planning issues, review feedback, Replan requests — have explicit Owner exits besides Cancel.

The detailed contracts and transition table live in modules 02–06; they do not introduce new Task states or Agent-authored recovery checkpoints.

## First implementation milestone

[First Executable Slice](docs/09-first-executable-slice.md) defines the single-Runner, single-repository, single-Node loop to implement and verify first, followed by the remaining V1 capabilities and a complete single-host release gate. It is a delivery sequence, not a replacement domain model.

## Deployment and extension boundary

```text
Web / Mobile
    ↓ authenticated commands and reads
Backend control service + primary database
    ├─ domain records / orchestration / authorization
    ├─ delivery coordination and provider adapter
    └─ versioned dispatch / commands / events
          ↓
        Runner instance(s)
          ├─ local Runtime installations / supervised processes
          ├─ workspace materializations / local operation journal
          └─ scoped Agent tool calls back to control service
```

V1 deploys one Runner; the same serializable service boundary applies when co-located. Runtime installation, process, workspace location, and session handles are Runner-scoped. Core Task/Plan/Node identity is location-independent. The control service never reads a Runner path as though it were local.

Expansion order: multiple Runners serving separate Tasks → explicit quiescent workspace transfer → same-Task distributed Nodes. Scheduling across machines requires workspace locality/transport guarantees, not merely free capacity and `runner_id`. See [Runtime & Execution](docs/03-runtime-and-execution.md) and [Workspace & Git](docs/04-workspace-and-git.md) for the owning contracts.

[Architecture Readiness](docs/10-architecture-readiness.md) lists the current extension checks and implementation gates; it does not replace those contracts.
