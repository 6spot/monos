# Independent initial Task planning review

Status: **accepted within this leaf's scope**. Independent final static, test-log,
deployed-source and native-state audit passed for `09-30-a-task-start-planning`,
source v2 SHA256 `a1d2601559e907b7d91938c0c691bc8f5646ddfd51e9018edda378194b074485`.
No remaining review blocker. This does not accept Node execution or delivery.

## Scope and review baseline

Read the active PRD, design, implementation ownership/checks and backend-seam
research, the architecture/principles and relevant backend/protocol/Runner specs.
Reviewed the existing Task-record, dispatch, selection and protocol seams while
the Backend and Runner owners implement. No product-code changes, deployment,
commit or test-host mutation were performed by this reviewer.

The design explicitly addresses the known seam hazards: receipt-first replay;
source authority beyond `kind=planner`; scheduler-before-Task lock order including
replay; frozen input with durable preparation failure; repeated exact issue/answer
provenance; semantic phase completion with separately retained Stop/physical
ownership; no planning before Start and no Node execution in this leaf.

The full static pass now includes `task-planning.ts`, `task-planning-state.ts`,
migration 17, queue/scheduler/service/domain integration, Runner source/CLI/effect
guards, native harness and the final 32-case PostgreSQL planning suite. Final
Unicode nonblank validation uses an explicit shared whitespace set and real
object-wrapped TS/Go fixtures; the final source and generated artifacts match.

## Findings and disposition

1. **Frozen protocol taught unsupported CLI invocations — fixed by Backend.**
   The initial context used `--payload JSON` and
   `monos status`, while the real bundled CLI accepts `--input file|-` and
   `monos command-status`. This could turn a normal Planner invocation into
   repeated rejected calls. Backend replaced the examples with the actual CLI
   arguments and added context assertions in the passing PostgreSQL suite.
2. **Repository-free Stop recovery strands the physical claim — fixed by Runner;
   independent focused race tests passed.** A recoverable initial-Planner Stop failure persists
   `operations.state='recovery'`; backend `pending` sends admitted effects only,
   while `Daemon.prepareRecovery` originally excluded every `Workspace == nil`
   operation. A committed Plan still holds capacity, and source Retry cannot
   promote its successor. Reconnect must reconcile the original source-bound
   Planner Stop through the existing finite recovery batch, with original bytes,
   scoped dispatch and retained recoverable/terminal evidence. The fix validates
   exact Task/intent/Spec/context, revoked unreleased inventory authority and the
   retained operation; normal delivery and recovery share the `effect:` key and
   lifecycle lock. The bounded batch drains after Ready and does not reinsert a
   failed effect on heartbeat. Missing evidence, hard failures and other phases
   remain excluded. Focused `-race` checks, including TLS terminal-result replay
   after Ready, passed independently.
3. **Native inspection treats QUEUED as completed — fixed by Root; independent
   six-test harness suite passed.** `TaskPlanningProbe.inspect` initially stopped waiting as soon as
   `process_released=true`. A QUEUED Attempt has that value before any process
   starts. Inspect immediately after Start/Retry could snapshot a queued Attempt
   and report a false native failure. It now waits for a terminal Attempt and
   physical release; the queued -> running -> succeeded regression passed.
4. **Caller-selected Plan/Node identity collisions surface as uncertain internal
   failures — fixed by Backend; targeted and full database verification passed.** The public payload accepts
   generic IDs, but `plan_revisions.id` and `nodes.id` are global primary keys.
   A collision with another Task previously escaped `publishInitialPlan` as
   PostgreSQL `23505`, which HTTP mapped to `internal_error` with reconciliation
   instructions. The new initial-publication boundary catches only the two named
   primary-key constraints and returns `payload_conflict`, rolling back the whole
   failed outcome. Regression cases check both collisions followed by a successful
   fresh-ID publication from the same still-authorized Planner.

Additional native-evidence suggestions sent to Root: compare source prompt bytes
directly with canonical context (not only each against separate fields), and check
the planning/Plan HTTP projections against the independent SQL evidence. Root
implemented these and strict two-source Retry lineage checks. Backend also added
typed same-Task event source/issue foreign keys and exact Attempt launch/source
binding checks in migration 17; final post-change database verification passed.

The Role eligibility seam is implemented: initial publication explicitly joins
selected Roles with `NOT archived`, rather than relying only on the legacy
selected-membership helper. New queue admission and pump replay recheck the source;
the pump does so after the original Runner lock and before committing its source
selection bookkeeping.

## Verification coverage completed

Each boundary below passed through the final tests, static review and native
evidence as appropriate. Native timing does not substitute for deterministic
database contention tests.

| Boundary | Verified contract |
| --- | --- |
| Creation and Start | Canonical creation/pump produces zero planning; concurrent distinct/same-request Start serializes to one source with exact immutable receipts. |
| Frozen context | Exact Spec, current eligible Role descriptors/Project/Guidance and ordered same-Spec issue answers; no Todo/session/other-Task inputs; encoded byte/code-point overflow persists a non-executable source that only explicit Retry refreshes. |
| Scheduling | Replay and initial enqueue both recheck current source/head/planned Attempt/Spec/control under the documented lock order; no fake Attempt when unavailable. |
| Physical ownership | Source Retry may persist while fenced cleanup remains; promotion on either Runner cannot bypass an old owner claim or unresolved effect. |
| Authority and publication | Node/Todo/legacy/other-phase Planners cannot publish; stale source remains rejected even with the latest forged control version; current one-Node Plan preserves absent/empty fields and exact requirements. |
| Correctable errors | Unknown fields, malformed graphs and duplicate dependencies fail validation; valid multi-Node/Artifact consumption is explicitly unsupported without terminalizing the Planner. |
| Atomic outcomes | Plan/issue, event, receipt, logical success/fence, outbox closure and repository-free Stop commit together; outcome/Stop/Cancel races prove both observed lock orders. |
| Issue exits | Exact answer+Retry, repeated answer history, Stop withdrawal and Cancel work without capacity; wrong/stale/duplicate answers do not consume fresh authority. |
| Recovery | Before/after selection, Start and phase commit retain the same identities; post-outcome exit is not missing outcome; outcome-free exit requires explicit Retry. |
| Schema and migration | Strict shared TS/Go validation, optional-field round trips, fresh migration and retained version-16 upgrade with no synthesized historical sources. |
| Native acceptance | Real canonical Owner creation and bundled CLI prove pre-Start inactivity, Plan/issue and exact Owner resolution, settled process trees, zero repository materialization and no Node execution. |

## Independent checks run

- A read-only Node script imported the live shared validator and passed 25 schema
  cases: valid canonical initial Dispatch; Node/Todo/resource/source contamination;
  malformed digest; exact optional empty Node fields; blank/NUL objective text;
  unknown fields; duplicate dependencies; null optional fields; exact paired
  issue answer/sequence; mixed source/Attempt targets; and exclusive Plan/issue
  outcome shapes. This is a focused schema check, not the complete protocol gate.
- `mise exec go@1.27.1 -- go test -race ./internal/daemon -run
  'TestInitialPlanning|TestReconnectTerminalReplayFollowsReadyOnWireWithoutHostEffect'`
  passed from `runner/` after the Stop recovery fix.
- `python3 -m unittest test_task_planning_probe.py` passed 5 harness tests at the
  intermediate checkpoint and 6 after the queued-inspection fix.

The extra stale-candidate pump/scheduler-replay regression passed: one independent
pool retains candidate bytes while another pump selects them and Owner Stop/Retry
supersedes them; releasing the old pump proves its scheduler replay cannot rewrite
the old source. Plan/Node collision correction, exact issue lineage and fresh Retry
after immutable preparation failure also passed.

Final owner-run gates are separately attributed: 217 TypeScript and 142 Python
tests; lint, typecheck, protocol freshness, build and native Node module imports;
full Linux Go race/vet/four-binary build; 183 PostgreSQL tests in 17 files, including
32 planning cases. This reviewer inspected retained final Linux logs
`linux-go-build-v2.log` and `linux-db-v2.log` and independently verified their
source inputs. The source-v1 fixture failure and initial install preflight failure
remain retained; neither is represented as a successful final gate.

## Independent deployed and native audit

Read-only SSH audit used the existing test installation on `100.120.14.84`.
All 254 manifest file hashes match the local tree, remote build tree and installed
source. The archive SHA256 matches the accepted v2 value above. All four installed
binaries match the successful build artifacts and hashes in `verification.md`;
the three service/helper binaries live in `/usr/local/libexec`, and the CLI in
`/usr/local/bin`. Current backend-container copies of the planning, service, queue,
schema and migration files also match the manifest.

- Backend container: `860ea77cf2167a8105a40c8e6bedc20a2ae9c5e166e9af70b197b7c4a4e8e5a3`.
- Image: `sha256:9fa1a867f7f2e015e3c6ae52385f6628b2cfac25ececb9997253bef31a97fee6`.
- Backend instance: `53bf706f-d17f-4d4e-80d3-99bb25c95a5a`; Runner `runner-a`
  connected, ready and fresh at incarnation/report incarnation 33.
- Backend listens through `127.0.0.1:18444`; independent monolab container ID,
  image, creation time and start time match the before-deploy record on 18443.

The native trial at `/root/monos-planning-native-v1` passed creation, before-Start,
Start/replay, issue, answer/Retry/replay, Plan and final idle audit. The five report
hashes in `verification.md` match their actual files. Current PostgreSQL Task,
Specification, source, event, receipt, Plan and Node rows match the final evidence;
the old issue snapshot's source/events/receipts/Specification remain unchanged.
Current Owner Start and Retry receipts match their retained exact request bytes,
digest and response (control versions 2 and 4).

Task `e14ad4bb-4688-4647-981c-70911889e17b` retains Specification
`a9b8ee1f-af68-45c0-948e-5af22902e05e` and Plan
`5c99259e-d5d5-4b1f-a784-dc5d2027ddae`, with one PENDING Node
`04fb910d-fdf9-4e2d-9ae2-ae269f53ca74`. Its definition retains four hard requirements,
three expected outputs, the exact answered `Add book` label and no dependencies.
Both source prompts equal canonical context bytes and their SHA256 values;
the successor has exactly one retained issue answer. The effective Specification
and Project match, Role inputs contain only ID/name/description, and neither Todo
capture nor private Role-instruction sentinels enter the Task context.

Independent read-only SQLite and PostgreSQL comparison verified every native
command envelope/digest and original successful Stop for all three processes:

| Phase | Attempt | Current result |
| --- | --- | --- |
| Discussion preview | `1fc1216e-bc84-4962-b546-bf3e53c9f4e4` | SUCCEEDED, one Start, original Stop succeeded |
| Initial issue | `738d01d2-c431-434f-a74a-ad6582e88510` | SUCCEEDED, one Start, original Stop succeeded |
| Retry Plan | `39ef9b6c-e2ec-4639-9632-9141d5ced80f` | SUCCEEDED, one Start, original Stop succeeded |

All three have mutation disabled, process absent and released, matching retained
dispatch identities, absent original PID/birth identities, empty/nonexistent
cgroups and systemd MainPID 0. Their retained systemd failed markers do not imply
live processes; the explicit physical and successful Stop evidence establishes
settlement. This reviewer did not reset these markers. Current global queued,
mutating, unreleased, unresolved-effect, active-lease, pending-outbox and pending-
planning counts are zero. This Task has zero workspaces and zero Node Attempts.

Historical rows were independently compared with the pre-deploy SQL backup using
read-only COPY output: all 43 Agent receipts, 13 Owner receipts, 8 configuration
receipts, 7 Todo receipts, 9 Discussion receipts and 6 Task-preview receipts remain
byte-identical. The previous Capture acceptance Task
`0c24174a-6910-4810-b4b6-14f68d202f0b` and Specification
`e4c4fc24-a429-47e4-84bc-f990bb08df13` also match their pre-deploy rows. That Task
remains PLANNING with no source, Plan, Node, Task Attempt or Start.

## Scope limit and follow-up

Only explicit initial planning is accepted. No Node execution, repository work,
delivery, provider-session resume or new live restart trial is claimed. The next
Node-execution leaf must explicitly account for the retained RUNNING Task with its
PENDING Node before enabling scheduling. This reviewer changed only this report;
all product fixes stayed with their owners, and no deployment or commit was made
by the reviewer.
