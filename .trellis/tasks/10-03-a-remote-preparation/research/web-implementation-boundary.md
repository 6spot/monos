# Remote preparation Web implementation boundary

2026-10-04. Active task: `10-03-a-remote-preparation`.
This is preparation for the assigned Web implementation. Product source remains
read-only until main approves the backend/protocol frozen contract.

## Context and initial state

Loaded the current implement manifest, PRD/design/implement, planning review,
guard/UI and backend remote research, architecture/invariants, relevant workspace
delivery rules, accepted publication/delivery/protocol contracts, frontend index,
execution/session/hook/type/state/structure/component/visual/quality guidance and
collaboration contract. Reused accepted local inspector/candidate source and its
current-boundary evidence, then inspected the actual integration/journal/fixture
seams. Planning review is READY; it authorizes contract freeze, not a completed
remote implementation or installed App claim.

Initial `git status --short`: only existing framework/AGENTS/Trellis guidance,
task manifests/PRD and docs index modifications plus task research/design/implement
were dirty. Web and the two assigned browser fixture sources were clean after
upstream acceptance. All other contributors' changes are preserved.

## Behavior gap and file ownership

Local REVIEW already exposes immutable result inspection, candidate ancestry,
redacted scans and exact policy receipts. The missing Web behavior is the
Delivery-owned remote operation/read projection and its exact Retry/cleanup
attention. Backend owns admission, permissions, provider polling/effects and
settlement; Web renders validated canonical facts and authenticated receipts.

| Expected owned file | Necessary change after freeze |
| --- | --- |
| `apps/web/src/features/remote-preparation.tsx` | Task-scoped adjacent remote collection/detail/history/checks, precise safe states and scoped Retry. |
| `apps/web/src/lib/remote-preparation-api.ts` + `.test.ts` | Generated-schema read/receipt validation, exact Task/item/operation/source/observation/head/page binding, no-store/session/AbortSignal. |
| `apps/web/src/features/task-overview.tsx` | Mount the remote group beside Local results without remounting inspector or candidate children. |
| `apps/web/src/features/task-ui.css` | Existing semantic tokens, wrapping metadata, bounded check/history lists, 44px mobile controls. |
| `apps/web/src/lib/task-api.ts` + `.test.ts` | Add only the frozen remote command/result family and exact receipt route/result checks. |
| `apps/web/src/lib/use-task-command.ts` | Truthful remote Retry notice: request saved is separate from effect reconciliation/PR/check completion. |
| `apps/web/src/lib/task-storage.test.ts` | New generated envelope allowlist round-trip/cross-Task/storage failure/session tests through the existing validator. Storage format need not change. |
| `apps/web/test/remote-preparation.e2e.ts` | Actual built SPA/Owner/PG/WSS interaction with explicitly synthetic provider/push responses; screenshot provenance and fences. |
| `apps/server/test/fixtures/execution-ui-fixture.ts` | Only dedicated fixture scenario/peer ownership and safe deterministic responses. No Start/effect execution. |
| `apps/server/test/fixtures/web-server.ts` | Test-only authenticated scenario routes and approved provider-constructor injection; preserve exact schema cleanup. |

No backend/Runner/protocol/generated/migration/spec/lifecycle edits, nested agents,
commits, host operations or live provider effects belong to this worker. No shared
shell redesign, new store, generic workflow framework or permission inference.
No Prepare PR/Accept/Merge/Request Changes control or placeholder is introduced.

## Placement and truthful projection

Prefer one Task-level `RemotePreparations` group immediately after `TaskResults`
in `TaskOverviewView`. This avoids duplicate remote polling/cards for every
historical completion and keeps terminal Cancel cleanup visible independently of
the currently selected local result. Each item explicitly links its original
source, effective basis, candidate/tree/head and fixed resource/repository.
Contract-approved direct item/operation selection remains pinned across refresh.

Local `ResultInspector` and `PublicationCandidates` keep their existing identity
keys and selection. Provider observation refresh must not clear an open file,
replace its immutable bytes, clear an exact policy review or alter Task state.
Repository-free/no-change/deferred mode never implies a missing mandatory PR.
In after-acceptance mode explain local-only preparation and show actual retained
remote history if any; do not request write access or manufacture an operation.

Distinguish original source vs effective basis vs verified published head. An
explicit same-tree new-source mapping reuses the recorded public head/PR and
immutable published manifest; it is not a newly pushed candidate and conveys no
new Owner acceptance/override authority. Do not rewrite the old source label.

Checks are information for the exact observed head/base: pending, failing,
neutral, skipped, cancelled, incomplete, unknown and no checks stay distinct.
Mergeability is informational; no required-check/protection readiness or accepted
delivery is inferred. Older green observations must visibly become historical
when item/head/base/applicability changes. Preserve timestamped prior facts when
provider reads fail. A provider-merged PR is remote truth, not Owner acceptance.

## Contract prerequisites sent to backend owner

1. Freeze exact list/detail/checks query/result names and paths, page/cursor bounds,
   direct older item/operation lookup and Task/resource/item cardinality.
2. Canonical record includes operation ID/digest/version, source/effective basis,
   candidate/mapping identity, fixed branch/repository/target/PR identity, safe
   phase/failed-step/reason, current flags, exact retry/cleanup capability and
   cooldown/next-observation facts. Guards reference their actual owning
   Conversation/change/reconciliation source rather than browser-derived counts.
3. Checks pages bind immutable observation identity, literal head/base, complete /
   stale/current flags and observation time. One response cannot mix pages from
   two polls. Nonsecret display fields and provider URL constraints are explicit.
4. Freeze Retry command expected version/digest and actual result fields. Both
   known and authoritative-unknown receipts are scoped to the authenticated Task;
   receipt recovery must resolve its original request before new-effect checks.
5. Existing `recoverTaskIntent` derives receipt URL from the family key. If the
   new key differs from its API suffix (for example `remote-preparation`), add an
   explicit receipt path mapping; do not guess a `/remote/commands` route.
6. Approved dependency injection must permit browser-only strict provider/push
   responses through the real coordinator. No production fixture switch, arbitrary
   provider host override or seeded authoritative remote projection is needed.

These are requirements for the producer freeze, not handwritten alternate wire
types. Main approval precedes schema-dependent code.

## Receipt, session and late-response fences

- Extend existing generated command allowlist and bounded
  `monos:task-ui:v1:<session>` journal; preserve all prior families/records. Persist
  the complete exact Retry envelope before POST, with operation digest/version and
  one request ID. Never store token, provider raw response, permission secret or
  arbitrary URL. No POST from mounting/polling.
- Keep `sessionMatches` preflight and actual `X-Monos-Session` header. Preserve
  scope in `[Task, remote item/operation]` command keys, same-tick busy guard and
  epoch/mount checks after awaits. A replacement cookie between GET and POST
  cannot authorize the old command.
- On response loss/incompatible receipt keep the original pending request. Only
  authoritative `unknown` allows the identical envelope to replay. A stale
  version changes available recovery, never silently updates the stored basis.
  A committed/admitted Retry receipt indicates wake/admission, not successful
  push/PR creation/checks. It cannot bypass provider cooldown or unknown-effect
  reconciliation.
- Query keys bind Task/session/item/operation and checks observation/head/base /
  continuation. Consume AbortSignal, then check it after asynchronous digest
  validation. Fresh canonical applicability wins over cached response flags;
  immutable old check bytes remain labelled historical. Do not repeat the earlier
  inspector bug where cached `current=true` masked newer canonical history.
- Logout/revocation/replacement clears private query/journal state using existing
  epoch transition. Selection and unmount abort reads; late page/detail/check
  callbacks cannot restore old selection, private state or mutation authority.
  Transient read/session failure preserves drafts and last truthful observations.
- Read Retry/refetch is separate from authenticated effect Retry. Ordinary
  history has no mutation action. Terminal cancellation retains only the specific
  canonical cleanup Retry capability, not ordinary preparation authority.

## Scenario and screenshot matrix

The rows below define functional risks, not one screenshot set per row. Under the
2026-10-04 user-requested verification-scope clarification, capture representative
distinct layouts at desktop1440×1000 and mobile390×844: preparing, current PR/checks
with long content, mapping/history, reconciliation/cooldown attention, terminal
cleanup, and local-only/empty. Add full-page companions only where scrolling or
overflow needs inspection; identical layouts reuse a same-build image. Each capture binds dirty source,
schema/fixture/server inputs, actual CSS/JS assets, route/selected identity/state
and scroll. Inspect current viewport images against the accepted Multica-derived
neutral hierarchy; retain safe failure evidence and isolate older builds.

| Scenario | Required assertion / visible evidence |
| --- | --- |
| Preparing / Runner offline / unsupported | Canonical phase/reason; local file/candidate remain usable; no fabricated PR or progress percentage. |
| Missing/denied App access / permission | Safe attention with supported recovery, no credential values or guessed grant. |
| Pending input / transferred proposal / issue / guidance / revision | Explain actual canonical pause and point to owning Task section; reply alone does not invent resolution. |
| Same-tree published mapping | Reused exact public head/item/PR with distinct current original/effective source; no new push claim. |
| Current prepared PR | Stable branch/PR/source/head/base; deterministic safe metadata, exact observations and no acceptance claim. |
| Old success, new pending head / base moved | Old green bytes clearly historical; current pending/incomplete facts cannot inherit pass. |
| No checks / unknown mergeability / neutral/skipped/cancelled | Distinct factual labels; no readiness/merge authorization inference. |
| Check and operation continuation | Reach >64 checks and >32 histories or the frozen limits; exact selected observation/operation preserved. Synthetic stress is labelled. |
| Provider timeout / incomplete pages / rate limit | Previous timestamped observation retained as stale, safe read Retry, visible cooldown; effect Retry cannot bypass it. |
| Known failed step vs uncertain push/create/update | Distinct statuses; no duplicate provider effect/PR creation after lost response or zero lookup matches. |
| Retry committed but reply lost / authoritative unknown | Reload and original receipt recovery/replay keep original IDs/digest/version; exactly one admitted intended action. |
| Cancel before/during/after prepare | Terminal Task stays terminal; exact owned PR closure/reconciliation and retained branch; access-denied cleanup remains visible. |
| Owner requirement change / selected history | Canonical authority flips while immutable selected bytes remain; no stale normal Retry. |
| Logout / replacement / Task/item switch / unmount | Held detail/check/page response and command preflight cannot revive private data or cross scope. |
| after_acceptance / no-change / repository-free | Local inspection remains truthful; zero remote write/token requests in this leaf. |
| Long names and literal provider strings | React text, bounded safe metadata, validated link, contained scroll, keyboard/focus and 44px mobile controls, no page overflow. |

## Fixture and gate plan

Use the existing isolated PG browser process and owned fixture Task/Runner. Opt
into new remote capability only for the remote scenario; existing synthetic
execution/result/local-publication peers keep their old behavior. Configure the
scenario's automatic mode via normal authenticated Configuration, not a global
product bypass. Coordinate the frozen provider injection/WSS frames with backend
before creating the peer. Retain exact original results across reconnect; never
interpret unrelated Start/effect frames as real execution.

After freeze: API/Task journal units, affected root/Web types and scoped lint;
backend route readiness; Vite build and focused real built-browser scenarios.
Run related inspector/publication/execution regressions only for changed shared
inputs. Retain exclusive current-task evidence paths and graceful fixture exit;
observe the exact owned namespace/prefix before/after and do not drop unrelated
concurrent backend schemas. Coordinate port18555 ownership before launching.

This planning note is the only worker edit so far. Product/type/build/provider/
host tests are intentionally not run for a read-only boundary report. Product
verification and PNG inspection remain required after approved implementation.
