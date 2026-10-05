# Research: provider design convergence review

- Query: Independently review concrete provider readiness, test-merge applicability, method selection, eight-call budgeting, shared effects and Cancel feasibility.
- Scope: internal design/source inspection; one targeted official documentation follow-up.
- Date: 2026-10-05
- Ownership: this output only; product/design/PRD/implementation files read-only. Existing task PRD/task metadata are modified and design/implement/research are untracked; preserve all concurrent changes.

## Findings

### Verdict

READY for implementation after targeted reread of root's corrected design. The initial per-context test-merge blocker is resolved by whole-input selection, and the concrete protected/unprotected eight-call recipes are recorded with literal ancestry reuse and 15-second scoped check freshness. This does not certify implementation or installed App delivery.

Read: task `prd.md`, `design.md`, `implement.md`, `research/provider-finalization-design.md`; reused previously inspected architecture/spec/provider source. No broad repeated research, tests, authenticated API requests, provider effects, lifecycle changes, commits or nested agents.

### B1: select a complete check input, do not mix required contexts across commits

Initial `design.md:144–148` chooses the test merge OID only if that individual required context has a test-merge result, otherwise falls back to the candidate. Official troubleshooting instead describes selecting the test merge commit when it has status evidence and the head otherwise. It does not authorize synthesizing a successful required set from both inputs. Example: required `build` is successful on head; test merge has unrelated `lint` evidence but no `build`. The proposed per-context fallback would incorrectly advertise `build` ready for the selected merge input. [GitHub required-check troubleshooting](https://docs.github.com/en/pull-requests/how-tos/merge-and-close-pull-requests/troubleshooting-required-status-checks#conflicts-between-head-commit-and-test-merge-commit).

Smallest fix accepted by root: complete collection for candidate and observed test merge scope. When the positively observed test merge OID has any status/check evidence, require the entire applicable required set there; do not fall back per context. Otherwise use the candidate collection. Unknown provenance, incomplete collections or ambiguous selection remain unknown. This conservatively avoids treating documentation's ambiguous check/status wording as permission to combine inputs. Store accepted head/current base/test OID separately; the test merge OID never becomes the accepted candidate.

Collection must observe all check/status evidence needed for that selector, not only query the required names: unrelated test-merge evidence also affects conservative selection. Within the chosen input keep same-name status/check lanes, App identity, latest status ordering and required check completion rules intact.

### B2: concrete effect turn fits eight calls when immutable proof is staged

The initial plan's staged-turn language is feasible but should state this exact protected-branch recipe before dispatch:

| Call | Operation |
| --- | --- |
| 1 | Issue exact readiness grant. |
| 2 | GET exact original PR before bracket; validate head/base/test OIDs and immutable review identity. |
| 3 | GET classic protection for fixed target. |
| 4 | GET complete active applicable branch rules; active unsupported rules remain unknown. |
| 5 | Issue exact merge grant. |
| 6 | GET repository merge settings with contents-write grant; select/revalidate frozen method. |
| 7 | GET exact original PR after bracket with readiness grant. |
| 8 | PUT merge with accepted head and frozen method, only after locked immediate authority/claim recheck. |

The two PR reads provide the existing adapter's current target observations through `base.sha`. Requiring a separate target-ref GET as well would create a ninth call; do not add it without consolidating an equivalent observation or changing the staged contract. For positively unprotected branches, replace call 3 with GET branch requiring `protected===false`; call 4 must still establish empty applicable rules. Bare protection404 is insufficient.

Before this effect turn, stage complete head/test check collections and strict ancestry using literal immutable base/head OIDs. A previously verified compare result with `merge_base_commit.sha===base` remains a graph fact for those immutable OIDs; it need not be recomputed when both current brackets match. If base/head/test/policy/config/accepted scope changed, discard readiness and refresh those prerequisites in staged turns. Store checkpoint data and digests, never installation tokens.

Require a bounded recent complete checks observation at actual mutation admission (for example the existing normal 15-second polling interval), including retained-page observation times rather than making old pages fresh by assigning a new completion timestamp. Slow or oversized staging that cannot meet freshness stays unknown/waiting. Both final brackets and current protection must match the staged scope; supported provider enforcement handles subsequent concurrent check/protection changes. Bypass authority must not be relied upon.

After call 8, a validated synchronous success body can be persisted as original-operation success evidence. Any mandatory fresh merged-PR confirmation can run in a later read-only turn. Missing/invalid/lost response enters reconciliation; it never schedules another PUT. Do not require a ninth call before returning safely. This keeps tokens RAM-only and preserves existing installation cooldown, request deadlines and body bounds.

### Other reviewed choices

- **Methods:** same guarded endpoint supports merge/squash/rebase at identical call cost. Configured preference is frozen in manifest, concrete selection before first intent, settings refreshed with minimal contents-write grant, Retry never selects a replacement. Squash/rebase final OIDs are not candidate OIDs. Clarify that default “first allowed/compatible” is the ordered allowed-method decision under applicable repository/branch restrictions; it must not become a fallback after a selected method has failed or become uncertain. `docs/04-workspace-and-git.md:220` remains authoritative.
- **Supported protection:** classic required contexts, App-aware check runs, same-name collision and strict immutable ancestry are feasible. Unprovable App-bound legacy status stays unknown. Reviews/rulesets/queue/deployment/signature requirements remain unsupported, so neither `mergeable=true` nor an informational aggregate grants authority.
- **Shared effects:** design's Task/item owner across preparation/close/merge is necessary and sufficient as a design seam only if every mutation admission and before-HTTP claim path uses it, including legacy Cancel/Retry and accepted preparation nomination. Implementation must enforce it across tables; installation reservation or independent indexes do not supply this exclusion.
- **Unknown merge:** the initial design correctly retains original PR/head/method identity after response loss and restart, distinguishes validated rejection from transport uncertainty, and never repeats PUT because a claim expired or a later read is open/missing/closed. A merged exact PR proves delivery, without fabricating remote actor or observed method.
- **Cancel:** revoke new effects, keep Task terminal, preserve unresolved merge owner and continue original read-only reconciliation. Suppress close-PR until the unknown merge settles. Late success records history without revival/undo. Exact receipt replay precedes terminal/currentness checks.
- **Authority and scope:** zero/one modified automatic GitHub item, collection-shaped neutral manifest, frozen metadata/scan/mapping/source and real Owner receipt are preserved. Developer authorization and synthetic verification do not establish product acceptance or installed App readiness.

### Validation and integration handoff

Inspection scope: the three current task planning artifacts, prior provider research and targeted official precedence documentation. No tests were run. Root owns updating planning artifacts and resolving convergence. Provider execution owner should cover the distinct mixed-input selector example, protected eight-call intent, preserved immutable compare proof, stale retained-page freshness, default/configured methods, cross-lane claim contention and Cancel during unknown merge. Reuse unchanged archived provider feasibility and upstream preparation evidence at their recorded boundaries.

## Caveats / Not Found

- Targeted final reread confirmed root incorporated whole-input test-merge selection, the eight-call effect recipe, PR target brackets, immutable ancestry scope, bounded checks freshness and exclusion of unsupported/bypass-dependent modes. No remaining provider design blocker was identified. Implementation must measure freshness from actual retained-page observations, not rewrite timestamps to freshen old facts.
- A complete runtime call graph, database exclusion mechanism and typed checkpoints do not yet exist; their implementation is required before claiming provider acceptance. The recipe establishes feasibility, not executed evidence.
- Zero installed live App configuration remains the explicit external gate. This review introduces no live-provider claim.
