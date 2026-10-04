# Runner implementation verification

Date: 2026-10-04. Active task: `.trellis/tasks/10-03-a-publication-candidate`.
Owned implementation: handwritten `runner/internal/{host,daemon,control}` publication
modules, their integration points and meaningful Go tests. Shared protocol/generated
files and `runner/internal/wire` belong to the backend/protocol implementer. Existing
unrelated AGENTS/Trellis/hooks changes were recorded before editing and preserved.
No commits, task lifecycle changes, host installation, provider mutation or model runs
were performed by this delegate.

## Implemented behavior

- The daemon verifies the original successful completion operation, exact retained
  Start/source/workspace/manifest digests, released physical outcome, and original
  Basis-absent successful open. It compares complete original parent descriptor and
  raw successful outcome with their SQLite journal records. Original attribution
  stays separate from effective carried Specification/Plan evidence.
- The host verifies initialized storage/export lineage through the same disk-only
  helper used by unchanged ResultRead behavior. It checks exact result ref, commit,
  tree and base, rejects administrative Git symlinks/alternates/unsafe owners or
  writable files, and validates the complete original service pin plus exact cache
  pin, provider repository identity and generation/lease/target lineage. An OID's
  mere existence is not public proof. Optional target parents must be ancestors of
  the immutable source; production published parents remain rejected until the
  later remote-reconciliation leaf supplies authority.
- Construction inputs, original source and full requests are canonical immutable
  records under validated 0700 service-private directories. New records are 0600,
  atomically installed without replacing existing evidence, file-fsynced and
  directory-fsynced. Directory creation syncs both child and parent. The factory
  uses controlled author/committer, persisted fixed dates and safe Task/version
  message; commit-tree preserves the exact result tree. An absent-to-exact CAS
  retains `refs/monos/candidates/<construction_id>` without changing export HEAD,
  source refs, execution worktree HEAD/index/files or private history.
- Actual immutable base/result-tree equality settles not_applicable without a
  candidate/ref. Construction/candidate/head/ref identity stays identical through
  new scan-run operations. Same operation changed inputs or foreign refs require
  reconciliation. Completed/incomplete scan pages are immutable; external context
  cancellation retains unfinished intent and permits the original request to
  resume. A processing deadline after construction records terminal incomplete.
- Preparation has a separate two-worker lane. It never holds Daemon.mu, occupies
  Runtime slots, invokes Host supervision, fabricates Attempt effects, or schedules
  semantic work. Busy/duplicate requests remain backend outbox work. Dedicated
  WSS negotiation/prepare/result/ack frames fence current incarnation and preserve
  stable request identity. After Ready, previously committed unacknowledged pages
  replay without construction/scanning; exact acknowledgements preserve history.
- Scanning enumerates actual newly reachable commits, every parent's raw NUL diff
  with version union, and the complete final tree. Historical later-deleted blobs,
  binary bytes, literal symlink targets, gitlink metadata and workflow deletions
  retain their correct treatment. Every blob content SHA256 covers complete bytes;
  bytes stream in 64 KiB chunks with 512-byte overlap, using the frozen finite PEM,
  GitHub classic/fine-grained and AWS rule corpus. No matched value/snippet/stderr
  or matching-value/path hash is persisted in findings.
- Exact-tree regular .gitignore blobs are streamed into a temporary private
  pattern-only repository. Actual Git check-ignore uses NUL stdin, empty index,
  no global/info excludes, hooks or filters. Symlink ignore files and unsupported
  filesystem aliases produce incomplete coverage. GIT_LITERAL_PATHSPECS must be
  omitted specifically for check-ignore because actual Git rejects that flag's
  implicit literal magic; stdin filenames are already literal.
- Pinned defaults are 50 MiB eligible local policy, >100 MiB noneligible provider
  finding, 128 MiB/blob and 512 MiB aggregate processing caps, 256 commits,
  8192 paths per tree, 32768 version occurrences, 4096 findings and 8 MiB sanitized
  canonical evidence, 4096 UTF8 path bytes, and 120-second processing attempts.
  Coverage.paths counts aggregate distinct visited paths; max_paths is per tree,
  so aggregate paths may exceed max_paths but never complete versions. Workflow
  permission grants are not inferred from read access; this leaf rejects an
  unobserved allowed configuration at the daemon boundary.
- Known verified-baseline credential exposure matches the same blob at ANY baseline
  path for ANY scanned version, including copied/renamed content later deleted.
  It is noneligible and retains exact baseline attribution. Credential-sensitive
  finding/baseline filenames become the fixed redacted placeholder with flags and
  stable finding-level occurrence ordinal. Accepted findings receive consecutive
  ordinals independently of visited-version coverage, so several rules on one
  blob remain distinct without inflating coverage. Finding identity binds candidate/configuration/run
  and safe facts. Safe finding pages cap both 64 items and entire encoded frame
  512 KiB; total canonical bytes/count/digests agree with immutable summary.

## Owned files

New host modules: `publication_candidate.go`, `publication_journal.go`,
`publication_scan.go`, `publication_ignore.go`, `publication_pages.go`;
new tests `publication_candidate_test.go`, `publication_scan_test.go`.
Existing `host/result_read.go` only extracts shared disk validation without changing
its read contract. New daemon `publication.go` and `publication_test.go`; integration
in `daemon.go` and `recovery.go`. Control integration in `client.go` and new
`publication_test.go`. This report is the only owned task research output.

## Local evidence and input identity

Actual profile: Go 1.27.1 **darwin/arm64**, `/usr/bin/git` 2.54.0 (Apple Git-157),
SQLite CGO and real temporary Git repositories. Executable Go path:
`/Users/me/.local/share/mise/installs/go/1.27.1/bin/go`.

Final input identity:

- Schema SHA256: `a0068f53fe67643a367e82726ac9b4257ce4d9203416a408e9029cbbbbe84e75`.
- Generated Go types SHA256: `78b3a9559ff7f6a392eb47c1dc4499be815d5fc49950bb9718cdbe5384c28435`.
- Runner/shared-Go/fixture input manifest SHA256:
  `da9b580e00cc10477ae37d66600582e9c5a0daf2ce3464a161af8fcde0649dc4` (118 files).
- Host Go manifest: `61416bb795b07d8a7fbd15f76b9e39eeb6f308d325a1a49a53f773a2b4600bfc`.
- Daemon Go manifest: `55c28a1955b36d2b9f781b9cc064dd2a9405224dba7e8dc21629ee18cdea2a16`.
- Control Go manifest: `d571d16a0f03e72b5c49fb584ea9cd2d4e6169c30f04e11e231f5dabcf06d486`.
- Shared wire Go manifest (owned by protocol implementer):
  `e3968899d04129c72b72924eb3a382a5866151b401daa3b08cbfcb7854680c78`.

Manifest algorithm: recursively enumerate `.go`/`.json` plus `go.mod`/`go.sum`
under `runner`, `packages/protocol/generated/go`, `packages/protocol/fixtures`;
sort using Python pathlib path-component ordering; SHA256 the UTF8 concatenation of
`<file SHA256>  <repo-relative path>\n`. Per-module manifests use all immediate
`*.go` files and the same line format. Later relevant edits invalidate these gates.

Main's final audit also records standard whole-string lexicographic ordering of
the same118 individual source hashes:
`a7ace85a28cfbf39d4f1bcc5552da3f54e591689e18d4765a8dd32382b69c715`.
This ordering correction changes no input byte or gate validity; the original
`da9b580e...` aggregate above retains its explicit pathlib-component semantics.

The pre-F2 whole-module gates used aggregate
`70379b8bf0e4e8449e21825901f7fccc3174fae6541fb5005444129ed881a50c`
and host manifest `ccdb51b38477d51ff34b11aee0ac304adc57c572993eb20ea284b2b5e8372a88`.
F2 changes only `host/publication_scan.go` and `host/publication_scan_test.go`;
daemon/control/wire manifests and generated protocol remain unchanged. Current
affected host gates below supersede prior host evidence; unrelated whole-module
results are retained without repeating those packages.

| Command | Scope | Result |
| --- | --- | --- |
| `go test ./internal/host ./internal/daemon ./internal/control -run 'Publication\|ResultRead' -count=1` | Actual Git candidate/scan, SQLite source proof, WSS and unchanged retained reads | PASS; prior input revision, superseded by final whole-module gates |
| `go test ./...` | All Runner packages and generated/shared consumers before F2 | PASS; host 53.158 seconds, daemon 1.523 seconds; host evidence superseded by scoped F2 gate below |
| `go test -race ./...` | All Runner packages before F2 | PASS; host 67.546 seconds; host evidence superseded by scoped F2 gate below |
| `go vet ./...` | All Runner packages before F2 | PASS, exit 0; host evidence superseded by scoped F2 gate below |
| `go test ./internal/host -run '^TestPublicationMultiRuleFindingOrdinals$' -count=1` | Physical Git candidate and pages with multiple findings per version | PASS, 1.512 seconds |
| `go test ./internal/host -count=1` | All host tests on final F2 input | PASS, 50.272 seconds |
| `go test -race ./internal/host -count=1` | All host tests on final F2 input with race detector | PASS, 66.786 seconds |
| `go vet ./internal/host` | Affected host package on final F2 input | PASS, exit 0 |
| `git diff --check -- runner` | Runner patch whitespace | PASS |

Actual tests cover private add/delete exclusion versus genuinely newly reachable
historical deleted credentials; all-parent merge unions; inherited final content;
Git-backed nested ignore/negation and version changes; workflow additions/deletion
and unknown/allowed scan seam; all finite credential rules across chunk boundaries,
whole binary content digest and negative corpus; invalid UTF8 paths; injectable
commit/path/version/blob/aggregate/finding/evidence bounds and missing immutable
head; copied/renamed publicly exposed blobs, historical deletion and sensitive
filename redaction; encoded page splits/aggregate digests; exact symlink/gitlink/
executable tree preservation; target ancestry and rejected published seam;
SHA256 Git object format CAS/replay; source/ref/intent drift; concurrent requests;
faults after intent/commit/ref/manifest/scan/result; stable rescan identity;
external cancellation versus own processing deadline; private journal tamper and
ack-loss replay; original Basis-nil open versus later lease; no Runtime mutex/capacity
use; TLS/WSS Ready capability, digest/ack/current-vs-stale incarnation and disconnect
cancellation. Backend PostgreSQL contention/authority/receipt tests remain parent
and backend ownership.

## Failed trials and corrections

Initial actual-Git ignore tests returned incomplete because Git check-ignore rejects
GIT_LITERAL_PATHSPECS=1 as unsupported magic. The dedicated ignore environment now
omits it and regression tests pass. An initial source-preservation assertion assumed
old show-ref lines remained contiguous after adding the candidate ref; the corrected
assertion compares every original ref plus actual HEAD/index/files. The generated
strict proof test exposed a fixture's missing remote URL and a shallow-copy mutation
that emptied original outcome.storage_id when preparing pre-enrichment pin JSON;
fixture metadata is now independently copied. Own-deadline regression showed an
early Git error was classified missing_object; processing deadline now explicitly
freezes timeout incomplete after construction while external cancellation remains
unfinished. All failed local outcomes were preserved in tool/session history and
resolved before final gates.

Independent review F2 found that several findings on one scanned version reused
the same ordinal and could not settle at the backend. The scanner now numbers
accepted findings independently of visited versions. The actual factory regression
produces ten findings across eight versions: tracked ignore plus PEM, classic GitHub
and AWS rules on one blob in both publication and final scopes, plus another
credential path. It checks every ordinal, finding identity, unchanged version
coverage, sanitized pages and exact same-scan replay. Backend real-PG acceptance
is separately owned and uses a synthetic complete physical-result envelope; it
does not claim to have executed this Git fixture. The initial new test build used
the generated Scope enum as a string map key; the fixture now uses the enum type.

## Optional native permissions fixture and limits

`TestPublicationNativeRetainedPermissionFixture` **skips by default**. Main may set
`MONOS_PUBLICATION_EVIDENCE_DIR` to an explicitly created empty service-owned 0700
absolute directory beneath safe service ancestors and run only that test. It retains
actual code-produced result.git, journal operations/constructions and 0600 proof.json
with exact intent/pages/candidate paths and source/head/tree/result digests. The main
agent can independently stat owners/modes and test execution-account read/write
denial. The test performs no sudo/helper/service/provider/model action. Other
publication host tests also use only owned temporary fixtures; journal fixtures use
safe owned current-working-directory parents because world-writable /tmp lineage is
correctly rejected. The native fixture is an isolated same-account actual-Git factory
with a synthetic public baseline, **not** production Root/original remote proof.

This delegate has not run installed Linux/systemd/cgroup/two-account or provider
trials, and makes no such claim. Main owns any coordinated scoped Linux evidence,
integrated PostgreSQL/Web verification and independent review. Permanent disk loss,
remote publication/reconciliation, workflow permission observation and published
parent admission remain subsequent-leaf contracts. No new dependency was added.
