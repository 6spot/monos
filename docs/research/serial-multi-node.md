# Serial multi-Node execution

Date: 2026-10-11. Functional development continues under the Owner instruction to
defer native A06/A30 acceptance. This increment implements serial execution of an
initial DAG and settled Review Rework of a selected subgraph. Agent-requested
upstream Rework is the next increment.

## Implemented behavior

Initial Task Planner can publish 1..256 Nodes with unique identities and a complete
acyclic dependency graph. Each distinct Role must be selected and available in
the Project. Optional hard requirements and expected outputs are retained exactly.
`consumes` remains absent/empty; direct dependency completion and selected Artifact
metadata are already available as canonical upstream input.

The Node pump prepares only a currently eligible serial candidate. Upstream Nodes
must have current successful completion evidence, and the prior Task Node process,
operations and workspace leases must be physically settled. This avoids freezing
all descendant prompts before their inputs exist. Fresh context includes current
Role configuration, successful dependency summaries, revision/manifest identity,
and selected Artifact metadata; Agent reads exact bodies with `read_artifact`.
Unselected Artifacts and obsolete activations do not become upstream evidence.

Queue admission and promotion repeat the dependency and physical checks under the
Task lock. Two pumps cannot create competing same-Task Node writers. Explicit
Owner Retry/Continue and Runtime fallback may retain fresh intents while cleanup
waits; such intents cannot queue early. One blocked Node does not hide independent
runnable work: Task state is derived from the whole effective graph.

Canonical Node command versions bind their immutable Node source, while Owner
controls retain current Task CAS. Control changes for another Node cannot stale a
still-current source. Exact source pointer, activation, effective Spec/Plan, mutation
permission, Owner holds and input/freeze guards remain authoritative. A retired
source with no Attempt cannot be revived from a scheduler's earlier snapshot.
Source-owned pending guidance similarly forbids old admission. Guidance for a future
dependent or completed Node with a running descendant waits durably before source
preparation/reactivation; it cannot throw repeatedly and starve other follow-ups.

## Same workspace, exact completed proof

A same-Plan `WorkspaceTransfer` carries `purpose: serial` and a genuine completed
predecessor's Attempt/lease/operation/manifest/tree and fixed workspace metadata.
It forbids Replan proposal/publication fields and checkpoint handoff. The target
must be the current canonical Node source on the same Runner, Task and Plan.
The immutable admitted open descriptor retains that proof for replay.

The Runner checks both retained source manifests, exact settlement and writer
absence before adopting the new lease. Git content and fixed ancestry stay intact.
A scratch Conversation can run concurrently with this handoff. Existing Replan
transfer retains its exact approved cross-Plan provenance. Historical completed
code can be the physical base after Review Rework without regaining semantic
completion validity for the new activation.

## Review and Conversation

Conversation and Review contexts enumerate the full bounded graph. Review Planner
can choose a nonempty subset of current Nodes for Rework; the program expands the
complete descendant closure after settlement. Requested `node_ids` stay exact to
the command receipt, and `affected_node_ids` records the applied closure. Those
Nodes get new activations and exact feedback context; unrelated completion evidence
and all historical output remain intact.

Actual multi-Node Specification/Plan replacement is still explicitly unavailable.
Reject these writes before request, freeze or operation creation; ordinary reads
and replies continue to work. Initial multi-Node execution does not silently claim
multi-Node Replan, parallel worktrees, multi-repository delivery or Agent-requested
Rework with its recovery/three-request limit.

## Validation

Focused PostgreSQL tests exercise A → B with independent C, exact Stop/completion
barriers, concurrent pumps under an observed Task-row lock, blocked independent
work, source-version isolation, fresh Role and upstream Artifact selection, guided
future Nodes, running descendants and stale-source admission. Planner tests cover
full DAG/Role validation, multi-Node read context, exact subset/descendant Review
Rework, independent retained results and unsupported mutation rollback.

Workspace tests cover actual admitted A → B handoff with live Conversation,
immutable descriptor replay, rejected forged proof/basis and Review activation
1 → 2 using historical completed code. Runner tests use actual local Git content
and retained settlement records; no native model or Linux isolation is claimed.

The final isolated PostgreSQL aggregate passed **470 tests in all 49 files**
with two workers. Local Vitest passed **627 tests** with database suites skipped;
shared protocol validation passed **450 cases**. Typecheck, lint, protocol drift,
native Node module import and production build passed. Go race coverage passed
for all packages: full Host suite plus its final focused manifest-binding change,
and all remaining Runner packages; vet passed. Final native initial-Planner
instructions were updated to match DAG support and their Adapter tests passed.
Existing Fastify/pg deprecation and Vite bundle-size warnings remain. No native
model or Linux host acceptance was run.

See [Node execution](../../.trellis/spec/backend/node-execution.md),
[workspaces](../../.trellis/spec/backend/workspaces.md),
[Task planning](../../.trellis/spec/backend/task-planning.md) and
[Review correction](../../.trellis/spec/backend/review-correction.md).
