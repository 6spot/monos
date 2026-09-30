# Task Conversation acceptance plan

## Existing evidence and behavior gap

Canonical initial planning and Node execution are accepted through work commit
`c5ce437` and Session 19. The existing host has one shared-capacity Runner and a
native one-shot OpenCode integration. Old `commit_task_turn` only records a probe
reply plus Stop (`apps/server/src/service.ts`); it is not ordered canonical input.
The owning requirements are modules 02, 03 (Task input delivery and Closing
guidance obligations), 05 and 06 (Requirement revision publication/input
consistency). The completed Node acceptance does not prove Conversation.

## Local contracts to establish

1. Separate-process, separate-connection Owner submissions with observed lock
   contention: immutable sequence, unique request receipts, one source resolution,
   immutable launch cutoff. Race commit/withdraw in both orders, including crash
   immediately before/after commit. No next Planner while old physical ownership
   or effect remains, even with a spare shared slot. Initial planning shares that
   same Task Planner claim.
2. Reply-only handling while Node progresses: persist observed basis without
   changing Spec/Plan/Node source, invalidating evidence or reviving stopped work.
   Input sequence is independent of execution control version. Current affected
   facts still guard action routing. Later input is never consumed by earlier
   reply or included in an earlier history-search result.
3. Retry/Withdraw with no Runner, saturation, native exit without a formal reply,
   queued selection, uncertain command response and stopped/terminal Tasks.
   Authenticate both mutations and read/status recovery. Distinguish historical
   withdrawn input from outstanding instructions. Terminal input can be answered
   but cannot create execution changes or an independent Task.
4. Guidance before planning, on unfinished work and after completion admission.
   Frozen launch IDs and per-recipient dispatch/start facts are not successful
   handling. Missing launch obligations reject completion; handling settles only
   with successful trusted finalization. Required follow-up survives restart and
   cannot bypass original process/effect/lease ownership, hard-completion recovery,
   Owner Stop or unrelated blockers. Withdrawal/supersession resolves only its
   own obligation and never resurrects stale evidence.
5. Accepted-batch attribution uses the current real acceptance seam: accepted
   cutoff and conversation-only effects must have direct DB tests. Do not claim
   provider delivery acceptance while production delivery is a later roadmap leaf.
6. UTF-8 and encoded response/Dispatch budgets, canonical cursor validation,
   source scope, immutable IDs/receipts and migration negative SQL cases.

## Native acceptance using existing deployment

Root owns host mutation/evidence. Reuse `/root/monos-boundary-probe-src`, the
existing Compose backend/database and `monos-probe-runner.service`. Preserve
port 18444 and the unrelated monolab service on 18443. No new permanent service.

Before installation, freeze source and four built binaries, run actual Linux
Go race/vet/module/build and isolated PostgreSQL suites, retain private backups,
snapshot all original receipt rows and inspect global idle. After additive
migration/install, independently verify installed hashes, running server image,
historical receipts and unrelated service identity. Reuse the existing installer
pattern from `/root/monos-node-deploy-v1`; use a new evidence directory, never
overwrite its accepted history or reset canonical product records.

Create fresh Todo -> exact preview/confirmation -> Task through public Owner
commands with an explicit unique prefix. Todo-only and another-Task sentinel
content must be absent from canonical Task context. Native Planner must commit
actual Task-scoped replies through the installed CLI, with original SQLite
envelopes and PostgreSQL receipts agreeing byte-for-byte. Send a second message
while a first turn is active to establish retained ordering. Before Start and
after explicit Owner Stop, conversation must leave execution inactive. Obtain a
formal source outcome or use explicit recovery/withdrawal; never infer completion
from stdout or repair truth through SQL.

For guidance, use a bounded canonical one-Node native exercise with a public
repository only if needed to demonstrate private-work continuity. Record the
original source/Attempt/activation and actual private file digest. Route within-
scope guidance, prove trusted Stop/export and physical release precede successor
Start, same Node/workspace survives, new prompt receives exact guidance IDs, and
successful completion carries exactly its declared handling evidence. Completion-
first follow-up additionally proves the old immutable completion survives and the
new activation owns new evidence. The earlier Node task's Git proof remains
useful baseline but is not a substitute for the new guidance path.

Restart existing backend then Runner from an idle boundary. Compare canonical
input/source/resolution/guidance/recipient rows, immutable receipts, complete
Attempt identity fields and original process-tree absence. Record original
observational failures and model deviations with exact inputs; any additional
observer must independently validate retained evidence and cannot erase a failed
trial. Raw-log projection exceptions are exactly `activity_at`,
`log_visible_sequence`, `exit_observed`, as in Node acceptance.

Execution UI belongs to its later leaf. This task proves authenticated Owner
read/control APIs and native CLI contracts; it must not claim a new UI exists.
