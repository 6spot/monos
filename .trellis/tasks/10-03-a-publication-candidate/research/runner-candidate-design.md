# Research: Durable Runner publication candidate and complete local range scan

- Query: Smallest durable idempotent exact-tree candidate with verified public parents, actual publication-range findings, recovery and Stage A boundaries.
- Scope: mixed (repository implementation + official GitHub limits/permission documentation)
- Date: 2026-10-03
- Assignment: Runner/local Git only. Read-only outside this file; no host, model, provider mutation, implementation or Git mutation. Existing framework dirty changes were inspected and preserved. Collaboration contract direct-child depth cap applies; no nested delegation.

## Findings

### Required contract and current implementation

`docs/04-workspace-and-git.md:201–220` requires local candidate construction and checks on REVIEW in both preparation modes; automatic remote preparation is default and has no Owner Prepare PR step. `:273–289` requires exact result tree, controlled public parents, stable construction inputs and explicit delivery ref; private Agent/completion ancestry is excluded, not rewritten or sanitized. `:214–216` requires every newly reachable commit and introduced/changed file version, including later-deleted content, plus the final tree; redacted findings and exact-version eligible overrides cannot bypass hard provider limits/permissions. `:291` requires explicit remediation for already-published sensitive history rather than ordinary automatic history rewriting.

`docs/09-first-executable-slice.md:25–39,118–134`: Stage A is one Node/repository with GitHub delivery; preserve collection cardinality and two-worker safety. Full multi-repository/plain-Git/after-acceptance final delivery is later V1. This leaf can prepare/scan local candidates for after-acceptance mode without implementing its remote publication/acceptance sequence. No new Task states, Agent role taxonomy or Task resource binding (ARCHITECTURE and docs/08 read).

**Currently implemented:** exact finalized completion, private service-owned result export, typed bounded read-only Owner file/diff transport. **Not implemented:** publication candidate, publication scan, publication permissions snapshot, published-head reconciliation, local delivery outbox, finding overrides. A previous successful `complete_node` result is not a public delivery commit.

### Files found and reusable patterns

| File | What to reuse / boundary |
| --- | --- |
| `runner/internal/host/finalize.go:44–139` | Persist frozen commit inputs before commit-tree and keep operation ref for exact replay. Do not reuse private parent or Agent metadata. |
| `runner/internal/host/snapshot.go:94–158` | Completion bare export at `Root/results/<completion_op>`; trusted service-private directories, no-local clone/fetch, exact commit/tree verification and result ref. |
| `runner/internal/host/result_read.go:43–65,81–179` | Cancelable bounded raw Git subprocess; no hooks/replacement objects/lazy fetch, trusted disk/storage lineage and exact export identity. |
| `runner/internal/daemon/result_read.go:15–55` | Existing journal completion/Start/descriptor/digest/success identity chain. Factor reuse without weakening released historical authority. |
| `runner/internal/host/workspace_git.go:73–229` | Verified GitHub remote fetch, service-private pin record, stable base/target refs and provider repository ID. |
| `runner/internal/host/workspace_effect.go:425–445` | Root persists pinned fetched metadata and actual storage identity before materialization; original observations stay attributable. |
| `runner/internal/host/workspace_git.go:481–555` | Service fetch worker uses exact root operation and service-owned resource lock; private pin file path. |
| `runner/internal/journal/journal.go:193–219,267–305` | Immutable original operation and exact outcome; useful precedent, but existing table/types are Attempt effects. |
| `runner/internal/host/helper.go:183–216` | Atomic fsync/write/rename/directory sync precedent; default 0644 is unsuitable for new private intent/finding files. |
| `runner/internal/daemon/daemon.go:167–194` | Bounded connection worker tracking/deduplication; nonworkspace work currently holds daemon mutex, unsuitable for long scans. |
| `packages/protocol/schemas/v1/contracts.json:11448` | Full `ResultReadIdentity`; reuse source identity instead of rebuilding a weaker result scope. |
| `packages/protocol/schemas/v1/contracts.json:6314` | Existing repository-access result has repository ID/default branch/read authentication, no workflow-write permission. |
| `infra/runner/bootstrap.sh:114–135` | Root/service dual storage ID and service-private result/service directories. |

### Trust chain for exact source

Before candidate writes, reuse `retainedResultIdentity` to bind successful completion operation, dispatch/Task/Node activation/Spec/Plan, manifest digest, immutable operation identity digest, workspace descriptor digest and physical effect result. Backend separately owns current applicability; historical completed bytes remain inspectable, but a stale completion cannot become current publication authority merely by matching Git OIDs.

`result_read.go:81–136` checks root + service storage IDs and service-private bare export, owned HEAD/config/objects/refs and absence of alternates; `:166–178` checks exact identity digest, result ref, commit tree and base. Factor these identity/trusted-export checks into a shared helper called by read and candidate preparation, rather than invoking a synthetic file read or duplicating subtly different guards.

No candidate command uses mutable Task workspace HEAD/index/files as its input. It uses the immutable successful completion export's exact tree. No Host supervision call, Agent start, writer lease or root process is needed: candidate objects belong to the unprivileged service account.

### Existing proof of public parent origin

`workspace_git.go:86–103,142–149,224–228` retains service-private `<open_op>.json` with original workspace digest, base ref, target branch, GitHub repository ID, complete flag and fetched metadata. Its production path is `Root/service/workspace-operations/<open_operation_id>.json` (`:553`). The service worker derives source URL only from verified repository identity/access, rejects provider repository mismatch (`:79–84`), and resolves remote heads/tags without ambiguity (`:175–207`).

It retains `Root/cache/resources/<resource_id>.git` refs `refs/monos/pins/<open_op>/base` and `/target` (`:177–217`). Base fetched at first materialization establishes the recorded existing remote revision; later opens use immutable `w.Basis.BaseCommit` and may reuse an existing cached object (`:196–202`), so **a later pin alone is not fresh independent proof of original remote origin**. Link to the original successful open and first complete pin evidence, not arbitrary existence in cache/export.

Recommended initial parent verification:

1. Exact original successful `open_workspace` operation + descriptor in local SQLite; its Task/workspace/resource/Runner scope equals selected source, and original descriptor/basis establishes first materialization rather than a speculative Agent-supplied revision.
2. Successful open outcome's fixed base/target/repository metadata; canonical completion preserves same fixed base and target branch. Check storage lineage as above.
3. Trusted service-private complete pin JSON with matching open operation workspace digest/repository ID/ref/metadata and exact service cache pin OIDs. JSON's pinned metadata predates root's storage-ID enrichment; compare actual fields rather than requiring whole metadata bytes equal after enrichment.
4. Parent OID is that recorded base; validate object type/connectivity in export/cache. OID existence alone, execution-owned common refs and result-export `origin` are not public-origin evidence.

Root current workspace record is useful materialization/storage confirmation (`workspace_git.go:28–60`) but changes to later leases and is not a replacement for historical immutable original-open provenance. Existing root operation records remain immutable per operation; service can read ordinary root-owned records without adding a sudo filesystem API.

For an additional remote target parent, require exact trusted successful fetch observation and cache pin, same repository/target lineage, and `merge-base --is-ancestor <target> <source_git_commit>` in the immutable result export. Remote target presence alone does not prove it was integrated into the result. Keep deterministic ordered parents: first delivery basis, then optional distinct integrated target. Reject duplicates and private source/completion parent selection.

For subsequent publication, first parent must be last **reconciled published delivery head**, backed by Delivery's durable exact repository/branch/head observation and retained local candidate manifest. No such production observation exists yet. Do not expose an Owner arbitrary parent-OID setter or turn a merely prepared/rejected previous candidate into a published parent. This leaf can define the typed seam and unit-test it; remote truth/reconciliation is the next delivery leaf. An uncertain push prevents replacement under that same delivery item.

### Recommended minimal durable construction (proposal)

Use separate Delivery-owned typed preparation, not existing Attempt `Operation.kind` or readonly `ResultRead` frames. A released completion Attempt cannot own a new mutable effect; Owner GET file reads must stay side-effect free.

```text
PublicationPrepareRequest {
  schema_version:1,
  operation_id, delivery_item_id, task_id, runner_id,
  source: ResultReadIdentity, source_identity_digest,
  parents: VerifiedPublicParent[1..2],
  construction:{version,author_name,author_email,committer_name,committer_email,
                author_date,committer_date,message},
  scan:{scan_id,rule_version,configuration_digest,configuration,permission_basis},
  request_digest
}
VerifiedPublicParent {
  oid, kind:"materialization_base"|"published_delivery"|"integrated_target",
  observation_operation_id, observation_digest,
  repository_identity, storage_id,
  published_observation? // exact reconciled Delivery receipt; no arbitrary OID
}
CandidateManifest {
  candidate_id, preparation_operation_id, source_identity_digest,
  source_workspace_revision, result_tree_id, delivery_head,
  ordered_parents, parent_provenance_digest, construction, construction_digest
}
PublicationPrepareResult {
  schema_version:1,operation_id,request_digest,
  status:"prepared"|"blocked"|"incomplete"|"recoverable"|"identity_mismatch",
  candidate_manifest?,scan_manifest?, // bounded summaries, never raw secret data
  findings_cursor? // read complete immutable pages separately
}
```

Names are illustrative; coordinate exact shared schema with backend researcher. Keep candidate construction identity separate from scan configuration so a rule/permission/config update can rescan the **same head** under a new scan ID without regenerating Git metadata or rewriting an existing operation's immutable input.

Physical stages:

1. Backend atomically admits a local Delivery preparation/outbox record under current Task evidence before dispatch (main/backend ownership). No provider call is necessary to prepare the first local candidate using existing trusted pins.
2. Runner checks protocol feature support, source and parent provenance. Acquire one service-private lock keyed by preparation operation ID; same resource delivery lineage must also be serialized/reconciled by backend item guards.
3. Persist immutable 0600 `Root/service/publication/<operation_id>/intent.json` with full canonical request digest, source/parents and controlled commit inputs; fsync file and parent directory **before** commit-tree. Reject conflicting intent under same ID. Avoid default `saveRecord` 0644 for these private records.
4. Smallest Git store: create candidate in the already-validated service-private completion bare export with operation-specific `refs/monos/candidates/<preparation_op>`. Preserve `refs/monos/result`, source commit/tree and all source worktree data unchanged. If later verified public parent lives in another immutable export, import only its verified explicit public candidate ref locally before construction; no remote fetch, wildcard ref import or alternates. An isolated service-owned bare delivery store is a defensible alternative but adds object import/recovery work; it is not required for the first local leaf.
5. `commit-tree <exact_result_tree> -p <verified_basis> [-p <verified_integrated_target>]` with frozen controlled metadata; message uses fixed Task/version IDs, not Task free text or Agent commit messages. Fixed authors/dates are supplied in a sanitized environment. Verify commit tree and exact ordered parents, and public basis ancestor relation.
6. Set candidate ref with compare-and-set from absent (zero OID of correct hash length). Existing same ref must equal deterministic expected head; foreign/ref drift stops for reconciliation, never overwrites/force updates. Do not advance export HEAD/result ref or any delivery branch here.
7. Persist immutable manifest and scan intent before reporting completion; preserve original rejected candidates and all completed scan histories. A scan failure cannot delete/recreate the candidate under a different head.
8. Complete scan and persist fsynced sanitized finding records/summary. A reply loss replays the same manifest/scan; reconnect repeats the authorized stable backend operation. Backend stores the exact result before marking its outbox done.

Backend's durable outbox plus local fsynced intent/result are enough for idempotent recovery: no second Runner semantic scheduler is required. A small new SQLite publication table is optional, but current Attempt effect tables cannot be reused without violating their type/scope meaning. If using filesystem journal only, retain complete unresolved operation IDs/descriptors and reconcile exact requests on restart; no generic Directory-as-domain state. A distinct bounded publication recovery inventory may aid diagnosis; do not insert non-Attempt work into existing Attempt inventory with fabricated Attempt IDs.

Stages `intent → candidate_ref → scan_started → scan_complete → reported` are local infrastructure progress, not Task states. Cancellation/disconnect can interrupt scan; durable intent/ref survives. Deduplicate workers per operation and use a separate bounded preparation lane rather than holding `Daemon.mu` during a long scan (`daemon.go:184–187`). Requests use the active WSS incarnation, but stable operation identity survives connection replacement. Do not echo errors/raw Git output into logs.

### Complete publication range algorithm

Pin actual `delivery_head`, ordered parent set, verified-public exclusion basis, rule version/config digest and scan ID. The scanner input must be a candidate manifest, not an arbitrary Owner-supplied head or Task's mutable remote tracking ref.

1. Enumerate `rev-list --topo-order <delivery_head> --not <all_recorded_verified_public_parents>` (fixed OIDs, no replacement objects/lazy fetch). Resolve and check every commit and parent explicitly. This is the actual newly reachable set.
2. For each newly reachable commit, enumerate its introduced/changed paths with raw NUL-delimited tree comparisons against **every** parent; union resulting new `(commit,path,mode,blob_oid)` versions. Root commit compares to empty tree. Do not use a combined merge diff: it can omit changes inherited relative to only one parent. No rename detection is required: delete/add is truthful; later-deleted introduced blobs remain in an earlier commit's scan.
3. Also enumerate all files in the final candidate tree using recursive NUL `ls-tree`, including unchanged tracked inherited files. Scan final-tree content/size/ignore findings explicitly.
4. Stream blob bytes, hash them and apply fixed byte-oriented credential rules with bounded overlap across chunks; cache content checks by blob OID/rule digest, but preserve separate commit/path occurrence attribution and ignore/workflow context. Size uses `cat-file -s`; binary/non-UTF8 file content is not exempt from byte-pattern credential rules.
5. Evaluate ignore rules from the exact tree being checked, with version-specific nested `.gitignore` and negation semantics. A blanket path suffix matcher or current worktree `check-ignore` is incorrect. Prefer a service-private temporary pattern-only worktree plus temp index for Git's own `check-ignore --no-index -z --stdin` under exact tree rules; no full source checkout/hooks/filter execution. Materialize only verified regular `.gitignore` blobs, disable global excludes/info-exclude effects, enforce owner/path bounds and cleanup. This proposed Git invocation needs real local Git tests before adoption; do not assume bare-repository check-ignore automatically reads rules from an arbitrary tree. Unsupported/symlink ignore materialization becomes explicit incomplete scan, never pass.
6. Workflow-permission check examines exact `.github/workflows/` additions/modifications/deletions/mode changes in introduced commit changes; whole final tree existing unchanged workflows do not alone require new push permission. A delete can require permission even though no new blob is present. Treat added/modified workflow files in earlier candidate commits as relevant even if later removed.
7. Stable finding ID hashes canonical `(candidate identity,scan rule/config,occurrence commit/path/blob,rule_id)`; never hashes raw matched secret into public IDs. Return rule, commit, path, object/content digest, measured size/limit, eligibility and safe fixed message. No matched value/excerpt/raw stderr/provider credential in persisted finding, response or logs. Controlled message IDs avoid importing private commit text.
8. Persist the complete scan coverage digest/counts: new commit IDs, file-version coverage, final tree, limits/rule/config/permission basis. Mark complete only after all supported coverage is checked. Overflow/unsupported path/timeout/missing object is incomplete and blocks preparation; first N clean records do not mean pass. Finding pages bind exact scan ID/candidate/config digest and are complete within explicit budgets.

**Important distinction:** with valid controlled factory parents all verified/public, a newly generated candidate ordinarily contributes one new commit. Private source commit that added then removed a credential is correctly excluded, so a clean exported tree can pass. Nevertheless the scanner must implement actual history enumeration, not encode the assumption that new range is always one commit. Lower-level real-Git scanner tests can build a newly reachable add/delete chain above a trusted baseline to prove later-deleted detection. Such synthetic inputs do not authorize the production factory to select an unverified private intermediate parent.

Already-published excluded parent history is not freshly scanned in full on every update. Preserve prior scan/provenance facts and explicit known published-sensitive findings; if such exposure is known, block automatic delivery and report its exact published revision. This leaf does not rotate credentials or rewrite remote history.

### Concrete proposed limits and configuration

These are recommendations to freeze in design, not values currently implemented:

| Limit | Proposed value / effect |
| --- | --- |
| Encoded WSS frame | Existing 1 MiB cap; preparation/result reserve wrapper space, summary below 512 KiB. |
| Findings read page | At most 64 items and 512 KiB encoded; scan-bound stable cursor. |
| New commit range | At most 256 commits; above bound incomplete, non-overridable processing guard. |
| Files in one tree / complete final tree | 8192 paths; unsupported total never silently truncated. |
| File-version occurrences | 32768; count all occurrences even if content digest reused. |
| Aggregate unique blob bytes scanned | 512 MiB uncompressed; hard processing guard, separate from publication policy. |
| Per blob content scan | 128 MiB, streamed in 64 KiB chunks; above bound explicit incomplete (also above GitHub regular-file hard limit). |
| Finding total | 32768 deterministic records; overflow incomplete, no authorization from truncated list. |
| Publication policy default | 16 MiB per tracked blob/version, configurable and explicitly eligible if policy allows; scan contents fully up to processing bounds so an override never grants unscanned bytes. |
| GitHub regular Git file hard limit | Greater than 100 MiB blocks; exact provider rule version/config pinned and non-overridable. |
| Preparation processing deadline | 120 seconds per attempt with durable retry under same ID; separate bounded two-worker lane, no blocking WSS handler/heartbeat/Agent slots. |
| Redacted messages | Fixed rule wording, small bounded paths/IDs; no snippets. |

Pin config such as `publication_policy_max_blob_bytes`, scan processing budgets and credential rule version in immutable scan configuration; backend owns Owner-editable policy and provider permission snapshots. Do not call processing budget failures Node capture failures or provider hard findings. If a >128 MiB blob cannot be hashed fully, report its exact Git object OID/size and explicit unscanned state; do not invent a SHA256 content hash from a prefix.

Credential rules should start with a finite versioned high-confidence byte pattern set (private-key header; GitHub token forms; AWS access-key form, etc.), bounded fixed overlap and no arbitrary runtime user regex. A passing pattern scan means these configured patterns were not found, not proof of no secrets. Eligible credential-policy overrides are backend exact Owner receipts; hard size/permission/incomplete coverage cannot be overridden.

GitHub official documentation currently states files larger than 100 MiB are blocked and larger than 50 MiB warn. Use only the block as provider hard rule; the proposed 16 MiB local publication policy is a separate chosen limit. [GitHub large-file limits](https://docs.github.com/en/repositories/working-with-files/managing-large-files/about-large-files-on-github)

GitHub Apps require Workflows permission for access/edit of `.github/workflows` files. Existing monos read-access response does not report it, and public read success or configured App ID does not establish workflow-write authority. Freeze `workflow_write: allowed|denied|unknown` plus exact integration/config version/observed source; unknown behaves as a blocking non-overridable permission finding when candidate changes workflows. No token required in local scan. A new permission snapshot from actual provider/token scope belongs to delivery authorization work; do not infer it. [GitHub App Git permissions](https://docs.github.com/en/apps/creating-github-apps/registering-a-github-app/choosing-permissions-for-a-github-app)

### Protocol, persistence and migration seams

- Add dedicated candidate request/result and findings-read contracts in `packages/protocol/schemas/v1/contracts.json`, regenerate TS/Go/OpenAPI. Strict mode/frame conditionals forbid irrelevant/null/unknown fields. Negotiate optional Ready feature (e.g. `publication_modes:["local_candidate_v1"]`); old Runner returns unsupported before dispatch, not a vague timeout.
- Shared source may directly use `ResultReadIdentity`; put hashes/counters under existing schema definitions. Request digest covers immutable candidate inputs; scan digest covers candidate + parent basis + rule/config/permission snapshot. Generated structs are transport, not authority.
- Add `runner/internal/host/publication_candidate.go`, `publication_scan.go`, `publication_ignore.go` and actual Git tests; factor safe Git/trusted-export helpers from `result_read.go` without changing read semantics. Mutating `commit-tree` needs a separately named sanitized wrapper with frozen author/date inputs; the readonly raw reader intentionally has no mutation metadata environment.
- Add `runner/internal/daemon/publication.go` for source journal validation, bounded duplicate/replay handling and exact results; `control/client.go`/Ready handshake advertises support. Service-private filesystem journal avoids SQLite schema changes if sufficient; if new SQLite bookkeeping is selected, keep it distinct from Attempt effects and test its migrations.
- Backend new Delivery-owned tables/outbox/Owner finding reads/override receipts belong to sibling research/design. Do not add candidate columns to completion manifests or rewrite original operation/effect evidence. Existing publication seam is not a new business PR abstraction.
- Bootstrap can create a 0700 `service/publication` child under already-private `service` (or lazily allocate validated children as service). No new host account, sudo helper action, inbound port or provider write credential.
- Acceptance/final push remains future: push only exact `candidate_ref:delivery_branch`, no mirror/all refs/force; published ancestry replacement guards require durable remote reconciliation. Local candidate preparation cannot claim that remote publication has occurred.

## Tests required and meaningful recovery cases

### Actual Git candidate factory

- Base public commit → private Agent add credential → private remove credential → completion tree: candidate tree exactly equals completed tree, parent exactly verified base; `rev-list candidate --not base` contains candidate only, neither private commit is reachable. Original result ref/source worktree HEAD/index/files unchanged.
- Credential still in final tree produces redacted credential finding; no filtering/export sanitizer. Compare exact tree, modes, symlink target bytes and gitlink OIDs.
- Repeat same operation before/after fsync intent, commit-tree, ref write, manifest write, scan write and response loss: same head/parents/date/message and no extra candidate ref; concurrent same ID admits one immutable result. Same ID changed source/tree/parents/config is rejected, not overwritten.
- Unexpected existing candidate ref/head, storage swap, symlink ancestor/config/objects, alternates, corrupt/missing journal/source manifest/private export/pin JSON/cache pin/provider repository ID all fail without adopting filesystem state. Ensure raw secret-bearing errors never logged.
- Optional merged verified target: source ancestry must contain exact target; factory preserves public basis + target ordered parents; unintegrated target/private parent fails. Duplicate parents fail. Object format SHA1/SHA256 zero/ref handling tested or unsupported explicitly.
- Later publication seam: previously prepared-but-unpublished head cannot be parent; exact reconciled published manifest can be imported as first parent, producing fast-forward. Uncertain outcome blocks replacement; unrelated changed public head not silently overwritten. These are local fixtures, not provider proof.

### Actual Git complete scanner

- Trusted baseline → introduced secret/blob above policy → later deletion: net diff/final tree clean but historical finding exists, exact introducing commit/path/blob attached.
- Merge change differs from only one parent; union per-parent scan catches it. Private source deleted secret excluded from real controlled candidate range produces no leaked finding. Final inherited prohibited content still detected.
- Tracked ignored regular files with nested negation, ignored paths introduced by later `.gitignore`, tracked deletion and temporary add/delete version. Assert evaluation uses each version's exact rules, no global Owner config or current-worktree contamination.
- Workflow add/modify/delete/rename-as-delete-add, unchanged workflow, unknown/denied/allowed permission snapshots. Permission update changes scan digest and invalidates prior finding decisions without changing candidate head.
- Binary credential pattern, chunk-boundary match, invalid UTF8 content, symlink target, gitlink nontraversal, nonUTF8 filenames and traversal/magic/control characters. Unsupported path/ignore rules must be incomplete, not omitted or rendered lossy as a safe file.
- Exact limits: 64/65 findings pages; 8192/8193 paths; range/bytes/version/finding cap boundaries; >100 MiB hard file; configurable 16 MiB policy eligibility; stale cross-scan cursors. Use sparse or streamed generated file fixtures to avoid giant memory allocations.
- No match bytes in durable findings/result/logs/IDs; stable repeated scan coverage/counts/digests and clean-vs-blocked-vs-incomplete distinction. Object SHA256 computed from complete bytes, never prefix.

### Runner/control recovery

Use existing journal/result-read tests for completion/source identity, TLS/WSS fixture pattern in `control/connection_test.go` and daemon recovery tests. Prove old-incarnation result cannot complete current operation, duplicate dispatch doesn't create another commit, disconnect cancels CPU/subprocess but retains intent, fresh authorized restart resumes same operation, and multiple candidate requests leave heartbeats/Stop/readonly result reads responsive. No Agent/Host/process-supervision calls and no network Git commands occur for preparation/scans. Backend PG/outbox test owns two-worker/restart claim safety.

Run focused actual Git/Go tests, `go test -race ./...`, `go vet ./...`, protocol generation drift and producer/consumer tests after schema regeneration. Physical filesystem/permission claims require actual installed Linux evidence where code changes affect those guards; local same-account tests do not replace native two-account deployment proof.

## Related specs

Read: `.trellis/spec/guides/agent-collaboration.md`, `.trellis/workflow.md`, `.trellis/spec/runner/{workspace-guidelines,execution-guidelines,quality-guidelines}.md`, `.trellis/spec/protocol/schema-generation.md`, backend delivery contracts and applicable schema. Root implementation/index contracts remain authoritative; this file is research, not spec mutation.

## Caveats / Not Found / Decisions for design

- New candidate/scan/override transport and persistence do not exist. Exact names and whether Runner uses only fsynced files or a small new SQLite table need main/backend agreement; prefer one sufficient local authority rather than three projections.
- Existing `saveRecord` sets 0644; private findings/intent need stricter writer, not silent reuse. Existing resource cache/service pin JSON trust must include Lstat/parent checks before reading; mere path naming is not proof.
- No workflows-write capability in existing repository-access metadata and no production last-published-head observation exist. Unknown must stay unknown; remote permission discovery/reconciliation is a later provider leaf.
- Stage A factory first public-base + optional integrated target can be implemented now; subsequent published-head support must not fabricate published receipts. Define and test seam while remote adapter is absent.
- Ignore evaluation is the trickiest new Git behavior: factor and verify Git-backed exact-tree evaluation with real Git before relying on it. No code or local Git mutations were performed during research.
- Processing limits are proposed concrete defaults; incomplete scans preserve local result/REVIEW and cannot authorize publication. Ordinary repository files/credentials are never automatically changed by scanner.
- Provider hard limits are dated external facts checked 2026-10-03; record rule version/config in scans so changes invalidate stale findings/overrides.
