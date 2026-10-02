# Execution Board and Task workspace

## 1. Scope / trigger

The Execution UI exposes canonical execution and exact Owner controls. The backend
remains the lifecycle authority. `features/execution-board.tsx` owns the collection;
`task-detail.tsx` composes Conversation, Overview, Timeline and Execution details.
Local REVIEW is a local result, not acceptance or remote delivery.

## 2. Signatures

- `#board?project_id=...&attention=needed&history=all` selects Board filters.
- `#task?task_id=...&section=conversation|overview|timeline|execution` selects a Task;
  Conversation is the default. `#execution` remains Execution settings.
- `taskRead(taskId, suffix, schema, query?, sessionId?)` validates scoped reads.
- `submitTaskIntent(intent, sessionId)` / `recoverTaskIntent(intent, sessionId)` use
  the existing execution, conversation, specification and replan command families.
- `useTaskCommands(sessionId, onUnauthorized)` owns Task drafts and exact pending
  commands, above conditionally mounted Task pages.

## 3. Contracts

Task-only sessionStorage is an explicit exception to memory-only configuration,
Todo and preview state. Store no credentials, provider configuration, raw logs or
arbitrary URLs. The versioned journal key is `monos:task-ui:v1:<session UUID>`;
limits are 2 MiB, 64 Tasks, 64 draft scopes and 32 pending scopes per Task. Validate
all loaded envelopes against an allowlist of generated command schemas and exact
Task identity. Never evict unresolved commands to meet quota.

Persist the complete immutable envelope before POST. Recovery reads its original
receipt; only authoritative `unknown` permits replay of the same payload and IDs.
Do not POST on mount. Do not infer success from HTTP 200 or generic `committed`:
each command requires its actual result fields and matching identity. A newer
composer draft survives an older request's success.

Confirm and apply/publish are explicit separate operations. Canonical proposal
reads recover exact confirmation IDs across reload. Direct Owner
`edit_specification` authorizes and admits the complete displayed change; it is
not a draft-save endpoint. Closing/reopening the editor preserves its text, basis,
summary and impact. Replacing that basis requires the explicit new-edit action.

Successful session reads expose a non-authenticating `session_id`. Task reads and
commands carry `X-Monos-Session`; the server first authenticates the credential,
then compares this UUID. A preliminary GET alone does not prevent cookie replacement
between preflight and POST. Clear private Task storage/queries on logout,
revocation or verified replacement. An epoch and mount guard fence late callbacks,
including callbacks after awaited query cancellation. Transient session-read errors
preserve drafts.

Query keys contain Task identity and read scope; Board keys contain all filters.
Selected scopes poll canonical reads. Refresh shared configuration on Board/Task
entry and Task identity changes, including fragment-only Task switches, so newly
created Project names resolve without resetting retained editors or command bases.
Every bounded history/operation list must
expose its continuation, including decisions omitted from summary caps. Runtime
logs remain in diagnostics; formal events and separately grouped execution flow
must not promote raw text into lifecycle facts. Label observation/admission times
accurately when actual start/completion timestamps do not exist.

## 4. Validation and error matrix

| Condition | Required behavior |
| --- | --- |
| Corrupt/incompatible stored journal | Preserve it, disable new Task commands, offer safe retry |
| Storage quota/write failure | Keep the draft in memory; do not send an unpersisted command |
| Lost response or incomplete/mismatched receipt | Retain exact pending command and Check request result |
| Unknown receipt | Replay original envelope once through normal server idempotency |
| Definitive version/precondition failure | Refresh facts; keep draft and original basis for explicit correction |
| Session UUID mismatch/unauthorized | Clear private session state; prevent late callbacks from restoring it |
| Read failure | Show retry without discarding drafts or fabricating empty canonical state |
| Event reset required | Read fresh Task overview before resuming from its event cursor |

## 5. Good / base / bad cases

Base: a Ready Task can receive a question without starting planning.
Good: two tabs race Start; the winner creates one intent, the stale caller sees a
conflict. A lost specification confirmation is recovered before explicit Apply.
Bad: after reload, regenerate a command ID or silently replace its old basis.

Terminal Task questions remain available. Further execution links back to Todo;
no new Task proposal/creation belongs in Task Conversation. Dismiss Replan and
withdraw linked requirements remain independent decisions.

## 6. Tests required

`lib/task-api.test.ts` and `task-storage.test.ts` cover allowlists, receipt identity,
malformed/contradictory unknown results, corruption, limits and epoch fences.
`test/execution.e2e.ts` verifies actual authenticated routes, scoped drafts/reload,
lost/unknown replies, two clients, session replacement, controls and responsive
screens. Joint requirement/Plan approval and publication each need committed-response
loss plus reload coverage, preserving both exact confirmations and one publication.
Fixture Runtime acknowledgements are synthetic and do not prove native
execution. Inspect current-build desktop 1440×1000 and mobile 390×844 screenshots;
retain routes/state/build identity. Shared-shell edits also require existing Web
regression tests. Final acceptance is recorded per task, not inferred here.

## 7. Wrong vs correct

Wrong: a delivered instruction becomes "implemented", or an old completion is
shown as current because its Node once completed.
Correct: render exact current manifest applicability, keep original revision and
activation attribution in history, and distinguish saved input, delivery, formal
completion, local review and eventual Owner acceptance.
