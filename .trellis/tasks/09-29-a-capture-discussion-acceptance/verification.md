# Capture and Discussion integrated verification

## Acceptance matrix

| Requirement | Evidence | Result |
| --- | --- | --- |
| Capture/open has no model effect | `postgres-todos.test.ts` exact capture/read footprint; browser capture/navigation; native `captured-discussion-ordered-20260930-a.json` | Passed |
| Assigned/unassigned discussion and ordered input | `postgres-discussion.test.ts` scoped Project attribution, move/retry and atomic rollback cases; native ordered two-source discussion; new two-session first-submission lock-contention regression | Passed |
| Shared execution capacity and queued conversations | Discussion PostgreSQL shared-slot tests plus current scheduler heartbeat contention regression; prior native two-slot queue/reconnect/promotion trial | Passed |
| Atomic final reply/requirement state and no duplicates | PostgreSQL receipt rollback and independent-process death before/after COMMIT; native ordered source watermarks and SQLite handoffs | Passed |
| Retry/Withdraw and physical Stop | Native interrupted Discussion, retry of same source, second Stop and withdrawal followed by later successful source; browser status/command projection fixtures verify presentation | Passed |
| Stale and repeated two-client confirmation | 15 Task Preview PostgreSQL cases, concurrent browser confirmation, native concurrent confirms/creates and independent digest/provenance checks | Passed |
| Independent exact Task and preserved Project | Native creation of one PLANNING Task, one immutable revision and zero Plan/Node/Attempt/Start; reassigned/archived source and archived Project preserve created result | Passed |
| Browser reconnect/read restoration | Full 23-case suite includes lost confirmation/create responses, malformed recovery, Todo navigation, canonical Task/Project restoration and current Specification | Passed |
| Combined current backend/Runner idle restart | Retained backend v1 before/after and explicit Runner-only continuation v2; `research/restart-evidence.json` | Passed |
| Final source/physical ownership audit | Post-Runner checkpoint verifies 205 source files, four binary hashes, six absent native Attempts and zero global ownership/queue/input guards | Passed |

## Versioned evidence

Current product work commit is `61f140b` (migration 15), deployed from archive
SHA-256 `a0913337e59aa109940bd2486c1e5b0264d27aba44af54d53c4ac6af39b1a014`.
Its manifest binds 205 product files. Prior leaf reports are archived under
`09-29-a-todo-capture`, `09-29-a-todo-discussion` and `09-29-a-task-preview`.
Private native evidence directories on `100.120.14.84` are respectively
`/root/monos-todo-capture-evidence-v1`, `/root/monos-todo-discussion-evidence-v1`
and `/root/monos-task-preview-evidence-v1`. Existing monos endpoint remains
`https://127.0.0.1:18444` with `monos-probe-runner.service`.

Reused Runtime queue/reconnect and earlier live Stop/reboot cases are documented
in archived `09-29-a-runtime-integration-acceptance/verification.md`; their hashes
are in its `research/host-evidence.json`. These establish the tested Runtime
behavior, not a fresh current-source host reboot.

## Checks and limits

The final product snapshot passed 151 local tests, 138 same-host PostgreSQL tests,
23 browser scenarios and Go tests. Final Python harness suite is 90/90 (23 for
this harness), with syntax compilation and diff checks passing. The added real
PostgreSQL concurrency regression passed 1/1; focused ESLint and TypeScript passed.
The full 138-case DB baseline was reused, not relabeled as a new 139-case run.
This integration leaf changes acceptance tooling and adds a focused database
regression for simultaneous distinct first submissions. The existing tests only
covered concurrent replay of one saved request and sequential new submissions.
Previously passing unrelated product suites need not be repeated without a product
change or new failure concern.

Assigned-Project Discussion behavior is covered deterministically; the native
ordered and preview scenarios began unassigned. Model-driven native Discussion
and structured preview succeeded with the configured zero-price model. Idle
restart checks invoke no model. Earlier native queue tests use a deterministic
driver through the real CLI and do not establish autonomous planning quality.

Task Start, execution planning/workspaces, Task Conversation, delivery and full
Stage A/V1 acceptance remain later work. Planner repository inspection remains
explicitly unavailable in Stage A; module 09 schedules it for Stage B.

## Restart result and retained failures

Final harness SHA-256:
`9ea5e1b42515a198ca42918fd3cdc021ce18ec8463413813c24490b29c6ab3ba`.
Current evidence is `/root/monos-capture-discussion-acceptance-v2`. It binds the
retained backend restart in `/root/monos-capture-discussion-acceptance-v1`, then
restarts only Runner. Backend and Runner each restarted exactly once. All 24
Owner receipts, source messages, previews, Task and initial Specification remain
exact. Four successful replies bind to native commands/journal digests/receipts;
five Attempts additionally have real historical native snapshots. All six current
native process identities and two known sleep children are absent. Global pending
input/outbox, writable/queued/unreleased Attempts and unresolved operations are zero.
The retained Task still has one revision and no Plan, Node, Attempt or Start.

The first read-only preflight v1 failed on normal output/exit records appended
after historical snapshots; v2 preflight passed after correcting that comparison.
The first actual backend restart then reconciled the preview Attempt's last exit
event. The initial comparator incorrectly treated its three mutable log/exit
projection fields as immutable semantic records. All original events and all
business records remained unchanged. The failed report and exact executed script
bytes are retained. A strict corrected comparison verifies the appended event's
original dispatch/boot, canonical digest, stream/order sequence and precisely
explained projection changes. Explicit continuation binds that evidence and
prevents another backend restart or duplicate Runner continuation.

`research/backend-restart-reconciliation.json` records the observed delta;
`research/restart-comparison-retrospective.md` and Runner quality specs capture the
boundary lesson. `research/restart-evidence.json` contains final report hashes,
service identities, checks, source/binary bindings and clean ownership. No product
source change, new model invocation or additional permanent service was needed.
