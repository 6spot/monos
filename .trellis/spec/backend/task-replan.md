# Exact one-Node replacement Plans

Implementation: `apps/server/src/task-replan*.ts`, additive migration21 and
protocol `TaskReplanSource`, `PrepareReplan`, `WorkspaceTransfer`.
Status: implementation and independent full-scope acceptance passed on2026-10-02
in `09-30-a-single-node-replan`. Native evidence covers both private-work paths,
standalone/joint publication, explicit exits and idle service restart. Issue-answer
and COMMIT races remain real-PostgreSQL/process coverage.

## 1. Scope / Trigger

Actual semantic insufficiency requests a replacement graph within the same Task.
The current slice supports one complete Node. It preserves immutable Plans,
activations, Specification revisions, completion manifests and physical leases.
Runtime failure/silence and ordinary Owner feedback do not imply insufficiency.
Review-feedback routing and multi-Node graphs remain outside this slice.

## 2. Signatures

```text
Node: request_replan({reason})
Conversation: commit_task_turn(... routing:{kind:"replan", basis, text})
Replan Planner: prepare_replan({replan_request_id,source_id,proposal_id,plan_id,
  basis,nodes,summary,impact,requirement?})
Replan Planner: raise_planning_issue({replan_request_id,source_id,reason})
```

`task_replan_source` binds request/source, Spec/Plan/control and context digest;
it is mutually exclusive with all other canonical source types. It uses the same
`planner:<task>` owner and empty workspace reservations. No new Runtime kind,
physical effect or permanent service is added.

Owner `POST /v1/owner/tasks/replan/commands` accepts
`{schema_version:1,request_id,task_id,name,payload}`:

| Name | Payload |
| --- | --- |
| `confirm_replan` | `{proposal_id,content_digest}` |
| `publish_replan` | `{proposal_id,confirmation_id,basis,requirement_confirmation_id?}` |
| `dismiss_replan` | `{replan_request_id,expected_version,direction?}` |
| `retry_replan` | `{replan_request_id,expected_version,issue_id?,answer?}` |
| `defer_replan_inputs` | `{proposal_id,inputs:[{input_id,version}]}` |

GET `/v1/owner/tasks/:task_id/replan` and suffixes `/requests/:id`,
`/proposals/:id`, `/commands/:request_id` provide bounded state and exact recovery.
Result status is `committed|unknown`; a successful terminal Agent command may
precede its actual process release.
Task scope comes from the exact Owner envelope and scoped receipt; results do not
contain `task_id`. SQL deferral/authorization checks must not require a nonexistent
response field. Replan transport `source_watermark` is0; the actual input cutoff
remains unchanged in the immutable source/context/proposal and input guards.

Migration21 owns `replan_requests`, `replan_sources`, `replan_live_attempts`,
issues/decisions/proposals/publications, authorization-command links, input
deferrals, Node/guidance applicability and immutable workspace transfers.
`replan_control_holds` retains every inherited control's origin and exact later
Owner resolution. Both referenced Stop and Continue/Retry receipts are immutable.
`task_publication_slots.owner_kind` discriminates requirement/Replan ownership;
it does not create an independent publication lock.

## 3. Contracts

One partial unique constraint allows one unresolved request per Task. Node
handoff atomically persists request/blocker/freeze, fences the requester, admits
Stop and records its terminal receipt. Competing requests cannot close the losing
source or process its input. Conversation's reply and request routing commit
together. Existing successful command replay remains available.

Freeze cancels queued Node work and blocks new starts. Only precisely recorded
live source eligibility survives the request's own control transition; independent
Stop, activation/Spec/Plan change and later invalidation still revoke it. Never
substitute current control version into an old command.

Generation waits for old processes, effects, leases and shared Planner ownership.
Replan preparation and issue are terminal, repository-free phases. Owner publication
also waits for the preparing Planner's actual process/claim release. Retry supports
failed, issued and prepared-but-stale generations. Old graph authority is revoked;
joint retries preserve the original requirement obligation and predecessor chain.
`eligibleReplan` requires the exact current, unrevoked `task_command_proposals`
row with `expires_at > clock_timestamp()` for confirmation and publication.
Expired confirmation returns `unmet_precondition`; use `retry_replan` with the
same request and its current version to obtain a fresh source/proposal. Preserve
old proposal/context/receipts; do not extend expiry or copy old authorization.

The complete immutable proposal binds graph, readable summary, current Spec/Plan/
control, event/input cutoffs, evidence, guidance, holds and historical private-work
disposition. Identical Node IDs require every formal definition field identical,
including omitted versus empty optional fields. Changed work receives a new Node.
Current evidence follows exact applicability edges, never historical relabeling or
an invalidation gap. Replacement work cannot inherit old completion as its own.

Joint ordering is request → quiescence → graph plus full Spec proposal → separate
exact graph/requirements approvals → one atomic publication. The requirement impact
is strictly `graph_sufficient:false` with reserved graph/request identities; the
graph envelope binds its requirement digest without recursive hashing. Standalone
Spec apply/pump cannot publish this branch. An already-admitted sufficient change
must reconcile/withdraw before fresh joint preparation; never mutate its impact.

Publication atomically consumes both exact approvals when joint, appends complete
revisions/membership/applicability/transfers, switches pointers, resolves only owned
guards and records trusted scheduling origin. SQL independently verifies the exact
Owner receipt/envelope/response chain, not merely a foreign key or consumed token.
Polling/confirmation bookkeeping cannot self-invalidate semantic control versions.

Dismissal clears only its request, revokes queued/live generation and retains claim
ownership until physical settlement. Linked requirements remain independently
withdrawable. Requirement withdrawal invalidates dependent generation/proposal but
does not dismiss the request. Reads expose each remaining exact Owner exit. Retain
all independent blockers, Owner Stop and scoped guidance with immutable provenance;
reason text is never blocker identity.

`WorkspaceTransfer` is system-authored publication input. It binds actual old
source Plan/Node/activation/Attempt/lease, Stop/checkpoint or finalized completion,
fixed Task/resource/storage lineage and target Plan/Node/activation. The old source
Plan can precede the most recent applicable Plan. Future target Attempt/open/lease
IDs are bound when the system admits the new descriptor. Backend and root Host
independently check exact released predecessor. Never clear a checkpoint to bypass
ownership. Once adopted, failed new open/Stop/retry uses the new lease; a third Node
needs fresh publication. Completed inheritance checks finalized Git, not old dirty
HEAD/index equality.

## 4. Validation & Error Matrix

| Condition | Required behavior |
| --- | --- |
| Reused request ID with changed bytes | `payload_conflict`; retain original receipt |
| Foreign source, Task or approval | `denied_scope`; no effects |
| Changed approved basis or request version | `version_conflict`; fresh assessment |
| Live writers/Planner or occupied publication slot | `unmet_precondition`; retain ownership |
| Unsupported graph/origin or source-confused issue | Reject; no fabricated planning intent |
| Unresolved input without exact deferral | Reject publication; keep actionable exits |
| Joint apply through standalone Spec path | Reject with linked Replan/remaining exits |
| Expired current graph proposal | `unmet_precondition`; same-request Retry creates fresh proposal |
| Dismissed/withdrawn stale generation | Reject all new outcomes; preserve replay |
| Stale/missing/forged transfer or checkpoint | Reject at backend and Host |
| Terminal/accepted Task | Reject new mutations; continue physical cleanup |

## 5. Good / Base / Bad Cases

Base: Node terminally requests a new formal goal; after Stop and Planner release,
Owner confirms the whole one-Node graph and publishes it without a resident Agent.
Good: a joint requirement change publishes both pointers under two exact approvals,
preserving independent Stop and old work only as explicit historical input.
Bad: use a new Node ID to inherit old completion, clear a private checkpoint to
reopen it, or dismiss linked requirements automatically.

## 6. Tests Required

Real PostgreSQL must cover authenticated Node/Conversation routes, one terminal
winner, live completion during freeze, source/issue confusion, complete graph
validation, exact SQL authority negatives, independent controls and linked exits.
Independent process tests must observe actual competing backend PIDs/locks and
before/after-COMMIT loss, verifying one complete pointer/receipt outcome.

Runner checks cover mutually exclusive source, phase CLI allowlists, terminal
prompt, unchanged reconnect Stop scope and both positive/negative root transfer
proofs. After final protocol generation compile every Go consumer, then full
race/vet/four-binary checks from the frozen Linux source.

Native acceptance must record actual bundled CLI terminal request, quiescent
preparation, independently saved Owner envelopes, complete graph/membership/digest,
old/new source and root lease/checkpoint, new completion and real Task Git. Separate
unfinished and finalized observers. Keep failed observations and qualify PG-only
coverage. `infra/probe/task_replan_probe.py` observes authority; it never writes SQL
to manufacture a product transition.

## 7. Wrong vs Correct

Wrong: request freeze invalidates every live source, then a current-version bypass
admits stale completion. Correct: capture exact eligible live source across only
the request-owned transition and retain all independent revocation checks.

Wrong: `consumed_by != null` establishes approval. Correct: compare exact stored
confirmation and publication envelopes/results, proposal digests and independently
preserved Owner requests; jointly consumed approvals bind the same publication.

Future real review-feedback dismissal must atomically preserve feedback and create
a fresh routing successor linked to dismissal, with same-feedback/basis anti-repeat
and old Planner settlement. No placeholder feedback API or forged origin is valid.
