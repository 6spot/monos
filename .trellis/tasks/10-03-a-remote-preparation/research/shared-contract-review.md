# Independent shared contract freeze review

2026-10-04. Active task: `10-03-a-remote-preparation`. Scope is the step 2 shared
schema/generation/validation/fixtures/wire/migration handoff. Only this report is
writable; handwritten Runner, backend coordinator and Web behavior are not being
accepted by this gate.

**Dependency verdict: READY.** B1 and operation-history placement are resolved by
the clarified producer contract. The reviewed schema and generated types support
dependent Runner/Web implementation. This is not combined product acceptance.
No source changes were made by the reviewer.

## Findings (fixed)

### Operation history row identity — main clarification accepted

- Files: `research/frozen-contract.md` Owner reads section;
  `contracts.json:15564` query/page and `contracts.json:15361` record.
- Issue: stable item identity and a latest-item detail route alone do not specify
  how multiple failures/retries over the same source remain distinct selectable
  history. The optional nested operation already supplies the needed identity;
  no extra DTO or route is necessary.
- Resolution confirmed by main: list one row per immutable remote operation,
  descending operation creation time then operation ID; source filter comes from
  request.preparation.source.operation_id. Cursor binds row kind and exact stable
  operation position. One tagged latest applicable local-only fallback per item
  is allowed only when that item has no remote operation. Web selection/query keys
  bind item plus operation, or tagged fallback. Item detail remains latest-item
  and must not overwrite a historical selection. Historical rows are current=false
  even if source/head match; fresh latest detail independently fences Retry.
- Final artifact text verified in the clarified freeze's Owner reads section;
  exact final hash is recorded below. Existing DTOs suffice without expansion.

### B1 — immutable uncertain result resolution producer clarified

- Files: `research/frozen-contract.md:79–86`, Owner Retry section;
  `contracts.json` PublicationPushResult/PublicationPublishedProof;
  `0023_remote_preparation.sql:80–88`.
- Issue: an ACKed reconciliation_required push result is immutable and changed
  result bytes conflict. The operation result/terminal SQL row is also immutable.
  Retry of started/unknown work must retain its original operation and observe,
  but the original freeze does not specify how a later exact candidate-head
  observation becomes an authoritative published proof without replacing that
  result or creating another push. PublicationPushResult has no independent
  resolution-attempt channel. A later backend observation table can support
  append-only resolution, but its producer/transport and trusted Runner local
  verification must be explicit before consumers implement divergent rules.
- Requested resolution: freeze an append-only same-operation resolution/proof
  retaining the original result digest/ACK, including who produces the later
  observation and how Runner independently retains/verifies it for subsequent
  published-parent construction; alternatively explicitly freeze a nonterminal
  treatment before ACK. Neither may overwrite the original result, repeat an
  uncertain push or fabricate a new push operation.
- Ownership: main architectural decision and backend/protocol producer, followed
  by Runner consumer. Reviewer cannot fix contract/source outside owned report.
- Resolution: `frozen-contract.md:93–136` and matching design text now specify
  backend fixed-host authenticated observation of the exact original repo/ref,
  exact candidate-head equality, verified original request/result/manifest/scope
  and original worker_absent=true. Under item lock, append ref and published
  observations linked to the original operation, pin its first valid resolution,
  update item proof and append immediate exposures atomically. Original terminal
  operation/result digest/ACK remain untouched. Settled uncertain operations keep
  an explicit item-level successor/quiescence guard outside the active SQL index;
  resolution removes only this uncertainty, preserving input/exposure/Cancel guards.
- Transport and local proof verification are explicit: the existing authenticated
  local preparation carries the proof. Runner verifies its retained original
  intent/result/ACK and incoming full scope/digests, independently reads the exact
  ref using historical observe-only access for that original operation, then
  atomically retains private resolution alongside the original result. Missing
  evidence, live worker, unavailable or mismatched ref never authorizes construction.
  Later parent verification loads that retained resolution with the old result
  digest rather than requiring original result.status=published. No replacement
  push result, ACK, physical attempt or new remote operation is invented.
- Disposition: **CLOSED for dependency freeze**. Actual backend/Runner tests must
  subsequently prove original bytes/ACK preservation, same-operation resolution,
  exposure retention and new-source construction/mapping with zero repeated push.

## Findings (not fixed)

No unresolved blocking finding at this dependency gate. The specified runtime
correlation, admission, private proof retention and current/history behavior
remain required consumer implementation and final-test obligations, not behavior
claimed by the shared-schema tests or this read-only review.

## Verified boundaries

| Boundary | Read-only conclusion |
| --- | --- |
| Tagged published parent | Published variant requires proof+digest and forbids original workspace/outcome/observation-open fields. Original variants require their original proof fields and forbid published fields. Scope/digest/object equality remains mandatory domain verification. |
| Digest chain | Published proof carries original request and result digests plus full immutable candidate and independent ref observation. Push result does not contain that proof, avoiding a result/proof digest cycle. |
| Same-tree mapping | Mapped result requires unchanged prior candidate plus fresh scan and mapping; prepared forbids mapping. Mapping binds new source/basis/configuration/request and old manifest/published head/proof. New scan baseline is verified published head, not old manifest parents. Provisional construction stays unused. |
| Mapping waiver | New selection/prepare/apply fields preserve old ordinary command bytes. Exact mapping_digest is a required domain equality for mapped selection and forbidden for ordinary selection; schema alone cannot infer current mapping. Confirm/apply must retain exact prepared selection and actual Owner receipt. |
| Permission and ephemeral access | Proof has exact resource/repository/App/installation/key/config/grants/time scope. Stable grant fingerprint excludes observation time/expiry. Observe response forbids claim/proof; push requires claim expiry and verified proof. Explicit nullable expected_head is retained in both TS and Go. Runtime must verify valid calendar/time ordering, 30-second safety and all admitted request bindings. |
| Capability and frames | Additive github_review_v1 Ready capability and exact one-payload publication_push/result/ack frames, current incarnation and no Start/Attempt reinterpretation. Absence means unsupported. |
| Bytes and Unicode | Actual encoded 512 KiB new roots/whole publication frames; HTTP access/permission request/result 16 KiB; raw UTF-8 metadata body 64 KiB, paths 4096 bytes. TS rejects malformed surrogates; Go validates raw UTF-8/surrogates before decode and counts original raw bytes as well. |
| Retry receipt | Committed response requires actual operation_id, operation_digest and operation_version. Unknown forbids invented operation fields. Only actual Owner Retry can create a new operation for terminal blocked + push_started=false + worker_absent=true with fresh admission; all possible-effect histories remain original-operation reconciliation. |
| Checks | Incomplete forbids success/current; stale forbids current. Exact head/base/observation paging, at most 64 entries. Required checks remain unknown; no merge authorization is introduced. |
| Provider operation shape | Push requires prepared, never mapped. PR create requires content/no review, update requires both, close requires exact review/no content. Domain scope, redaction, identity and historical cleanup authority remain backend responsibilities. |
| Migration durability | Additive version 23; no historical migration delta. Immutable intent/item identity, set-once PR identity, monotonic Cancel/may-have-mutated, one active unfinished mutator, append-only permission/observation/mapping/exposure/receipts. SQL constraints do not substitute for canonical guard and uncertain-history checks. |
| Immediate exposure | Every credential finding actually published is retained before the next ordinary effect, including PR create/update. Clean/deleted/mapped results and old waivers cannot clear it; exact reconciliation/Cancel cleanup remain available. Actual coordinator PG scenarios are explicitly pending. |

Full Runner compile remains a documented consumer task: validated parent variants
now use optional pointers, and generated reason/rule enum names changed. That
expected adaptation is not a failure of this shared-wire dependency gate. Runtime
authority and producer correlation are not supplied by generated interfaces.

## Verification

- Loaded current check context and PRD/design/implement, full freeze report sections,
  protocol command contract and previously reviewed relevant publication/delivery/
  Runner contracts. Inspected path-scoped status and preserved all dirty files.
- Initial freeze report SHA256 independently matched
  `b6a210a9949fb32c7f6d45f82c2d90926ad826741a73d646f2b848d0a7db5e64`.
  All **15/15** declared schema/generator/TS/Go/OpenAPI/fixtures/wire/migration/
  registry/PG-test hashes matched current bytes. A later prose clarification must
  be bound separately; it does not silently change this initial report identity.
- Clarified final freeze SHA256 independently verified:
  `696d179ace2e234f5f612bc63e68cf362c975427ff275a51b8e1377ce43580b7`;
  matching design SHA256:
  `cf18d256f01f6617c2890f1dae4792f0e3ea964b9f7bc54102dcbbbac0765314`.
  Re-read both new resolution/history sections and verified all **15/15** source
  hashes again unchanged, plus agreement with main-freeze-input-verification-v2.json.
  Prior `b6a210…` is historical. No runtime test is claimed to cover the newly
  specified resolution/history semantics before consumers implement them.
- Inspected all 28 new schema definitions and the six changed prior definitions,
  strict conditionals, generated optional/nullable representations, OpenAPI routes,
  validation/wire delta, both shared test implementations, all **51** fixture cases,
  migration SQL and real upgrade test code. Historical SQL migrations 1–22 have
  no source delta.
- Reused exact-input producer evidence from frozen-contract.md: protocol generation/
  check PASS; **327 protocol tests** PASS; wire race/vet PASS; root typecheck/scoped
  lint PASS; **2 actual PG upgrade tests** PASS (22→23 and 21→23; 12 unrelated
  tests skipped). Original full command output was not independently rerun or
  claimed as new evidence. These gates cover step 2, not coordinator or full Runner.
- Focused current-source Node probe for trailing LF in new fixed repository URL,
  delivery ref and numeric repository ID: all **3 rejected** by actual TS validator.
  No regex drift defect established. Read-only JSON inspection corrected an initial
  helper lookup from `$defs` to this repository's `definitions`; no source changed.
- Scoped `git diff --check`: PASS. Report formatting/owned-path check follows.
- No repeat broad tests/generation/PG/provider/host calls, product/spec edits,
  nested agents, commits or task state changes. Final combined gates remain pending
  backend/Runner/Web implementation, current-input tests and native/UI evidence.
