# Controlled local publication candidates

## 1. Scope / Trigger

Automatic local preparation of a current modified Git result after settled REVIEW.
This is Delivery system work independent of Runtime Attempts. It runs for both
`remote_preparation=automatic|after_acceptance`. It creates no remote write,
PR, accepted delivery, write token or new Task state. Repository-free results and
physically equal base/result trees create no delivery item.

Sources: server `publication-{candidates,candidate-reads,commands,policy}.ts`,
migration `0022_publication_candidates.sql`, Runner `internal/host/publication_*`
and `internal/daemon/publication.go`, protocol `contracts.json`, Web
`publication-candidate.tsx`. Read [result identities](result-content-reads.md),
[delivery](delivery-contracts.md), [workspace](../runner/workspace-guidelines.md)
and [architecture](../../../ARCHITECTURE.md).

## 2. Signatures

```text
GET /v1/owner/tasks/:task_id/publication-candidates?source_operation_id=...&cursor=...
GET /v1/owner/tasks/:task_id/publication-candidates/:candidate_id
GET /v1/owner/tasks/:task_id/publication-candidates/:candidate_id/findings?scan_digest=...&cursor=...
POST /v1/owner/tasks/publication/commands
GET /v1/owner/tasks/:task_id/publication/commands/:request_id

PublicationPreparation(db, instanceId).pump()
PublicationPreparation.pending(runnerId, incarnation, supported) -> Frame[]
PublicationPreparation.finish(runnerId, incarnation, page) -> PublicationACK?
```

Authenticate the existing Owner cookie/session UUID. Reads are no-store/nosniff.
History pages contain at most 32 records, finding pages at most 64 findings and
512 KiB encoded. Canonical cursors bind Task/source or Task/candidate/scan and
their exact immutable position. Direct candidate lookup reaches older candidates
without depending on the first history page. List and direct candidate reads take
the Task `FOR SHARE` before deriving applicability; concurrent canonical Task
revision writers must not mix old effective identity with newer admission facts.
Locks never span Runner or provider I/O.

Ready optionally advertises `publication_modes:["local_candidate_v1"]`.
Dedicated frames are `publication_prepare`, `publication_result`,
`publication_ack`, each with schema_version, incarnation and exactly its payload.
They are not Start/effect frames. The Runner uses a separate two-worker lane.

Migration 22 owns `delivery_items`, `delivery_operations`,
`publication_result_pages`, `publication_candidates`, `publication_scans`,
`publication_findings`, `publication_override_receipts`,
`publication_command_receipts`. Delivery operations initially have nullable
item_id; only prepared physical results create the item. Immutable identity,
terminal result, pages, candidates, scans, findings and receipts are protected by
DB triggers. Pending dispatch state is mutable; terminal facts are append-only.

## 3. Contracts

### Exact source, public ancestry and construction

Digests use existing canonical JSON SHA256 in TS and Go. `source_digest` covers
the entire original `ResultReadIdentity`; original Specification/Plan attribution
is never rewritten. `effective_basis_digest` separately covers Task, current
Specification/Plan, original completion operation and completion manifest.
Applicability requires exact canonical result/carry, current effective basis,
finalized workspace head and current relevant configuration.

First public parent is the original successful Basis-absent materialization,
including exact operation, workspace, raw outcome and observation digest.
Runner verifies retained SQLite/journal and trusted pin/cache/storage/repository
lineage. OID presence or a later open does not establish public provenance.
Original construction uses that verified base. Subsequent automatic preparation
may use the exact reconciled published proof under
[remote preparation](remote-preparation.md). Additional integration-target transport
remains deferred; its direct factory checks do not prove the public-store production
path. Prepared local heads cannot be labeled published.

`PublicationConstruction` freezes construction/candidate IDs, source digest,
repository, target branch, ordered parent proofs, author `monos`, email
`monos@localhost`, ten-digit Unix timestamp with `+0000` and fixed message
`monos Task <Task UUID> result v1`. The candidate has exactly the result tree and
only verified public parents. Private Agent commits/messages/parents do not become
reachable. Original export, workspace and refs retain their attribution.
Create `refs/monos/candidates/<construction_id>` by absent-to-exact CAS. Conflicting
refs or uncertain evidence require reconciliation, not a guessed new identity.

`PublicationPrepareRequest` freezes operation_id, scan_run_id, complete source,
effective basis, construction and configuration with their digests. Incarnation
is transport scope, not operation identity. Crash/reconnect replays the identical
request. Explicit Retry after terminal incomplete creates a new operation/scan
run over the same construction/head/tree/parents/metadata.

### Admission, pauses and transport

Pump requires settled REVIEW, no Specification publication slot, pending Replan,
unreleased process or workspace lease. Require exact current Git result; physical
tree comparison decides no-change. Admission is serialized under canonical Task
and configuration guards. Cancel disables new dispatch; late exact replies may
persist history but cannot restore applicability.

Filter canonical paused guards before the bounded due-row scan (16 rows), recheck
source/config/admission under Task lock, emit at most two frames. A racing pause
defers the same operation five seconds. Selecting oldest two rows before checking
their pause state can indefinitely starve later dispatchable Tasks.

Authenticate owning Runner, current backend instance, live socket and incarnation
for each reply. Pending operation dispatch incarnation must match; settled exact
pages can replay an ack on the current connection. Result persistence and ack are
separate so response loss is recoverable. No DB transaction spans physical work.

### Scanner and sanitized findings

Scan every newly reachable commit against every verified public parent, all
introduced/changed versions against every commit parent, including versions later
deleted, and the complete final tree. Do not scan private Agent ancestry excluded
from the candidate. Coverage tracks commits, paths, versions and unique blob bytes.
Each emitted finding has a unique stable finding-level `occurrence_ordinal`;
multiple rules on one version must not reuse the version coverage counter.

Git uses literal, bounded subprocesses without hooks, filters, external diff,
textconv, lazy fetch or submodule fetch. Ignore evaluation uses the exact tree's
`.gitignore` patterns in a private temporary pattern-only repository, excluding global and
info excludes. `git check-ignore --stdin -z` must omit
`GIT_LITERAL_PATHSPECS=1` because Git rejects that combination; NUL stdin supplies
literal names. Unsupported ignore/path/object conditions are incomplete.

Finite credential rules v1: PEM private-key headers; GitHub classic
`gh[pousr]_[A-Za-z0-9]{36}`; fine-grained
`github_pat_[A-Za-z0-9_]{22,255}`; AWS `(AKIA|ASIA)[A-Z0-9]{16}`.
Process bounded chunks with overlap and hash the entire blob only after complete
reading. Rule success does not certify a secret-free result or provider pack size.
No arbitrary regex is admitted.
The 8192 path bound applies to each enumerated tree. Coverage.paths counts distinct
visited paths across trees and may exceed 8192; complete coverage.paths never
exceeds coverage.versions. Do not impose a different aggregate path contract.

Finding kinds: tracked_ignore, publication_policy_size, provider_hard_size,
credential_pattern, published_credential, workflow_permission. Safe messages/rule
IDs are frozen schema enums. Never emit matched values, snippets, raw stderr or
tokens. Credential-bearing filenames and baseline filenames use exactly
`[redacted credential path]` plus their redacted flags; do not hash sensitive paths.
Exact paths remain private Git data. Backend independently validates redaction,
kind/rule/message, eligibility, size facts, baseline parent and finding ID before
storing pages. Finding ID hashes candidate manifest digest, configuration digest,
scan_run_id and sanitized finding facts excluding finding_id; no circular scan hash.

Known-public exposure applies to any scanned credential version whose blob occurs
at any path in a verified public baseline. Rename/copy/later deletion does not
make it eligible. Attribute exact baseline commit, safe baseline path, blob,
complete content digest and credential rule. Required
`PublicationRecord.known_public_exposure_count` derives distinct immutable
(baseline_commit, blob, content_digest, credential_rule_id) facts across all scans
for the same Task/resource/repository item. Later clean/new-source/no-change scans
do not clear that separate guard. No remediation setter exists in this slice.

| Bound | Frozen production value |
| --- | --- |
| Local blob policy | 50 MiB |
| Provider hard blob limit | Greater than 100 MiB |
| Processed blob / unique aggregate | 128 MiB / 512 MiB |
| Commits / paths / versions | 256 / 8192 / 32768 |
| Findings / sanitized evidence | 4096 / 8 MiB |
| UTF-8 path / whole encoded frame | 4096 bytes / 512 KiB |
| Findings per page / physical deadline | 64 / 120 seconds |

Configuration binds policy/rule/traversal versions and permission fingerprint.
Workflow add/modify/delete/mode changes require verified workflow write permission.
Automatic GitHub preparation uses the exact observed App profile; local deferred
preparation retains unknown permission and does not request write tokens. Existing
read tokens grant no write permission. New scans retain explicit workflow_changes;
legacy omitted metadata remains valid history but grants no new remote admission.
Own deadline or limit exhaustion produces immutable incomplete evidence. External
connection/context cancellation is interrupted, without terminal cache, so the
same request resumes. Incomplete/hard findings cannot be waived.

### Pages, reads and precise Owner authority

Each immutable page repeats identical result/summary/count/digests and includes
page_index, page_count, findings and page_digest over that canonical array.
`findings_digest` covers all pages flattened in order; `findings_bytes` counts
canonical UTF-8 bytes (`[]` is two). Accept pages in any order, exact duplicates
replay, conflicting duplicates reject. No candidate/scan/item/ack settles until
all pages and exact counts/IDs/ordinals/bytes/digests/echoed identity validate.
One empty page is required for zero-findings and nonprepared outcomes.

Commands use schema_version, task_id, request_id, name and strict payload:

| Name | Required payload |
| --- | --- |
| retry_publication_preparation | operation_id, operation_digest |
| prepare_publication_override | candidate_id, candidate_manifest_digest, effective_basis_digest, scan_digest, finding_ids |
| confirm_publication_override | proposal_id, content_digest |
| override_publication_findings | Exact prepare selection plus confirmation_id |

Mapped-result selections additionally require their exact mapping_digest; ordinary
selections forbid it. A same-tree mapping retains the old candidate/source manifest
and runs a new current-source/basis scan. Finding reads and waiver applicability
follow that scan's operation/mapping, not the manifest's old source. Old receipts
cannot carry into the new scan or basis.

finding_ids are sorted, unique, nonempty, at most 64. Prepare freezes exact
candidate/tree/head/parents/source/effective basis/scan/config/finding selection;
confirmation requires actual authenticated Owner authority. Apply consumes exact
confirmation and stores immutable receipt. Mixed eligible/hard selections reject
atomically. Only tracked-ignore, local-size and ordinary credential policy findings
are eligible. Replay resolves the prior request receipt before new-effect staleness
checks. Receipt recovery never creates a new request. Development autonomy is not
a product Owner confirmation. Overrides preserve findings and grant no publication,
Accept or accepted-delivery authority.

Web uses canonical reads/commands, session-bound pending journals, safe React text,
bounded scrolling and wrapping, 44px mobile controls. Historical candidates remain
inspectable; fresh current/scan applicability controls authority. Logout/session
replacement/selection change abort and fence late private responses. A clean scan
with known exposure displays both facts and keeps the guard visible.

## 4. Validation & Error Matrix

| Condition | Outcome |
| --- | --- |
| Invalid strict payload/query/cursor/Unicode | invalid_input before admission |
| Missing Task/candidate/scan or crossed cursor | denied_scope |
| Revoked/replaced Owner session | unauthorized; suppress private data |
| Stale Runner instance/incarnation/dispatch | stale_execution |
| Request/page/result/ID/digest replay conflict | payload_conflict; transaction rolls back |
| Stale effective basis/scan/configuration | version_conflict; history remains |
| Hard/noneligible/mixed finding selection | denied_scope; no partial receipt |
| Existing identical command request | Original immutable receipt |
| Repo-free / identical actual trees | No operation for repo-free; no item/candidate for no-change |
| Offline / unsupported Runner | Truthful read status; no fabricated result |
| Missing retained export | unavailable; no clone/export substitution |
| Original retained journal/parent identity mismatch | reconciliation_required / identity_mismatch; no substitute proof |
| Uncertain/conflicting construction ref | reconciliation_required; no useful Retry claim |
| Own scan deadline/bounds/object/path failure | Incomplete with typed reason, unwaivable |
| External interruption | Same durable operation resumes without terminal cache |

## 5. Good / Base / Bad Cases

Good: an ignored blob matching three credential rules emits four unique findings
per scanned occurrence, complete pages settle once, and retry retains its candidate.
Base: a clean complete scan has no findings; a previous published exposure still
appears as a separate positive guard. Empty result is not a secret-free certificate.
Bad: two paused Tasks monopolize a Runner's dispatch limit; a direct read mixes old
Spec identity with new Task guards; private Agent history becomes public ancestry.

## 6. Tests Required

- Shared TS/Go fixtures: strict frames, entire encoded byte/page/path bounds,
  Unicode, safe messages/kind/rule facts, request/scan/candidate/receipt schemas.
- Actual PostgreSQL: migration21-to22 checksum preservation; genuine completion
  admission; competing-worker Task lock/rollback/restart; paused oldest operations
  followed by eligible siblings and original-operation resume; direct read share
  lock versus canonical revision writers; multi-rule full-page settlement;
  out-of-order pages/duplicate conflict/reconnect ack; incomplete Retry; exact
  three-step Owner receipt replay and atomic mixed-hard denial; later genuinely
  completed clean source retaining prior exposure; no-change with zero items.
- Actual Git/SQLite: original Basis-absent provenance/pin/cache tamper; exact tree
  and private ancestry exclusion; CAS/crash/replay/fixed dates/optional target;
  changed versions against all parents, later deletion, final tree; ignored
  multi-rule blobs with unique ordinals independent of coverage; finite-rule
  chunk boundaries/full hashes/binary/UTF-8; filename/baseline redaction and public
  copy/delete; workflow deletion and bounded incomplete coverage.
- WSS: actual authenticated TLS capability/instance/incarnation/ack-loss recovery,
  own deadline versus external cancellation; no Runtime capacity/Start use.
- Built SPA: 64+finding pagination, exact draft/reload/receipt recovery,
  current-to-historical authority, permanent exposure after clean scan, session
  replacement and late-response fences. Source/build-bound desktop/mobile images.
- Native Linux: CGO tests/builds and service-owned actual Git fixture; code-produced
  private export/journal/intent/pages/candidate modes and distinct execution UID
  read/write denials. Supply a unique owned0700 TMPDIR: a world-writable default
  `/tmp` correctly fails trusted-lineage checks. Synthetic baseline fixtures do
  not prove production remote observation or installed Runtime acceptance.

## 7. Wrong vs Correct

```text
Wrong: latest worktree + Agent parents -> force candidate ref -> scan final files
       -> prose consent -> waiver clears findings/exposure -> publish
Correct: exact original completion + verified public proofs -> fixed CAS candidate
         -> every public-range changed version + final tree -> immutable safe pages
         -> fresh effective applicability -> exact authenticated Owner receipts
         -> retained findings/exposure; remote delivery has its own later contract
```
