# Research: Exact requirement proposal and publication contracts

- Query: Minimal complete Specification/impact proposal, Owner authorization, source provenance, replacement/withdrawal, serialized admission, later-input gates and immutable evidence applicability.
- Scope: internal; read-only code research, no deployment or implementation.
- Date: 2026-09-30

## Findings

### Architecture requirements

- `docs/02-planner-and-planning.md:411-425`: prepare a **complete** Specification plus change summary and impact (affected Nodes/descendants, invalidated/carried evidence, retained/superseded guidance, graph sufficiency). Owner authorizes exact content **and displayed impact** against the base. Admission freezes affected dispatch and settles old ownership before publication. A sufficient graph stays unchanged; immutable Node definition changes require Replan. Before initial Plan, revision changes invalidate/reconcile stale planning without inventing Replan.
- `docs/02-planner-and-planning.md:423`: only one admitted change/Replan publication per Task; later conversation continues independently. Newer input must be interpreted or explicitly Owner-deferred before publication. Reading a newer control version does not refresh old semantic assessment.
- `docs/02-planner-and-planning.md:435-443`: committing the proposal reply resolves input interpretation, **not** the change obligation. Replacement retains one originating obligation and revokes old eligibility. An admitted predecessor must reconcile before successor admission.
- `docs/05-tool-protocol.md:337-347`: separate preparation is not a phase outcome; only attachment in `commit_task_turn` makes it confirmable. `apply_specification_revision` admits a durable operation and needs no resident Planner. Authorization binds Task, base, exact Specification, impact, source proposal and action. Direct complete Owner edits may authorize their exact content; conversational prose cannot impersonate confirmation.
- `docs/05-tool-protocol.md:354-358`: Retry/Withdraw address input/change operation identities, use exact operation versions, retain history and reconcile admitted effects. Confirmation does not append a new unclassified input.
- `docs/06-state-and-formal-data.md:506-539`: immutable revision parent/source/authorization; explicit Plan/evidence applicability; one atomic publication switches pointers, records invalidation/carry-forward, resolves linked obligations and writes events/intents. Independent Owner Stop/guidance/feedback/blockers survive. Withdrawal cannot resurrect revoked acceptance, old Attempts or evidence invalidated by real effects.
- `docs/08-principles-and-non-goals.md`: programs orchestrate deterministic state; Agent decides semantics. No new Task states, team/workflow engine, duplicate control table, or rewritten historical evidence.

### Current implementation seams (files found)

| File | Current responsibility / extension |
| --- | --- |
| `apps/server/src/task-records.ts:90` | Internal PLANNING-only Spec publication; consumes confirmation for content alone. Not a full public change operation. |
| `apps/server/src/task-records.ts:102` | `assertCurrentNode` currently demands activation Spec equals effective Spec; this rejects legitimate carried evidence after revision. |
| `apps/server/src/task-records.ts:116` | Settled descendant reactivation; checks process/effect settlement, increments activation, clears current source/result, rebinds guidance. Reuse after new Spec pointer is set, preserving independent blockers. |
| `apps/server/src/owner-commands.ts:52` | Exact canonical `{control_version,specification_id,plan_id}` proposal basis comparison. |
| `apps/server/src/owner-commands.ts:61` | `prepareTaskProposal`: canonical content digest, immutable identity by application comparison, expiry, no Task version bump. |
| `apps/server/src/owner-commands.ts:78` | `confirm_proposal`: Owner session then Task lock, prior request lookup, exact digest/basis, one receipt per proposal. |
| `apps/server/src/owner-commands.ts:118` | `consumeTaskConfirmation`: Owner-only helper, atomically consumes receipt. Cannot directly authorize an Attempt caller lacking an Owner session. |
| `apps/server/src/task-conversation-state.ts:430` | Canonical turn commit routes input before immutable reply/resolution, and ends Planner phase in same transaction. Natural attachment seam. |
| `apps/server/src/task-conversation-state.ts:213` | Bounded current context includes input issues; add proposal/change records and source provenance here. |
| `apps/server/src/task-conversation-state.ts:285` | Fixed prompt currently routes scope changes to `issue`; must teach proposal preparation/attachment once implemented. |
| `apps/server/src/task-guidance.ts:170` | Action routing validates current control/Spec/Plan; rejects terminal/accepted Task. Add proposal attachment routing without implicit execution admission. |
| `apps/server/src/task-conversation.ts:228` | Retry/Withdraw currently resolves guidance or issue; extend lookup to owning requirement operation, retaining one receipt namespace. |
| `apps/server/src/app.ts:133` | Existing Task conversation commands/reads and `:153` generic Owner commands; add typed requirement operation reads/admission here. |
| `packages/protocol/schemas/v1/contracts.json:7372` | Authoritative Task routing schema; generated TS/Go/OpenAPI follow generation, never manual edits. |
| `packages/db/migrations/0004_owner_commands.sql` | Generic proposal/receipt tables; authorization receipt unique per proposal, request receipt unique per Task/request. |
| `packages/db/migrations/0005_task_records.sql:70` | Immutable Spec/Plan/activation/completion triggers; preserve and extend through new records. |
| `packages/db/migrations/0019_task_conversation.sql:97` | Input issues and answers; immutable provenance/terminal dispositions. |
| `apps/server/src/node-completion.ts:38,61` | Current activation and exact Attempt Spec/source checks; retain stale-writer fencing, distinguish applicability from execution authority. |
| `apps/server/src/node-execution-state.ts:64` | Canonical source validity includes current Spec/Plan/control. Old launch source must never be relabeled. |
| `packages/db/src/schema.ts:3` | Sparse typed read mappings; reviewed SQL migrations own constraints, so SQL remains primary. |

### Recommended minimal data and command shape

These are design recommendations, not existing APIs.

1. Add immutable `requirement_proposals` with Task, stable change-obligation ID, predecessor proposal ID, originating Attempt/source/input, exact bounded complete Specification, summary, canonical impact, base Spec/Plan/control, observed Owner-input cutoff, proposed Spec/impact digests and proposal-envelope digest. Link all source inputs/messages through normalized same-Task FK rows, not unchecked JSON IDs. A source issue link binds the exact issue/version; original issue remains open until a durable successor owns the guard. Preserve the complete chain when Retry creates a new input from an old issue.
2. Impact must enumerate exact affected Node/activation/source/result identities and descendant closure, exact carried completion operation/manifest identities, active guidance IDs and retained/superseded disposition, plus graph sufficiency. Reject omitted/duplicated/foreign Node references and ambiguous evidence coverage. No current Plan uses empty Node/evidence lists. A sufficient single-Node Plan needs no fabricated Plan revision; either invalidate its completion and reactivate it or explicitly carry its exact completion unchanged.
3. `prepare_specification_revision` authenticates canonical Task Planner scope, validates current action basis and source cutoff, creates a draft and normal command receipt; it does **not** resolve input or fence the Planner. `commit_task_turn` routing `{kind: specification_proposal, proposal_id, basis}` attaches the draft under its original source/Attempt and resolves the input with canonical reply atomically. Attachment is a separate append-only row or immutable association: immutable proposal content need not be updated. No attachment means no confirm/admit eligibility. Retry of a failed turn does not adopt a draft from a different source implicitly.
4. Reuse `task_command_proposals` for Owner receipt mechanics by hashing a complete envelope `{task_id,proposal_id,base_specification_id,base_plan_id,specification_digest,impact_digest,source_input_ids,input_cutoff}` as content. This naturally binds impact/source without changing all existing proposal actions. Domain eligibility must additionally check attachment, supersession, operation state and later-input coverage. Existing content-only `publishPlanningSpecification` cannot remain a bypass for public change admission.
5. Owner `apply_specification_revision` validates/consumes exact receipt and admits the operation in one transaction, returning the same operation for repeat requests and for two different requests confirming the same proposal. Do not consume a receipt and leave a publication unowned. Generic confirmation may remain a preparatory step, or a typed confirm-and-apply wrapper may create/consume the receipt atomically. Once admitted, subsequent deterministic recovery does not depend on session lifetime, Planner process or proposal expiry.
6. Direct Owner complete-edit command binds **complete Spec and displayed complete impact** in the authenticated envelope and creates the same immutable proposal/authorization/admission records in one transaction. If impact has not been semantically assessed, persist the exact edit as input for Planner assessment; do not let the program invent graph sufficiency/carry-forward. Owner-authored text must not later be silently rewritten while retaining authorization. A refreshed Planner interpretation requires fresh confirmation.
7. Add one `requirement_change_operations` row per admitted proposal, unique proposal ID and a partial unique Task index over unresolved admission statuses. This is a domain operation, separate from physical Runner `operations`. Keep one stable originating change obligation with a current eligible proposal pointer; proposal replacement must not leave one guard per obsolete draft. A future Replan admission must share the same Task publication slot; do not create competing independent unique indexes that permit one change plus one Replan simultaneously.
8. Add immutable publication/applicability records binding operation, old/new Spec, retained Plan, and completion/activation identities. New Specification includes authorization/operation/source links. Record explicit invalidation as history, never update old completion, Artifact, Plan or activation creation basis. Publication creates the new Spec/pointer/applicability/required activations/events/intent together. It is at-most-once by operation and revision uniqueness, not by worker timing.

### Later input and version discipline

- Capture proposal input cutoff from canonical Task input sequence, not reply append sequence. On confirmation/admission and again on publication, inspect **every** later pre-acceptance input under the Task lock. An unresolved/failed head blocks publication unless Owner explicitly defers that exact input for this exact proposal/operation. Deferral never deletes the input, marks it replied, or withdraws its independent obligation.
- Add immutable operation-scoped input-disposition rows with input identity/version, disposition, resolving reply/Owner receipt and assessment basis. Reply-only/status input can be deterministically recognized as non-changing from its committed routing; changed-scope/issue/proposal/guidance requires explicit compatibility or successor proposal assessment. Avoid blanket `processed_watermark >= latest` checks: interpreted input may own an unresolved change, and conversation message sequence includes replies.
- Owner deferral is a dedicated idempotent authenticated command, bound to displayed proposal and exact input IDs/cutoff. New messages after deferral are not automatically covered. Later-input deferral does not grant permission to enlarge confirmed impact or clear guidance/Stop.
- Preparation/attachment/confirmation bookkeeping must not bump execution control and invalidate itself. Admission may bump it when installing execution freeze/revocation. Persist the admitted post-transition basis so publication does not fail solely on its own transition. Owner Stop/later replies may change independent facts; revalidate semantic basis/affected identities explicitly rather than requiring a global version to remain constant for the lifetime of settlement.
- If affected activation/result/Spec/Plan or material impact changes, retain settlement work and require fresh semantic assessment/authorization. A successor may preserve exact authorized text while refreshing assessment, but materially different impact needs a new Owner receipt. Never overwrite a proposal basis with the current version to force success.

### Applicability and migration hazards

- **Critical:** `assertCurrentNode` currently uses `a.specification_id=t.specification_id`. Add a trusted effective-applicability join for unchanged completed activation evidence, restricted to a published operation and exact retained Plan/activation/completion. Do not weaken it to “same Task and Node” or globally drop Spec checks. Carried evidence is historical evidence explicitly applicable to the new Spec, not a newly authorized live Attempt.
- A previously carried result needs a new explicit carry decision for each revision. Bind original completion and prior effective applicability so a missing/invalidation gap cannot be crossed transitively. Current read/status and future acceptance queries must use the same applicability predicate.
- For unfinished work continued on a new Spec, immutable `node_activations` forbids rewriting its creation basis. Decide either (a) append effective activation-applicability records for the same activation and create a fresh source, or (b) deliberately reactivate with a new activation. Architecture specifically mandates reactivation for completed affected work; same unfinished activation with explicit applicability is the narrower continuation model. Do not silently update the activation row.
- Migration19 terminal `handled` guidance obligation attribution is immutable. Revision invalidation must invalidate **reliance** on handling through applicability and create new relevant obligations for reactivated work; never turn old `handled` rows back to `pending` or change their completion IDs.
- Generic proposal/authorization tables currently rely significantly on application immutability. Add appropriate immutable-content/one-way-consumption checks for new domain records, with same-Task composite FKs and deferred attribution checks. Preserve historical existing nullable metadata; no fabricated source messages for old revisions.
- Input issue statuses currently allow only `open,withdrawn,retried,cancelled`; durable transfer to a requirement obligation needs explicit linkage/status or a constrained successor association. Do not label an issue `withdrawn` when Owner merely authorized a proposal.
- Existing receipts/manifests, v1/v2 completion hashes, old activation bases and task creation metadata must be byte-identical across upgrade. Use additive migration20; do not edit previously applied migrations.

### Test plan

1. Protocol: exact/bounded full Spec and impact, duplicate/foreign evidence/source IDs, malformed enum/unknown fields, canonical digest parity, generated TS/Go freshness; terminal/accepted claims reject preparation and attachment.
2. Draft/attachment: cannot confirm unattached draft; wrong source/Attempt/Task rejected; crash before commit leaves retryable input; reply/attachment/receipt atomically visible; committed replay cannot duplicate proposal or reply.
3. Owner admission: two clients/same or different request IDs yield one receipt/operation/revision; changed text/impact/source/base rejected; expired/revoked/superseded proposal rejected; authentication rollback leaves receipt unconsumed. Direct edit must bind exact impact too.
4. Input races: new input before confirm and during settlement, status reply vs new change/guidance/issue, failed head, explicit exact deferral and then a newer message; no lost input, automatic deferral or material impact enlargement.
5. Replacement/withdrawal: prepared replacement revokes old eligibility, same originating guard; admitted replacement waits settlement; publish-versus-withdraw one winner; stopped/lost Runner leaves pending reconciliation; withdrawal never restores old authority or independent guards.
6. Applicability: no-Plan pre-start revision creates no Start/Node; single completed Node all-carry preserves Plan and REVIEW; invalidate reactivates and preserves old completion/hash; old Attempt remains fenced; twice-carried evidence requires an unbroken explicit chain; direct SQL cross-Task/evidence and mutable history writes rejected.
7. Operation recovery: independent PG sessions/processes contend, before/after-COMMIT crashes, Stop during settlement, completion-first/change-first and hard-finalization recovery; old Spec visible until atomic publication. Native Linux private code/writer/lease continuity must be proven separately from SQL admission.
8. Upgrade: populated migration19 historical receipt/manifests/Spec/Plan/activations before/after equality; complete current Conversation/Node/planning suites plus changed protocol/Runner gates.

### Technical choices to settle in design

- Prefer domain-specific receipt/admission wrapper around generic Owner helpers; generic `consumeTaskConfirmation` requires a live Owner token and rechecks pre-admission basis, so it must not be called from a background publication worker or an Agent-only endpoint.
- Choose explicit unfinished activation applicability versus new activation, then make Node currentness, source construction, completion and guidance assignment agree. This cannot be solved solely in the proposal table.
- Define the finite compatibility outcomes for later interpreted input; safest minimum is permit canonical reply-only/withdrawn or exact Owner deferral, require fresh proposal assessment for effectful input. Avoid silently considering every replied input compatible.
- This leaf can implement sufficient graph paths; graph-insufficient proposal must remain visible and guarded for the next Replan leaf, never publish new requirements under knowingly insufficient unchanged definitions. Full joint Spec/Plan publication remains a dependency unless parent expands scope.

## Related specs and external references

Read `.trellis/spec/backend/task-records.md`, `task-conversation.md`, `owner-access.md` and `.trellis/workflow.md`; architecture modules02/05/06/08 are authoritative. No external library or new service is required; existing PostgreSQL transactions, constraints and canonical JSON/digest utilities suffice. No external reference was consulted.

## Caveats / Not Found

- Research does not claim implemented requirement-change APIs, runtime acceptance or passing tests. Prior Conversation acceptance is taken as given and was not re-audited.
- `packages/protocol/schema.json` does not exist; actual schema source is `packages/protocol/schemas/v1/contracts.json`.
- Read ranges above identify current seams; implementation may move lines. Existing `publishPlanningSpecification` is an internal primitive used by tests, not a complete public requirements subsystem.
