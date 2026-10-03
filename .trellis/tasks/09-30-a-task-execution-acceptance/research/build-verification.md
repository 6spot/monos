# Candidate staging and Linux build verification

Build ready on 2026-10-03. This worker packaged, staged and tested the accepted
candidate; it did not install source/binaries, restart services, change Owner
settings or admit native/model work. Root owns those subsequent acceptance steps.

## Frozen provenance

| Item | Exact identity |
| --- | --- |
| Candidate commit | `04c0380beacfaf1b14b55cd86a87c0fdb8b0e030` |
| Accepted product commit | `d5530ea464622fcc3c85c987375acf16dfb1a194` |
| Candidate Git tree | `664fc9d8bf9c338102da925bffc4db4ac9078be3` |
| Source tar SHA256 | `f7a52dbd8998a828881da38d7aac78aabb2181ff01d5880ec31f85f2c027326c` |
| Candidate manifest SHA256 | `aeb0d0c92ecb02788dc2bc881d603de0ab34cbaa0a0a9ed2e217aa030e4c5ffb` |
| Previous installed v4 manifest SHA256 | `e125d117b5b337cc15f6889c23c5fa2beba2356956dd481b6f17ca58f2e669aa` |
| Build intent SHA256 | `f767b6fc54c98a8e8a75e58b996a61e7a41436e557dec5e80a0644b076238efe` |
| Final `built.json` SHA256 | `a8929450b81c3622d3595a17aa6d9ac2830c8d6cfc89e70b06ee57dd87470a9d` |

The manifest records all 372 selected tracked files, Git blob IDs, committed modes
and SHA256 hashes. Its scope is `git ls-files apps packages runner infra scripts
package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.json tsconfig.build.json
eslint.config.mjs`. The package compares each working file's bytes and executable
bit against the committed blob before archiving committed bytes. It excludes
`.trellis`, ignored/untracked files and private deployment data. Tar members were
independently read back and checked for regular-file type, exact membership, bytes
and mode; remote extraction also checks paths before materialization.

Against the retained 343-file installed manifest: **29 added, 33 changed, zero
removed**. No migration changed. The source directory was checked again after all
build/tests for exact file membership, bytes and modes.

## Paths and utilities

- Local private package/utilities: `/tmp/monos-execution-acceptance-omyu8pc5/`.
  Retrieved records are in its `results/` subdirectory; all 17 closed JSON/log
  files were checked against the final result's hashes where listed.
- Remote source: `/root/monos-execution-acceptance-src-v1`.
- Remote inputs/evidence: `/root/monos-execution-acceptance-build-v1/` contains
  `source.tar`, `manifest.json`, `installed-manifest.json`, `package.py`, `build.py`,
  `targeted-db.mjs`, `intent.json`, stage `.log`/`.result.json`,
  `targeted-postgres-summary.json`, final `built.json` and subsequent `cleanup.json`.
- Fresh binaries: `/root/monos-execution-acceptance-build-v1/bin/`.

| Utility | SHA256 |
| --- | --- |
| `package.py` | `3587f9acc6f92f426ac54744c603f967a047ecd4054942f0d544847bd6703b37` |
| `build.py` | `6b125616593f3f8567f5d61ecab2f9dfc3bf6794fa04474fc639ca24f54c9d9b` |
| `targeted-db.mjs` | `5f3df104b01a653507b05b268627f00976b898155312e5b70920f1e8a57c4dcc` |

Python compilation and Node syntax checking passed before transfer. Build begins
only after supplied manifest/tar hashes match, source path is unused and both
candidate tags are absent. An exclusive claim and intent precede the long stages.
Stage output and exit status are retained without overwriting an earlier run; a
failure prevents `built.json` from being written. Do not rerun the same claimed
namespace or overwrite its tags. A future trial needs separately reviewed unique
paths/tags and preserved earlier results.

## Executed Linux gates

| Gate | Result |
| --- | --- |
| `go mod verify` | All modules verified |
| `go test -race -p 2 -timeout 180s ./...` | All eight tested packages passed; three other command packages have no test files |
| `go vet ./...` | Passed |
| `go build -trimpath` for all four commands | Passed, all four fresh outputs mode `0755` |
| Docker `test` target | Passed, 45.87 seconds |
| Docker `server` target | Passed, 21.91 seconds |
| Image source byte/mode checks | Passed: 225 copied tracked files in tests, 223 in server |
| Server/tests built Web assets | Same three files and exact hashes |
| Targeted real PostgreSQL | **44/44 tests passed in 3 files**, Vitest duration 39.72 seconds |
| Schema cleanup | Before/after seven schemas, no additions or removals |

The complete Go stage took 20.60 seconds in Linux amd64, Go 1.27.1, CGO enabled.
Its exact image ID was
`sha256:69a7b9788769bec032d238959b61854e9ae87f57be9029ec04e9885fabf99195`.
Source was mounted read-only, network disabled, with existing module/build caches
at `/root/monos-logs-gomod-cache` and `/root/monos-planning-go-build-cache`.
The fresh outputs and source hashes were rechecked after PostgreSQL testing.

PostgreSQL ran inside the new test image on the existing internal control network:

- `postgres-owner-access.test.ts`: 5/5.
- `postgres-task-ui-reads.test.ts`: 8/8.
- `postgres-node-execution.test.ts`: 31/31.

The database URL was mounted as a read-only private file and passed to the test
subprocess environment, never printed or placed in Docker argv. Tests use their
existing isolated schemas. No full historical fault suite was repeated.

The host proxy at `127.0.0.1:7890` was checked before using Docker build arguments.
Both finished image environments were verified to contain no proxy environment
variables. Go/test containers were limited to two CPUs and 4 GiB; no Docker socket
or host process/cgroup namespace was exposed to them. All task-owned Go, image
verification and PostgreSQL containers used `--rm`; final inspection found none
remaining and recorded a successful Docker inventory read in `cleanup.json`.

## Candidate outputs

| Image tag | Exact image ID |
| --- | --- |
| `monos-execution-acceptance-server:v1` | `sha256:daa468f43a5b13fe67ebeeb79a575131159f241502cc39fb8ded9b27cd161cc3` |
| `monos-execution-acceptance-tests:v1` | `sha256:3583dc6c467a164a5fcb0aca4fdab9a643c69458c2c778efe8e79cec7aa8fa9e` |

No `latest` tag was replaced. Both images use Node 24.21.0 from the repository's
digest-pinned Dockerfile. Root can bind its image-only overlay to the exact server
image ID above.

| Binary | SHA256 |
| --- | --- |
| `monos` | `c422e1c1d03beb1b936969657ace7c9a9c5c3cb89b640fd1518e34e65f4da5dc` |
| `monos-runner` | `f222fdc0302a91587822bc6fa1810b32b2a27d3cefd8e8cb2c6e5876067c6678` |
| `monos-probe-launch` | `402fe22e3c82eb46e0702702fd6c1eca0534cafb0b3d375ca529c5ce1d645de5` |
| `monos-probe-exec` | `d1e18d61747cd5fa572485babec8bdd9db1354a44adec3345b65f7717a103c43` |

| Built Web file | SHA256 |
| --- | --- |
| `index.html` | `1d6cc2c3f9a67bac7e16875ba581148d548ef63bb3593ff974a7f0a3b55c68bc` |
| `assets/index-DVkmoQ-z.js` | `bfa74cc434579f2669e355fc81f27f64d71ee9f4a787687b46881d1fe0aa8bca` |
| `assets/index-CIqFVtS4.css` | `6a2266335a48d2301ad4b94d338e3e06b9f21837c2661f1417ee1f08b410b76c` |

## Evidence limits and handoff

These results establish the exact staged candidate's build, generated-consumer
compatibility and affected PostgreSQL contracts. Container tests do not establish
host systemd/cgroup behavior, actual CLI/model invocation, browser screenshots,
repository execution, service reconnect, installed-file preservation or provider
delivery. Root must use its independent backup/preflight/install/native/browser
evidence for those claims. Existing historical recovery evidence remains bounded
by its recorded revisions. This worker made no product-code changes or commit.
