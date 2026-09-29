# Node execution design

## Boundary and source

Extend the existing orchestrator, managed output storage and Runner effect
protocol. Backend owns formal authority and current evidence; Runner owns physical
facts. Reuse RuntimeScheduling/DispatchQueue and current pump; no new service.

Migration 18 adds `node_execution_outbox`: immutable source ID, Task/Node/activation/
Spec/Plan/control, planned Attempt, configuration version, frozen prompt/context/
digest and predecessor/recovery provenance. Only waiting/done/check facts mutate.
Node points to current source/blocker. Preparation failure creates no fake Attempt.

Discover effective canonical one-Node membership through source-bound public
`plan_published` provenance. This reconstructs work after publication/pump crashes
and admits the retained native Plan on upgrade. Arbitrary fixture PENDING rows
are not authorization. Recovery creates fresh source in its Owner transaction.
Unsupported multi-Node Plans explicitly block; never flatten them.

Preparation locks configuration SHARE then Task/Node/source. Freeze fixed Node
protocol/accurate CLI examples, full effective Spec/Node/current referenced Role,
Project map/reservations and bounded current Artifact/recovery metadata. Archived
referenced Roles remain usable. Exclude content bytes (read_artifact supplies them),
Todo/cache/sessions/Planner Guidance/other Roles/Tasks/raw logs/Git bytes. Enforce
code-point and encoded Dispatch byte bounds with wrapper headroom. Failure is an
immutable correctable source; no clipping or implicit pump refresh.

Selection order: configuration -> planned-Attempt advisory -> Auto registry/Runner
-> Task -> Node/source -> Attempt. Enqueue/replay/promotion check current source,
planned Attempt, exact basis and digest. Canonical QUEUED atomically means Node
RUNNING; explicit legacy probes retain compatibility. Offline/stale Runner waits
durably; unsupported/missing policy, complete unavailable installation or exhausted
targets block factually with Owner Retry. Retry reads current configuration; queued
context/target stays frozen. Old same-Node or Task-workspace ownership prevents
promotion even with free slots. Never make Planner availability a Node dependency.

## Artifacts and manifest

`publish_artifact {artifact_id,title,content:{text,media_type},references?,supersedes?}`:
title nonblank <=256 code points; UTF-8 text <=256 KiB (empty allowed); MIME <=128
characters; <=32 external references, each absolute http(s) URL <=2048 characters
and optional label <=256. Reject binary/path inputs. Server calculates SHA256/size.
Store immutable managed content, full provenance, event and receipt atomically.
Global ID collision/changed request is a correctable conflict. Publication does
not unnecessarily advance Task control CAS. Supersedes is same-Task provenance.

Agent read_artifact is Task-scoped; authenticated Owner lists/manifest/content reads
are bounded and survive producer exit. Return JSON data, no-store/nosniff; never
execute HTML on the app origin or fetch references. Initial Planner consumes remains
absent/empty until its owning Artifact-consumption feature is enabled.

`complete_node {summary,artifact_ids?,handled_guidance_ids?:[]}` freezes an immutable
manifest keyed by operation/source/basis before fencing. Nonempty guidance remains
explicitly unsupported until Conversation. Omission selects this Attempt's Artifacts;
explicit unique IDs must belong to this Node/activation (earlier Attempt permitted);
[] remains distinct. Racing late publication cannot change the frozen manifest.
Physical `operations.result` stays physical; immutable `node_completions.result`
adds manifest `summary`, `artifact_ids` and `completion_manifest_digest` to it.
Encoded Artifact read response wrappers are bounded separately from UTF-8 content.

## Terminal outcomes

Signed Node admission validates current source and existing claim/connection/
activation/Spec/Plan/control; Artifacts are backend work, never Git operations.
Completion admits one operation+manifest+receipt and closes mutation. Canonical
repository-free completion is explicit in the Operation and allowed only if no
open/lease or retained dirty private workspace needs settlement. Require whole-tree
absence and prohibit Git/workspace evidence. An existing dirty same-activation
checkpoint from an earlier Attempt requires reopen/finalize; no bypass by retry.
Explicit legacy probes alone retain fixture Git behavior.

After physical success store immutable completion+manifest, update Node and derive
REVIEW only with local effects/physical ownership settled. Re-derive on later Stop
settlement. Cancelled Task operations settle truthful history without current
evidence. Stale activation/source success is rejected; later Spec/Replan work owns
superseded settlement. Recoverable completion remains RUNNING with attention under both event
arrival orders; hard failure is BLOCKED and retains ownership.

`block_node` records reason/blocker as a successful formal handoff, not Runtime
failure, fences mutation and admits Stop. Node BLOCKED; exact answer is required
for semantic Retry. Factual missing-outcome/config failures do not need invented
semantic answers.

## Owner controls and hard recovery

Retain legacy Attempt variants for explicit legacy probes only; source-bound
canonical Attempts reject them. Add exact Node/activation/source/blocker variants
plus Task CAS. Stop supports no-Attempt waiting, queue and running work. Continue
only resolves Owner Stop; Retry resolves factual failure or exact answered blocker.
Persist new source and answer atomically with receipt. Saved intent may wait for
terminal fenced cleanup, but promotion still requires physical settlement. Same
Node activation persists across ordinary Retry/Continue. Frozen Project resource
map and workspace reservations must remain identical through later configuration
edits and queue promotion.

Owner completion recovery has two modes: retry original operation after repair,
or trusted settlement then fresh correction. Retry re-admits exactly the original
immutable Operation under Runner->Task locks; no old Agent mutation is restored.

Fresh correction admits system-only `settle_completion`, linked by original
completion ID and immutable identity digest, same Attempt/dispatch/workspace/lease.
Keep the immutable lease settle pointer on original completion; add a separate
unique authorized relation. Follow [Runner research](research/runner-recovery.md).
Serialize old Agent/effect workers and workspace coordinator/writer locks. Reconcile
original success first, including retained final ref/commit and completed HEAD CAS.
If already finalized, export and settle its exact original success; do not abandon
success or launch unnecessary correction. Otherwise preserve old finalization
intent/refs and capture a trusted recovery checkpoint using temporary index without
changing actual HEAD/index/files. Only this recovery capture may omit ancestry
validation; normal Stop/finalize rules remain strict. Preserve private ignored data.
Checkpoint and service export must be durable before original cancellation/lease
release. Success/failure after crash retains exact IDs and authority.

Pair settlement atomically in backend: a strict settlement result carries the
original result/disposition. Avoid the existing mutual wait where complete rejects
all other unresolved operations but settlement waits on complete. Ordinary unrelated
operations still prohibit release. Later fresh Attempt receives retained correction
provenance and must fix ancestry before completion. Infrastructure capture failure
still holds ownership; it never fabricates a checkpoint.

Local pre-delivery Cancel binds exact Spec/Plan/control, revokes current sources,
queued/live mutation and unfinished Nodes, preserves completed history and sets
Task CANCELLED. Admitted completion/effects settle without current evidence or
revival. If a hard failed completion needs settlement, use the same trusted paired
operation with cancellation disposition. Failed cleanup remains explicitly retryable
after Cancel without Task/source revival. No post-Plan PLANNING or remote claims.

## Upgrade and operation

Historical source/manifest metadata stays null. Add strict FKs/immutability and
same-activation constraints, preserving explicit legacy operation meanings.
Generate TS/Go/OpenAPI/fixtures together and test clean install plus migration 17.
Root stages complete verified source, tests fresh Linux binaries, backs up DB/
journal/binaries and replaces existing services. Keep port 18444 with the existing
Compose override. Account for the native reading-list Node before enabling pump.
Retain failed/uncertain evidence. Rollback requires settling new wire operations
with compatible binaries; no destructive down migration or journal reset.
