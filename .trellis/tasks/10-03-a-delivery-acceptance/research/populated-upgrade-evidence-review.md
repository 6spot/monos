# Independent populated upgrade evidence review

Active task: `.trellis/tasks/10-03-a-delivery-acceptance`.

Reviewer: `/root/review_final_check`, 2026-10-07. **READY / PASS for the isolated populated clone preflight only.** No evidence defect remains in the reviewed v2 receipt chain. Root owns subsequent installation gates; this reviewer performed no replay, test, host/provider/Agent operation, product edit, commit or lifecycle action.

## Findings (fixed)

- File: `populated-upgrade-v2-transport-verification.json`. The original transport receipt recorded `transport_closed=true` without a separate closure status. Root retained that receipt and added controller/receipt hashes plus the actual guarded controller exit0. Independently read the private controller: its `finally` checks the SSH close return code, raises on nonzero and writes collection receipts only after this guard. Its recorded successful execution therefore supports close0. Both current controller and original transport receipt hashes match the new provenance record. This is distinct from the first inventory's invoked-close-only limitation.

No executable file was changed by this reviewer. All previous failure/review artifacts were preserved.

## Findings (not fixed)

No actionable evidence issue found. Raw dump/streams remain private and were not inspected here. Reused snapshot evidence refers to the original v1 dump, not a fresh live database observation. This preflight does not prove coordinated backup, stopped primary services, installed native process/workspace quiescence, installation replacement or App/native/browser/delivery acceptance. All six PRD installed criteria remain open.

## Independent reconciliation

| Boundary | Verified result |
| --- | --- |
| Candidate | V2 intent image `sha256:de8f15a1b9b60f9b013abaa167100f84f518ac3304afc0ab98d408efc8fd7434` equals the server image in the frozen build receipt for commit `63eaa285ab90fdd6de018671a47ba5583f87bc75`. Build receipt SHA256 remains `066c1a62eade75781491f01dbc68fb938e0daa23ff046a651469d4144a654e13`. |
| Loaded helpers | Intent and transport hashes equal the final reviewed/current Python `2f61ad0ac1dc23fb551410a3590dbcfb8e23b37b9d6f526cc3717c49f49c177d` and MJS `3ab65e5cf3d5afa90275c42c247f2f640cf583f15c3c620d05bf7188129c4f13`. The reviewed source caches validated prior bytes and awaits actual candidate `migrate()` twice. |
| Original snapshot | V1 and v2 results carry identical dump SHA256 `2322f194cabf970cb5ae482f2459d72a587c07ba1024ccf04ae65194d33f0abb`; v2 intent explicitly links `/root/monos-delivery-populated-upgrade-v1`. Fresh clone/observer names and nonce differ from v1. |
| Actual environment | Node observation is `v24.21.0`, PostgreSQL `17.11 (Debian 17.11-1.pgdg13+2)`, database `acceptance_clone`. Reviewed command uses network-none PostgreSQL/tmpfs/no host ports and only its network namespace for the candidate Node observer. |
| Restore/migration execution | Create, restore and migrate stage metadata each records exit0. Restore and migrate raw streams have the empty-stream SHA256. Overall execution receipt records returncode0. No backend pumps are invoked. |
| Retained data | Independently recomputed:85 original **public** tables,3478 original rows; every before/after count and sorted-row SHA256 is identical, with no missing/extra original table. Included counts:32 Tasks,88 Attempts,36 Specification revisions,136 command receipts,42 configuration receipts and934 log entries. Original-column and duplicate-multiplicity scope is preserved. |
| Migration history |21 original ordered migration rows exactly match SHA256 of unchanged source files1–21; the final25 rows exactly match all25 source migrations. Scoped diff confirms migrator/migrations unchanged. This independently checks more than the Boolean summary. |
| New records |37 newly introduced tables; every count is zero. No product pump-created delivery/review/publication records are claimed. |
| Observation binding | Local observation file SHA256 `fc94944e9ddeee4326e10be6569755e3a289a94750fbdf12e6f400c32ace0d9b` equals the result's exact observation digest. All four observation checks are true and independently consistent with its full maps/arrays. |
| Cleanup | Observer is absent through successful inventory; exact original clone `4fe22f7f7b1c62d351c41c81c3ff8a4e2c358d6b87b744c935fdb267c3e03e09` had Stop0 and confirmed inventory absence on the second post-stop observation. The create stdout digest equals SHA256 of this ID plus its newline, linking creation and cleanup identities. Frozen helper requires name/ID and nonce/role absence, never nonzero-inspect inference. |
| Transport | Controller hash `f6381b2b7e1c9916e7b9c6a3132f57f255a4e65a9081ae47bd8be4e56a01bff6` and transport receipt hash `ae99799cce1ac5015bfe6a3bc2675ef36642a356769dd08fbccd08d5eeaac9e2` match closure provenance; actual guarded controller exit0 supports verified SSH close0. |

### Retained v1 failure

V1 remains failed with generic RuntimeError and no successful Node observation; its exact runtime cause remains unknown. The original immediate cleanup report remains unconfirmed despite Stop0. Its separate later successful read-only inventory confirms the original clone ID absent and zero matching task containers. That observation resolves cleanup only. V2 success neither establishes the cause nor rewrites v1 as a passing preflight.

## Verification performed

- Read-only inspection of v2 intent/result/observation/stage/transport metadata, separate closure provenance and private controller source; reconciled frozen build image/commit and unchanged helper/migration inputs.
- Read-only Python artifact analysis recomputed table/count/hash equality, original/final migration checksums, observation and controller/receipt hashes, exact dump continuity and create/cleanup identity digest: PASS.
- No raw private dump/log collection, additional SSH/Docker/DB/model/provider call or test invocation. Existing helper/code evidence is reused; no suite or preflight replay is justified after this proof.

## Evidence SHA256

| Artifact | SHA256 |
| --- | --- |
| `populated-upgrade-v2-intent.json` | `f1fe9d31480d5fdaf27d7e06ece566988073a6eee51241324bbbae80d5945b32` |
| `populated-upgrade-v2-result.json` | `6a6f414147b29c6b3dd8ea19fd36930abaf68cc58aeb2b82547d13916792de25` |
| `populated-upgrade-v2-populated-upgrade.json` | `fc94944e9ddeee4326e10be6569755e3a289a94750fbdf12e6f400c32ace0d9b` |
| `populated-upgrade-v2-create-clone.json` | `de24e94161af4e9a4101b1b3c7ca3700e90855f1b761a47d2fa311cad258f876` |
| `populated-upgrade-v2-restore-clone.json`, `populated-upgrade-v2-migrate-clone.json` | `67e6fe6778ac9eb736c5c48fa6b14fb9117f952037dda96926975b56fda8b50a` |
| `populated-upgrade-v2-transport.json` | `ae99799cce1ac5015bfe6a3bc2675ef36642a356769dd08fbccd08d5eeaac9e2` |
| `populated-upgrade-v2-transport-verification.json` | `f0927a785ebacb7527466e7d0bff0677e40606882af301735bfd9a7ebfa1a14a` |
| `populated-upgrade-v1-result.json` | `591cebcc560f887ce72c4d4e0c7825261404d4413bd4dc4875624b7afef03774` |
| `populated-upgrade-v1-reconciled.json` | `085e76e6b011a4ee3b73ceca8035dbb18602ec7c18183ab18c46184205dc7669` |
