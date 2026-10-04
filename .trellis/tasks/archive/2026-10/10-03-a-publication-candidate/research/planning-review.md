# Independent publication-candidate planning review

Date: 2026-10-03. Active task: `10-03-a-publication-candidate`.

## Scope and context

This is an early read-only planning/contract review, not the final implementation gate. Backend/protocol and Runner writers are active; Web waits for the shared freeze. Reviewer owns this note only. Loaded the task's check context, PRD/design/implement, architecture modules 04/05/06/07/08/09, collaboration contract and relevant backend/protocol/Runner/frontend contracts. Initial dirty state includes other-session AGENTS/Trellis workflow/skill/config changes and the active task's assigned changes; all were preserved.

`design.md` resolves policy differences in the research proposals: 50 MiB local policy, separate >100 MiB provider constraint, explicit local override commands, immutable scan runs, no-change-before-item and after-acceptance local preparation. Research's alternative values or proposed APIs are not independent implementation requirements.

## Findings (fixed)

Both planning findings below are now resolved by main/protocol owner in the design and `research/frozen-contract.md`. The original observations remain below for traceability. No product/spec fix was made by reviewer.

- P1: verified public baseline lookup matches the identical credential-bearing blob at any baseline path, records the original baseline commit/path, and remains noneligible. Main additionally adopted this for **any scanned credential version**, including introduced then deleted versions, rather than final-tree-only lookup; Runner was assigned the correction and regression.
- P2: finding paths and baseline paths have explicit redacted flags and a fixed `[redacted credential path]` placeholder. Finite rules inspect filenames too. Sensitive raw paths or matching-value/path hashes are not persisted; stable occurrence ordinals distinguish redacted occurrences. Exact unredacted paths remain ordinary private Git data, not findings/API/journal fields.

## Findings (not fixed)

No remaining concrete blocking planning issue is established. P1/P2 are closed at the contract level; their implementation/regression evidence belongs to the later combined gate.

### P1. Published-sensitive exposure must survive a rename/copy

- Planning source: `design.md:49`, the `published_credential` rule requires the same path/blob in the verified public baseline. Architecture source: `docs/04-workspace-and-git.md:291` requires explicit remediation after sensitive content was already published, rather than ordinary automatic delivery/history rewriting.
- Concrete valid case: the exact verified public baseline contains `secret.txt` with a credential-bearing blob. The candidate renames or copies the same blob to `renamed.txt`. Its OID/content is identical and the baseline proves remote exposure, but matching only `(path,blob)` misses the fact. The ordinary configured credential finding could then remain override-eligible despite known published exposure.
- Minimal contract correction: match identical scanned credential-bearing blobs against any path in each exact verified baseline tree. Preserve the baseline commit and original path as exposure attribution; maintain noneligible remediation status. This does not require rescanning all excluded old history or treating private source history as public.
- Verification required: real Git rename and copy cases, old-path deletion, and retained known exposure through subsequent scan/retry. A prepared private intermediate blob must remain excluded from this public-baseline assertion.
- Sent to main and Runner owner; contract correction adopted as described above. The active Runner draft was read only to confirm the proposed path-plus-blob seam, not to claim final implementation failure.

### P2. Redaction must cover a credential-bearing filename

- Planning source: `design.md:45` forbids persisting/echoing matching values, while findings retain path; backend research also requires synthetic match values absent from serialized responses, UI, logs and errors.
- Concrete valid case: filename is `<synthetic-token>.txt`, and its blob contains the same token. Returning the raw finding path leaks the matched value even if text snippets and Git stderr are omitted.
- Minimal contract correction: define a safe redacted path/placeholder shape in the frozen finding contract, or an explicit incomplete/unsupported-safe-display outcome. Keep exact raw scan attribution inside the Runner private boundary as needed; do not let UI/API or fixed message construction echo the sensitive string. A known synthetic token in both filename and content should be tested across result/pages/journal/UI/errors.
- Sent to main as a contract decision; safe field shape adopted as described above. No product finding is claimed from incomplete code and no schema was changed by reviewer.

## Planning conclusions already consistent with architecture

- New local work belongs to durable Delivery operations and its own two-worker Runner lane. A released completion Attempt and ephemeral result-read exchange do not gain mutation ownership. No new Task state, Role, Task resource binding or generic workflow engine is introduced.
- First public parent requires original successful materialization/open and trusted pin evidence, not OID presence. A distinct remote target also needs proof of integration into the immutable result. A locally prepared candidate is not a last published delivery head; uncertain remote outcomes require reconciliation at the future seam.
- Construction freezes controlled metadata and source/tree/ordered parents before mutation, uses operation-specific absent-to-exact CAS and verifies exact tree/head/parents. Replays retain the head and original inputs; rules/config changes produce scans rather than changing construction metadata.
- Automatic local preparation waits for canonical REVIEW and physical settlement, survives backend restart, and serializes by Task/resource before an item exists. Only actual immutable base/result tree comparison proves modification. Equal trees settle not-applicable without an item/candidate, and repository-free output never manufactures a Git delivery item.
- Interrupted work resumes the same operation. A committed incomplete scan remains immutable; authenticated explicit Retry admits a new scan run over the unchanged candidate. Pending transport recovery must not accidentally become a background loop of fresh incomplete scans.
- Newly reachable history is enumerated against verified public baselines; every-parent version union and final-tree checks preserve later-deleted evidence. Private execution ancestry excluded by the constructor remains private. Binary content, literal symlink target and gitlink metadata handling must not invoke Agent code or submodule/network fetch.
- Processing limits are separate from publication policy/provider hard limits. Complete scans require full coverage; finding-page receipt is not complete scan authority. All pages must agree on immutable operation/candidate/run/config/coverage counts and digests before durable complete settlement and ack.
- Override authority is an actual authenticated exact Owner receipt, distinct from standing development authorization. Current complete scan, effective basis/source/candidate/head/tree/parents/rules/config/permission and sorted exact eligible finding IDs are checked atomically. Stale/cross-scan/mixed-hard/duplicate selections fail as a whole; replay precedes stale-current checks and returns the original immutable receipt. No receipt grants remote permission or sets acceptance/cutoff fields.
- Original attribution and current effective applicability are separate. Cancel, replacement and configuration/rule changes retain history and cannot let late replies restore current authority. Both resource modes run local checks with zero remote writes, write-token minting or Runtime capacity use. Unknown workflow permission stays noneligible; local pattern completion is not a secret-free or provider-success claim.
- History and findings reads are bounded, independently authenticated, no-store and exact selection/cursor scoped; old records beyond page one remain directly inspectable. Web needs session/selection/late-response fences and distinct current/historical/incomplete/offline/deferred labels.

## Frozen-contract review

`research/frozen-contract.md` appeared during review and was read. Its explicit RFC8785 digests separate source/effective basis/construction/candidate manifest from request/run/outcome. Finding IDs use run and facts without their ID, avoiding a circular outcome digest. Construction IDs, controlled metadata and head/ref are preserved across scan retries. Materialization descriptors explicitly require the original successful Basis-absent open rather than a later open that merely reused its base.

Dedicated prepare/result/ack frames have bounded wrappers and no Attempt fields. Page assembly validates repeated result identity, exact duplicate versus conflict, indices/counts/bytes/page and whole-findings digests before complete atomic persistence/ack. Empty results have one empty page. Historical reads and exact source/basis/config applicability remain separate from receipt authority. Override prepare/confirm/consume and receipt recovery stay authenticated and bind the whole exact eligible selection.

The remaining implementation checks are explicit: connection interruption must resume the same intent rather than being accidentally cached as a terminal incomplete result; committed unavailable/reconciliation-required status must have an honest retry_allowed/recovery path rather than an enabled retry that can only replay an immutable error. These are recommended final code-path checks, not established defects in active writers' unfinished code. Full strict byte/Unicode, status/field-shape, runtime enum and cross-language enforcement must be demonstrated by their eventual gates.

**Planning/contract gate: ready.** No additional active-writer exploration or competing build/test was performed after main requested the planning handoff. Final combined review follows writer completion.

## Verification

- Read-only file/status/source searches completed; no product/generated/spec changes, build/generation, DB/host/provider/model action, nested agent, Task transition, commit or archive.
- Planning counterexamples above are source/contract reasoning, not native physical tests. No existing local-result acceptance was rerun or presented as publication evidence.
- Final implementation acceptance remains pending writer freeze and integrated current-input schema/PG/actual Git/recovery/browser/visual gates. This early review does not approve remote publication, delivery acceptance or native Linux installation.
