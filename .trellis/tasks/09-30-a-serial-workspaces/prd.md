# Authorized Project repositories and serial Task workspaces

## Goal

Open a real Project repository lazily and retain one serial Task workspace across Attempts.

## Requirements

- Canonical Tasks with no legacy fixture resource use active Project resources and bounded launch path reservations. Agent input supplies only resource_id.
- Persist exact nonsecret operation/workspace/lease identity, fixed base and branch target; duplicate opens and reconnect restore the same workspace.
- Use service-owned read-only caches and uncredentialed execution workspaces. Public GitHub access requires verified public metadata; configured App access uses a repository-scoped contents-read token and never falls back anonymously.
- Preserve dirty/private work and trusted Git lineage through Stop, failure and fresh Attempt reuse. Cancel an unexposed failed open through explicit admitted Stop so recovery cannot deadlock.
- Keep exact legacy fixture receipts readable while denying fixture fallback and Planner inspection for canonical Tasks.

## Acceptance criteria

- [x] An authorized real GitHub resource opens through the native Tool Protocol without reading fixture.git; different requests return one stable Task/resource workspace.
- [x] Real PostgreSQL tests cover admission/removal/default races, scope/lease guards, same-request recovery and atomic receipts/results; Git/Runner fault tests preserve pinned base and ownership across each durable boundary.
- [x] Native Linux two-account evidence proves cache/credential isolation, stable workspace across Attempts, preserved dirty work and no duplicate writer or remote publication.
- [x] Existing protocol, backend and Runner regression gates pass; unavailable credentials/refs/storage have explicit recoverable outcomes and Stop remains usable.

## Dependency and scope

Follows [Capture and Discussion](../09-28-a-capture-discussion/prd.md).
Parent links express ownership; this ordering is an evidence gate. The Owner has
authorized sequential execution and routine implementation/test decisions.
No new permanent service, team model, generic workflow engine, automatic Runtime
hang inference, mandatory native session resume or cross-Runner migration.

Task Start/context scheduling, managed Artifacts, Task Conversation, revision/Replan,
execution UI and delivery are later leaves. Planner repository inspection remains
Stage B. This native slice uses the already-authorized public GitHub test repository;
public access does not establish a live private-token claim. Private token scope,
expiry/error handling and non-persistence receive deterministic integration tests;
real private access requires Owner-configured App credentials and separate evidence.
