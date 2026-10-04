# Independent Runner remote lane review

Active task: `10-03-a-remote-preparation`. Read-only product review against
accepted base `2095660a1fe546412430b5d630d4837dc550155b`. This report is the
reviewer's only writable file. Backend and Web are still under their writers;
this is not their final review or the task's combined acceptance.

## Scope and reviewed inputs

Reviewed the 29 handwritten Runner files listed in
[Runner handoff](runner-full-lane-handoff.md), including their control/daemon
integration, production host paths, actual Git/process cases and opt-in native
bridge. Original source/result/journal helpers and current backend construction
were read only to establish the affected boundaries.

Exact file hashes are the `owned_files` entries in
[final input manifest](evidence/runner-full-lane-final-inputs.json), SHA256
`1a1c7f6c2840ca1ac984eb6d79886bee9c14dc6234c16157dc51326837751840`.
All 29 still matched at the end of this initial source review. The manifest
contains 138 total inputs; main previously verified those total inputs. This
review did not repeat all 138 checks or claim the original whole-module runs
used the later two-file permission-context delta.

Loaded native hook's saved full output, then directly read the relevant omitted
Runner/workspace/quality, frozen-contract, task PRD/design/implementation,
collaboration and verification-scope resources. Architecture review covered
`ARCHITECTURE.md`, delivery sections of `docs/04-workspace-and-git.md` and
`docs/08-principles-and-non-goals.md`. Read relevant existing local-publication
and requirement/Replan contracts. Unrelated frontend implementation was outside
this bounded review.

Initial dirty state: all 29 assigned files were modified or untracked, plus
backend-owned wire files. No product source, shared output, unrelated dirty
file or existing evidence was written, staged or reverted.

## Findings (fixed)

None. Product source was read-only.

## Findings (not fixed)

### P2 — New public object store loses supported SHA-256 source format

- File: `runner/internal/host/publication_store.go:46`.
- Related production path: `publication_candidate.go:53`; existing regression
  fixture: `publication_candidate_test.go:566`.
- Exact reviewed store hash:
  `8de30bc185976b9de33aa75dd359eb0535de914dce79dbb1d283d37787c6ce29`.
- Issue: new `public.git` is initialized by plain `git init --bare`, so the
  controlled environment creates the default SHA-1 object format. Production
  local preparation now imports the source result tree and public parent pack
  into this store. A previously supported SHA-256 source produces incompatible
  objects and fails `index-pack`, leaving local preparation unavailable. This
  also affects local-only/after-acceptance preparation; GitHub-only remote
  admission does not isolate this local path.
- Evidence: accepted `TestPublicationSHA256ObjectFormatCASReplay` explicitly
  constructs a SHA-256 repository, but calls the old factory with source and
  destination equal. Consequently its retained passing result does not exercise
  the new production store boundary. Current backend local admission has no
  GitHub-only restriction before dispatching local preparation.
- Required correction: initialize the service store with the verified source
  object format and reject format mismatch on reuse. Keep importing the result
  tree and verified public graphs only. A focused adaptation of the existing
  SHA-256 case through the new store boundary is sufficient; no new broad
  format matrix is requested.
- Status: reported to main for the Runner owner; not fixed because no product
  write permission was assigned. Review verdict remains pending this fix.

### Deferred optional target-parent seam

- File: `runner/internal/host/publication_candidate.go:314`.
- Exact reviewed candidate hash:
  `833d35da5af20a1cc0c794db71f08fafd932ead65b96c7cf6dc47bee6a7ea649`.
- Issue: optional `target` parent checks `merge-base(target, source_commit)`
  in the new public store, which intentionally lacks the private source commit.
  A valid integrated second parent therefore fails this store path. The prior
  optional-target test uses the original export as its destination and misses
  that separation.
- Scope decision: current `ensureLocalCandidate` admits exactly one verified
  materialization/published parent. The frozen leaf explicitly defers target
  transport, and main confirmed this is a deferred limitation, not a blocking
  defect in current single-parent admission. Document that production scope;
  address source ancestry in the trusted original export when target transport
  is implemented. Do not import private ancestry to repair this seam. No extra
  target-parent test matrix or source edit was performed.

## Reviewed behavior without additional findings

- Push specifies one literal candidate/ref, no force or lease-force, tags,
  mirror or recursive submodule effects. Fixed service-owned pre-push bytes
  check destination, one advertised update, local head and expected remote OID;
  receiver nonforce/CAS remains the later race guard.
- Original completed result and open journal/outcome/cache pin remain authority.
  Public object import includes exact result tree/public parent graphs and
  excludes source commit ancestry. The original export is not repaired or
  relabeled as published.
- Intent, started marker, worker identity, absence, result and ACK are retained
  by canonical exclusive install and fsync. Missing spawn/identity evidence
  cannot settle ownership; releasing flock does not prove process absence.
  Restart signal authority requires actual Linux boot/birth/UID/group identity;
  missing/tampered identity is conservative. Started uncertainty is observe-only.
- Actual SIGKILL test kills a separate Runner process with a live descendant
  group, then verifies conservative recovery. Positive Linux recovery is a
  final root evidence boundary, not established by Darwin cancellation cases.
- ACKed uncertain result and ACK stay immutable. Resolution validates private
  original intent/result/ACK/absence, candidate graph and a fresh exact original
  operation observation before retaining separate resolution bytes.
- Published-parent scope preserves Task/resource/Runner/storage/repository/item
  lineage across an explicitly new source generation. Same-tree mapping reuses
  the old manifest with a new source/basis/config/scan and zero new public commits.
  Revert compares the actual published parent tree and creates a real FF commit.
- New scan carries explicit workflow-change metadata and immutable permission
  context. Permission renewal keeps stable grant context separate from expiry;
  final write claim/token/proof is checked again after physical scan before start.
- HTTP access and WSS results/ACK bind request/operation/item/current incarnation,
  literal ref/head and nullable expected head. Access response is bounded/no-store;
  token goes only through service RAM and anonymous FD to fixed askpass, with
  redirects/helper/config/environment boundaries enforced.
- Root-only GitHub bridge is explicitly `oauth_injected_remote_kernel`, bounded
  to the marked numeric repository, fixed path and synthetic content. It does
  not fabricate a formal original workspace request or live App proof.

## Verification

Actually performed: path-scoped dirty/diff inspection and direct source/test/
contract review; SHA256 comparison of all 29 owned inputs to the exact final
manifest, PASS with zero mismatches. No product commands were rerun.

Reviewed and reused retained command JSON plus raw successful output:

| Evidence boundary | Existing command | Result |
| --- | --- | --- |
| Original 138-input Darwin module | `go test ./... -count=1` | PASS; exit 0, host 76.435 seconds |
| Same original inputs | `go test -race ./... -count=1` | PASS; exit 0, host 95.178 seconds |
| Same original inputs | `go vet ./...` | PASS; exit 0 |
| Final permission-context delta | focused seven-prefix host selector | PASS; exit 0, host 17.827 seconds |
| Same final delta | same selector with race | PASS; exit 0, host 20.756 seconds |
| Same final delta | `go vet ./internal/host` | PASS; exit 0 |

Commands use pinned Go 1.27.1 on Darwin arm64. Exact selector, invocation bytes,
raw logs and original/final manifest distinction are linked from the handoff.
The original full-module evidence is historical for its two later changed files;
the focused delta supplies those changed claims. The SHA-256 store finding is
not covered by the old same-directory factory test, despite its passing result.

Skipped broad reruns, native host/provider effects and UI tests under assigned
scope and the verification stopping rule. Main owns final Linux CGO/build/native
UID/process/permission verification and authorized actual GitHub effects. Those
remaining gates are evidence limits, not additional source findings. Native
OAuth injection cannot prove installed production App issuance; existing live
App configuration is absent and remains an explicit later external prerequisite.

Current executable specs still need main's final remote preparation/mapping/
workflow/permission updates after integration. This report does not accept the
leaf or claim backend/Web/current installed production integration passed.

## SHA-256 correction re-review — current Runner verdict READY

Focused read-only follow-up after the Runner owner's correction. The initial
finding, file hashes and evidence above remain historical. This section closes
the P2 for the current two-file delta; it does not rewrite earlier whole-module
Darwin/Linux evidence as having used these new inputs.

### Findings (fixed by owner; independently reviewed)

- File: `runner/internal/host/publication_store.go`.
- Issue: new public store used default SHA-1 for supported SHA-256 source objects.
- Fix: bounded `rev-parse --show-object-format=storage` reads the trusted original
  export's actual format, accepting only exact `sha1` or `sha256` output. New
  store initialization passes that explicit format. Existing store configuration
  and format must validate before any pack import; mismatch is rejected. The
  existing immutable identity writer still compares exact bytes and never
  overwrites an established identity. There is no format conversion, private
  source-commit import, source ref mutation or ancestry repair.
- Regression: the existing SHA-256 test now runs through the actual separate
  store, asserts private source commit absence, 64-character candidate identity,
  exact CAS/replay after reuse, unchanged original source refs, and rejection
  of an actual SHA-1 store without changing its format.

### Findings (not fixed)

No additional defect found in this correction. The optional second target-parent
seam remains deferred under the same main-confirmed production scope decision.
It is not part of this correction or a current single-parent admission defect.

### Verification and exact current inputs

Read [correction handoff](runner-sha256-store-handoff.md), SHA256
`c451c629f1eccd48fa8abdb0d6c60bd3f167243a9b4e2002f8bcc22395165dd4`,
and [current final manifest](evidence/runner-sha256-store-final-inputs.json), SHA256
`0c6f4f1a09def850feee281c00edda7a51d507ce6667c16b1c2a66af9a35af43`.
Compared manifest entries: exactly two inputs differ from the initial final
manifest, with 136 remaining entries unchanged. Both current files match:

| File | Current SHA256 |
| --- | --- |
| `runner/internal/host/publication_store.go` | `139c8ea4d0aa012e7ac475942db84b7c908ba5fe610a2ea2b3712e58f8110205` |
| `runner/internal/host/publication_candidate_test.go` | `20182eb61ea58968453187c9db11135d8e6f22b1784a243641ae02ecad5be473` |

Actually performed: path-scoped dirty inspection, direct current source/test
review, handoff/manifest/two-file hash comparison and retained invocation/raw
output review. The writer's focused regression failed before the correction
(`publication object unavailable`, exit 1) and passed after it (host 1.239
seconds, exit 0). Existing affected physical store/mapping/revert/permission
cases passed (host 18.982 seconds), their race run passed (host 22.091 seconds),
and `go vet ./internal/host` passed (exit 0). Exact commands and raw failures/
successes are linked from the handoff. No unchanged command was rerun here.

Current Runner source review is **READY**, with no remaining blocking source
finding in this bounded scope. Root is refreshing the affected final Linux/native
store/build evidence and retains the original full Linux run's original scope.
Backend/Web combined review, final native/provider evidence, executable-spec
integration and the live production App prerequisite remain main's boundaries.
