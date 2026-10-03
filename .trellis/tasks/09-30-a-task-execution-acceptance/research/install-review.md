# Installation and observer review

## Scope and status

Reviewer owns this report only. Reviewed the current task requirements/design,
reusable accepted audit contracts, observer/install helpers and frozen package/build
utilities. No service, Owner command, model call, lifecycle write or historical
trial was run by this reviewer. Product source remains unchanged.

Core script, frozen build, fresh host revalidation, actual private backup and
installed-history review pass after the fixes below. Scoped installation accepted.
This is not native-chain or package acceptance.

## Findings (fixed by root, independently reviewed)

1. Observer baseline lacked comparison of the current monos image to the accepted
   Replan v4 image. Observer v4 now requires that image, a running positive-PID
   container and the exact existing loopback18444 port mapping. Source and all four
   binary comparisons remain separate prerequisites.
2. Rollback unconditionally removed every newly added source path, so installation
   failure before creating one path caused rollback to fail. Missing paths are now
   allowed; existing paths must be regular non-symlinks with exact candidate bytes
   before deletion.
3. Installation and rollback shared the same exclusive binary temporary name. An
   interrupted install could strand that name and block rollback. The phases now
   have distinct names, preserving the interrupted install artifact for inspection.
4. Exclusive observer/installation intent files were fsynced without their parent
   directory. Observer save now also fsyncs that directory; binary replacement and
   completed backup directories likewise receive directory fsync.
5. Rollback required the monos server container to exist even when Compose had
   removed it before a failed replacement. Its explicit rollback-only capture now
   omits that container read. Normal before/after capture remains strict; database
   and monolab identities, receipts, canonical/native/Git history and global idle
   ownership remain required. Database running/private-port checks were added to
   the baseline and database identity is preserved independently.

The retained observer v1 method-resolution failure and v2 rejection of a known
never-launched Attempt are observation failures, not product outcomes. v4 calls
`WorkspaceProbe.runner_identity` explicitly and reuses the exact existing seven-
predicate proof for only Attempt `8e0194f7-e11d-4c8f-9899-6fd288fa7bdb`. It requires
the source/withdraw/dismiss receipts and zero actual launch, journal, unit, cgroup,
spool, outbox, effects and leases. Other unstarted Attempts fail. Launched Attempts
retain the full physical-settlement predicate; native and canonical history is
compared rather than rewritten.

## Findings (pending)

- Final ordinary native chain, requested repository behavior, inspected actual
  browser views/reload and trial ownership settlement require separate acceptance.
- Original baseline/bootstrap/continuation-v1 limitations remain retained below.
  Their corrected evidence is not used to relabel the original failed observations.

## Contracts reviewed

- Observer SQL uses PostgreSQL read-only transaction defaults. The selected
  methods only read database/native/systemd/Git state; no inherited admission,
  service-restart or native-driver method is invoked. Git reads disable external
  configuration/hooks and preserve index, refs, files, commits and exported trees.
- All six global immutable receipt tables retain multiplicity. Both accepted
  Specification/Replan Tasks remain REVIEW with exact records and native history;
  only `last_checked_at` is normalized. The three exact legacy nonrunnable rows
  remain separately retained. Nineteen global ownership/work predicates gate work.
- Fresh Runner registration/readiness and exact monolab identity are checked.
  Compose always includes the existing18444 override and targets only server with
  `--no-deps`, `--no-build`, `--pull never`; no down/volume deletion exists.
- Backup uses pg_dump and SQLite's backup API from a read-only source, plus exact
  binaries, private configuration/credentials, previous source archive/manifest.
  Backups remain under0700 directories with0600 files and recorded hashes.
  Rollback never restores a database or overwrites newly admitted command history.
- Build utilities stage committed tracked bytes and executable modes, reject
  reused staging/image identities and changed migrations, use isolated temporary
  containers, and never install or invoke Owner/model operations. Go validation
  precedes all four fresh binaries. Server/test image source and generated Web
  assets are checked, followed by three targeted PostgreSQL suites with exact
  before/after schema sets. Runtime proxy environment is rejected.

## Verification so far

- Independently verified all372 archive entries against candidate commit
  `04c0380beacfaf1b14b55cd86a87c0fdb8b0e030`, hashes and executable modes.
- Previous343 files are all retained;62 changed/added files, no migration change.
- Archive SHA256: `f7a52dbd8998a828881da38d7aac78aabb2181ff01d5880ec31f85f2c027326c`.
- Manifest SHA256: `aeb0d0c92ecb02788dc2bc881d603de0ab34cbaa0a0a9ed2e217aa030e4c5ffb`.
- Package script and previous-manifest hashes match the frozen manifest.
- Python syntax parsing: PASS for reviewed package/build/observer/installer.
- Isolated execution of actual helper functions: PASS for exclusive0600 intent
  persistence/refused overwrite, rollback binary restoration despite a retained
  install temporary file, and missing-server capture restricted to rollback while
  retaining database/monolab reads. Files stayed in a temporary local directory;
  external service calls and root chown were mocked, with zero external actions.
- Local lint/type/browser evidence is reused only through the unchanged accepted
  candidate source; no native behavior is inferred from source checks.

## Actual frozen build evidence

Independently checked `results/built.json` SHA256
`a8929450b81c3622d3595a17aa6d9ac2830c8d6cfc89e70b06ee57dd87470a9d`, its six stage
results and six closed logs, and all three utility hashes. Every stage exited zero
and every build predicate is true. Read the actual Go and PostgreSQL logs:

- Linux amd64 Go1.27.1/CGO enabled: module verification, eight tested packages with
  race detection, vet and all four fresh binary builds PASS.
- Docker server/test image source checks PASS (223/225 copied tracked files).
  Both images contain the same exact built Web assets, matching the accepted
  migration JS/CSS identities.
- Targeted Owner-access/Task-UI-read/Node-execution PostgreSQL suites:44/44 PASS.
  All seven preexisting schemas remained, with no additions/removals.
- Recorded cleanup has a successful Docker inventory and zero task-owned build/
  test containers. These are build/test containers, not service lifecycle evidence.

The server image is
`sha256:daa468f43a5b13fe67ebeeb79a575131159f241502cc39fb8ded9b27cd161cc3`.
All binary/image/asset identities and complete limits are retained in
[build verification](build-verification.md). Installation still requires root's
fresh idle baseline and private backup checks; no new native trial has been run.

## Resumed independent review (2026-10-03)

Read the actual retained archive, stage results and logs again after resumption.
All **772 provenance predicates pass**: exact 372 archive members, committed bytes
and executable modes, final build/manifest/archive hashes, six log hashes, six result
hashes/zero exits and three utility hashes. This count is a provenance audit, not
772 new product tests. Existing accepted lint/typecheck/default/protocol/build and
50 distinct browser cases remain reused at their recorded scope; the earlier
interrupted full browser run is not relabelled an uninterrupted success.

Read-only host inspection confirms original `before-v4.json` SHA256
`984676a2f2f9d16dd4aa3ae1df217a61bd318a5162b022975c61d32a3f350b96`:
all14 baseline checks pass, all19 global ownership counts are zero, all343 old
source hashes and four binaries match the accepted installation. Specification has
four Attempts and one completion; Replan has19 Attempts and two completions. Both
are REVIEW. The one exact never-launched Replan Attempt has all seven canonical/
native/physical proof predicates true. Original records/intents were only read.

Additional helper fixes were independently reviewed in actual `/tmp` source:

- Observer intents and result provenance now include the external never-started
  helper. `revalidate-before` writes a new exclusive identity and binds original
  baseline/intent hashes; it never overwrites or reruns the old baseline identity.
- Installer backup/preinstall gates use the same installation-preservation checks
  and retain observer/common/external-helper plus baseline provenance.
- Installation candidate requires the full exact accepted commit rather than a
  short prefix.
- The after-install observer explicitly requires the candidate server running
  with a positive PID, besides exact image/ports and fresh Runner registration.

## Actual preinstall and private backup approval

Fresh `revalidate-before-v4.json` SHA256
`dfd61f34557f47cd11dc88b0f7a72f03e14f9f6ab697e3482b3e073f3f0a575e`
passes26/26. Backup revalidation SHA256
`a208dfdad86118382a55ab5dcb2019cc0e629d45a7bf1d864ee79823e84ccc3c`
also passes26/26, with all19 global ownership counts zero. Both preserve the old
installation rather than changing or overwriting original observations.

Actual private backup completion SHA256
`0bca9692c91515957b8a80a069ce1ed340b9d998c3d0de139b84ee10b520ec4b`
passes independent read-only inspection. All26 files are regular non-symlinks,
nonempty and exact in hash/size, mode0600; containing directories are root-owned
mode0700. Four old binaries, configuration/unit/ports/sudoers and old source archive
match the baseline. PostgreSQL's20,097,404-byte dump has the completion footer and
canonical Task/receipt tables. SQLite opened read-only has all five expected tables
and `PRAGMA integrity_check` returns `ok`. No backup body or credential was printed.

The recorded installer hash, observer/common/never-started helper hashes, baseline
and baseline-intent hashes all match the actual dependencies. Approved exact
installer SHA256:
`05c750153e1e51f1563d2f6e8045350c183899f44c93b21a768686e131c6f6f8`.
Its final preinstall gate must still succeed before its scoped replacement. This
approval establishes installation readiness only; native chain, final visual result
and package acceptance remain pending.

## Browser helper and retained installation interruption

Independently reviewed browser helper SHA256
`b08f24b5ccc1ca6fb2d89d75dd3d26f92815017a3f98711ac8aa9510c88a6893`.
It uses the current SSH socket, reads the actual authenticated session before
generic POST, audits exact session UUID on Task command routes, and excludes login
bodies and credential headers from saved evidence. Response recording failures are
caught and surfaced after draining, not lost as unhandled promises. Screenshot
targets are checked before writing, and route shutdown awaits held handlers.
Node syntax passes. No browser Owner action was taken by the reviewer.

Original preinstall gate SHA256
`ae4e8682869584ef588ec8db379501368bafdd289298db80bcff3956be4c261e`
passes26/26. Original install intent SHA256
`1b869be6955b6756f46856fb299a19500e7b45457ec3288416fad7fe9120f6fc`
binds the approved installer/build/backup/dependencies. Its bootstrap log reports
`stop/reconcile owned units before reinstalling`; install-complete and Compose-up
log are absent. Root reports the Runner remains stopped and source/binary/image
replacement has not begun. This interrupted operation is retained, not a successful
installation or a native product failure. Recovery review is pending on the exact
continuation helper and actual physical-release proof for only those named units.

## Scoped continuation review

Approved exact one-shot continuation SHA256
`6b0f80723c82e3917b143c14af9cb2cbc8ddbfd010549e02ac29f487a32b6c44`.
It binds the original install intent, failed bootstrap log, build/backup hashes,
installer/observer dependencies and original image overlay. The gate permits only
the intended Runner Stop difference; source, binaries, images, canonical/native/
Git history, receipt multiplicity, private configuration and global ownership
remain unchanged. Runner must be inactive with no PID/job/cgroup writer.

Targets are the exact observed 12 Attempt service names: eight failed and four
active/exited. The 11 ordinary units require exact canonical released/absent/no-
mutation rows, journal phase `absent`, native settlement, trusted root launch
identity, unit invocation/dispatch/ExecMainPID and original process birth absence,
plus actual kernel and `/proc` cgroup absence. The separate Host-only exited-unit
fixture binds its exact accepted report and manifest byte hashes and requires no
canonical or journal record. Earlier apparent missing canonical rows came from
querying dispatch IDs as Attempt IDs; the worker's corrected actual Attempt query
found all 11 ordinary rows. No release is fabricated for the Host fixture.

Complete proofs are persisted exclusively and rechecked before targeting only the
four exited units with Stop and eight failed units with `reset-failed`. All owned
unit inventory must then be empty and a fresh exclusive bootstrap check must pass
before any file/image replacement. Original failed evidence is preserved, and the
successful installation record references both original and continuation intents.

Reviewer parsed the actual helper and executed its actual `unit_checks` function
in isolation. The positive fixture and nine unsafe changes behave as required:
reject live systemd PID, altered dispatch, canonical writer, kernel writer,
unacknowledged root, unsettled native state, pending job, same original process and
unstable PID read. This local predicate check made no host/service action. Worker
also reports two positive and 28 negative predicate checks. Root owns executing
the approved continuation once and supplying actual proof/after-install evidence.

### Retained continuation v1 serialization failure

Actual v1 execution stopped while constructing the first complete unit proof:
SQLite `starts.body` is returned as bytes, but journal hashing called `.encode()`.
The exclusive v1 intent and passed pre-replacement gate remain retained. Root
reports no unit Stop/reset, bootstrap retry or file/image replacement occurred.
The isolated `unit_checks` review above did not exercise complete `prove_unit`
serialization and therefore did not establish its actual host execution.

Worker owns a v2 continuation with unique output identities and bindings to v1
failure evidence. Readiness now requires executing all 12 complete unit proofs
read-only on the actual host and JSON-serializing their complete outputs before
any metadata action; fixing the bytes/string hash must preserve raw journal bytes.
Installed/native evidence remains pending.

### V2 full actual proof and approval

Approved continuation v2 SHA256
`96dc6ab77696aced84e18892382715564e09d0720022f690acd4142af9d74184`.
The delta preserves raw SQLite bytes when hashing, binds exact prior v1 helper,
intent/gate/failure artifacts, refuses any prior advanced v1 progress and uses new
exclusive v2 output names. Original installation identity is retained.

Reviewer independently imported the actual transferred helper on the host, allocated
its read-only probe without constructor writes, executed complete `prove_unit` for
all 12 targets and serialized the complete results. All predicates pass; JSON is
73,895 bytes, SHA256
`302271b0f76c427f652e69c0efa773f3b1b3fb2cdf03589e17054f67328b763e`,
matching the worker's independent observation. Exact current v2/v1 helper hashes,
all three retained v1 observation hashes, original install-intent/bootstrap-failure
hashes and absence of prior advanced v1 progress also pass. No `main`, save,
constructor, metadata action or service action was invoked in this reviewer check.
This directly exercises the complete actual failure boundary from v1; root may run
the approved v2 continuation once, subject to its fresh gate/rechecked proofs.

## Actual installed-history acceptance

Root executed v2 once. Reviewer read actual exclusive continuation intent/gate,
12-unit proof result, post-action inventory, bootstrap log, install-complete and
after-install result. Every per-unit predicate is true; metadata actions targeted
only the proven units, their inventory is empty, and bootstrap reports success.
Original and continuation intent hashes are bound by install-complete. Current
helper/dependency/baseline hashes match recorded provenance.

Actual `after-v4.json` SHA256
`88e1abec25cb531132da97358533de29f4c6db97a8f0b7e0401ac4d598d0818c`
passes **28/28**, with all **19** global ownership counts zero. Candidate source,
four binaries and server image are exact; server runs with a positive PID, keeps
loopback18444 and has a new container. Runner is freshly registered and ready.
Database/monolab18443 identities, private configuration, six global receipt-table
multiplicities, three legacy rows and both preserved REVIEW Tasks' complete
canonical/native/Git histories remain exact under the documented poll-timestamp
normalization. No database restore or new native/model admission occurred in this
installation proof.

Retained continuation/unit/installation records:

| Record | SHA256 |
| --- | --- |
| `install-resume-v2-intent.json` | `b2621395d28ea50d842f7c710bc66895f0156701b3e1b725bdeebe74819d2b8c` |
| `install-resume-v2-gate.json` | `2a96aa32eac64f94f58237a9c92e067d697c1287699ca47aa58923e647202cba` |
| `install-resume-v2-unit-proofs.json` | `58f52f729a982bb8319b229b181ef544024b67e8a33ebdf0fc0e5dad27510594` |
| `bootstrap-resume-v2-check.log` | `c12d1ed9282ba297e6d9f09d43a506a85d1370a8854f5718f6873523cd610399` |
| `install-complete.json` | `d9be3280def641aa0f333abef1f0df579af03920e5f7a4cfa93a348284dcd325` |

Fresh catalog record states active native-tool
`opencode/longcat-2.5-preview-free`, explicit numeric zero input/output/cache-read/
cache-write prices, OpenCode1.18.30, observed epoch1790977483.5223105. This is
catalog/version evidence; it does not establish the upcoming native chain.

Reviewer also fetched the actual installed `/` shell and its exact JS/CSS through
the current TLS forward, trusting the existing Runner CA with normal certificate
verification. All three responses are200 and match frozen `built.json` asset hashes;
served HTML/JS/CSS sizes are391/753,019/44,993 bytes. These are unauthenticated
read-only static requests, not Owner/model commands or a new container.

Native observer review caught and corrected a prestart predicate incorrectly
expecting `READY`; canonical Task state is `PLANNING`, while Ready is a UI column.
It also requested actual service-private export identity alongside worktree bytes.
Revised helper retains the capture receipt's nested Todo identity and exact preview
receipt source, and checks zero Task execution effects before Start plus actual
export-tree/result-ref equality at completion. Native chain and remaining visual
acceptance are recorded in [acceptance-review.md](acceptance-review.md).

## Actual preservation after the native chain

Reviewed separate final-preservation helper SHA256
`2c9cf85659356a6a489c27ba7b80fbf7fbbcdcd253ac4ac552bfe4617cdfd3a7`.
It binds exact installed baseline/install-complete/manifest/observer/common/
never-started hashes and preserves old semantic/native/Git comparison. Global
receipt maps are compared as original multiplicity subsets: actual new Owner/Agent
commands legitimately add rows, while every original hash/count must remain.
It also requires exact372 candidate files, installed binaries/image/container/
Runner identities/config, DB/monolab/legacy and all19 zero ownership dimensions.
Worker exercised full constructor-free actual read paths and serialization,
preserving its31/31 read-only report and historical/receipt-loss negative checks.

Root ran the exclusive named final preservation gate. Actual
`/root/monos-execution-acceptance-deploy-v1/final-preservation-settled.json`
SHA256 `216f70c623170229f31e45fcd82c214547a969070e180db678502f7fc1b74a01`
passes **31/31**, all19 zero. Reviewer independently reloaded exact frozen baseline,
manifest/install records and actual result, recomputing every predicate on the
host without constructor/save/service/Owner/model action. All31 recorded predicates
recompute exactly at the result's actual capture time. Historical heartbeat age
then was1.3346 seconds; re-evaluating that historical heartbeat against later wall
time correctly becomes stale and is not evidence that the original ready check
failed. No extra restart or admission was performed to refresh historical proof.

Both preserved Spec/Replan REVIEW Tasks' canonical/native/Git history, legacy rows,
original six-table receipt multiplicities, existing DB/monolab18443, installed
server/Runner/source/binaries/private configuration are intact after the fresh
native work and semantic correction. This closes installed-history preservation;
current Task result and browser acceptance remain scoped to the companion report.
