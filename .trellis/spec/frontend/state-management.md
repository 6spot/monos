# State Ownership in the Web Client

Sources: [UI](../../../docs/07-owner-review-and-ui.md), [formal state](../../../docs/06-state-and-formal-data.md), [delivery](../../../docs/04-workspace-and-git.md).

## State categories

| Data | Owner |
| --- | --- |
| Task/Node status, operations, acceptance, messages | Backend canonical records/projections |
| Cached reads | TanStack Query |
| Selected view/filter where shareable | URL/navigation state |
| Composer drafts, open dialog, local field values | Scoped React state |
| Provider transient stream | Provisional presentation, never canonical reply |

Do not add a global state library initially. Context may share stable UI/session dependencies, not create a second execution store. Derive counts/labels from validated projections rather than maintaining independent counters.

## Product rules

Capture does not invoke AI. Opening a Todo does not invoke AI. Discussion starts on an explicit interaction. Todo ordering reflects Discussion activity, not background execution.

Board maps PLANNING to Ready to start; RUNNING/BLOCKED/REPLAN_REQUIRED to Running with applicable attention; REVIEW to Review; COMPLETED to Done; CANCELLED to history. Queueing is not failure. No percent progress or invented ETA.

## Acceptance and conversation

Before acceptance, unresolved requests can disable Accept with a reason. Successful acceptance freezes the exact batch. Later chat is saved/answered but cannot disable delivery Retry, pause CI/merge or change its result. Display the server's accepted-operation attribution; the client must not classify messages based on local timestamps.

Explicit Request Changes/Cancel use backend guards. Partial delivery offers finish/Retry or Cancel remainder. Completed Tasks stay terminal; further implementation starts through Todo Discussion as an independent Task.

Wrong: set Task COMPLETED optimistically after the Accept HTTP response.
Correct: show the admitted operation, then reflect the authoritative final delivery outcome.

## Attempt log reconnect

Keep the selected Attempt log cursor with the rendered or otherwise retained entries.
Advance it only after those entries are retained, so a failed render or interrupted
request can safely replay the same page. `has_more=false` describes one read, not
the end of an active Attempt; continue polling while status permits later Runtime
events. Show gaps and factual activity without inferring Task/Node progress or a
formal outcome from log text.

## Verification

Test two tabs racing Accept/message, stale projections, correction during delivery, pending conversation after completion and partial failure. Client refresh/navigation never advances lifecycle.


## Configuration drafts

Project/Role drafts are keyed by stable IDs, retain their original control version,
and survive record/view switches. Policy/provider drafts are scoped to their form.
A snapshot refresh never rebases an edited draft. Conflict refreshes canonical data;
only explicit Reload saved version discards a draft. No browser persistent storage
contains passwords, keys, session tokens or pending commands. Secrets clear on
committed save (including recovered receipts), logout and session revocation.
