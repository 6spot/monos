# Queries, Commands and Streams

Sources: [stack](../../../docs/11-technology-and-deployment.md), [Tool Protocol](../../../docs/05-tool-protocol.md), [UI](../../../docs/07-owner-review-and-ui.md).

## Server reads

TanStack Query owns server-read caching. Keys include scope and identity: a Task's messages and another Task's messages must never share a cache entry. Illustrative key shapes, not existing hooks:

```ts
const taskKey = (taskId: string) => ["tasks", taskId] as const;
const messagesKey = (taskId: string) =>
  ["tasks", taskId, "messages"] as const;
```

Co-locate feature queries and commands; use `use...` only for actual hooks. Avoid generic hook frameworks and a second fetch cache.

## Mutation contract

Create one request ID per intended command and retain the exact payload for transport retry. An uncertain result is queried/replayed under that ID; editing the payload or correcting a definitive validation failure is a new command. Never silently replace expected versions after conflict.

Do not issue formal commands from mount effects. UI double-click prevention improves UX but cannot replace backend idempotency. On success, refresh affected authoritative projections. Show accepted-operation progress separately from completed effects.

## SSE and lifecycle

SSE uses resumable cursors with authoritative refresh after gaps. Clean up connections/subscriptions when scope or component lifecycle changes; reconnect must not duplicate messages/events. Never stop cloud execution on unmount or browser disconnect.

Provisional stream content is separate from committed Planner replies. Deduplicate the eventual reply by source identity rather than appending provisional text as canonical history.

## Tests

Exercise scope changes, repeated mount/unmount, reconnect after cursor gap, lost mutation response and double submission. Assert retained drafts and one canonical result. Query cancellation must not become a Task cancellation.


## Configuration and session reference

`useCommand` holds one immutable pending configuration command; an in-flight ref
blocks same-tick duplicate submits. Malformed or unavailable receipt reads retain
uncertainty. Replay occurs only after an authoritative unknown receipt; a definitive
replay rejection may release the pending command while retaining its editor draft.
Commit recovery clears the same record/secret draft as an immediate receipt.

On logout/revocation, cancel reads, update the existing session query to unauthenticated
and remove private queries. Do not clear the session query itself before updating it:
removing its active observer can leave the authenticated view subscribed to old data.
A temporary session revalidation failure must preserve mounted editors/drafts;
authoritative unauthorized responses unmount them. Recheck sessions on window focus.

Hash navigation updates the selected view in the click handler and handles history
changes. The keyboard skip link focuses the main region without changing the view.

Task command persistence and actual-request session binding follow
[Execution UI](execution-ui.md). Task polls use the same scoped TanStack Query
cache; no separate Owner SSE endpoint or transport store is introduced.
