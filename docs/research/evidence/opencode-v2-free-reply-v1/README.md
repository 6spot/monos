# Installed free-model reply verification

Status: **passed**. The installed `a93f3002ae0127098063bc08006a854af547d160`
Runner used OpenCode 2.0.20 and `opencode/longcat-2.5-preview-free` to submit the
formal reply **“免费模型已就绪”**. [verification.json](verification.json) binds the
source, receipt, terminal Attempt, physical observation and evidence hashes.

## Scope and authorization

The Owner previously authorized switching from the exhausted DeepSeek target to
a free model. [The policy request](policy-request.json) changed only the global
target's model, keeping the same Runtime, pinned Runner and empty fallback list.
Its [exact receipt](policy-result.json) committed configuration version 5 → 6.
No paid fallback target was configured. The one [Discussion request](reply-request.json)
used the existing Todo and did not request a new execution Task or repository edit.
The [Runner installation audit](../opencode-v2-free-catalog-install-v1/README.md)
and [Linux/native preflight](../opencode-v2-free-catalog-build-v1/README.md) preceded
these commands.

## Actual result

- Todo: `0c06605d-b8cb-471a-a28b-2a930a8016fe`.
- Source message: `9caa50b4-2d67-41cc-af7a-bf70f64d6180`, watermark 3.
- Attempt: `2e673ca7-990c-4e15-8945-01e71d8b633b`.
- Dispatch: `8bfd911e-07f5-48d8-8882-602a980ebc8a`.
- Formal command: `commit_discussion_turn`, request `discussion-turn-9caa50b4`.
- Reply: `8019183c-f3bf-459b-9567-8633fcb36f0c`, sequence 4, created
  `2026-10-09T14:20:23.920Z`, approximately 179 seconds after the Owner message.

[The messages](messages-final.json) bind the reply to the exact source.
[Discussion state](discussion-final.json) resolves watermark 3 with no pending
source. [The Attempt](attempt-final.json) is SUCCEEDED, mutation is revoked, and
both physical absence and release are recorded. [The final runtime observation](final-runtime.json)
contains the matching committed Tool Protocol receipt, zero held Attempts/leases/
operations/outbox work, and exactly the two original terminal Tasks. The new
Attempt's PID is absent, its cgroup is missing in two equal observations, and the
complete selected-process inventory contains only the Ready Runner. The transient
unit's signal exit records completion-triggered whole-tree termination; semantic
success comes from the formal receipt and canonical Attempt state.

Only one new native Attempt was admitted. No new Task or Task preview was emitted.
The discussion cache retained the prior requirement text and updated its source
provenance through the formal turn; no Task Specification was changed. All Owner
request sessions logged out. No repository, provider publication, or delivery
command was submitted by this verification.

## Validation and limits

The frozen Owner envelopes passed the actual protocol schemas before submission.
Post-run checks compared exact request/message/source IDs, committed receipt,
reply body, canonical SUCCEEDED/released facts, configured model/no fallbacks,
Task counts and the independent physical observation. Initial read-only snapshots
showed the real processing/RUNNING interval. One initial physical assertion used
an absent optional dictionary key; a later diagnostic captured the complete
observation, and the final check correctly treats an omitted current PID identity
as absent alongside the zero PID and independent process/cgroup evidence.

This is a successful free-model startup and formal Discussion reply, not a new
repository-delivery trial or full Stage A acceptance. The strict preflight proves
the selected catalog entry's explicit zero prices at observation time; it does
not promise future pricing, quota or completion of every plugin's initialization.
The installation report separately discloses its historical-row evidence limits.
