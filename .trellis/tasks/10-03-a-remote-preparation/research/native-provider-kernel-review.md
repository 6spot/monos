# Native provider kernel pre-effect review

Active task: `10-03-a-remote-preparation`. Bounded read-only review of root-owned
synthetic provider harness plus the frozen Runner bridge. This report is the
reviewer's only writable file. No token acquisition, fixture CLI execution,
host/provider contact, task lifecycle or product source mutation occurred.

## Exact initial reviewed inputs

All four inputs were untracked in the initial path-scoped dirty inspection.
The review loaded their source directly and read the actual GitHubRemote adapter
only to verify provider identity/mutation semantics.

| File | SHA256 |
| --- | --- |
| `research/native-provider-kernel.ts` | `0092ed12b7c822efd70b21ed0737e656e7879c2919699dd1a3c3434405de388f` |
| `research/native-github-fixture.mjs` | `26988650145eaae0a8747907a8c7d0d3c5e75bda757799683987204fff7f8ee5` |
| `research/native-provider-scope-check.mjs` | `650251288c70ff4817ccad76c22601d7846021ef612227ba14970348cb8307d1` |
| `runner/internal/host/publication_remote_native_test.go` | `967f0fb50301108b8104a5996ae3b37d5b80bf89917a76c5c1ae257192fa4276` |

`research/` paths above are relative to the current task directory. Architecture,
frozen contract, credential/physical ownership rules and verification stopping
rule remain those loaded in the preceding bounded Runner review.

## Findings (fixed)

None in this initial review. Root owns the harness; Runner source stays frozen.

## Findings (not fixed)

### P2 — Final-source gate accepts an internally consistent historical build

- File: `research/native-github-fixture.mjs:15`.
- Issue: `source_manifest_sha256` is compared only between the supplied Linux
  result and its supplied remote-location file. No manifest hash/entry is
  compared to current reviewed Runner inputs. Any historical successful run
  with matching files and a valid binary digest passes the stated final-source
  gate, including the already-retained pre-SHA-256-fix full Linux run.
- Effect: the trial can exercise an older binary while being labeled final-source
  evidence. The remote binary byte check proves equality to the supplied report,
  not equality to the current source.
- Required correction: bind the provided Linux manifest bytes to its report
  digest and compare every relevant manifest source entry to the current reviewed
  source before token acquisition or external effects. Preserve the distinction
  between original full Linux evidence and the affected current native delta.
- Status: reported to root; reviewer has no harness write permission.

### P2 — Native correction push lacks fresh exact repository/account preflight

- File: `research/native-provider-kernel.ts:163`, `nativePush`.
- Issue: initial CLI preflight occurs before the first push, but `nativePush`
  itself never refreshes account/numeric repository/name/description/public
  fixture identity. Correction follows PR creation and bounded check collection
  I/O, then immediately enters the Git bridge. The bridge pins a URL/name and
  expected ref/head, but cannot independently assert numeric repository identity
  or the historical fixture marker.
- Required correction: perform the existing authenticated exact-scope preflight
  immediately before each bridge effect, after immutable intent retention. This
  is one required boundary read, not an expanded test matrix or second trial.
- Status: reported to root; no source edits or effects performed.

### P2 — Create validates exact delivery head only after POST

- File: `research/native-provider-kernel.ts:193`, `openWithLostResponse`.
- Issue: repo/main preflight and complete zero-PR lookup precede POST, but the
  stable delivery ref is not freshly observed and compared to the candidate
  before POST. Exact-head validation occurs only after successful response
  suppression and PR lookup. A changed branch therefore receives a new PR for
  a different head before the harness rejects it.
- Required correction: a bounded authenticated exact delivery-ref observation
  immediately before POST must show the candidate head. Absent/unavailable/
  different head fails before creation. Keep the existing immutable create
  intent, successful-response suppression and one-POST guard.
- Status: reported to root; no source edits or effects performed.

## Boundaries reviewed without additional findings

- Pins numeric repo `1393178791`, full name
  `6spot/monolab-feasibility-20260928-160020-public`, exact historical description,
  public/nonarchived/default-main clone URL and authenticated `6spot` account.
  No product repository payload or visibility/merge/Accept mutation is selected.
- Native Git bridge fetches verified public baseline and modifies only fixed
  `monos-remote-preparation-fixture.txt` with bounded synthetic text; candidate
  uses controlled metadata/public parents and clean physical scan. It never
  reads/copies local monos source into the fixture tree.
- Immutable local native/create/update/close intents precede effects. Existing
  output directory/intent cannot be overwritten by a blind CLI restart. Lost
  successful create response increments one POST counter and reconciles by
  exact unique repository/head-ref/base/marker lookup; no second POST exists.
- Adapter validates numeric same-repository PR identity, literal ref/base,
  marker and public URL. Update and close independently read the exact owned PR
  and current candidate head before PATCH; close retains and observes the exact
  branch. Unknown response fails with retained intent rather than claiming success.
- Polling reads literal head collections with bounded pages and a trailing
  head/base/PR bracket. Required readiness stays explicitly unknown. This lower
  kernel does not claim to prove production scheduling or App grant semantics.
- Token is captured in memory, carried over anonymous SSH stdin and inherited
  FD3, then through fixed anonymous-pipe askpass. It is absent from explicit
  arguments, remote child environment, intent/HTTP audit, files and Git config.
  Remote log/artifact output refuses the token bytes before transport/persistence.
- Remote test process switches to actual `monos-probe` UID and distinct `me`
  execution UID, with empty supplementary groups, protected service-owned binary
  and private fixture. Each collected artifact asserts service ownership/0600
  and actual execution-account read/write denial. Final exact UID997/UID1000,
  source and binary evidence remains root's current native evidence gate.
- Safe bridge proof is explicitly `oauth_injected_remote_kernel`, not a formal
  PublicationPushRequest/original workspace/App proof. Final trial output names
  production App issuance and installed coordinator as not proven; no Owner
  acceptance or merge is performed.

## Verification

Performed: assigned dirty/source inspection, exact four-file SHA256 capture,
cross-check of actual adapter semantics and existing Linux source/binary evidence
shape. Main reports the narrow zero-network scope guard, syntax, TS and lint
checks passed; this reviewer did not rerun those unchanged checks. The earlier
Runner bridge review/evidence remains bound to its unchanged hash.

No live trial was performed by this review. Initial verdict is **NOT READY for
effects** until the three gate gaps above are fixed and reviewed. Root's affected
native SHA-256/build refresh remains required. Missing installed production App
configuration is explicitly separate and cannot be supplied by OAuth injection.

## Root corrections re-review — current source READY

Read the current two-helper delta after root addressed the findings. Original
hashes and findings above remain historical. No Runner bridge or scope-check
source changed, and no live effect was performed by this review.

### Findings (fixed by root; independently reviewed)

1. **Current-source binding:** CLI reads actual Linux `manifest.json` bytes and
   verifies their digest against the result/location digest. Every manifest
   source entry is compared to current repository bytes before token lookup,
   before each native bridge and after the trial. The existing pre-fix manifest
   therefore fails on the changed store/test hashes. Relevant provider/protocol/
   helper/lockfile hashes are captured and retained in immutable `source-inputs`
   evidence, with file/symlink/path checks and later drift detection. Remote
   binary bytes must still equal the supplied current native result digest.
2. **Fresh push scope:** both `nativePush` calls now perform the authenticated
   account/numeric repository/full name/description/public/default-main preflight
   immediately before immutable native intent and bridge entry. They additionally
   reject drift from the original public main baseline. Numeric identity cannot
   be inferred solely from the Git URL during the correction step.
3. **Pre-POST exact head:** create now performs one bounded authenticated GET of
   the literal delivery ref using its fresh review grant, requires HTTP 200,
   exact ref/type and exact candidate head before POST, then preserves the same
   one-POST counter, response withholding and exact unique PR reconciliation.

No additional concrete blocking defect found in this delta. Native token flow,
synthetic-only content, exact PR ownership, branch retention and explicit lower
kernel provenance remain as reviewed above.

### Current hashes and verification limits

| File | Current SHA256 |
| --- | --- |
| `research/native-provider-kernel.ts` | `7b7b4ed374013591f8c76f11b76ac4a0d342b470f8543040bf2f12285325d0f1` |
| `research/native-github-fixture.mjs` | `67ede05ce41ac6cc7f9344abb48ba3a7fd4e64fbc49b8672763f7300cf9a3572` |
| `research/native-provider-scope-check.mjs` | `650251288c70ff4817ccad76c22601d7846021ef612227ba14970348cb8307d1` |
| `runner/internal/host/publication_remote_native_test.go` | `967f0fb50301108b8104a5996ae3b37d5b80bf89917a76c5c1ae257192fa4276` |

Actually performed: direct current delta review, exact four-file hash capture,
source-manifest producer/schema inspection and report whitespace check. No test
matrix, token lookup, CLI, SSH or provider command was run. Root owns the affected
TS/lint/syntax/existing zero-network guard checks for its changed helpers and the
current SHA-256 native build/store evidence refresh. Earlier helper check results
remain historical for the two changed inputs until those affected checks finish.

Current **source pre-effect review is READY**. The trial must use the current
native delta result and pass its executable source/binary gate; it cannot use the
pre-fix v1 run. This review does not claim the external trial happened or passed,
production App issuance was configured, installed coordinator integration passed,
or final backend/Web/leaf acceptance completed.

## Narrow early-failure continuation review (2026-10-05)

Assignment: only the native bridge timestamp-object persistence and CLI
`--resume-from` delta; no product fixes, tests or host/provider effects.

### Findings (fixed)

Root fixed the test bridge's scalar timestamp record at
`runner/internal/host/publication_remote_native_test.go:208-224`. It now saves and
reads a canonical object `{timestamp: ...}`, compatible with the existing journal
canonicalizer, then uses that retained timestamp for both controlled commit and
construction digest. Existing journal bytes remain exclusive/immutable; malformed
or conflicting retained bytes fail before push.

### Findings (not fixed)

No concrete blocking defect found in this bounded continuation. This is a
continuation of the exact original first operation after a demonstrated early
failure; it does not authorize replay of a started operation or another PR POST.

- Original operation `0fa427c1-8ca3-4b13-ab77-99eb6ed6956a`, item
  `0366011d-f6ce-4104-8304-dbdc6ac7244f`, Task
  `5e176dea-d06e-4bc9-b38c-5299e0a61d29`, resource
  `71bc7a07-dcd1-4f40-a60a-ef28ff2dddfc`, base
  `9ac3353e97ed6a0cb96a80bb8e136d44cac982e4`, repository ID `1393178791`, exact
  historical fixture and synthetic text remain the same. Canonical input digest
  independently matches retained intent digest
  `6ca08d60b86c1ca2fe9dc44515d6b750272b78afd0d1ec2f8607e4537dfa27c3`.
- Actual failed-trial boundary retains only intent; timestamp, candidate, scan,
  started, worker, absence, result and proof are all absent. Exact original ref
  observation is absent/404. Ref absence alone is explicitly not physical absence
  or nonexecution proof; the pre-start filesystem boundary supplies the decisive
  additional evidence. Original command records exit 1 before timestamp retention.
- CLI lines 23-35 require a private owned prior evidence directory and private
  bounded regular evidence files, the original prepare action/input/intent hash,
  absent effect markers and matching literal original ref/repository. It passes
  the original input into the first nativePush at line 126, rather than generating
  another operation/input. Continuation attribution is saved separately with
  exclusive writes in a new output directory; previous records are only read.
- Current source/binary gate remains in force before token acquisition and bridge
  entry. Fresh authenticated account/numeric repository/description/main preflight
  must equal the original base. The native bridge additionally verifies current
  main and actual advertised original delivery ref against expected absence,
  before construction and started marker. Its real push retains exact nonforce
  expected-head guard. A drifted head cannot become a fresh initial push.
- No physical absence is invented. Real native process completion must report
  worker absence before `absence.json`; exact ref observation without that record
  cannot create result/proof. Both remain scoped OAuth lower-kernel evidence, with
  no formal workspace, installed Runner coordinator or GitHub App claim.

### Verification

Actually performed: direct narrow current-source review, original command and
failed boundary/ref/intent reads, canonical input digest comparison and read-only
SHA256 capture. No tests, native CLI, token acquisition, SSH or provider invocation.

| Input | SHA256 |
| --- | --- |
| `research/native-github-fixture.mjs` | `df37391fe81a8ecd9e61181a21eb4798866700a3650d0918d8a936a6f57426ce` |
| `runner/internal/host/publication_remote_native_test.go` | `1e4ce86a8aabf1e8941f22af2e1d504665acdab55951206979e7674b3879e81f` |
| `evidence/native-github-final-v1/failed-trial-boundary.json` | `2b5e0d34a73dc95f38c4c94657fd6afba9f6b49e0934580255aeebf8b98d6376` |
| `evidence/native-github-final-v1/failed-trial-ref-observation.json` | `d0c3cfc5f379ea04074d240fb33e9b0931cb2f63931df17e941b9e1659f0bccb` |
| `evidence/native-github-final-v1/native-0fa427c1-8ca3-4b13-ab77-99eb6ed6956a-intent.json` | `aa2a307af8c2b5416b2b4e186fb0cd536ec04e12ae28f18e23511ab96d28d6ea` |
| `evidence/native-github-final-v1.command.json` | `2b8dad0f90b65bd26fadbafa41de35ff74a418e902e7608bfa1f19b0c70df74d` |

Disposition: **READY for this exact early-failure continuation**, conditional on
the CLI's current native manifest/binary gate and fresh preflights. Root owns the
affected bridge build and helper checks. Backend/Runner P2 fixes have separate
pending reviews; this disposition does not override them or claim trial success.
