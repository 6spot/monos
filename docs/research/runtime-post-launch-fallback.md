# Post-launch Runtime fallback

Date: 2026-10-11. Implemented Stage B functional slice. The Owner deferred
A06/A30 native acceptance and requested continued feature development with local
verification. This record describes the implemented behavior, not a Linux/model
acceptance result.

## Result

A verified native terminal Runtime error can now continue the same unresolved
work on the next configured target. The failed Attempt ends; its exact Stop,
process absence, operations and leases must settle before a fresh immutable source
is prepared. The successor uses the same Runner and workspace lineage, with fresh
formal context and a new Attempt. Node identity and activation are preserved.

This works for Node execution, initial Task planning, Todo Discussion, Task
Conversation, Replan and Review routing/reconsideration. Each owning module
preserves the original obligation and existing Owner controls. Successful formal
outcomes, admitted completion and admitted requirement publication take precedence.
No Owner decision, Planner reply, completion or retry receipt is fabricated.

The [backend continuation contract](../../.trellis/spec/backend/runtime-continuation.md)
and [selection contract](../../.trellis/spec/backend/runtime-scheduling.md) own
implementation details. The [coordinator](../../apps/server/src/runtime-continuation.ts)
uses explicit source-family functions; it is not a generic recovery engine.

## Verified failure transport

`RuntimeEvent.runtime_failure` accepts only `native_terminal_error`, on `exited`
or `process_absent`. The Runner Adapter parses bounded native stdout JSONL frames
without changing raw output. Invalid/truncated/oversized frames or ambiguous
JSON discriminator keys cannot establish a Runtime failure.

- Codex requires a native top-level `turn.failed` envelope with an error message,
  as the final event, plus normal nonzero process exit.
- OpenCode requires a native top-level error with `error.type` equal to
  `provider.transport` or `unknown`, plus normal failed exit. Its failure can be
  followed by native projection output. `aborted` and SIGINT exit 130 are excluded.
- Nested tool output, ordinary nonzero exits, cancellation, signals and silence
  do not authorize automatic fallback. Error text is never classified heuristically.

The trusted worker converts `ErrRuntimeFailure` to reserved exit 75. A native
child merely returning 75 remains ordinary failure. Capture exit 74 takes
precedence. Host reads validate the managed worker identity and normal exit facts;
the daemon retains the original terminal event before exposing absence, including
fast-exit/failed-start-send paths. Restart reuses the exact event even after ACK.
Stop and workspace settlement preserve the original worker wait proof.

See [Runner contract](../../.trellis/spec/runner/execution-guidelines.md) and
[wire contract](../../.trellis/spec/protocol/schema-generation.md).

## Durable ordering and recovery

Migration 26 persists Attempt chain root/index/predecessor and freezes the root's
ordered `selection_context.policy_targets`. A successor advances strictly through
that suffix, retaining original policy source/version even if current configuration
changes. The context itself uses current formal Project/Role data. Explicit targets
form one-element chains. Unsupported settings or confirmed installation absence
can be skipped; offline/unknown facts wait, and capacity queues the chosen target.
A different Runner pin is unsupported transfer, never an implicit workspace move.

`runtime_continuations` binds the exact failure event, Stop and at most one prepared
successor. SQL checks preserve same scope, source family and semantic lineage.
Prepared source plus successor identity commit together; queue admission plus
`queued` resolution commit together in the later source-pump transaction.
Initial planning has explicit Runtime-predecessor provenance. Todo sources retain
the previous intent. Review source generation requires exact settled continuation
authority, not a relaxed generic operation transition.

The lock order is configuration, Runner, Task/Todo, Attempt and continuation.
Selection's exhausted branch also takes the scope lock before continuation. The
bounded pump records per-candidate errors without starving other source owners.
Obsolete prepared sources are superseded; temporary freezes and ordering barriers
retain valid sources. An exhausted continuation can remain unresolved until its
source-specific attention projection is permitted; `resolved_at` records that
separate completion. No exhausted chain can choose another target.

Capture failure closes any still-pending handoff through its source's ordinary
attention path, even if terminal or physical-release evidence arrived first.
Owner Retry remains available after exhaustion; Stop/Withdraw/Cancel supersede
pending automatic work before or after source preparation. Completed sources do
not gain fresh authority from a late Runtime event.

## Local verification

The added Node suite has 8 cases and the Planner suite 20. They cover frozen
multi-hop policy after configuration edits, unchanged Node/activation/workspace,
Stop and lease barriers, actual competing PostgreSQL coordinators, duplicate and
absence-first events, explicit target exhaustion, fresh source context, all source
families, Owner exits, capture ordering and admitted formal-outcome precedence.
Existing scheduling, delivery, review and source-lifecycle suites were also run.

The first complete PostgreSQL run had 450 passing tests and 4 assertion failures:
three stale migration maximums and one old error-code expectation for an invalid
accepted-delivery pointer. The current guard correctly rejects that pointer with
23514 before the FK check; its test now checks rollback and unconsumed confirmation.
The three affected files then passed all 35 tests. The final aggregate rerun
passed **454 tests in all 46 PostgreSQL files**, with two workers and no timeouts.

`pnpm test` passed 622 tests with database suites skipped; shared protocol
validation passed 445 cases. Full Go race tests and vet passed on macOS Go 1.27.1.
Typecheck, lint, protocol-generation drift check and production build passed.
Existing Fastify/pg deprecation and Vite bundle-size warnings remain.

## Native envelope references and remaining scope

Codex envelope reference: [official SDK events](https://github.com/openai/codex/blob/main/sdk/typescript/src/events.ts).
OpenCode references use official `v2.0.20` sources:

| Source | SHA-256 |
| --- | --- |
| [run.ts](https://github.com/anomalyco/opencode/blob/v2.0.20/packages/cli/src/run/run.ts) | `da2c319095d92215f7b79efd3b0654f9b6d8dd434bf7007e0d52d4fbf8c19846` |
| [noninteractive.test.ts](https://github.com/anomalyco/opencode/blob/v2.0.20/packages/cli/test/run/noninteractive.test.ts) | `c49fe9d3b2b4cc98c04bdc939c20c773e8976436b742125aed360f0b2c06cde9` |
| [noninteractive.ts](https://github.com/anomalyco/opencode/blob/v2.0.20/packages/cli/src/run/noninteractive.ts) | `115bbf8336eff518e3bf211047867a6c4df09dea56fef00899c5c49b4fb02004` |

The current upstream `noninteractive.ts` fingerprint differs from the earlier
repository audit. These are source/fixture observations, not freshly verified
installed CLI bytes or a native failure run.

A06/A30, actual provider failure, installed Linux isolation, service restart and
retained-work model continuity remain deferred. Selected queued work losing its
Runtime before Start still follows existing cancellation/Owner recovery. Ordinary
missing formal outcomes remain explicit recovery. Parallel workspaces, cross-Runner
transfer and additional Runtime adapters are outside this slice.
