# Independent review — Specification changes

Status: **source-ready; frozen Linux/native acceptance pending**.
Baseline: accepted Task Conversation commit `609e392`. Full-scope source review
and final independent regressions pass. This is source-freeze clearance, not
final deployment/native acceptance.

## Findings (fixed)

- Resolved the Agent-apply self-input design ambiguity with backend: Owner must
  explicitly defer the exact applying Planner input first. Apply never silently
  interprets or finishes its current turn. Deferral affects only input gating;
  complete impact is independently checked. Prompt/read paths and the explicit
  defer/apply flow were reviewed; backend final Agent-apply positive passes.
  No product or host changes by this reviewer.
- `task-specification-state.ts` accepted duplicate guidance IDs when their JSON
  dispositions differed, omitting another active ID from the complete impact.
  Independent API test reproduced publication; backend added ID uniqueness and
  complete SQL snapshot membership/type/version checks. Regression passes.
- Migration20 permitted input deferral using an ordinary message receipt, an
  obligation pointing to another obligation's proposal, and deleting a settling
  publication slot. Independent direct-SQL tests reproduced all three. Backend
  added exact deferral command attribution, composite obligation FK and deferred
  active/terminal slot/publication checks. All regressions pass.
- Migration20 incorrectly rejected valid unfinished refresh → completion on the
  refreshed Spec → carry into the next revision. Independent lifecycle test
  reproduced the error. Backend now permits exact parent-Spec completion after a
  prior refresh applicability record while retaining gap checks. Regression passes;
  original activation creation basis and completion remain unchanged.
- Normalized source completeness was missing from proposal constraints. Backend
  added reverse completeness and inner envelope scope/basis checks. An independent
  SQL fixture containing a valid JSON source list but no normalized rows is rejected.
- Added exact Owner authorization-origin and Owner/Agent admission-receipt links;
  mere nonempty `consumed_by` is no longer sufficient. Four independent negatives
  pass: consumption without its owning operation, and forged Owner origin missing
  content digest, command name or Task identity. SQL action predicates use
  `IS NOT TRUE` so missing JSON fields cannot bypass checks through SQL NULL.

## Findings (not fixed)

No remaining confirmed source defect. Frozen Linux/native acceptance remains an
integration gate owned by root; this reviewer does not claim it complete.

The historical full rerun exposed an ambiguous `old.id` alias against PL/pgSQL's
`OLD` pseudo-row. Root renamed it to `previous_proposal`; the final independent
10-case suite now passes. Backend completed exact admission basis, command scope,
request and committed/admitted response checks, including missing-field SQL NULL
handling. Backend's final direct pre-Start edit and Agent apply positives pass
2/2 on the strict SQL. The fair settlement-pump rotation uses durable
`last_checked_at` without altering Owner operation versions; its dedicated
regression passes (backend evidence in `backend-implementation.md`).

### Completed source review checkpoints

- Deferral exempts only exact input processing, never materially changed guidance,
  activation, completion identity or impact from fresh semantic assessment and
  exact authorization.
- Generic confirmation/pre-start publication helpers must not bypass the owning
  domain's attachment, supersession, impact/input and settlement guards.
- A repeated carry must bind immediately previous effective applicability and exact
  original completion; no invalidation gap may restore evidence accidentally.
- All enqueue/promotion, planning/Node/guidance pumps and completion/capture-failure
  projections must honor the same operation-owned freeze. Physical success cannot
  roll back because semantic authority was revoked.
- Same-activation unfinished refresh must retain immutable creation basis and add
  explicit applicability. New activation is for completed invalidation or the
  precisely preauthorized completion-during-settlement branch.
- Withdrawal/replacement/issue transfer must preserve one originating obligation,
  reconcile existing effects and preserve Owner Stop and unrelated blockers.

## Verification

- Full lint: **pass** at the latest review checkpoint.
- Full TypeCheck and native app import: **pass** at the latest checkpoint.
- Independent protocol tests: **6/6 pass**, including valid strict compilation,
  Owner/Agent envelope separation, complete content/impact and receipt requirements,
  one-Node graph limits, bounded exact source/guidance IDs, canonical source-bound
  proposal attachment and exact versioned recovery/deferral negative cases.
- PostgreSQL independent tests: first **5/5 pass** after fixes (56.87s), then
  normalized-source completeness **1/1 pass** (8.11s), then four authorization
  negatives **4/4 pass** (32.62s). Historical full rerun: **1 pass / 9 fail** (75.18s)
  due to the new `old.id` alias regression during normal fixture preparation.
  After the alias fix, final full rerun: **10/10 pass**, 100.82s, session 71802
  (start 00:03:08). Prior failures remain recorded above as historical evidence.
- `git diff --check`: **pass**.
- Frozen Linux/deployment/native acceptance: later integration gate owned by root.
- Root reports build, full Python **179/179** and focused probe **17/17** pass.
  These supplement source review; helper tests do not establish actual native
  publication, physical settlement or applicability acceptance.

Reviewer ownership (confirmed by backend): this report and dedicated suites
`packages/protocol/test/task-specification-review.test.ts` and
`apps/server/test/postgres-task-specification-review.test.ts`. No concurrent
product/spec edits, new service or push.
