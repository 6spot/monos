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

The actual `/v1/runner` WSS handshake is Hello → Welcome → inventory/reconciliation/discovery → Ready. `app.ts` polls every250 ms after Welcome, so `PublicationPreparation.pending(runnerId, incarnation, supported): Promise<Frame[]>` must return `[]` before any transaction when `supported` is false. Native version discovery may take several polls. Capability is advertised only after successful Ready processing. Once supported, pending retains connected+ready, exact incarnation/backend instance and heartbeat freshness checks; this early no-work return grants no dispatch authority.

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
`postgres-publication.test.ts` must exercise actual TLS WSS with at least two polls before Ready: only Welcome frames, socket remains open, no delivery sent timestamps. Its direct pending test asserts unsupported/no-side-effect behavior, supported not-ready/stale-incarnation/foreign-instance rejection, and subsequent current Ready dispatch.

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
