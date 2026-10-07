# Populated upgrade diagnostic and snapshot reuse review

Active task: `.trellis/tasks/10-03-a-delivery-acceptance`.

Reviewer: `/root/review_final_check`, 2026-10-07. **READY** at the final hashes below for root's isolated continuation under the existing build/host serialization gate. This is helper safety approval, not a successful migration or installed backup/upgrade claim. Previous review reports and the failed v1 remain untouched.

## Findings (fixed)

- File: `populated-upgrade.py`. During this review, prior snapshot validation used one read while copy/restore used a later independent read. Root now caches the bytes once after private-file checks, verifies their SHA256 against the original result and uses those same bytes for the fresh dump and restore. The actual continuation is bound to the validated snapshot without rereading mutable input.
- File: `populated-upgrade.py`. Root added exclusive private per-stage stdout/stderr and status/hash files for dump/create/restore/migrate and timeout diagnostics. The main failure report retains its original stage before optional database-log collection. This addresses the initial generic RuntimeError's missing diagnostic boundary without changing that failed artifact.
- File: `populated-upgrade.py`. Post-stop cleanup now permits bounded read-only inventory polling for asynchronous `--rm` removal. Every successful absence still requires the exact original name/ID absent and an empty run-nonce/role inventory. An error or exhausted wait remains unconfirmed; polling does not admit another start or a foreign stop.

All repairs are root edits. This reviewer changed only this report.

## Findings (not fixed)

No actionable issue remains in the assigned delta. The captured snapshot remains the v1 source snapshot; reuse is not a new observation of the live primary database and cannot substitute for the later fresh coordinated backup. Root must keep raw stage streams in private storage and expose only selected safe metadata.

## Privacy, ownership and failure checks

- Fresh output directories remain exclusive root-owned mode0700 with umask0077; stream files use exclusive creation and inherit0600. Raw stdout may include the entire database dump and raw stderr may contain sensitive query details, so these files are intentionally private rather than claimed redacted. Public result/stage metadata contains status, finite stage/type and hashes; no passwords or raw output are printed. Clone password/URL remain file inputs, never host argv values.
- Prior directory and dump checks reject symlinks, non-root ownership and group/other permissions. The cached bytes are compared against the original `source_dump_sha256`, then reused in a fresh directory with a new nonce, new clone credentials and separate clone/observer identities. Intent links the predecessor directory and retains current helper/image identities before clone creation.
- Existing exact-name/ID/image/nonce/role ownership guards are unchanged. Cleanup still runs observer first, then clone, catches per-container failures and saves the exclusive result before reporting uncertainty. Successful inventory observation, rather than failed inspect/stop, supplies absence evidence.
- Reviewed `populated-upgrade-v1-result.json`: outcome remains fail, generic RuntimeError retained, immediate clone cleanup remains unconfirmed. The separate actual read-only `populated-upgrade-v1-reconciled.json` records successful inventory, original ID `2160a396fb4613829108b841d7f6ccd5c530a8adc51996bdce3fce2d9fa82422` absent and zero matching task containers. That later observation resolves cleanup only; it does not turn v1 into a successful upgrade.
- Original dump hash is `2322f194cabf970cb5ae482f2459d72a587c07ba1024ccf04ae65194d33f0abb`. The script binds actual reused bytes to that retained result at execution. This reviewer has not accessed the raw private dump or claimed its execution validation.
- Primary dump command, isolated network/tmpfs/no-host-port clone, explicit candidate Node/migrator command and old-column/count/hash plus prior21→25 comparisons retain the v2 reviewed boundaries. MJS is byte-identical to the reviewed version; no semantic/native/workspace/provider or primary migration claim is introduced.

## Verification

- Read the complete latest Python helper, then the final cached-snapshot repair; inspected v1 intent/result/reconciliation metadata and reconciled final source hashes.
- Root-reported Python syntax check after the final repair: PASS, reused. Reviewer performed no helper/host/provider/Agent execution, test rerun, product edit, commit or lifecycle operation.
- Scoped `git diff --check`: PASS; helper/report files are untracked, so final report whitespace is also checked directly. Retained earlier report hashes remain `8a0eaea1500b7adb03eb050dd0aa4e4595a82469e30b423cde989db9feb6b460` (initial) and `c900278bb3508e82765479a1184614e13d062fef5cef36b45887206fe7f3576f` (v2).
- No additional unit or archived suite is warranted for this diagnostic/continuation repair. The next actual isolated run must retain its own restore/migration comparison and cleanup evidence, including failures.

## Reviewed SHA256

| Input | SHA256 |
| --- | --- |
| `populated-upgrade.py` | `2f61ad0ac1dc23fb551410a3590dbcfb8e23b37b9d6f526cc3717c49f49c177d` |
| `populated-upgrade.mjs` | `3ab65e5cf3d5afa90275c42c247f2f640cf583f15c3c620d05bf7188129c4f13` |
