# Runtime policy and GitHub configuration

## 1. Scope / Trigger
Migration 9, execution policy/provider configuration commands, Owner infrastructure reads and optional Runner ready-frame installation reports. Implementation: `configuration.ts`, `github.ts`, `service.ts`, Go host discovery.

## 2. Signatures
- Configuration command names `save_policies` and `save_github`; `save_role` accepts optional `execution_policy`.
- GET `/v1/owner/infrastructure` -> `InfrastructureSnapshot`.
- GET `/v1/owner/github/repositories?page=1` -> bounded `GitHubRepositoryPage`.
- `touch(runnerId,incarnation,ready,runtimes?)`; `ready.runtimes` is an optional complete installation report.
- Field-free helper `{action:discover,attempt_id:""}` runs the fixed version command.

## 3. Contracts
Policy: complete default/fallback targets, optional hard Runner pin, optional manual model/thinking, attention-only duration_budget in seconds (1..604800). Empty Global/Planner fields mean inherit; no Runtime Profile or Role-bound runtime_id. Saved configuration never rewrites existing launch context. Production policy resolution/fallback belongs to the later Runtime integration.

GitHub input: app_id, installation_id and optional write-only private_key (required on initial setup/change of App). RSA >=2048 bits; omit PEM only to preserve the existing App key. AES-256-GCM uses random 12-byte IV, 16-byte tag, version/App/installation associated data and a domain-separated HKDF key from the private service signing secret. Store encrypted key and public-key SHA256 fingerprint; receipts contain only exact-input digest and safe response, never PEM/envelope/token. Service signing-key rotation requires re-entry of provider keys. Backup private service configuration with DB; do not place it in workspaces.

The v1 HKDF salt is fixed bytes `6d6f6e6f6c61622d70726f7669646572` (hex), with
info `github-private-key-v1`. These are current implementation facts. Under the
[pre-use development policy](../../../docs/12-product-naming-and-upgrades.md),
historical ciphertext compatibility is not required: update the current
encrypt/decrypt contract together and recreate scoped development configuration
when it changes. Fresh encryption, binding, JWT and secret-handling checks remain
required. Versioned migration is scoped after actual use begins.

GitHub API host is fixed, redirects forbidden, requests have a 10-second timeout and 1 MiB JSON bound. RS256 App JWT mints an installation token with contents:read and metadata:read; all token material remains in memory. Each GET returns up to 100 repositories and an explicit next_page; no arbitrary URL or network access in DB transactions. Credentials are not installed into coding CLIs. Repository permission/metadata checks do not establish push/merge readiness.

Runner reports replace only that Runner's registry under its current incarnation and backend-instance lock. Missing optional reports retain observations marked non-current after reconnect. Backend restart makes old connections offline until reconnect. Reported timestamps are server time; current/online/availability are separate. Discovery runs only supported OpenCode --version as fixed non-root execution UID/GID with a controlled environment, output bound and deadline/process-group kill. It never accepts a caller path/flag/account, logs CLI diagnostics, launches a model or checks login. Probe helper remains account/path-specific until production host configuration work.

The actual `/v1/runner` WS(S) handshake is Hello → Welcome → inventory/reconciliation/discovery → Ready. `app.ts` polls every250 ms after Welcome, so `PublicationPreparation.pending(runnerId, incarnation, supported): Promise<Frame[]>` must return `[]` before any transaction when `supported` is false. Native version discovery may take several polls. Capability is advertised only after successful Ready processing. Once supported, pending retains connected+ready, exact incarnation/backend instance and heartbeat freshness checks; this early no-work return grants no dispatch authority. Both transports follow [optional HTTP/TLS](../protocol/transport.md).

## 4. Validation & Error Matrix
| Condition | Result |
| --- | --- |
| Pre-Ready or unsupported publication lane | Empty frames; no transaction or delivery mutation |
| Supported lane with stale/not-ready connection | stale_execution; no dispatch |
| Stale config/replay | Existing configuration version/receipt rules |
| Invalid/missing new App key | invalid_input; no partial edit |
| Changed service key/ciphertext binding | unmet_precondition; re-enter key |
| GitHub 401/403 | sanitized access-denied prerequisite |
| Invalid/oversized/network provider response | sanitized unmet_precondition |
| Non-Owner request | unauthorized before provider requests |
| Duplicate Runtime IDs | invalid_input |
| Old incarnation/backend instance | stale_execution; no registry overwrite |
| Version command error/timeout/missing CLI | unavailable/not_found, never login inference |

## 5. Good / Base / Bad Cases
Good: delayed native discovery survives multiple control polls without publication work, then current Ready enables ordinary dispatch. Bad: throw stale_execution for an unadvertised publication lane and close the valid handshake.

Good: manually select a new model without waiting for a cached catalog. Base: disconnected Runner retains its observed installation version. Bad: call a detected version executable-ready, or expose provider private keys in receipts.

## 6. Tests Required
`postgres-publication.test.ts` must exercise actual TLS WSS with at least two polls before Ready: only Welcome frames, socket remains open, no delivery sent timestamps. The server transport tests also cover authenticated HTTP/WS before Ready. Its direct pending test asserts unsupported/no-side-effect behavior, supported not-ready/stale-incarnation/foreign-instance rejection, and subsequent current Ready dispatch.

`postgres-infrastructure.test.ts` covers policy persistence, encrypted key storage/replay, RSA JWT signature, requested read permissions, provider errors/response bounds, invalid keys, key rotation and Runner incarnation/instance/omitted-report behavior. Go discovery tests assert fixed non-root identity/env/argv and bounded version output. Shared fixtures cover complete fallbacks and strict ready reports. Real --version discovery is separate from live model/CLI tool invocation acceptance.

`github-compatibility.test.ts` records an earlier synthetic ciphertext regression.
It is historical compatibility evidence, not a required pre-use gate. Current
encryption/decryption, authenticated binding and provider JWT correctness are
covered by the affected current-version tests.

## 7. Wrong vs Correct
Wrong: execute the Owner-installed CLI as root or expose a generic executable setting to the privileged helper.
Correct: fixed non-root discovery; Owner manages CLI installation/login, and only version facts enter registry.

Wrong: expose a provider key or ciphertext envelope in a receipt.
Correct: keep encrypted key storage private and return only safe fingerprints.

Wrong: check Ready availability before returning from an unsupported publication lane.
Correct: return an empty frame array before the transaction; keep all supported connection and dispatch guards.

## Resource-scoped plain Git HTTPS credentials

[git-https-credentials.ts](../../../apps/server/src/git-https-credentials.ts) and
[migration 33](../../../packages/db/migrations/0033_git_https_credentials.sql) own
plain HTTPS service credential storage. `GitHTTPSCredentials(signingKey)` is the
third optional dependency of `Configuration(db,github?,gitHTTPS?)`. This is separate
from global GitHub App configuration and never installs credentials into Agent
CLIs, Project context or Task resource bindings.

Each row binds immutable resource ID, repository identity and exact remote URL to
username, encrypted token, opaque generation and safe save receipt. AES-256-GCM
uses a random 12-byte IV and 16-byte tag. HKDF-SHA256 uses the provider salt above
with distinct info `git-https-credential-v1`. Canonical JSON AAD binds the purpose,
resource ID, exact remote URL, username and generation. The stable scope digest
binds resource/identity/URL/username and allowed system use `read,observe,push`,
excluding material generation, token and unrelated GitHub configuration. Same-user
token rotation can therefore refresh material for an existing accepted scope.

Inputs require nonempty username (at most 256 Unicode characters) and token
(at most 4096 UTF-8 bytes), well-formed Unicode, no NUL/CR/LF, and no colon in the
username. Tokens stay in memory during encryption/decryption. Public statuses and
immutable receipts contain only resource ID, username, generation and scope
digest. Encrypted tokens are also excluded from public responses. Decryption or
binding failure yields a sanitized prerequisite error and never anonymous retry.

Call `gitHTTPSCredentialScope(tx,resourceId)` and
`GitHTTPSCredentials.authentication(tx,resourceId,expectedScopeDigest?)` while
holding the configuration share lock before Runner/Task locks. Unknown/inactive
resources and nonplain adapters are denied. A missing configured credential allows
anonymous read only when no expected authorization scope is supplied. Configured
access returns `https_basic` with an expiry five minutes ahead, a local grant-use
deadline rather than a statement about upstream token expiry or provider-enforced
read-only/repository-only attenuation. Callers retain exact operation/resource/URL
checks and recheck material generation when crossing an external-I/O boundary.

`verifyGitHTTPSCredentialReceipt` checks historical safe saved evidence against
the current resource/user/scope. SQL `git_https_credential_receipt_matches` checks
the exact safe saved response and optionally its material generation. A deferred
constraint binds current material to its exact configuration receipt in the same
transaction; resource/URL binding is immutable. Rotation preserves historical
receipt truth; clear prevents new credentialed grants. Neither operation releases
physical publication ownership or invalidates historical remote-effect evidence.

`postgres-git-https-credentials.test.ts` covers safe snapshots/receipts, encryption
and cross-resource/material binding failures, receipt/version rollback, same-scope
renewal and replay, missing/foreign receipt rejection, clear/removal denial and
anonymous independence from global GitHub configuration. These are local database
and crypto checks, not evidence of native Runner permissions or real Git service
authentication and write access.

## Local Runner enrollment

[runner-enrollment.ts](../../../apps/server/src/runner-enrollment.ts) owns one-use
grants and exact redemption; [migration 35](../../../packages/db/migrations/0035_runner_enrollment.sql)
stores hashes and immutable consumed request bindings. The local administrative
entrypoint issues capacity 1–32, lifetime 60–3600 seconds and a random 32-byte
token. It intentionally prints the grant only to its administrator. Never expose
an unauthenticated minting route or copy the grant into ordinary logs.

`POST /v1/runner/enroll` is a bounded capability-authenticated exchange, with no
Owner cookie or pre-existing Runner credential requirement. Lock the token row,
retain exact consumed replay before checking unused expiry, and consume with the
database clock after lock acquisition. Create a new offline Runner and receipt
in one transaction; request IDs/credentials cannot substitute another identity or
capacity. Store no raw secrets in PostgreSQL. Exact replay returns only the old
request/Runner IDs and never restores a later changed credential or releases
execution ownership. See [enrollment design](../../../docs/research/runner-enrollment.md)
and [installation recipe](../../../infra/runner/enrollment.md).

## Installation configuration diagnosis

`GET /v1/owner/setup-readiness` authenticates the Owner and reads one repeatable
snapshot, with a shared observation time for all Runner heartbeat facts and
policy decisions. [setup-readiness.ts](../../../apps/server/src/setup-readiness.ts)
reuses the scheduling target/installation/fallback rules without admission locks,
reservations, enqueues or Task mutations. Active Projects use their selected
available Roles. Busy capacity and repository-free work remain valid; GitHub
configuration is not a universal start prerequisite.

`SetupReport` exposes migration/configuration versions, current connection and
installation facts, and exact policy reasons with recovery actions. It always
lists storage, CLI login, model execution and Git read/write as unverified. An
available selection is only an observation. The bounded report cannot include
credentials, Role instructions or partial/truncated collections. The local
[`doctor` command](../../../infra/compose/diagnostics.md) consumes it through a
temporary Owner session and attempts bounded logout after success or failure;
only validated report JSON reaches stdout.
