# Technology & Deployment

This is the accepted technology baseline. Modules 01–08 own domain and execution contracts; this document owns their concrete implementation mapping. Module 09 defines the first executable slice and module 10 its verification gates. Stack selection does not imply that the runtime/isolation feasibility probes have passed.

## Selected stack

| Area | Selection | Responsibility |
| --- | --- | --- |
| Web | React, Vite, TypeScript | Responsive Owner workspace and review UI |
| UI primitives | Tailwind CSS, shadcn/ui components added on demand, Base UI primitives | Repository-owned components and styling |
| Server data in Web | TanStack Query | Cached reads, invalidation and reconnect refresh |
| Backend | Node.js LTS, Fastify, TypeScript | Authenticated commands, domain services, orchestration and delivery coordination |
| Primary database | PostgreSQL | Canonical records, claims, receipts, events, outbox and projections |
| Database access | Drizzle with reviewed SQL migrations | Typed queries and explicit SQL where locks/transactions require it |
| Runner | Go, independently built daemon | Runtime adapters, native process supervision, workspace effects and local recovery |
| Agent command client | Go `monos` CLI bundled with the Runner release | Attempt-scoped HTTPS Tool Protocol calls through native Agent command tools |
| Execution host | Linux with Owner-installed/authenticated Agent CLIs | Native process execution and durable host workspace storage |
| Git | System Git CLI invoked with structured argument arrays | Clone/fetch, worktrees, revision capture, integration and authorized push |
| Remote delivery | GitHub App integration behind a provider adapter | Repository access, PR/checks and guarded merge |
| Initial deployment | Docker Compose for backend/PostgreSQL; host Go daemon managed by systemd | One Linux host initially, separate control and execution boundaries |
| Tests | Vitest, Go testing/race detector, Playwright | Domain/protocol checks, Runner supervision and Owner flow verification |

Use supported stable releases and pin concrete versions in lockfiles, `go.mod`, and deployment image references at scaffolding time. Do not equate the architecture decision with a commitment to an unverified package version.

### Dependency policy

Keep external dependencies small and justified. Prefer platform/standard-library APIs and already-selected packages when they meet the requirement. Add a package only for a concrete need, recording its purpose, why the existing stack is insufficient, runtime/transitive cost and maintenance status. A mature parser, database driver or accessible interaction primitive can justify a dependency; dependency minimization is not a reason to build an unsafe substitute. Do not preinstall libraries for hypothetical future work.

Use shadcn/ui with Base UI as the frontend component baseline. Select the Base UI preset explicitly during scaffolding and retain its configuration in the Web package. Add only components required by the current slice and inspect their source/dependency changes. Keep generated component source in the Web package; do not add Radix alongside Base UI or a second full component suite for the same interaction. shadcn components may have runtime dependencies, including `@base-ui/react`; owning their source does not make them dependency-free. Forms retain native HTML semantics and local React state; their visible controls use repository-owned shadcn components on demand, following the [component rules](../.trellis/spec/frontend/component-guidelines.md). Native elements inside those components, semantic page structure, and documented domain compositions remain appropriate; native semantics do not authorize a separate per-page visual system. Follow the [Multica-derived visual contract](../.trellis/spec/frontend/visual-design.md) for presentation. Server state uses the selected TanStack Query, and simple motion uses CSS. Add form, global-state, animation, date or utility packages only when actual requirements justify them. Do not add a monorepo build orchestrator, external queue or orchestration framework to the baseline.

Official setup reference: [shadcn Base UI support](https://ui.shadcn.com/docs/changelog/2026-01-base-ui) and [Base UI Dialog](https://ui.shadcn.com/docs/components/base/dialog). Recheck the supported CLI syntax when scaffolding; the project chooses Base UI explicitly rather than relying on a changing CLI default.

## Runtime topology

```text
Browser: React SPA
    │ HTTPS commands / reads + SSE updates
    ▼
Fastify backend (TypeScript modular monolith)
    ├─ Project / Role / Todo / Task services
    ├─ Planner context and Tool Protocol
    ├─ Orchestrator and Runtime policy/claims
    ├─ Workspace operation coordination
    ├─ Delivery coordinator + GitHub adapter
    ├─ outbox/background workers
    └─ PostgreSQL
    ▲
    │ Runner-initiated authenticated WSS connection
    │ versioned commands, replies, heartbeats and events
    ▼
Go Runner (Linux host service)
    ├─ Runtime discovery / CLI adapters
    ├─ native process supervision and local effect journal
    ├─ Workspace Manager / system Git operations
    └─ native Attempt processes
          ├─ Owner-installed Agent CLI and its existing authentication
          ├─ assigned host workspace/scratch directories
          └─ bundled monos CLI → backend HTTPS Tool Protocol
```

Planner is semantic Agent work executed through the same Runner/CLI infrastructure as Node work. Backend Planner code builds context and validates formal results; it does not silently replace Planner execution with an unrelated direct model API loop.

The backend and Runner are separate executable/deployment units from the first implementation. Backend services are modules, not microservices. Background workers initially run with the backend and may later run as another process from the same application code, using the same PostgreSQL guards.

## Concrete communication choices

- Web uses HTTPS JSON APIs. SSE carries persisted/provisional UI updates with resumable cursors; clients refresh authoritative state after gaps. A live connection is never lifecycle authority.
- Runner initiates WSS to the backend, avoiding a required public inbound Runner port. RPC-style envelopes over that connection carry correlation IDs, stable operation IDs, schema versions and current ownership. Backend Workspace reads are routed through this service boundary rather than opening host paths.
- Agents invoke the `monos` command on PATH through their native command-execution tools. This Go executable ships with the Runner release and sends scoped HTTPS Tool Protocol commands to the backend (module 05). Runner configures its managed path, backend address and private Unix-domain socket at launch. The existing daemon validates CLI peer process birth/boot identity and cgroup membership against dispatch ownership, persists immutable request envelopes and supplies scoped credentials (module 05); no separate package-manager install, MCP server, or MCP registration is required. Command invocation is on demand and does not add a resident service. Runtime Adapter process/session transport remains separate from this command path.
- PostgreSQL outbox rows are committed with control transitions. Workers poll/claim bounded batches with transactional guards; notifications may wake workers but are not durable queue truth. No Redis, Kafka or Temporal is required in the baseline.
- Keep large logs/content off the small command-response path: batch events, apply backpressure, and use authenticated HTTP transfer when needed. Runner-local spooling and acknowledged cursors remain mandatory.

Canonical cross-language payload definitions live as versioned JSON Schemas in `packages/protocol`. Generate TypeScript/Go transport types from those definitions and check generation drift in CI. OpenAPI describes the HTTP surface using those contracts. Neither Go structs nor handwritten TypeScript interfaces are an independent wire-format authority. Schema validation does not replace domain transition validation.

## Native execution and local persistence

The Go daemon directly invokes an installed host CLI with a resolved executable path, structured arguments, working directory, and controlled environment. It runs execution under the configured host account with that CLI's existing Owner-managed authentication. monos does not require an execution container, execution image, reinstall, or new container-specific login.

Each Attempt has supervised native process identity bound to dispatch/Attempt IDs, a process group or service scope, log streams and a durable start record. The Linux implementation must demonstrate process-tree termination and restart reconciliation, including escaped/background descendants; a single child PID or a shell `kill` alone is insufficient. Use the local journal and process birth/supervisor identity to reconcile uncertain starts without spawning duplicates. The concrete supervisor mechanism is selected by the feasibility probe.

Runner creates separate workspace/scratch directories and grants each Attempt its reserved workspace paths at launch (module 03). `open_workspace` lazily clones/materializes the repository inside those paths; serial work may reuse the Task Workspace, and parallel work uses private Node worktrees. The Runtime's native tools then read/write/build/test in those host paths. A worktree separates code state; it is not a container or a security sandbox.

Use supported CLI-native permission/sandbox settings and host account permissions. Keep backend state and system delivery credentials protected under separate service identities. Native execution uses the permissions of its configured account, so monos does not claim arbitrary-code containment or protection from credentials independently available to that account. A stricter sandbox can be an explicit future execution-environment option without changing Task/Node/Attempt semantics; it is not a prerequisite for using an already-installed CLI.

The V1 baseline permits normal CLI shell execution and Node workspace writes, following the native-runtime approach observed in Multica. Do not add a monos shell-command allowlist, global read-only mounts, or private PID namespaces as prerequisites. Cgroup supervision provides process ownership/freeze/kill; separate service/execution accounts protect monos credentials. Planner inspection uses service-owned immutable snapshots that the execution account can read but cannot modify. These are distinct responsibilities, not a promise to sandbox all execution-account activity. CLI-internal configuration/dependency maintenance is part of the installed Runtime's behavior; avoid inventing a filesystem sandbox solely to suppress it.

Runner's durable journal uses local SQLite for operation metadata and immutable CLI request envelopes, plus filesystem spool files for logs. Request records include original attribution, schema/version guards, full payload or pinned immutable content, digest and send/receipt reconciliation facts; they contain no bearer credentials. Persist them before HTTPS submission, keep them service-private, and retain unresolved records across restart. It is infrastructure bookkeeping, not a second database of Task/Node truth. Git objects, workspaces and journal/spool data live on durable host storage. PostgreSQL remains the canonical product/control database. Backup and disk-loss guarantees remain those in modules 04 and 06.

The Owner installs and authenticates coding tools on the execution host. Discovery verifies the executable and startability under the actual execution account, including its permissions and login context. monos never installs those Runtimes or performs login on the Owner's behalf.

## Host identities and hardening

V1 uses two host identities:

| Identity | Runs | Holds |
| --- | --- | --- |
| Runner service account | Go daemon, journal/spool, per-resource repository caches, credentialed Git operations | Enrollment credential; short-lived provider tokens in memory only |
| Execution account | Agent CLI processes, workspace files, uncredentialed Git operations on workspaces | Owner-managed CLI logins; its current Attempt credential |

The daemon runs as a systemd service with cgroup delegation and the capability to start processes as the execution account. Each Attempt, and each system Git operation on a workspace, runs in its own child cgroup, which provides whole-tree freeze and kill. The feasibility probe confirms this mechanism or replaces it with an equivalent one.

Workspace files belong to the execution account. Finalization and integration run as that account in a system cgroup outside the Agent's tree, after that tree is frozen; this assumes non-hostile Agents, consistent with the V1 containment non-claim. The service account keeps a local bare repository cache per resource, fetched with a short-lived read-only token. Workspaces clone and refresh from that cache without credentials, and their `origin` points at it, so pushing to `origin` fails for lack of write permission; remotes an Agent adds with the Owner's own credentials remain outside this guard (module 05). Delivery imports the finalized result tree and constructs its separate candidate commit with controlled public parents in system-owned storage (module 04). It persists and scans that candidate, then pushes only its explicit delivery ref with a write token; it never publishes internal Agent/operation refs. No mirror/all-ref push is allowed. Each account needs scoped `safe.directory` entries for repositories the other owns. Credentials never appear in process arguments, which other accounts can read through `/proc`; pass them through the service account's environment or an inherited descriptor.

The single-host deployment claims the module-05 boundary only when:

- the execution account is not in the `docker` group and has no passwordless `sudo`;
- PostgreSQL has no host-published port, and backend secrets and Compose files are unreadable by the execution account;
- Agents can reach the backend only through its authenticated HTTPS API.

Runner enrollment checks the conditions it can observe and reports any violation as an unsafe-host fact in Runner status; while one remains, monos does not claim the credential and authorization boundary. Project tests that need containers use a rootless container runtime owned by the execution account, or a separate execution host, never the control plane's Docker daemon.

## Git delivery across the process boundary

The backend owns provider authorization, PR creation/checks, acceptance and merge. Runner owns local Git objects. Backend sends an authorized push operation identifying the exact candidate delivery head, its source workspace/tree manifest, expected published head and delivery branch; the Runner service account executes it from the resource's repository cache, outside the Agent process, and reports a reconciled result. Provider credentials supplied for that operation are short-lived and repository-scoped where supported, never written into Agent-readable repository config, logs or environment; the system worker uses a service identity whose credential storage Agent processes cannot read.

The Runner system service is trusted infrastructure; formal Agent requests still require scoped authorization. A lost push/merge response is reconciled against remote state. The backend never requires the repository directory to be mounted into its own container.

The GitHub App requests Metadata (read), Contents (read/write), Pull requests (read/write), and Checks and Commit statuses (read). Changing workflow files also needs the Workflows permission; without it, preparation fails before any push with an explicit reason.

## Repository layout

```text
apps/
  web/                  # React/Vite client
  server/               # Fastify routes, module services and worker entrypoints
packages/
  protocol/             # versioned wire schemas and generated transport types
  domain/               # TypeScript domain rules; no CLI/filesystem effects
  db/                   # PostgreSQL schema, repositories and SQL migrations
runner/
  cmd/monos-runner/    # Go executable
  cmd/monos/           # bundled Agent command client for Tool Protocol
  internal/             # transport, adapters, supervision, workspace, journal
  go.mod
infra/
  compose/              # backend/database deployment
  runner/               # systemd and host configuration templates
```

Use a pnpm workspace for TypeScript packages and a Go module for Runner. `packages/db` is backend-only; Web consumes API contracts, never database models or credentials. Runner consumes generated protocol types and implements local effects, not a second copy of the Task scheduler. No monorepo build orchestrator is required initially.

## Initial deployment and expansion

One Linux host runs PostgreSQL and the backend via Compose plus the Go host daemon. The backend serves the built SPA for a same-origin Web/API deployment; a TLS ingress terminates HTTPS/WSS and supports SSE. Persist database and Runner data separately. Back up PostgreSQL on a schedule to storage off the host, for example with `pg_dump` or WAL archiving; Runner journal and workspace data remain under the disk-loss limitation in modules 04 and 06. Docker Compose is an application/database packaging choice only; it does not host the Agent CLI. The Go Runner does not require Docker API/socket access. Never expose PostgreSQL to the public network.

Adding machines installs the same Go daemon and enrolls each Runner with the backend. The backend keeps one canonical database and applies Runtime compatibility, capacity and Workspace locality checks. The first multi-Runner milestone distributes separate Tasks; workspace transfer and same-Task distributed execution remain later capabilities with their own verification gates.

The first concrete host CLI/execution account and deployment domain/TLS setup remain environment-specific choices. Owner authentication uses the local-login baseline below. Resolve host/setup details during feasibility before an externally accessible deployment; no public deployment may omit authentication.

## Conversational Task implementation boundary

The selected stack and deployment remain unchanged. Backend Task/Planner modules own durable Task messages, Specification revisions and semantic routing records; Orchestrator owns change settlement and effective pointers. PostgreSQL transactions/outbox serialize admissions and dispatch. Go Runner only executes attributed Attempts, reconciles processes/workspaces, and reports input delivery facts. It does not interpret Owner intent or publish requirement revisions.

Versioned dispatch includes the Specification revision and input/guidance basis. Start with queued follow-up and controlled stop-and-resume on the installed native CLI. Optional live steering is a negotiated Adapter transport feature with per-recipient receipts; it does not require containers, a resident Planner, or another service.

## Single-host installation and first-run contract

Ship a single-host deployment recipe with Compose configuration, reviewed migrations, TLS ingress configuration, persistent-volume paths, Runner/systemd configuration, enrollment and health commands. The recipe may configure monos services and OS identities with administrator authorization; it never installs or logs into coding CLIs for the Owner. A fresh installation must not require hand-written SQL, copying runtime session files, or placing system secrets in an Agent workspace.

Bootstrap in this order:

1. Create persistent backend/database and Runner/workspace locations with the documented service/execution ownership. Configure TLS ingress with an address reachable by both the host Runner and backend/browser deployment. Agent `monos` commands use this configured backend URL, never a container's loopback address or an assumed host-path mount.
2. Start PostgreSQL; run migrations under one migration lock; start the backend only after compatible schema readiness. Serve a same-origin Web/API and health endpoint. SSE/WSS pass through ingress with suitable streaming/idle settings and reconnect support.
3. Provision the sole Owner through a local administrative bootstrap command. The baseline is a local Owner login with a salted password hash and revocable server-side sessions in PostgreSQL; use Secure/HttpOnly/SameSite cookies, CSRF/origin checks and login rate limiting. Provision/reset credentials through an interactive local command, not command-line password arguments or an unauthenticated public setup route. Bootstrap is idempotent and cannot create a second Owner. This avoids making an external identity provider a V1 dependency.
4. Enroll the Runner with a one-use, expiring token issued through the authenticated Owner or local administrative interface. Store its distinct long-lived credential in service-only storage; ordinary daemon restart retains Runner identity and gets a new connection incarnation. Revocation/rotation does not delete unresolved execution ownership records.
5. Discover CLIs under the actual execution account, including its explicit home/login environment and executable paths. Verify non-interactive launch, bundled `monos` commands, structured output and physical Stop using that account, including Planner command access with read-only repositories. The Owner performs CLI login there. A login available only to an administrator's interactive shell does not satisfy this gate. The execution account also needs the project's build/test toolchains; unavailable tools produce actionable failure, not an automatic system-wide installer.
6. Configure Planner policy and at least one reusable Role referencing a verified Runtime. Configure GitHub App credentials/installation and Project repository/default ref/delivery settings, then select the Role for the Project. Verify scoped repository read and delivery permissions independently from CLI login. Capture/discussion can precede a runnable Project; Start reports exact missing prerequisites.
7. Run the Stage A smoke flow against an authorized test repository. Report separate backend/schema, Runner connection/storage, Agent CLI/`monos` command access and Git provider readiness. An HTTP health response alone never means Task execution is ready.

Backend starts independently of Runner availability so the Owner can inspect state, cancel/withdraw and repair configuration while execution is offline. Runner reconnects with bounded backoff; startup does not require a live browser. Templates restart failed services, but process recovery follows recorded ownership rather than blindly restarting every Agent. Initial health checks must not publish or merge in arbitrary repositories.

### Privileged process launch and shared repository access

The service-account daemon needs a concrete authorized path to start/supervise execution-account processes. Package a narrow local privileged launcher using fixed systemd/cgroup launch and stop operations, or an equivalently constrained systemd policy. It validates the Runner service identity, dispatch ID, fixed execution UID, reserved paths and unit ownership; the execution account cannot migrate processes into another Attempt’s supervised cgroup; it never exposes arbitrary root shell execution to the execution account or passes service secrets into the child environment. The helper is Runner infrastructure, not another orchestration service. Verify launch, freeze, kill, daemon restart and host reboot under the actual permissions before accepting the host profile.

Separate read-only repository cache objects from service-private credentials/journal. Grant the execution account traversal/read permission on the required cache repositories and no write permission; service Git can read finalized execution-owned objects through explicit access rules. Scoped `safe.directory` configuration is additional to filesystem permissions, not a substitute for them. Clone via Git transport (`--no-local`) across account ownership, without hardlinks or shared object alternates; do not rely on default local-clone optimizations across owners. Fetch/clone and candidate export must pass a real two-account permission test. Tokens stay outside cache config and Agent-readable files.

### Local resource limits and maintenance

Expose configured execution concurrency and per-process resource limits appropriate to the host. Cgroup limits apply to execution processes so an ordinary build cannot consume all resources needed by the database/backend and recovery services. Shared Runner slots are still the scheduling model; there is no permanently reserved Planner slot. Full capacity leaves chat visibly queued while deterministic Owner controls remain available.

Monitor free space for database volumes, Runner journal/log spool, caches and workspaces. Below configured thresholds stop new dispatch/materialization and report storage attention. If a durable journal/spool write fails, stop or freeze affected execution safely and do not acknowledge unpersisted effects or silently discard required records. Recovery requires restored storage and reconciliation before retry. Cleanup may remove disposable inspection data and acknowledged logs according to retention, but never unresolved-operation records or live/recoverable workspaces merely to free space. Do not automatically delete unrelated host files.

Before actual use begins, follow the [development deployment policy](12-product-naming-and-upgrades.md): validate a fresh current-version installation, without historical deployment/data migration or rollback gates. Replacing a runtime used by an active execution still requires stopping/reconciling its actual writers before reusing their resources. Backups taken for a concrete current-run purpose cover the corresponding PostgreSQL, service configuration and Runner journal/workspaces; a database-only restore cannot claim recovery of missing workspaces. After actual use begins, define migration, backup and recovery scope against the real deployment. Permanent disk loss remains outside V1's execution-recovery guarantee.
