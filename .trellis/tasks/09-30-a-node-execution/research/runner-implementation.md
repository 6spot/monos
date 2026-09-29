# Runner implementation: Node execution and completion recovery

Status: Runner implementation and local Go race/vet checks passed. Backend
integration and native two-account/process acceptance remain main-session owned.
No services, deployment files, remote host state, or commits were changed here.

## Implemented contracts

- Canonical `node_execution_source` binds Task/Node/activation/control and frozen
  Spec/Plan/context. Local command preparation, adapter configuration, effect
  scope and reconnect recovery validate the source; legacy fixture compatibility
  remains explicit.
- Native `publish_artifact`, `read_artifact`, `block_node` and completion CLI
  commands preserve exact JSON values, including omitted versus empty Artifact
  selection. Adapter instructions require a formal completion/block outcome.
- `repository_free:true` completion requires canonical source and manifest,
  physically stops the whole Attempt tree, checks retained local reserved work,
  retains a root terminal operation, and returns absence without Git/path/workspace
  fiction. No legacy fixture Git effect or export is entered.
- Finite reconnect recovery includes canonical Node Stop/repository-free complete,
  preserving source/reservations, immutable operation identity, local failure
  evidence, Ready ordering, queue capacity and existing single-flight keys.
  Hard failures are not automatically retried. Ordinary explicit same-ID admitted
  redelivery still retries a failed completion or settlement.
- `wire.OperationIdentity` is JCS over every immutable Operation input, excluding
  `state`, `result`, `cancelled_by_operation_id`. SQLite and root equality include
  manifest, repository-free and original-completion target fields.
- `settle_completion` accepts only an exact canonical workspace-backed original
  completion. The local helper additionally receives that immutable original
  Operation, validates its digest, and retains it if admission preceded any local
  delivery. This allows Cancel to settle an original not yet seen by the helper.
- A root-owned exact target marker fences original completion launches and is
  rechecked after the execution-account writer lock. Settlement uses the existing
  stopping coordinator path to quiesce exact lease units/cgroups/pending jobs.
- Existing successful original root results remain exact. A matching retained
  original ref or HEAD at the frozen commit reconciles original finalization;
  an intent/commit object alone does not certify integration. Conflicting ref,
  HEAD, required objects or root identity remain recovery.
- Failed unintegrated results use a separate immutable recovery intent and private
  checkpoint. Only this branch may capture readable unrelated ancestry. It uses a
  temporary index, retains actual HEAD/index/files/ignored data, hashes the old
  intent bytes without altering them, and retains original refs/objects. Normal
  Stop and finalization ancestry checks are unchanged. Later correction still
  must restore the original fixed lineage before strict completion.
- Root writes one terminal pair record before local lease release/original
  tombstone. Replay reconstructs original outcome from that record. Daemon exports
  the exact original success or recovery checkpoint before a SQLite transaction
  commits both terminal results. Only the bounded pair is sent to the backend.
  Original cancellation replay uses the settlement flight key, not an independent
  cancellation or duplicate exporter. A stale in-flight failure cannot overwrite
  either terminal result. Original redelivery does not bypass a hard settlement
  failure; explicit same-ID settlement admission remains required.

## Main changed files

- `runner/internal/wire/operation.go`, `scope.go`, `wire.go`
- `runner/internal/host/completion_{capture,settlement,free}.go`
- `runner/internal/host/{helper,helper_effect,workspace_effect,workspace_git,
  workspace_identity,effect_scope,types}.go`
- `runner/internal/daemon/{completion,daemon,recovery}.go`
- `runner/internal/journal/journal.go`
- `runner/internal/local/socket.go`, `runner/internal/adapter/opencode.go`
- Native CLI and workspace worker entries under `runner/cmd/`

## Verification

Go 1.27.1 through `mise exec go@1.27.1 -- ...` in `runner/`:

- `go test -race ./...` passed across all Runner packages.
- `go vet ./...` passed.
- Targeted host/journal/daemon suites passed during development.

New meaningful coverage includes:

- Broken ancestry with staged, unstaged, untracked and ignored bytes; unchanged
  real HEAD/index; malformed old intent preserved; exact private capture; explicit
  Agent lineage repair followed by strict completion.
- Original intent/object/ref/HEAD interruption boundaries, missing required parent
  objects, and conflicting ref/HEAD;
  validated already-finalized versus cancelled settlement pair.
- Target marker digest/scope/manifest changes and symlink rejection; unchanged
  capture after a failed replay caused by a later writer.
- SQLite second-write failure rollback, restart/replay, late-worker terminal
  conflict, changed manifest, changed nested target/lease/Attempt/checkpoint and
  exact already-successful original preservation.
- Canonical no-resource completion after recoverable failure and reconnect;
  source/activation/Spec/Plan/context/authorization rejection; no fake Git/path or
  missing writer absence; zero-Host terminal replay; cancelled original replays
  the whole retained pair.
- Native CLI command transport and local canonical JSON value preservation,
  including HTML escaping and omitted/empty/earlier-Artifact selection.

One prior recovery test deliberately inserted a wrong Attempt result. Journal now
rejects that invalid scope before persistence, so the test asserts the earlier
guard. One CLI test compared literal JSON serialization; it now compares canonical
JSON so standard HTML escaping cannot be mistaken for changed Artifact bytes.

## Required integration evidence and limits

Native acceptance still must prove systemd/cgroup delayed-worker exclusion, exact
two-account export, repository-free HTML Artifact bytes, correction through a
retained private workspace, and DB pair/cancellation projection. Local fakes and
Git tests do not claim those host facts. Preserve failed/export-uncertain evidence.

Recovery requires readable HEAD/tree and intact trusted materialization identity.
Storage exhaustion, missing required objects, ambiguous integrated result or lost
root ownership retain recovery rather than fabricating a checkpoint or release.
Ignored private files remain in the workspace; the checkpoint does not claim to
archive them in the exported Git result repository.
