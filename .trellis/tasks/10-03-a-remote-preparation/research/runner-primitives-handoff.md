# Runner remote primitives handoff

## Scope and current boundary

This handoff covers the independent handwritten Runner primitives approved before the remote contract release. It does not claim an integrated remote lane, production App credential issuance, installed service behavior, Linux execution, or durable restart reconciliation. The shared contract remains subject to the main agent's release.

The item lock and immutable private operation files retain uncertain started intents. The fixed system pre-push hook checks the single advertised ref, local ref/head, expected old OID, and destination. Ordinary nonforce Git push provides the receiver CAS after advertisement. The process wrapper installs and validates that hook immediately before starting fixed `/usr/bin/git`, limits stdout to 16 KiB, discards stderr, applies a 120-second deadline, kills the process group on cancellation, and uses a one-second WaitDelay plus independently bounded three-second group cleanup. Only an actual `kill(-group, 0) == ESRCH` observation permits `WorkerAbsent=true` after a start. Parent exit alone does not permit release.

The process tests deliberately let a parent exit while its descendant and inherited pipes remain alive. Both parent-exit and connection-cancellation cases observe the live descendant first, require its group to disappear, retain the started intent, and forbid a fabricated terminal result. Other tests cover output overflow, normal completion, hook tampering, advertised unexpected ancestors, later receiver races, exact creation/FF update, and non-FF refusal.

## Owned input hashes

Paths are relative to the repository root; SHA256 values are exact current bytes.

| File | SHA256 |
| --- | --- |
| `runner/internal/host/publication_remote_primitives.go` | `3037cd722ab5b9b1a04dcf20ab929a009313506d69182c2c327d603301fd9623` |
| `runner/internal/host/publication_remote_primitives_test.go` | `693c14d17a1f82190b7a587745369cd0c3224a1c2f319cc4d7ecffaaf3f33228` |
| `runner/internal/host/publication_remote_process.go` | `df50e0a227527bd3e91103b51a00935e400898028c7a93137fb5d1793f759a74` |
| `runner/internal/host/publication_remote_process_test.go` | `6cd0741556588eed84f969b421160f4537b066e99ef6952abdd2b080b18baef9` |

A subsequent main-agent review identified that host `Identity(pid)` does not populate UID. The corrected helper reads at most 64 KiB from `/proc/<pid>/status`, requires exactly one four-value `Uid:` row with consistent real/effective/saved/filesystem UID, and binds that observation between two unchanged boot/birth identity reads. It compares the actual child UID with the service effective UID. Parser bounds/rejection tests run on Darwin; `TestRemotePreparationProcessLinuxUIDBinding` executes an actual live child check on Linux and explicitly skips on Darwin. The lingering parent fixture now waits until identity is bound before exiting, avoiding a test-only attribution race. The native retained fixture passes only when its guarded push succeeds with actual Linux identity binding.

The earlier static preflight covered the unchanged primitives source hash above and test hash `f7f045836a0b6c643615b4058e3f9a0c5960f9e156a76488301cabe11d649d2b`. The test delta integrates the bounded process wrapper and retained worker/start records into the native fixture. Both process files are new review inputs.

## Isolated verification inputs

Current draft generated types change the existing candidate consumer's original-parent fields to pointers and rename result/rule types. The real workspace focused compile failed before tests ran. Its original diagnostic bytes are retained in [current-draft-compile.stderr.log](evidence/current-draft-compile.stderr.log), with [command and exit status](evidence/current-draft-compile.command.json) and [stdout](evidence/current-draft-compile.stdout.log). No unfrozen consumer or shared schema was adapted to make this check pass.

The main agent approved an isolated source copy of accepted commit `2095660a1fe546412430b5d630d4837dc550155b`, containing tracked `runner`, generated Go protocol, and protocol fixtures from that commit, overlaid with only the four files listed above. Therefore the following passes establish the primitives against the accepted protocol. They do not establish current combined protocol integration.

The current [source manifest](evidence/isolated-primitives-uid-bound.source-manifest.json) records exactly 123 source inputs. The compact [owned source archive](evidence/isolated-primitives-uid-bound-owned-source.zip) contains the exact four-file delta; its hashes are recorded in the relocation proof below.

The retained earlier 124-input confirmed manifest included one additional draft `runner/internal/wire/remote_preparation_test.go`. It was not compiled by the host-only test/race/vet commands (imported package test files are excluded), but that older copy did not strictly match the approved four-file overlay. The refreshed 123-input copy excludes it. Earlier confirmed artifacts and pre-UID-fix logs remain historical evidence and do not establish current Linux readiness.

After every test process completed, the refreshed full private source copy was moved outside the repository. The [current relocation record](evidence/isolated-primitives-uid-bound-relocation.json) records its exact original and relocated paths, matching before/after full tree hashes, source manifest hash, and owned archive hash. No checks ran under the relocated `/private/tmp` lineage. The [earlier relocation record](evidence/isolated-primitives-confirmed-relocation.json) and its source archive are also preserved. Command JSON and native proof paths retain their actual historical prefixes; the matching relocation record supplies the mapping.

## Actual scoped gates

Platform: Darwin arm64. Go executable: `/Users/me/.local/share/mise/installs/go/1.27.1/bin/go`. All commands ran in the isolated copy's `runner` directory. Raw stdout/stderr files below are original subprocess bytes; command JSON captures exact argv, cwd, status, and scope.

| Command (using the Go executable above) | Result | Evidence |
| --- | --- | --- |
| `go test ./internal/host -run '^TestRemotePreparation' -count=1` | PASS, exit 0; package 3.930s | [command](evidence/isolated-primitives-uid-bound-test.command.json), [stdout](evidence/isolated-primitives-uid-bound-test.stdout.log), [stderr](evidence/isolated-primitives-uid-bound-test.stderr.log) |
| `go test -race ./internal/host -run '^TestRemotePreparation' -count=1` | PASS, exit 0; package 6.765s | [command](evidence/isolated-primitives-uid-bound-race.command.json), [stdout](evidence/isolated-primitives-uid-bound-race.stdout.log), [stderr](evidence/isolated-primitives-uid-bound-race.stderr.log) |
| `go vet ./internal/host` | PASS, exit 0; empty stdout/stderr | [command](evidence/isolated-primitives-uid-bound-vet.command.json), [stdout](evidence/isolated-primitives-uid-bound-vet.stdout.log), [stderr](evidence/isolated-primitives-uid-bound-vet.stderr.log) |
| `go test ./internal/host -run '^TestRemotePreparationNativeRetainedPermissionFixture$' -count=1` with the explicitly recorded evidence directory | PASS, exit 0; package 1.407s | [command/environment](evidence/isolated-primitives-uid-bound-permissions.command.json), [stdout](evidence/isolated-primitives-uid-bound-permissions.stdout.log), [stderr](evidence/isolated-primitives-uid-bound-permissions.stderr.log), [safe proof](evidence/isolated-primitives-uid-bound-permissions.proof.json) |

The opt-in fixture normally skips. All other remote primitive tests run by default, use fresh synthetic repositories and private temp fixtures, and need no sudo, installed service, provider credential, network remote, or model call. The isolated host vet covers accepted host sources plus the owned delta. Whole integrated Go tests/race/vet remain required after the main agent releases the shared contract and the lane is implemented.

## Failed trials retained

An initial actual Git receiver-race fixture tried to update the bare receiver ref directly from the synthetic pre-receive hook while Git's quarantine environment was active. Git refused this ref write. The fixture was corrected to unset `GIT_QUARANTINE_PATH`, `GIT_OBJECT_DIRECTORY`, and `GIT_ALTERNATE_OBJECT_DIRECTORIES` before invoking the controlled concurrent writer. This makes the test exercise a real receiver CAS race; the production pre-push hook does not perform such a write. This paragraph reconstructs observed tool output; no original-byte log was saved for that earlier trial.

A retained later race trial on process-source hash `ded766ec19b61e30b3c7c0f0cb1baf8df6bb62a3adc1754fbb5833820debdc07` failed because the wrapper conservatively withheld physical absence after parent exit: `WorkerAbsent:false` and `publication remote worker ownership unresolved`. See its original [stdout](evidence/isolated-primitives-final-race.stdout.log), [stderr](evidence/isolated-primitives-final-race.stderr.log), and [command](evidence/isolated-primitives-final-race.command.json). It did not falsely release ownership. The bounded cleanup was changed to keep polling through an EPERM probe until actual ESRCH or timeout; EPERM itself never proves absence. The failed output does not record the exact syscall errno, so this report does not attribute that failure to a measured errno. The prior cleanup fix passed a focused [race recheck](evidence/isolated-process-race-recheck.stdout.log) and the refreshed focused race gate above also passed on the current UID-bound input.

Earlier original two-file tests (test 2.349s, race 2.908s, host vet, local retained fixture 1.527s) were observed tool-history results without retained raw log files. They are reconstructed historical summaries, superseded by the scoped gates above for changed inputs.

## Native permission fixture contract

Test name: `TestRemotePreparationNativeRetainedPermissionFixture`.

Opt-in environment: `MONOS_REMOTE_PREPARATION_EVIDENCE_DIR`, pointing to an initially empty, absolute, service-owned 0700 directory beneath safe ancestors. The fixture uses the actual candidate construction/journal/pages lower factory with a synthetic public baseline, retains original result exports unchanged, and copies only the candidate graph into a separate private public object store. It then performs a guarded push to a fresh local synthetic bare remote. It is a candidate/remote-kernel fixture, not a production Root or live App issuance proof.

`proof.json` is a regular 0600 file with this safe shape:

```json
{
  "schema_version": 1,
  "fixture_scope": "actual_candidate_and_remote_primitives_synthetic_baseline",
  "service_uid": 501,
  "operation_id": "push",
  "item_id": "item",
  "request_digest": "<safe digest>",
  "result_digest": "<safe digest>",
  "candidate_manifest_digest": "<safe digest>",
  "head": "<OID>",
  "tree": "<OID>",
  "remote_ref": "refs/heads/delivery",
  "observed_head": "<same OID>",
  "paths": [{"kind": "intent", "path": "<absolute path>", "mode": "0600"}]
}
```

UID above is illustrative of the actual local run; Linux must verify its own service UID. The 16 path kinds are `root`, `journal`, `item`, `operation`, `intent`, `started`, `worker`, `result`, `lock`, `hooks`, `pre_push`, `public_object_store`, `synthetic_remote`, `candidate_intent`, `candidate_manifest`, and `scan_pages`. Directories are 0700; listed regular files are 0600; the fixed executable hook is 0700. The local caller independently checked ownership of these 16 paths and exact remote head equality. Root's Linux gate must independently check ownership, modes, non-symlink paths, and execution-account read/write denials.

`worker.json` currently serializes Go fields `PID`, `Group`, `UID`, `Birth`, `BootID`. Linux identity collection supplies boot/birth from the existing process identity implementation. Darwin's same-account test leaves `Birth` and `BootID` blank and is not durable Linux identity evidence. The fixture retains `started.json` before entry and its worker record from the onStart callback. Its result states `worker_absent:true` only after the actual live group check. No credentials or raw matching scan content are emitted.

## Follow-ups at shared contract release

The item flock is not a durable unresolved-intent successor fence. The full lane must preserve the started effect and exact request identity, require durable worker identity retention, and reconcile acknowledgements without constructing a new effect. On Runner death a parent-only flock may release while Git/helpers survive. Missing spawn-to-persistence evidence, missing Linux boot/birth identity, or inability to prove group absence must keep the operation unresolved. A remote head lookup or missing in-memory worker is not physical absence. Recovery must verify identity before signaling a reused PID/group.

The live invocation primitive currently proves group cleanup; it does not implement restart identity reconciliation or claim whole-system descendant confinement. Full-lane crash/reconnect tests and Linux native gates belong to the later integrated boundary. No current protocol, backend, generated code, Web, Runtime slot policy, provider, or host installation was changed by this handoff.
