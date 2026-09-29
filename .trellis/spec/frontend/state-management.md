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


## Todo capture state

`features/todos.tsx` owns filter/selection, capture text and Project drafts by
Todo ID. `['todos', ...]` query keys separate list scope and detail identity.
No selection auto-opens an item, and capture/opening never sends a Planner
command. Settings views remain mounted when switching to/from Todos.

`useTodoCommand` keeps one immutable pending command and blocks same-tick
duplicate submits. After committed or recovered save, invalidate authoritative
queries; the receipt's old Todo snapshot must not overwrite a later change.
Organization drafts keep their original version for explicit conflict recovery.
Capture text clears only after commit. Full page reload loses memory-only drafts
and pending requests; communicate this while a result is uncertain.

## Configuration drafts

Project/Role drafts are keyed by stable IDs, retain their original control version,
and survive record/view switches. Policy/provider drafts are scoped to their form.
A snapshot refresh never rebases an edited draft. Conflict refreshes canonical data;
only explicit Reload saved version discards a draft. No browser persistent storage
contains passwords, keys, session tokens or pending commands. Secrets clear on
committed save (including recovered receipts), logout and session revocation.

When an organization command removes the selected Todo from the current filter,
return keyboard focus to the enabled capture input after detail unmounts. Preserve
focus already on navigation/filter controls. Browser tests cover desktop/mobile
archive, restore, assignment and retained drafts.

## Todo Discussion

`features/discussion.tsx` stays mounted within Todos even when selection changes;
`useDiscussion` retains drafts and exact pending requests keyed by Todo ID. Clear
only a committed submitted draft, and recover the same request before another
submission for that Todo. Read status and history with Todo-scoped query keys.

Owner history starts with a bounded recent page; explicitly loaded pages move
backward. Merge by immutable message ID in sequence order, allowing a refreshed
canonical withdrawal disposition to replace an older projection. New input must
appear without fetching all prior history. Status is factual queued/processing/
settling/interrupted state; Stop retains input, Withdraw resolves it without a
reply, and Retry waits for server-verified settlement. Raw Runtime output is never
inserted into Discussion history. Optional Task preview content is a proposal;
creation requires the separate exact Owner command.
