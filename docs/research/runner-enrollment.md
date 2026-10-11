# Runner enrollment

Status: implemented as the first installation/operations slice after `d8f1530`.

The [installation contract](../11-technology-and-deployment.md) requires a
one-use, expiring enrollment token and a distinct long-lived Runner credential.
Existing probe administration inserts a supplied credential directly; this slice
adds the production registration path through a local administrator command and
the Go Runner. It does not establish the deferred native installation gate.

## Boundary and ownership

The administrator issues a bounded grant through a local stdin command with
database access. The backend owns grant expiration, consumption and new Runner
identity. The Runner owns random credential generation, private local intent and
durable credential installation. Existing authentication and connection
incarnations continue to own reconnect and execution recovery.

| Area | Change |
| --- | --- |
| Protocol | Strict issue/grant/request/response and private credential schemas, 4 KiB bounds, generated TS/Go/OpenAPI and shared negative fixtures |
| Backend | Local issuance command, token-hash storage, atomic exact redemption, safe HTTP response and immutable consumed receipt |
| Runner | `enroll --config` command, durable pending request, one atomic identity file and resolved configuration before opening the journal |
| Installation documentation | Concrete private-file recipe and recovery commands using the existing service/execution split |

This slice does not add Web settings, coding-CLI installation/login, credential
rotation/revocation commands, host cleanup or a new Runtime model. No historical
deployment migration is required. Existing explicit-ID probe configurations remain
usable by the current native evidence tooling.

## Exact enrollment and retries

`RunnerEnrollmentIssue` selects capacity 1–32 and lifetime 60–3600 seconds. Local
administration returns a `RunnerEnrollmentGrant` with a random 32-byte base64url
token. Only its hash, capacity and database-clock expiry persist in PostgreSQL;
the grant output intentionally contains the short-lived secret and must be stored
privately. There is no unauthenticated token-issuance endpoint.

Before its first request, the Runner generates another random 32-byte credential
and a request ID and syncs the complete pending intent outside the execution tree.
`POST /v1/runner/enroll` receives that exact request and enrollment capability.
The backend locks the grant, validates an unused grant's expiry using database
time, and creates one offline, unready Runner with a hashed credential. It records
consumption and the exact request binding atomically. Clients cannot choose the
Runner ID or capacity, replace a Runner, or reuse the enrollment token as their
long-lived credential.

Concurrent identical requests return the same `{schema_version, request_id,
runner_id}`. Different requests cannot consume the same token. An exact consumed
retry remains readable after expiry so a lost response is recoverable. It never
rewrites the Runner credential or releases execution ownership. Failed creation
rolls back consumption. Responses and ordinary diagnostics contain no secrets.

## Local persistence

The daemon configuration initially has an empty `runner_id`; `token_file` points
to an absent identity file in a service-owned private directory. Configuration
may remain root-owned. The Runner uses a local process lock and a separate private
pending file bound to the exact configuration, endpoint and TLS trust before any
network request. It rejects a fresh registration when an identity, journal, WAL
or SHM already exists. Registration never opens, clears or replaces the journal.

After validating the exact echoed request ID, it saves the response in the
pending intent and installs one `RunnerCredential` JSON file containing the new
Runner ID and long-lived credential. Publication must not replace an existing
identity. Sync the file and parent before removing pending state. Recovery may
finish a matching partial installation offline; unrelated files, symlinks,
hardlinks or mismatched content are errors. A no-replace link installation must
recognize only its own exact pending-owned temporary link after a crash.

Ordinary startup resolves this private identity into the effective control
configuration before journal or daemon initialization. Every reconnect retains
the same Runner ID and uses the existing incarnation and inventory protocol.

## Verification plan

- Shared TS/Go fixtures reject forged identity/capacity, wrong versions, unknown
  fields, invalid bounds and secret fields in safe responses.
- Real PostgreSQL and HTTP tests cover contention, expiry, exact replay,
  transaction rollback, credential separation and safe errors. New credentials
  authenticate through normal Runner connection code without touching existing
  execution ownership.
- Local file and controlled HTTP/TLS tests cover persist-before-send, lost reply,
  exact retry, partial installation, fresh-host guards, concurrent commands,
  unsafe paths/permissions, malformed or oversized replies, TLS and redirects.
- Integrated typecheck, lint, build, generated-contract drift and affected Go
  checks run after implementation. Native Linux/account/service acceptance
  remains deferred; these checks do not claim an installed host is ready.

## Verification results

- `pnpm test`: 881 passed, including 21 shared enrollment contract cases.
- `pnpm typecheck`, `pnpm lint`, `pnpm build` and `pnpm protocol:check` passed.
  The native Node type-erasure import of the server entry module also passed.
- Real PostgreSQL enrollment suite: 9 passed, including observed lock contention,
  expired queued requests, exact replay after reconnect, credential collision and
  transaction rollback, existing execution ownership, actual HTTP entrypoints and
  the local administrator subprocess. Three affected migration checks also passed.
- Full `go test -race ./...` passed, including the existing Host Git/workspace
  suite (289.570 seconds), enrollment, control, CLI, daemon and wire packages.
  All Runner packages compiled and vet passed. Shared Go enrollment fixtures passed.
- Read-only review closed the recovered-stage data-sync, retained-intent sync and
  journal retry/in-flight gaps. Regression cases preserve original requests,
  reject newly appearing journal/WAL/SHM files and allow cleanup only for the
  exact already-published identity. The journal parent must remain private.

The implementation performs real local file operations and controlled HTTP/TLS;
it does not claim real power-loss durability testing, installed Linux permissions,
native coding-CLI access, provider permission or A06/A30 acceptance.
