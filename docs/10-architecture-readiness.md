# Architecture Readiness

This document is a review/gate index. Modules 01–08 own the rules; module 09 owns implementation sequencing. A documented contract is not evidence that its implementation or a third-party CLI has passed verification.

## Current conclusion

The Task / Plan / Node / Attempt separation supports staged expansion without replacing the domain model. Readiness is conditional on implementing the control/Runner, Workspace, authorization, and recovery contracts from Stage A. Merely keeping `runner_id` fields would not be sufficient.

No paper review guarantees freedom from implementation defects. The remaining high-risk assumptions must be exercised before broad product implementation, rather than deferred until multi-Runner rollout.

Apply the [pre-use development policy](12-product-naming-and-upgrades.md): current
execution and service boundaries are required; historical version/data migration
and rolling-upgrade support are scoped only after actual use begins.

## Extension checks

| Concern | Required boundary now | Later implementation | Owning module |
| --- | --- | --- | --- |
| Multiple CLI installations | Policy Runtime ID independent of machine; Registry keyed by Runner/Runtime | More installed Runtime adapters and settings discovery | [03](03-runtime-and-execution.md) |
| Remote Runner | Authenticated, serializable dispatch/events; no Runner database access or backend path reads | Additional machines and placement | [03](03-runtime-and-execution.md) |
| Workspace locality | Logical Workspace ID, recorded host/incarnation/generation; placement rejects unavailable lineage | Transfer manifests and transport | [04](04-workspace-and-git.md) |
| Same-Task distributed work | Node identities remain location-independent; completion requires integrated result | Remote result transport and authoritative integration | [03](03-runtime-and-execution.md), [04](04-workspace-and-git.md) |
| Multiple backend workers | Database claim/receipt guards plus fenced/reconciled side-effect operations | Replicated backend service | [06](06-state-and-formal-data.md) |
| Runner restart and late dispatch | Supervised process identity, durable start intent, connection incarnation and replay guards | Broader reconnect automation | [03](03-runtime-and-execution.md) |
| Current wire contract | Current producers/consumers agree; unsupported required semantics are rejected | Historical migration/mixed-version rollout after actual use begins | [05](05-tool-protocol.md), [development policy](12-product-naming-and-upgrades.md) |
| Parallel Git results | Serialized integration, revision-attributed evidence, final validation when required | Worktrees and distributed result integration | [04](04-workspace-and-git.md) |
| Multiple repositories | Workspace/delivery collections and per-item durable progress | Multi-item preparation/merge and partial-delivery UI | [04](04-workspace-and-git.md), [06](06-state-and-formal-data.md) |
| Artifact/log location | Managed immutable content and acknowledged log cursors; no bare local-path artifacts | Object storage and larger retention tiers | [06](06-state-and-formal-data.md) |
| Concurrent Tasks in one repository | Private Task workspace/PR lineage; provider checks on moving target | Greater execution concurrency | [04](04-workspace-and-git.md) |

## Failure scenarios to exercise before broad implementation

| Scenario | Architectural result to verify |
| --- | --- |
| A dispatch is accepted, Runner starts a process, acknowledgement is lost | Reconcile that process by stable dispatch identity; no duplicate spawn |
| Cancel races with a delayed Start on a reconnecting Runner | Revoked authorization denies the old Start; an already-authorized in-flight start is reconciled/terminated before capacity is released |
| A daemon reconnects while an old control connection is still alive | Old daemon channel is fenced; runtime process ownership is reconciled rather than blindly replaced |
| Two workers claim the same workspace integration after a lease timeout | Local worker ownership and operation journal prevent simultaneous mutation; timeout alone does not authorize takeover |
| A Node runs on Runner A and fallback exists only on B | Unsupported locality transition is rejected; private edits are not lost by cloning elsewhere |
| The backend filesystem differs from the Runner filesystem | Workspace/diff/artifact reads go through owning services; no accidental local file access |
| Backend receives duplicate/reordered Runtime events | Deduplicate by stream sequence; stale events do not revive terminal work |
| Current-version backend restarts while a completion operation is unfinished | Recover the exact admitted operation; do not reinterpret or duplicate its effect |
| A passes tests, B subsequently integrates nonconflicting code | A's evidence remains tied to its tested revision; final combined result is not falsely marked verified |
| Cancellation arrives after Git integration started but before formal commit | Reconcile side effects without granting current completion evidence or unlocking downstream work |
| Local worktrees are cleaned after delivery | Published managed Artifacts remain retrievable independently of those paths |
| A CLI asks for interactive approval in headless mode | The normalized input request raises attention; no silent indefinite wait |
| A lazily opened workspace lies outside the CLI's launch directory | Reserved path grants allow access without restarting the process; a CLI that cannot grant them fails the probe |
| A candidate introduces then deletes a credential-like file | Publication-range checks catch intermediate content, not just the net diff |
| An internal result history contains a removed credential-like file | A clean export preserves the exact final tree without publishing private ancestors |
| Replan dismissal happens during Planner execution | Execution is revoked and reconciled; review feedback is preserved, not silently withdrawn |
| The execution account can reach control-plane secrets (docker group, published database port, readable secrets) | Runner reports an unsafe host; the module-05 credential boundary is not claimed |

Use deterministic fault-injection tests for the control races, isolated process tests for supervision, and a real CLI/GitHub test run for Adapter/provider assumptions. The multi-Runner identities used in boundary tests can be fakes in Stage A; production transfer/failover requires separate acceptance evidence later.

## Decisions that cannot remain implicit

The selected stack, transports, bundled Agent command CLI, and host identity profile are defined in [Technology & Deployment](11-technology-and-deployment.md). Before broad implementation, probe native Linux process supervision and workspace access with the first Owner-installed Runtime Adapter. Verify PostgreSQL claim/transaction behavior, how the Runner journal and Git results survive supported restart, and how the GitHub adapter enforces expected-head merge. Exercise both HTTP/WS and verified HTTPS/WSS transport and generated JSON Schema contracts in a separate-process test.

Runtime-native sandbox behavior, non-interactive permission modes, reserved-path grants for dynamic workspace exposure, `monos` invocation under Node/Planner permissions and request-ID replay, commit-call reliability, session resume, provider check semantics, and process-tree termination must be established by observation/documentation for the chosen implementation. They are not guaranteed by naming an Adapter interface.

Do not expand scope to automatic cross-Runner failover, distributed transactions, microservices, or external workspace storage in Stage A. Preserve their boundaries now; implement them only with the corresponding recovery guarantees. Permanent Runner-disk loss remains explicitly outside V1.

## CLI command recovery gate

Module 05 owns CLI attribution, immutable request replay and terminal-result lookup. Before product implementation, exercise the module-09 cases with two concurrent same-UID Attempts, a forged/missing scope hint, a modified input file after uncertain submission, journal-write failure, crash around backend admission, and expired credentials after completion stops the caller. Prove that the existing Runner can perform scoped result reads without restoring Agent write authority. Validate Planner long-payload submission, local socket access and backend HTTP(S) while repository writes remain denied. These are probe requirements, not claims that the installed CLI versions already satisfy them.

## Conversational Task gate

The accepted model keeps Task identity stable while Specification revisions evolve through Task Planner conversation (modules 01–08). Stage A must verify ordered input, one Task Planner mutation owner, exact-content change authorization, atomic requirement/evidence publication, controlled continuation, and acceptance/delivery races. A single Runner/Node does not waive these contracts.

Exercise a lost input acknowledgement, a late completion after change admission, new input during change settlement, stale confirmation, and Replan dismissal with a pending requirement change. Verify both orders of input/Owner acceptance: earlier input blocks acceptance; later chat cannot block the frozen batch before its first write, during checks, on restart/Retry or after partial delivery. Explicit correction/cancellation and actual remote outcomes still serialize. Preserve per-recipient cardinality now; live steering and multi-Node delivery require independent feasibility evidence later.

The conversation closure cases in module 09 are required alongside the original execution loop. Stage A includes one-Node Replan publication; otherwise immutable Node definitions would prevent some promised requirement revisions. Guidance completion, operation-owned guard release, unavailable-Planner withdrawal and the acceptance-time delivery cutoff require explicit tests. Also distinguish local capture hard-limit failure (Node BLOCKED) from publication-only findings on a finalized result (REVIEW); these are different recovery and validation gates.

## Single-host V1 gate

Module 09's single-host release matrix is the V1 completion criterion; passing Stage A alone is insufficient. Module 11 defines fresh first-run bootstrap, local Owner authentication, Runner enrollment, two-account repository permissions, privileged supervision and current-run storage/restart behavior. Verify these on one host together with module-03 reboot recovery and module-04 provider polling without webhooks. Historical deployment/version/data migration is excluded before actual use under module12. These are required current-version checks, not deferred multi-Runner features or claims that the current repository already runs them.
