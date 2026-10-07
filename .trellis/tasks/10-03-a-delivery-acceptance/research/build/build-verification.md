# Committed candidate Linux build

Active task: `.trellis/tasks/10-03-a-delivery-acceptance`. Build delegate only; no installation, service operation, production migration, Owner setting, model call or provider write.

## Frozen inputs

- Candidate: `63eaa285ab90fdd6de018671a47ba5583f87bc75`; accepted review correction product `5c26071` plus two reviewed migration test repairs.
- Exact 493 tracked committed product files, regular-file types, Git blobs, SHA256 and executable bits match the working files. Compared with the retained installed372-file manifest:121 added,65 changed,0 removed. All21 prior migration files retain their bytes/modes; current migration set has25 files.
- Source tar: `57de313a0399e4d4899f0da83009339a418382c2b4899a1a1231e4ccdd8f4b54`; manifest: `c556a62a0e786bf4d65421c4490b3d210cce8e502c5174b7fd31a74c4b31ae25`. Independently read every tar member and verified493 exact bodies/modes, zero UID/GID/mtime and regular-file types. Repeated packaging refuses the existing output directory and preserves frozen artifacts.
- Reused accepted remote helper sources, read-only and SHA-verified: package `3587f9acc6f92f426ac54744c603f967a047ecd4054942f0d544847bd6703b37`; build `6b125616593f3f8567f5d61ecab2f9dfc3bf6794fa04474fc639ca24f54c9d9b`. Installed prior manifest `aeb0d0c92ecb02788dc2bc881d603de0ab34cbaa0a0a9ed2e217aa030e4c5ffb`.

## Retained first failure and helper correction

Original task paths `/root/monos-delivery-acceptance-{src,build}-v1` are retained unchanged. Go image `sha256:69a7b9788769bec032d238959b61854e9ae87f57be9029ec04e9885fabf99195`, Go1.27.1 Linuxamd64/CGO, network none,2CPUs/4GiB. Module verification passed, but the race stage exited1 after23.55seconds: existing publication/result tests create trusted fixture directories under package cwd; the old accepted helper mounted the entire source read-only. Default `/tmp` also violates a result-lineage test's private-ancestor predicate. No binaries, candidate Docker images or PostgreSQL stage ran.

V1 failure and closed Go/driver logs remain in the private remote/local artifact directory. Local Python3.9 rejected `tarfile.extractall(filter='data')` during evidence collection after the SSH transport had closed. The original result tar is preserved. Recovery verified every member was a regular single-component filename and copied each exact member to an exclusive local file; no path traversal, links or overwrite were admitted.

Root reviewed the helper-only correction before V2 execution. V2 uses fresh `/root/monos-delivery-acceptance-{src,build}-v2`, fresh image tags and container names. Frozen `/src` remains read-only; the ephemeral Go container copies it to `/work` owned by UID0, verifies all493 SHA256 values and exact modes before tests, and uses private `/work/tmp` for `TMPDIR`. Final source verification still compares the immutable staged source to the manifest. The product tar/manifest are unchanged.

## Selected commands and current status

Python helper compile and `node --check targeted-db.mjs`:PASS. No product lint/typecheck/full PostgreSQL/provider suite was repeated for these task-owned helpers.

V2 Linux Go and both Docker targets/image audits passed. Its PostgreSQL helper exited before connection/test execution because `pg` belongs to `packages/db`, while the helper resolved it from `apps/server`. The original V2 failure is retained; no successful `built.json` was written for V2. V3 corrected only the dependency lookup and added observed PostgreSQL version to its summary. After root's scoped review, it ran only the two selected PostgreSQL cases, after checking the exact successful V2 source/stage logs, helper hashes, binary modes/hashes and exported image IDs. The final V3 composite receipt explicitly retains those V2 stage identities and rechecks them after PostgreSQL.

ExecutedV2 Go gates:

```sh
go mod verify
go test -race -p 2 -timeout 180s ./...
go vet ./...
go build -trimpath -o /out/<name> ./cmd/<name>
```

The last command runs for all four executables only after preceding successful statuses. Four exact ELF/mode0755 outputs are required. Docker builds use the committed pinned Node24.21.0 Dockerfile's test/server targets; both images must match copied source bytes/modes and identical nonempty SPA assets, contain no runtime proxy environment, and successfully import native TypeScript app/coordinator modules.

The only fresh PostgreSQL selection is:

```sh
pnpm exec vitest run apps/server/test/postgres-publication.test.ts apps/server/test/postgres-owner-delivery.test.ts -t 'upgrades populated version21|upgrades exact version23 to version25'
```

The helper requires actual PostgreSQL17.11 and pinned Node24.21.0, supplies the private URL only in the child environment, isolates a unique test schema, requires exactly2 passed tests, removes its schema and compares the complete preexisting schema set. These fixtures establish populated21→25 preservation and version23 legacy-seam atomic refusal; they do not prove the actual installed32-Task/88-Attempt database upgrade.

## Final outcome and handoff

**PASS**, final composite `/root/monos-delivery-acceptance-build-v3/built.json` SHA256 `066c1a62eade75781491f01dbc68fb938e0daa23ff046a651469d4144a654e13`. Its exact safe local copy is [built.json](built.json); [build-intent.json](build-intent.json) binds the reused stages, binary/image identities and current helper hashes. [result-metadata.json](result-metadata.json) binds all closed V3 reports/logs and transport closure. Successful V2 stage result/log hashes remain explicit in the composite receipt; no V2 failure was relabeled.

| Stage | Final exit | Duration |
| --- | --- | --- |
| V2 Linux module/race/vet/four builds | 0 | 56.98 seconds |
| V2 Docker test target | 0 | 56.71 seconds |
| V2 Docker server target | 0 | 31.50 seconds |
| V2 test image/source/SPA/native imports | 0 | 1.54 seconds |
| V2 server image/source/SPA/native imports | 0 | 1.06 seconds |
| V3 selected PostgreSQL cases | 0 | 4.42 seconds |

V3 PostgreSQL: **2 PASS,20 skipped**, actual `v24.21.0` and `17.11 (Debian 17.11-1.pgdg13+2)`. Complete preexisting schema set remained identical:8 before/8 after; the unique test schema was removed. This stage did not rerun Go, build images or repeat the image audits. Final validation rechecked all source files/modes, original successful closed logs/results, current image IDs against original exported IDs and all four binary hashes. Docker inventory confirmed zero task-owned containers; private source, images and evidence are retained. SSH closure confirmed; root's serialized host slot is released.

Production handoff uses source `/root/monos-delivery-acceptance-src-v2`, binary directory `/root/monos-delivery-acceptance-build-v2/bin` and these exact images:

| Image | ID |
| --- | --- |
| `monos-delivery-acceptance-server:v2` | `sha256:de8f15a1b9b60f9b013abaa167100f84f518ac3304afc0ab98d408efc8fd7434` |
| `monos-delivery-acceptance-tests:v2` | `sha256:1d228d1b3b41c6114105c4ccb19db06092174b25afc7220a94f0de38ec8195a6` |

Both pinned Node images verified copied source bytes/modes:304 server/306 test files, identical3 SPA assets and successful native app/coordinator imports. No proxy environment is retained in either runtime image. Exact asset hashes are in the composite receipt.

| ELF executable, mode0755 | SHA256 |
| --- | --- |
| `monos` | `7fc14aacda3e07e9a120d96e391287aa92a2cad3d4059d61e181c9a6573f170b` |
| `monos-runner` | `8e4ac8f122455fce974293620f14401ad5e5ad1b545864907edb6da95742dcb7` |
| `monos-probe-launch` | `88a3706e964ef587be0614de850735a3311545933bcb1df7e4f6dacb7f67978e` |
| `monos-probe-exec` | `75103986428e4ccee0dd70e59c062f8842abb141db5f9b2437a069ed71e29faa` |

Current final helpers: package SHA256 `b4abc89e78c61cc72e1f0a959dc29c6ca040b600f6caf3e655ba27f84de22457`; build `544943d0e1794bd6533c485b8e93394009b1c6bea59f8c3551e5cb0a37c19368`; targeted DB `fb7344e48ba3d273cc0d22174e04b077c16e77efcb6f1ca4f927b63ad7c8f53c`. Build-v2 reused helper `8cfef033b47f368c0481360118a2c8f58e45c8a507f8bd744e4901b9ef91a94c` remains immutable. All candidate product files remain clean; migration25 remains `b3bca7c345ac49f39795ca4f4e5f99abf6fecf094833ccb88c7befcd84266f18`.

## Limits

No installed native CLI/cgroup, remote App issuance, ordinary Owner, physical upgrade, Task/PR/review/finality or responsive browser acceptance is claimed. Unchanged accepted correction semantics,24→25, Worker14 and protocol/API/browser evidence are reused rather than rerun. Root owns the later populated clone/production upgrade, installation, histories/receipts/Git comparison and real native loop.

All six PRD acceptance criteria remain open until their installed/native/remote/UI/history outcomes are observed. This handoff supplies build prerequisites only.
