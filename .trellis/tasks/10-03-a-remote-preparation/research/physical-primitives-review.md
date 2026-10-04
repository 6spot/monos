# Independent physical primitive preflight

2026-10-04. Active task: `10-03-a-remote-preparation`.

**Focused verdict: READY for integration.** No blocking defect found in the two
handed-off primitive files. This is a static and narrowly executed hook preflight,
not final Runner/coordinator acceptance or native GitHub/App evidence.

## Findings (fixed)

None. Product sources and tests were read-only. Only this report was written.

## Findings (not fixed)

No concrete primitive defect identified. Two explicit integration obligations
remain with the Runner owner; main has confirmed they will be required:

- `publication_remote_primitives.go:105`: invoke the fixed hook installer/validator
  immediately before Git, and abort on its error. The installer checks exact
  bytes, regular-file service ownership and executable `0700` mode. Git invocation
  must not proceed with missing/non-executable hooks, an alternative hooksPath or
  a bypass option. The current tests cover tampered bytes, but do not claim an
  end-to-end production push refusal after hook deletion or chmod; that assertion
  belongs to the full push path.
- `publication_remote_primitives.go:14`: physical exclusion is not durable remote
  authority. Before construction, credentials or successor dispatch, the full
  lane must examine retained started/unknown intents and settle the exact original
  effect. `lockPublicationRemoteItem` intentionally only takes flock; acquiring
  it after a worker exits cannot authorize replacement. The test proves that an
  intent survives lock release and rejects conflicting overwrite, not that the
  not-yet-integrated lane already rejects every successor.

These are recorded limits of the focused primitive handoff, not defects inferred
from the unfinished consumer implementation or unstable shared schemas.

## Source and test review

### Fixed system hook

- Lines 78–103 contain fixed Program code, not a repository hook. Require exactly
  two destination arguments and compare both independently to the fixed expected
  destination. Hook input is capped by reading 4097 bytes and retaining a sentinel;
  input above 4096 bytes rejects. Embedded NUL becomes a nonmatching character.
  A final LF is mandatory; another LF, update or field rejects. Globbing is disabled.
- Exactly four fields match local ref/OID equal to the requested literal head,
  destination branch and advertised expected old OID. Initial publication uses
  matching-length all-zero old OID. Input cannot select another ref or executable.
- Lines 105–113 validate nonzero object head, same-format expected OID, branch ref
  via literal `git check-ref-format`, and destination bounds/control characters.
  Canonical repository/URL/operation authority remains the caller's contract;
  the helper intentionally also supports a synthetic local bare destination.
- Lines 127–169 reject existing hook byte/type/owner/mode mismatch rather than
  repairing it. New hook installation uses a private temporary file, explicit
  `0700`, file fsync, exclusive link and parent fsync. A conflicting installation
  must validate the fixed existing file.

### Physical storage and ownership

- Lines 21–51 validate item ID, context, private root/items/item lineage, then
  acquire the existing no-follow flock helper. Validate regular `0600` service
  lock ownership and fsync before returning. Cancellation after acquisition
  releases the descriptor. Other items remain independent.
- `publicationDirectory` checks absolute root/service-owned non-writable ancestor
  lineage, symlinks, exact private `0700` service directory and creation durability.
  `operationDirectory` independently validates operation ID and directories.
- Existing `savePublicationFile` canonicalizes bounded records, requires trusted
  `0600` existing files, compares identical replay bytes, rejects conflicts and
  durably installs records exclusively. No lock/intent expiry deletes authority.
  New primitive fields/environments contain expected nonsecret facts, no token.

### Actual Git negative controls

`publication_remote_primitives_test.go:145` uses real Git and a bare receiver:

1. Unexpected advertised middle commit is still an ancestor of desired head, so
   ordinary FF would permit it; fixed expected-old hook rejects and preserves it.
2. Receiver-only synthetic pre-receive hook moves base to middle after
   advertisement. The guarded client has the expected advertised base, but the
   receiver's old-OID CAS rejects its update and preserves the competing middle.
3. With expected middle, ordinary exact FF succeeds; all-zero expected permits
   absent-ref creation. A sibling result still fails ordinary non-FF protection
   despite matching expected head. Tests inspect resulting remote refs.

The receiver race hook is test-only and separate from the fixed client hook.
The opt-in native fixture at line 214 uses an actual candidate factory, private
object store and synthetic bare push, checking source attribution and exclusion
of private ancestry. It is explicitly labeled synthetic primitive evidence and
skips without an exclusive retained evidence directory. This review did not run
or claim its two-account/native or provider acceptance.

## Verification

- Loaded task `check.jsonl`, current design and relevant complete Runner workspace,
  quality, accepted publication and delivery contracts; reused the source-backed
  planning review. Initial path-scoped status showed the two new primitive files
  untracked. Existing task/framework/product changes were preserved.
- Independently recomputed and matched the exact handoff SHA256:

  | File | SHA256 |
  | --- | --- |
  | `runner/internal/host/publication_remote_primitives.go` | `3037cd722ab5b9b1a04dcf20ab929a009313506d69182c2c327d603301fd9623` |
  | `runner/internal/host/publication_remote_primitives_test.go` | `f7f045836a0b6c643615b4058e3f9a0c5960f9e156a76488301cabe11d649d2b` |

- Read all 170 implementation and 299 test lines and the actual directory, trust,
  flock, journal and Git-environment helpers. No unstable shared schema review.
- Additional exact-source hook probe: extract the fixed script into memory and
  execute `/bin/sh -c` with controlled environment/stdin, no files or Git/provider
  invocation. **11/11 PASS**: valid input, first destination wrong independently,
  second destination wrong independently, one/three arguments, empty input, CRLF,
  tab-separated fields, blank second line, 4096-byte and 4097-byte malformed input.
  Valid exit 0; all negatives exit 78; every case emits zero stdout/stderr.
- Handoff reports focused Darwin tests **PASS 2.349s**, race **PASS 2.908s**, host
  vet and diff check **PASS**. These are explicitly worker-reported evidence;
  original full command/log/input manifest was not supplied during this review.
  Main will retain final integrated current-input test/race/vet logs after shared
  consumers stabilize. Matching two owned hashes alone is not a claim that every
  dependency of the earlier Go commands has remained unchanged.
- Scoped whitespace/report checks: PASS. No duplicate focused or broad Go suite,
  generation, builds, native host/provider effects, product edits, nested agents,
  commits or task lifecycle changes. Final integration must verify strict frames,
  current authority/credentials, physical unknown-intent fencing, immediate hook
  validation, bounded subprocess cancellation and final native evidence.
