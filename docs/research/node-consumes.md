# Node inputs and unchanged-graph requirement revisions

This completes the functional gaps left after [multi-Node Replan](multi-node-replan.md)
and [parallel workspaces](parallel-workspaces.md). Native A06/A30 and installed
CLI/provider acceptance remain deferred under the Owner's instruction to prioritize
functional development. Earlier research records describe their own increments;
their serial-only and unsupported-consumes limits no longer describe this code.

## Explicit Artifact inputs

`Node.consumes` names immutable, already published `artifact_id` values belonging
to the same Task. Initial planning and Replan reject missing, foreign and invented
future IDs before publishing a graph. Future outputs use `dependencies` and
`expected_outputs`. SQL constraints independently enforce same-Task membership,
unique string IDs and the 256-item limit.

The exact references become `upstream_outputs.consumed_artifacts`, including body,
metadata, source Node/activation/Attempt, Specification/Plan and content digest.
Input order is preserved. A selected Artifact in an applicable current completion
is labeled `current_completion`; every other permitted reference is explicitly
`historical_context`. A removed Node's published Artifact can remain historical
context. References do not add scheduling dependencies, supply completion evidence,
follow `supersedes`, or silently substitute newer content. SQL bounds the projection
before returning bodies; the combined dependency and consumed context also obeys
the existing half-item byte budget.

## Repository evidence and scheduling

Each completed dependency carries a `repositories` list from its exact completion
operation's workspace results. Entries identify resource/workspace, Git commit and
tree, capture and optional integration provenance. This replaces the obsolete
single-repository result fields. A later combined revision still needs fresh
validation; earlier completion evidence does not validate later integration.

Initial and Replan instructions in the backend and CLI adapter now describe
dependency-ready scheduling, with the program choosing concurrency and workspace
isolation. Planner defines work and dependencies; it does not impose a serial
execution assumption or invent future Artifact identities.

## Multi-Node Specification changes

Requirement-only publication now supports a sufficient, unchanged multi-Node
graph. The impact must cover every effective Node exactly once and retain exact
activation/source/completion identities. Carried completed evidence requires all
direct dependencies to be carried, preventing a descendant's old completion from
surviving an invalidated ancestor. Definitions, Node IDs, Roles and dependency edges
remain immutable; structural changes still require Replan.

The database repeats graph membership and carry checks and requires applicability
for every published Node in the same transaction. Existing authorization,
immutable provenance and joint-Replan guards remain in force. Settlement derives
Task state from all branches, allowing independent runnable work while another
branch retains its original Owner Stop or blocker.

When a stopped dependent's old completion settles after its upstream is invalidated,
the held replacement source may wait for prerequisites with a null prompt and no
Attempt. It retains the exact stop origin without creating executable stale context.
After upstream completion, explicit Continue/Retry prepares a fresh source through
the normal path.

## Verification

- Local PostgreSQL: Artifact consumption, multi-Node planning and multi-repository
  completion passed 22 cases across three files. Assertions cover actual Node
  sources, current/historical content, missing/foreign IDs, SQL enforcement, the
  context byte bound, removed-Node references and exact repository provenance.
- Local PostgreSQL: three new multi-Node Specification cases and all ten existing
  Specification cases passed. They cover carry/invalidation, direct SQL rejection,
  atomic rollback for incomplete publication, concurrent Stop settlement and the
  held dependent's completion/Continue path. The affected planner file then passed
  all six cases after replacing obsolete unsupported-feature assertions with
  incomplete-impact rejection.
- Focused Go initial/Replan instruction tests, TypeScript checking, scoped ESLint
  and `git diff --check` passed. Shared protocol/migration registration and final
  combined verification are owned by the integrating session.

These checks use synthetic Runner events and local PostgreSQL. They do not claim
native model execution, installed two-CLI fallback or real provider delivery.
