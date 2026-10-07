# Independent schema21 REVIEW inventory review

Active task: `.trellis/tasks/10-03-a-delivery-acceptance`.

Reviewer: `/root/review_final_check`, 2026-10-08. **READY for one root-owned read-only observation.** No actionable defect found in the assigned frozen script/design. This is static diagnostic approval, not global quiescence, canonical source/admission approval or permission to upgrade services.

## Findings (fixed)

None; reviewer changed only this report.

## Findings (not fixed)

No issue found within the projection's declared boundary. Full actual-source validation is a separate pending reader and was deliberately not reviewed here. Every old REVIEW Task, including a negative projection, still requires that canonical/source and native/ownership reconciliation before installation admission. An unavailable future family or a zero prospective count is not absence of ownership.

## Checked behavior

- Exact fixed primary container command invokes only `psql` with container-internal quoted user/database expansion, `-X`, `ON_ERROR_STOP=1`, session default read-only and one explicit `BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY`. Connection metadata and the entire projection/relations/migrations/legacy counts share that snapshot. No mutation, scheduler callback, source-admission function or canonical lock is invoked. Statement/lock/subprocess limits are explicit.
- Original current schema/search path and read-only/repeatable-read mode must match before a successful report. Python accepts exactly two JSON output lines with strict top-level metadata keys. SQL/query/shape/type/checksum/bound failures produce a fixed safe failure report, exit2 and unknown/null future counts without stale partial rows.
- Exact ordered versions1–21 and all21 embedded checksums match current unchanged committed migration files. Required17 base tables must exist as real/partitioned public relations.17 future relations are discovered through catalogs only, not statically queried. Future-family values remain `measured=false,value=null`; unexpected partial/full future relations retain facts but set `ok=false` and exit2. No invented zero is emitted for absent tables.
- Latest complete-operation selector matches `ensureLocalCandidate`: succeeded complete_node, exact Attempt/manifest/workspace joins, finalized workspace commit and descending operation timestamp/ID. It does not seek an older completion when the selected latest source is stale. Every REVIEW Task remains represented, including a null source.
- Currentness projection checks current completed Node activation/effective Plan, exact manifest/operation/Attempt and Node completion/lease links, then the same completed-result carry edges as `task-result-reads.ts`. Recursive Specification and Replan edges require carry disposition and exact operation/manifest/activation attribution; refresh or mere Plan membership cannot supply carry evidence.
- Admission flags mirror the existing local selector's acceptance/publication-slot/Replan/process/lease conditions. They are explicitly prospective: full canonical source/descriptor/launch/digest, original public parent/configuration and actual physical absence remain required. Resource mode defaults do not suppress local candidates in deferred mode; automatic remote configuration does not prove App/token/scan/readiness or a provider effect.
- Legacy migration24 blockers exactly match its preflight: any Task with nonnull accepted operation **or cutoff**, or any Task input with nonnull accepted operation, across all states. Counts and bounded identities are retained; `legacy_acceptance_blocks_migration24=true` is not cleared by `ok=true`. No existing seam is repaired or converted into Owner authority.
- Output is limited to validated IDs, counters, booleans and Git/manifest digests. No raw manifest/source/prompt/result/settings, repository URL/number, connection secret or database stderr is serialized. Counters reject booleans and unsafe integers; unexpected row fields/unsafe values fail. Complete collection counts must match identity cardinality and remain at most1000; SQL's1001-row sentinel makes overflow fail rather than truncate a successful inventory. The8MiB output cap is enforced before output parsing/reporting.
- `canonical_authority=false`, `global_quiescence_checked=false` and `physical_ownership_checked=false` remain explicit on both success and safe failure. The script cannot prove Docker/systemd/native process absence or later schema25 source authority.

## Verification

- Read-only initial scoped status and both complete assigned files, relevant owning source selectors/carry predicate, Specification freeze predicate and migration24 legacy preflight inspected. Other workers' files and the pending canonical actual-source reader were not reviewed or changed.
- Static AST/literal inspection independently compared all21 embedded migration hashes,34 declared relation names against fixed SQL and9 local documentation links/line targets: PASS. No observer import or SQL/host execution occurred.
- Reused delegate's source-only Python syntax evidence; no product tests, migration replay or mirror test matrix run. `git diff --check` passed; these files are untracked, so direct final whitespace inspection supplies the material artifact formatting check.
- Actual root observation/serialization result is still required and must retain script/SQL hashes and immutable execution identity. A failed invocation stays failed; it cannot authorize another task/source or an upgrade.

## Frozen SHA256

| Input | SHA256 |
| --- | --- |
| `legacy-review-inventory.py` | `0036a9e08a2b1274d5893afa9ceca0687cccff2ad45daba24d70ecb5ba96b8da` |
| Fixed `SQL` literal | `7991ca37e69305e6e77549916e11093cc5f680914670e03e5caf8e85770650f3` |
| `legacy-review-inventory-design.md` | `98d45121d762e44783960e1105a874a4f2bdbb061491d53f1e1169e5dcdfc968` |
