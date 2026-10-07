# Independent candidate build evidence review

2026-10-07. Active task `.trellis/tasks/10-03-a-delivery-acceptance`. Sole write ownership: this report. Static local inspection only; no host connection, effect replay, build/test repetition, product/helper edit, commit or lifecycle operation. Shared dirty Trellis/framework and task planning/research paths were recorded with `git status --short` and preserved.

## Decision

**READY — build prerequisites only.** No blocking inconsistency was found in the completed build evidence or frozen candidate. This result does not admit installation and does not pass any installed/native/App/Owner/PR/browser/history acceptance criterion.

Frozen candidate is exactly `63eaa285ab90fdd6de018671a47ba5583f87bc75`, tree `5c78d4b77ce46c819c0a4052cbb47d963e2c769f`. Compared with accepted product `5c26071ee83da7b6d4f37fca7fbc76b0b1e2269d`, only the two selected PostgreSQL test files changed in the product/build scope; production, protocol, Runner and Web inputs remain the accepted correction inputs. Task archive/journal commits are outside that scope.

## Independently reconciled facts

| Boundary | Static evidence result |
| --- | --- |
| Committed candidate | Current HEAD/tree/index match the candidate. All493 regular Git blobs, byte lengths, SHA256 values, Git modes/executable bits and current working bytes match [candidate-inputs-v2.json](candidate-inputs-v2.json) and [manifest.json](build/manifest.json). |
| Packaged source | Independently read all493 members of each retained v1/v2/v3 `source.tar`: exact committed bodies, regular types, modes0644/0755, UID/GID/mtime zero, identical member sets and identical tar/manifest hashes. |
| Installed input delta | Recomputed against the retained private372-file manifest:121 added,65 changed,0 removed. All21 previous migration bytes/modes remain identical; candidate contains25 migrations. This compares manifests, not current installed database contents. |
| Final composite | [built.json](build/built.json), [build-intent.json](build/build-intent.json), current helpers, [cleanup.json](build/cleanup.json), current stage result and every V3 closed log/result/driver hash in [result-metadata.json](build/result-metadata.json) match their exact local/private copies. |
| V2 reuse | All five original successful V2 results and closed logs match the final composite's retained result/log hashes, exits and timestamps. The original V2 helper/intent hashes remain unchanged. V3 runs only the corrected targeted PostgreSQL stage. |
| Image identity | Exact final server/test IDs occur in their original closed Docker export logs. Their independent V2 audits match the final composite:304 server/306 test source files, expected committed source subset, pinned Node24.21.0, native app/coordinator imports and identical three SPA assets. |
| Four binaries | Original V2/final intent and composite bind the same four SHA256 identities and mode0755 values. The reviewed builder enforces four ELF outputs and rechecks their hashes before/after V3; this static audit does not retrieve or execute the remote binaries. |
| Selected PostgreSQL | Original V3 Vitest JSON has exactly2 passed,20 skipped,0 failed; the passed titles are the intended populated21 preservation and exact23→25/legacy-seam refusal cases. Summary/result/log hashes match; actual versions are Node24.21.0 and PostgreSQL17.11. Recorded schema set8 before/8 after is identical and the unique test schema was removed. |
| Failures | V1 Go exit1 and V2 pg-lookup exit1 retain their original failure/result/log bodies. Neither failed namespace has `built.json`; no failed stage is relabelled successful. |
| Safe collection | All11/22/14 retained v1/v2/v3 result-tar members are flat regular files and exactly match their exclusive extracted copies. V2/V3 transport archives contain the six exact frozen payload members and match their declared archive hashes. |

Reviewed local private evidence is `/private/tmp/monos-delivery-acceptance-build-v{1,2,3}`. Only digests, safe identities and conclusions are retained here; private credential material and raw helper authentication text are not copied.

### Frozen handoff identities

- Source tar SHA256: `57de313a0399e4d4899f0da83009339a418382c2b4899a1a1231e4ccdd8f4b54`.
- Manifest SHA256: `c556a62a0e786bf4d65421c4490b3d210cce8e502c5174b7fd31a74c4b31ae25`.
- Final composite SHA256: `066c1a62eade75781491f01dbc68fb938e0daa23ff046a651469d4144a654e13`.
- Server image: `sha256:de8f15a1b9b60f9b013abaa167100f84f518ac3304afc0ab98d408efc8fd7434`.
- Test image: `sha256:1d228d1b3b41c6114105c4ccb19db06092174b25afc7220a94f0de38ec8195a6`.
- Source/binaries remain the V2 directories; V3 is an explicit composite receipt, not a fresh Go/Docker build. Mutable tags are labels: later execution/install must bind the exact image ID and binary/asset hashes.

The recorded JS/CSS hashes equal accepted correction Web evidence (`index-mkoA3kwR.js` / `index-CDYDw6Vm.css`). This supports reuse at unchanged layout/behavior boundaries; it does not prove the installed services serve those bytes or that a native Task populated those views.

## Failure recovery and truthful boundaries

[Build verification](build/build-verification.md) correctly distinguishes V1's read-only source/TMPDIR fixture failure from V2's dependency-lookup failure. V1's local Python3.9 collection error did not trigger another remote build. The original result tar and flat-member recovery are preserved. V2's successful Go/image stages remain the sole sources of those outcomes; V3 corrects only `pg` lookup and observed PostgreSQL-version reporting, then verifies and reuses the exact successful stages.

Cleanup's scope is zero containers bearing the task namespace after the build, with source directories, images and evidence retained. The reviewed finalizer actually checks Docker's complete container-name inventory before writing cleanup/composite receipts. It contains no service restart, installed migration, native CLI/model execution, Owner configuration or provider write. A retained image/source/journal directory is intentionally not claimed deleted. This is build cleanup evidence, not installed process/Attempt/lease quiescence.

SSH closure is recorded in final result metadata and backed by the reviewed transport's `finally`: run the task master's explicit exit, require return0, then emit `transport_closed:true`. This is stronger than the earlier inventory's invocation-only field. The remote build's driver log alone is not a closure receipt, and this static reviewer did not independently open a connection or re-observe host transport state. Safe local script hashes are V2 `12f4ea46e7c993032a5b69e8972646889771a529fb609715c06042498a0e3946`, V3 `a6fbeba04a51db2531e55f53518ad4fdd75459e353d76498adec040e182f7548`.

The migration fixtures establish their exact bounded contracts. They do not establish the real installed32-Task/88-Attempt clone/production upgrade, actual private histories/Git/receipts preservation, native cgroup lifecycle, GitHub App issuance or an ordinary Owner correction/delivery loop. [PRD](../prd.md) AC1–AC6 remain open, as the build handoff explicitly states.

## Checks run and remaining work

- `git status --short`, `git log`/`git diff --name-only` for accepted product→candidate, and bounded source/helper/report reads: scope and dirty-state reconciliation passed.
- Inline `python3` static evidence reconciliation using `git ls-tree`, `git ls-files`, `git cat-file --batch`, SHA256, regular-file/mode inspection, tar member reads and JSON/log parsing: all source/package/composite/reuse/image/failure checks passed. No inspected helper was executed.
- The first reviewer check incorrectly treated `transport_sha256` as a script hash and stopped after all prior checks passed. Diagnosis showed it is the transport **archive** hash. Only that interpretation and the remaining final PG/transport/collection checks were rerun; they passed. This was a reviewer assertion mistake, not a build evidence defect.
- Documentation links, code fences and whitespace are checked locally. Product tests, optional suites and host effects were skipped according to the read-only assignment and verification-scope stopping rule.

Root owns the next independent installation review, actual guarded canonical/physical ownership observations, coordinated private backups/populated upgrade, App prerequisites and installed native/UI loop. Any changed candidate/product/build/helper input invalidates only the evidence depending on that input; no extra build or suite is warranted solely by this report.
