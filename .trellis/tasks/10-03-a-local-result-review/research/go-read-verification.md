# Go local result read verification

## Assignment and limits

Own only the four new `runner/internal/{host,daemon,wire,control}/result_read_test.go` files and this report. Initial dirty state included existing main-session collaboration/workflow changes and concurrent Go/protocol/backend/Web implementation; preserved all of them. No product source, schema, generated file, existing test, spec, task lifecycle, journal or commit was edited by this agent.

Tests run on macOS as the current account with `/usr/bin/git` and Go 1.27.1. Actual Git object reads, local SQLite journal and local verified TLS websocket transport are exercised. Tests do not establish native Linux root/service/execution account ownership, systemd/cgroups, installed host integration, model/Agent execution, live provider writes or deployment. The internal directory policy test uses the current UID honestly; no production ownership bypass was added.

## Intermediate failures retained

1. First focused host run: immutable export/fixed-base and 130-change pagination passed. Gitlink fixture was accidentally removed by a second `git add .`; corrected by committing the prepared index. macOS refused an invalid UTF-8 physical filename; corrected with actual NUL-delimited Git index insertion, retaining the unsupported-name behavioral check. These were fixture failures, not product defects.
2. The actual `resultGit(..., limit=16, cat-file -p <commit>)` unexpectedly succeeded with output beyond the limit. `boundedOutput` embedded `bytes.Buffer`, promoting `ReadFrom` and bypassing the limiting `Write` during subprocess copying. Reported to product owner; fixed there by using a private buffer. Actual repeat and >8 MiB scan / oversized diff cases now pass.
3. A pre-canceled immutable read returned `identity_mismatch` during early Git identity validation. Reported to product owner; fixed there by early/context-aware timeout checks and distinguishing parent cancellation from output overflow. Actual repeat now returns `timeout`.
4. Initial generated wire schema accepted change records without status-required old/new objects and more than 64 KiB raw UTF-8 text (16,385 emoji). Reported to product owner; strict schemas and byte validators were corrected and regenerated there. Repeat now rejects those cases.
5. Original completion recovery test initially supplied Git/workspace metadata on the settlement result. Existing `ValidateCompletionPair` correctly rejected `invalid already-finalized pair`. Corrected the fixture to keep physical completion facts only on the original completion subresult; exact original identity is readable and settlement identity is rejected.
6. Two shell invocations used the wrong working directory: one new test write path failed before mutation; one Go invocation outside `runner` could not locate its module. Corrected explicit paths/workdir. These are not passing validation runs.

## Executed checks

From `runner`:

```text
/Users/me/.local/share/mise/installs/go/1.27.1/bin/go test ./internal/host -run '^TestResultRead' -count=1 -v
/Users/me/.local/share/mise/installs/go/1.27.1/bin/go test ./internal/host ./internal/daemon -run '^TestResultRead' -count=1 -v
/Users/me/.local/share/mise/installs/go/1.27.1/bin/go test ./internal/control ./internal/daemon -run '^TestResultRead' -count=1 -v
/Users/me/.local/share/mise/installs/go/1.27.1/bin/go test ./internal/wire -run '^TestResultRead' -count=1 -v
/Users/me/.local/share/mise/installs/go/1.27.1/bin/go test ./internal/host ./internal/daemon ./internal/control ./internal/wire -run '^TestResultRead' -count=1 -v
```

The final listed intermediate four-package run passed all 19 then-existing top-level tests and 43 subtests. Host package 9.581 s; daemon 0.691 s; control 0.590 s; wire 0.563 s. One additional real external-filter/replace-object test was added afterward, so that run alone does not validate the final test input. Final race evidence and input hashes follow below when completed.

## Behavioral scope

- Exact service-export object identity independent of later mutable worktree/HEAD; original fixed base instead of the private completion immediate parent; export ref/worktree preservation.
- Leading/trailing whitespace, terminal newlines, Unicode and empty file; missing/deleted file and base inspection; binary NUL/invalid UTF-8; measured oversized and exact 64 KiB content.
- Literal spaces, colons, tabs, newlines, dash prefixes and Git pathspec syntax; invalid/traversal paths and actual invalid UTF-8 Git index names fail explicitly.
- Symlink target blob is shown without following external target; gitlink metadata is shown without fetch/recursive traversal; executable mode and type changes remain exact.
- 130 real changes reach all three pages (64/64/2), with immutable replay; byte-limited pages for 64 names each containing 4,050 tabs reach every entry without exceeding 512 KiB. Cursor binds the full digest and numeric position, not a long path.
- Wrong cursor/digest/tree/base and altered exact result ref reject content; 8,193 records and a separate actual raw diff beyond 8 MiB return whole-scan limit without falsely complete pages; output overflow kills/waits sufficiently for immediate subsequent reads, oversized diff contains no partial patch; cancellation returns timeout.
- SQLite original operation/start/effect chain remains unchanged and authorizes a released historical completion. Twenty crossed identity fields and eight missing/corrupt provenance cases reject. Already-finalized settlement retains original completion authority, never settlement export substitution.
- A full four-slot read lane refuses a fifth synchronously; admitted identity failure settles independently of the held mutation mutex, returns its slot and does not invoke the mutating supervisor or alter the effect journal.
- Actual local TLS websocket handshake advertises capability, carries exact correlated result request/response and incarnation, routes promptly, and cancels its read context upon disconnect.
- Shared Go wire validation rejects missing/irrelevant/null fields, malformed paths/Unicode, incorrect status/object mode shape and raw UTF-8/fully encoded byte overflow.

## Final focused race run

```json
{
  "command": "/Users/me/.local/share/mise/installs/go/1.27.1/bin/go test -race ./internal/host ./internal/daemon ./internal/control ./internal/wire -run ^TestResultRead -count=1 -json",
  "exit_code": 0,
  "elapsed_seconds": 15.035,
  "top_level_passes": 20,
  "subtest_passes": 43,
  "failed": [],
  "packages": [
    [
      "monos.local/runner/internal/control",
      1.983
    ],
    [
      "monos.local/runner/internal/wire",
      2.09
    ],
    [
      "monos.local/runner/internal/daemon",
      2.183
    ],
    [
      "monos.local/runner/internal/host",
      13.439
    ]
  ],
  "input_count": 102,
  "input_manifest_sha256": "23027eedaad77c4dff62c38239d6b9468aa7b1d7d5e60a09c741ebe3836de01e",
  "unchanged_inputs": true,
  "private_log": "/var/folders/25/wn233x_93rv9z2jjm9xzfm_00000gn/T/monos-local-review-go-focused-dk0h6e9s.jsonl",
  "log_sha256": "bcdc51db680d062248df99e58be01104661e6bd466f1d089bac88204638332bb"
}
```

Input aggregate is SHA256 of sorted repository-relative path, NUL, per-file SHA256 and newline for every Runner Go source/go.mod/go.sum plus every generated protocol Go directory file. Inputs were hashed immediately before and after the run.

| Input | SHA256 |
| --- | --- |
| `packages/protocol/generated/go/contracts.json` | `415f9bd2f98b08ce4cbf9adfd1ab7876b9537e4b16462af7aaab8a353d1bb03a` |
| `packages/protocol/generated/go/go.mod` | `2d8da4db743ff11541b4ee0e40e477f2c184404446ba22a7ed265de9b3d602d2` |
| `packages/protocol/generated/go/schema.go` | `8e74d5a0b2b3fbcbafbdfd8dc66575110707bc45b4992a48fee07fc515aaa572` |
| `packages/protocol/generated/go/types.go` | `da7d0ed5bb0a772452137dd451a604f9ed259fb0047b62f976b2ca5b7956c22c` |
| `packages/protocol/generated/go/workspace_json.go` | `eaaf048f6e7ce36be22d51a786e10013c6b97659a8f5f846e6be0d53a12589de` |
| `runner/internal/control/client.go` | `d9643e1653a9c253a3eb8ae04458b24599f61fb4291346faea0db867a77d4681` |
| `runner/internal/control/result_read_test.go` | `eb303e0aaf997d35a2cd3daea4cb4d303c5b882e5b800854efad049f391e5f4b` |
| `runner/internal/daemon/daemon.go` | `61c7d06c988219fce0a3f098d3838736c452f3d8c934408cd979d35e21056de0` |
| `runner/internal/daemon/result_read.go` | `72397e0bbb993aa4f8e8d6d4f00988a31bfcfb71a58867e7e7206e9809501475` |
| `runner/internal/daemon/result_read_test.go` | `d6b4c0ac7af6960596868f6f81808eee43273cb1e02788f1b5a43248e35bf864` |
| `runner/internal/host/result_read.go` | `dd6793feb288ccc57521759d8fcab0e8406fa62a8df2f7a253265a47266b5b35` |
| `runner/internal/host/result_read_test.go` | `03ba03247c86d4bee376cc2160ebcd643f28a3c1a54dd9bd222d38d2b65d505d` |
| `runner/internal/wire/result_read_test.go` | `1c8453476206efc6e08d363ab45a918c7ec7da494dc95855c48b45074e224056` |
| `runner/internal/wire/wire.go` | `f5c98aa6e4b3ea48ce05c83f27a4a376d05ec7750826c36861938fa6cbf0dbbf` |

Tool versions:

```text
go version go1.27.1 darwin/arm64
git version 2.54.0 (Apple Git-157)
```

Full Go race/vet, root lint/types/protocol/build, PostgreSQL backend and browser integration remain owned by the main/product agents. No repeat of unrelated suites performed here. Final focused evidence becomes stale if any relevant hashed input changes.
