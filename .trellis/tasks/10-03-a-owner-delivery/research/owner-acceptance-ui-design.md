# Exact Owner acceptance UI research

2026-10-05. Root read-only source investigation; no product/browser/test/provider
effects. Upstream remote preparation accepted at4b37552. Development authority
does not supply an actual product Owner click or receipt.

## Existing seams

- `apps/web/src/features/task-overview.tsx:29` composes exact local Specification,
  work, local result/candidate, remote preparation and Artifacts. It has no final
  acceptance surface. Add one scoped Delivery section while retaining local and
  selected historical inspection. Do not turn the old informational checks card
  into an acceptance authority.
- `features/task-decisions.tsx:42` supplies source-bound command families and
  explicit confirmation/application compositions for requirements/Replan. Existing
  owned Base UI Dialog/Button primitives provide keyboard/focus/mobile behavior.
  Reuse them, not a custom overlay.
- `lib/task-api.ts:6–23` defines the generated allowlisted TaskIntent families and
  routes. `:43–117` checks actual receipt fields, not generic HTTP200/committed.
  Add a delivery family with command-specific proposal/digest/confirmation/batch/
  item-operation-version requirements.
- `lib/use-task-command.ts` persists the exact envelope before POST in existing
  Task/session storage, queries its receipt after uncertainty, and replays only
  authoritative unknown. Keep this journal; do not create another transport store.
- `features/task-conversation.tsx:28–183` keeps the composer available, including
  terminal questions. Terminal copy directs new execution to Todo Discussion.
  `TaskInputOperation.accepted_delivery_operation_id` already labels immutable
  input attribution; show later inputs outside the accepted batch without calling
  them changes queued to alter that frozen result.
- `TaskOverview`, generic Task reads and remote query keys bind Task/session/source;
  upstream current/history/receipt abort fences remain reusable. Current ordinary
  controls require fresh canonical REVIEW/effective basis. Frozen delivery Retry
  must instead bind original batch + actual operation capability/version, so a
  later chat/control-version change cannot silently disable it.

Architecture: docs07 Review/confirmation/conversation sections630–704; docs04
acceptance293–325; docs08 exact Owner acceptance/input cutoff. Frontend index,
component/hook/execution/visual contracts and scoped verification guide were read.

## Proposed smallest composition

Add `features/owner-delivery.tsx` and a typed `lib/owner-delivery-api.ts`; compose
from Overview. Reuse `task-api.ts`, Task command hook/storage and common read
helpers. Extend conversation copy only where batch/cutoff data is displayed.

The backend builds a complete exact acceptance proposal from canonical current
Spec/Plan/completion/evidence/candidate/parents/target/mapping/current scan and
actual eligible waiver receipts. Owner does not manually construct this envelope.
The UI shows the concrete proposal: result summaries/evidence, original versus
effective basis, each public head/tree/parents/target and mapped attribution.
Hidden technical identifiers remain in a disclosure; the actual reviewed version
is visible. Preserve collection-shaped data while supporting zero or one modified
GitHub item. Unsupported multi/plain-Git/deferred modes offer a concrete reason,
not an enabled misleading action.

Preparing a proposal, exact confirmation and admission remain distinct formal
operations. Opening/closing a dialog does not admit delivery; no commands execute
on mount. Dedicated delivery confirmation validates the full trusted proposal and exact
Owner receipt; generic confirmation rejects Delivery proposals. An explicit final Owner action
admits `Accept & Merge`, or `Accept result` for no-change/repository-free work.
Current proposal/confirmation reads recover identities after reload. Material source,
basis or evidence/candidate drift requires refreshed review; unresolved pre-cutoff
input blocks admission, while resolved reply-only sequence drift can retain the
unchanged reviewed proposal and admission stamps the current cutoff.
the UI never replaces a saved confirmation basis automatically.

After admission, show the accepted version and input cutoff, same frozen item,
waiting checks/provider readiness, actual merge/reconciliation/failure/completion
and canonical Retry/Cancel capabilities. Later messages do not hide Retry, reset
acceptance or alter its result. Required-check unknown remains explicit; local
scan success and `mergeable=true` are not readiness. Head drift must not inherit
approval. No Request Changes command is invented in this leaf; its guarded
revocation/restoration implementation belongs to the next ordered leaf.

## Protocol and backend handoff needs

- Protected no-store Task delivery read: current proposal and exact content digest,
  canonical applicability/disabled reason, confirmation, accepted batch and immutable
  item-operation/observation progress/capabilities.
- Proposal/result contracts expose full frozen Spec/Plan/valid completion/evidence
  identities and bounded zero/one supported items. Digests validated before use;
  abort/session fences rechecked after asynchronous validation.
- Dedicated delivery command envelope + strict receipt with real proposal,
  confirmation, batch digest and original operation/version where applicable.
- Overview/conversation read exposes accepted-operation and cutoff safely; current
  Task control-version remains ordinary command authority, not accepted Retry
  authority. Never show accepted/deployed from a merely pending transport response.

## Focused evidence plan

Reuse unchanged API/journal/local inspector/remote preparation component behavior
and upstream provider/native evidence at their exact input boundaries. New checks
cover only introduced ownership/interaction risks: stale confirmation or message
first rejection; actual Owner acceptance then later chat while delivery waits/fails;
same-batch Retry across reload/lost committed response; missing/mismatched receipt;
Task/session switch with held accepted-state response; zero-item acceptance without
remote effects; honest unsupported modes; changed head and required-check unknown.
Couple formal races/frozen authority to real PG cases, not duplicate UI permutations.

Capture only distinct new layouts on the current built SPA: exact confirmation,
frozen waiting/failed delivery, completed/accepted history and zero-item result
where materially different. Desktop1440×1000/mobile390×844; a full-page companion
only if necessary for long evidence. Inspect keyboard focus return, mobile action
reachability and wrapping. Old unchanged components do not need another14-image
reason matrix; new whole-page screenshots must use the actual new build.
