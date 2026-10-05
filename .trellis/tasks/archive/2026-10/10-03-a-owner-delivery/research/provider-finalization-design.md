# Research: provider finalization design

- Query: Smallest exact accepted-head GitHub readiness, merge and lost-response recovery extension.
- Scope: mixed; product source read-only, official public GitHub documentation only.
- Date: 2026-10-05
- Ownership: this file only. Root owns design/integration. No credentials, authenticated requests, provider effects, installations, tests, commits or nested agents were used.
- Initial dirty state: existing edits in AGENTS.md, docs/README.md, Trellis workflow/config/specs/tasks/skills and Codex agents/config/hooks; untracked hook tests and collaboration guide. This output was absent. All existing edits preserved.

## Findings

### Source and contract map

| Files found | Purpose / relevant pattern |
| --- | --- |
| `ARCHITECTURE.md`, `docs/08-principles-and-non-goals.md` | Delivery module owns provider effects; exact Owner authorization; no provider semantics in core Task/Workspace identity. |
| `docs/04-workspace-and-git.md:220` | Configured merge/squash/rebase; unset chooses first repository-allowed method in that order. |
| `docs/04-workspace-and-git.md:293–315` | Frozen Spec/Plan/result/candidate/parents/target, input cutoff, expected head, fresh target observations, uncertainty and Cancel. |
| `apps/server/src/github.ts:100–107` | Existing production RS256 installation issuance validates exactly one repository and exact permission profile; reuse it and encryption compatibility. |
| `apps/server/src/github-remote.ts:9–26,42–63` | Profile seam, shared eight-call budget, fixed host/version, deadline, response bound, scoped ETags and finite errors. |
| `apps/server/src/github-remote.ts:73–88,95–105` | Exact PR identity/repository/ref/marker parser and complete checks; currently drops producer App IDs, draft, merged boolean and merge commit OID. |
| `apps/server/src/remote-preparation-poll.ts:14–46` | Persisted collection checkpoints, total-count checks and before/after PR brackets; aggregate is informational and required checks remain unknown. |
| `apps/server/src/remote-preparation-state.ts:24–43,58–88` | Installation reservation/cooldown, remote quiescence/Cancel, immutable original publication proof. |
| `apps/server/src/remote-preparation.ts:157–212` | Token I/O outside transactions, repeat locked authority guard, persist possible effect before mutation, then observation/reconciliation. |
| `apps/server/src/remote-preparation-guards.ts:16–38` | Preacceptance source/configuration/input/scan/exposure guards. Do not invoke these unchanged for an accepted batch: later input is deliberately outside its authority. |
| `packages/db/migrations/0023_remote_preparation.sql:23–44` | Existing mutation-owner uniqueness and immutable observation persistence. Current operation kinds exclude merge. |
| `packages/protocol/schemas/v1/contracts.json:3124,15192,15250` | Resource merge setting and remote informational check contracts; generated TypeScript/Go/OpenAPI originate here. |
| `infra/github/probe.py:52–62,119–156`, `infra/github/uncertain.py:34–35,76–94` | Accepted synthetic expected-SHA/required-status and lost-successful-response proof. |

Related specs read: backend `delivery-contracts.md`, `remote-preparation.md`, `infrastructure-configuration.md`; guides `agent-collaboration.md`, `verification-scope.md`; `.trellis/workflow.md`; assigned task PRD. Upstream preparation acceptance is `4b37552`; it provides preparation, not product Accept/merge authority.

### API and grant facts

Continue the existing `X-GitHub-Api-Version: 2022-11-28` contract. Current documentation examples default to a newer version; do not silently change the production header. The synchronous merge endpoint accepts an installation token with contents write. Its body supports an expected `sha` and explicit merge/squash/rebase method. Documented outcomes include 200, 405 and head-conflict 409. PR `mergeable=null` is unfinished computation; the provisional merge OID is not delivery proof. [Pull requests REST API](https://docs.github.com/en/rest/pulls/pulls?apiVersion=2022-11-28#merge-a-pull-request).

Read classic branch protection using administration read. Required entries have context and optional App ID; strict checks require an up-to-date branch. [Branch protection REST API](https://docs.github.com/en/rest/branches/branch-protection?apiVersion=2022-11-28#get-branch-protection). Check-run responses expose `app.id`; statuses expose creator identity, which must not be mistaken for an App ID. Keep producer and kind separate; use documented latest-run filtering and latest status per context. [Check runs REST API](https://docs.github.com/en/rest/checks/runs?apiVersion=2022-11-28#list-check-runs-for-a-git-reference), [Statuses REST API](https://docs.github.com/en/rest/commits/statuses?apiVersion=2022-11-28#list-commit-statuses-for-a-reference).

The branch rules endpoint uses metadata read and returns active matching rules, including organization-level rules. Rulesets use `integration_id` and their own strict flag. Classic protection is insufficient to establish that no active rulesets apply. [Rules REST API](https://docs.github.com/en/rest/repos/rules?apiVersion=2022-11-28#get-rules-for-a-branch).

Repository merge settings require contents write authority to be visible; missing `allow_*_merge` fields are unknown, never implicit true. [Get repository](https://docs.github.com/en/rest/repos/repos?apiVersion=2022-11-28#get-a-repository). Installation issuance accepts selected repository IDs and requested permissions but cannot exceed the App installation's grants. [Installation token API](https://docs.github.com/en/rest/apps/apps?apiVersion=2022-11-28#create-an-installation-access-token-for-an-app).

Proposed profiles, each selected-repository and RAM-only:

| Profile | Exact requested permissions | Use |
| --- | --- | --- |
| readiness | contents read, metadata read, pull_requests read, checks read, statuses read, administration read | PR brackets, protection/rules, checks and optional ancestry comparison. |
| merge | contents write, metadata read | Read visible merge settings; execute one guarded PUT. No checks/statuses/admin/workflows write. |
| reconcile | contents read, metadata read, pull_requests read | Observe original PR/merge outcome, including after cancellation. |

Acquiring the merge profile to inspect settings does not admit a mutation. Select configured method if explicitly allowed; otherwise select first allowed merge/squash/rebase for an unset setting. Persist selection and configuration/observation digests with the immutable accepted operation before its first merge intent. Every retry retains this method. If it becomes disabled, block that operation; no silent fallback.

### Readiness semantics and bounded support

Preserve the Stage A scope: one modified GitHub repository already prepared automatically. Keep accepted items collection-shaped and reject multiple modified repositories, plain Git and after-acceptance publication before any finalization write. Preserve original source, mapping, basis, public candidate/parents, item, fixed target and exact numeric PR identities. A same-tree mapping is not permission to relabel its old candidate manifest.

Produce a new immutable readiness record rather than relabeling the old informational aggregate. Bind accepted operation/item, source/basis/candidate/mapping digests, current PR/head/base, App/installation/key/configuration, protection digest, check input SHA(s), selected method and collection completeness. Require non-draft open exact PR, exact accepted head, complete supported requirements and current mergeability. `mergeable=true` alone cannot authorize merging.

For classic required checks:

- Normalize context requirements while preserving App binding. Match check runs by context and producer App; latest status by context must stay a separate lane. A producer-bound status without attested App provenance stays unknown; `creator.id` or a bot name is insufficient.
- Missing required checks wait; pending waits; failure/cancelled/timed-out/stale/unknown never pass. Completed check-run success/neutral/skipped can satisfy GitHub policy, while commit statuses need success. An unrelated red check does not automatically fail required readiness. If a required context has both status and check, both must pass.
- Collect exact-head evidence. GitHub may require checks on a test merge OID instead; do not substitute that OID for the approved candidate. Record `(accepted head, current target, test merge OID)` and collect both necessary input sets, or report unsupported/unknown until their exact applicability is implemented. Head and test merge results can disagree. [Required-check troubleshooting](https://docs.github.com/en/pull-requests/how-tos/merge-and-close-pull-requests/troubleshooting-required-status-checks), [Protected branch semantics](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-protected-branches/about-protected-branches).
- For strict protection, compare literal current base/head OIDs and require the merge base to equal the current base; this is an ancestry inference from the returned graph, not a claim that the provider has atomically frozen the target. If behind, request reviewed correction; never update/rebase the accepted branch automatically. [Compare commits API](https://docs.github.com/en/rest/commits/commits?apiVersion=2022-11-28#compare-two-commits).

A narrow initial parser can support classic required status checks and explicitly observed absence of additional supported prerequisites. Active rulesets, required reviews/CODEOWNERS, merge queue, deployments, signatures, conversation-resolution or other unimplemented requirements remain unknown/unsupported. Include an explicit decision matrix for classic linear-history protection versus selected method rather than silently rejecting a supported squash/rebase setting. Unknown fields affecting merge authorization fail closed. Missing protection access or a bare 404 cannot prove that protection is absent. Never depend on App bypass authority to satisfy requirements.

Target movement discards old readiness/checkpoint applicability and triggers new observations. It does not change the accepted candidate or recorded workspace target. Provider expected-SHA enforcement is authoritative for concurrent head changes; this endpoint has no expected-base parameter. Fresh base brackets fulfill the existing architecture; claiming atomic base CAS would require a different contract.

### Durable merge and recovery

1. Accepted authority is a product Owner receipt, not development permission or successful PR preparation. Persist exact immutable accepted batch and item references before provider work.
2. Reuse installation reservation/cooldown and bounded checkpoints. Every turn has eight calls including token issuance and brackets, at most ten 100-entry pages per collection, unchanged scope/total validation and exact-page ETags. Additional protection/test-merge calls require staged progress; do not expand the budget. Reserve budget for mutation and mandatory observation work before setting possible effect.
3. Serialize preparation and finalization by Task then item/operation locks and one shared mutation owner. After token I/O recheck accepted batch authority, no explicit revocation/Cancel, exact immutable candidate/PR/configuration and readiness. Later chat/control-version increments cannot revoke this batch.
4. Persist the exact PUT intent and claim/CAS plus possible-effect flag before sending `{sha: acceptedPublicHead, merge_method: frozenMethod}` to the original PR number. Never hold a DB transaction during HTTP. Expired claim or restart cannot clear possible effect. Existing reservation serializes turns; it is not proof an unknown mutation did not occur.
5. Parse a 200 body strictly (`merged===true`, valid final OID); append proof and finalize only under original operation/item identity. Retain a fresh exact PR merged observation for recovery. Squash/rebase final OIDs differ from candidate head; never compare them for equality.
6. Complete, validated provider 403/404/405/409/422 rejection is a before-success rejection category, distinct from timeout/connection loss/5xx/invalid or lost successful response. Existing `request()` flattens non-2xx to availability errors, so add a narrow merge response classifier without weakening generic request bounds. On definitive rejection refresh remote truth and expose same-batch Retry as appropriate. On an unobserved result enter reconciliation only.
7. Reconciliation reads only the original numeric PR and validates repository ID, PR ID/number, head/base refs, marker, accepted head, `merged===true`, merge time and valid `merge_commit_sha`. A provisional test merge OID, head-only ref observation, PR closure, zero lookup, or unavailable response never proves success or failure. An open PR after an unknown call still does not prove the original call cannot finish: retain unknown, issue no second merge.
8. Cancel revokes new effects and Task stays terminal. Continue read-only original merge reconciliation and retain historical success without resurrecting Task or Owner authority. Do not close an unknown-merging PR until that admitted effect settles. A confirmed merged PR is retained; cancellation cannot undo it.

The PR read proves the accepted head was merged, not which actor or merge method produced it. Retain frozen requested method separately from observed remote facts; do not fabricate actual method attribution after response loss/external merge. This is an evidence limitation, not permission to repeat the PUT.

### Proposed implementation ownership seams

- Provider worker: `github-remote.ts` plus narrow new `github-finalization.ts`/readiness module, `github.ts` only for shared issuance/error needs; own new focused provider parser/recovery tests.
- Coordinator integration: parent-selected accepted delivery coordinator; reuse `remote-preparation-state.ts` reservation and exact item/PR/publication proof. Coordinate edits to `remote-preparation.ts`, guards, state and Cancel paths with the acceptance worker. Current preparation Request union and settled-result handling assume no merge.
- Persistence: parent-owned new migration/schema changes must fence merges against existing preparation effects. Reusing the existing operation table requires extending its kind constraint/request/result contracts and worker routing; a separate finalization table requires one common item-level exclusion check across both tables. Neither a second independent unique index nor installation cooldown alone suffices.
- Protocol: one parent-owned edit to `contracts.json`, fixtures and generator inputs; coordinate all generated TypeScript/Go/OpenAPI writes. A richer provider-internal check record can avoid breaking immutable historical informational checks. New public finalization outcomes remain provider-neutral, with GitHub details owned by the adapter.

### Narrow verification cases and reusable proof

Future implementation cases: exact accepted happy path; stale head rejection; missing/pending/failing required context; neutral/skipped checks; App mismatch/unknown provenance; same-name status/check collision; head/test-merge disagreement; strict behind and moving target; unsupported rules/reviews/queue; all three configured methods and unset ordered selection; missing/disabled settings; complete-page/ETag/checkpoint bounds; eight-call/cooldown preservation; competing claims; dropped successful reply and crash-before-persist; open/missing/closed/changed-head unknown recovery; Cancel during unknown merge; definitive failure then same-identity Retry. Couple claim/Cancel/input cases to real DB evidence rather than helper mirrors.

Reuse archived `09-28-github-head-checks/research/verification.md`: successful isolated old-SHA 409, required pending/failure 405, exact-head 200; retain its earlier transient-405 failed isolation finding. Reuse `09-28-github-uncertain-effects/research/verification.md`: one create and one merge, dropped successful application reply, exact PR/head/final OID recovered by reads. These establish provider feasibility, not current production App delivery, TCP packet-loss recovery, or new method/check semantics. Upstream `10-03-a-remote-preparation` proves unchanged push/create/mapping/Cancel boundaries; do not rerun those just because this leaf adds merge.

## Caveats / Not Found

- Root must resolve exact-head wording versus GitHub test-merge applicability explicitly: support observations bound to accepted head/current base/test OID without calling the test OID the candidate; otherwise expose this provider case as unknown. Do not silently claim head-only CI proves all applicable GitHub checks.
- `docs/04:220` forbids a merge-only shortcut. All three methods share the same guarded PUT; freeze selection and preserve explicit settings.
- Ruleset/review/queue evaluation and producer-bound legacy status attribution are not supplied by the current adapter. No complete provider authorization algorithm was found; unsupported cases need honest readiness states.
- Current docs introduce asynchronous merge/queue endpoints. This proposal preserves the proven synchronous expected-head API and leaves queue/stacked semantics unsupported; no new async adoption is required for this leaf.
- No installed live App configuration is established here (task records zero). Minimal production profiles and synthetic kernel verification remain distinct from a later installed external gate. No product Owner receipt or live provider readiness is inferred from developer authority.
- Validation performed: read-only source/spec/archive inspection and unauthenticated official documentation browsing. No test or live provider command ran; external links are precise documentation references, not a claim of installed API acceptance.
