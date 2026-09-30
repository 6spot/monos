# Specification command Runner implementation

Status: implemented and locally verified against the backend agent's generated protocol on 2026-09-30. No deployment, commit or push performed.

## Changes

- `runner/cmd/monos/main.go`: expose `prepare_specification_revision` and `apply_specification_revision` through the existing attributed journal channel. Help describes full proposal, nullable exact impact identities, source inputs, replacement, explicit confirmation receipt and the separate terminal conversation handoff.
- `runner/internal/local/socket.go`: only a canonical, non-reply-only Task Conversation source may prepare/apply. Existing dispatch/source ownership and fixed conversation version checks remain authoritative. Initial planning, Node, Todo and legacy Planner receive no new authority. Proposal routing still passes the existing exact source/input/watermark checks.
- `runner/internal/wire/wire.go`: allow only the generated prepare/apply payload members and required fields. Schema validation remains prior to immutable journal persistence.
- `runner/internal/adapter/opencode.go`: preparation creates an unattached draft; committed `specification_proposal` routing exposes it. Apply consumes an existing exact Owner receipt, admits independent backend settlement and still requires `commit_task_turn`. Prompt forbids inferred authorization, invented receipts, silent Node graph changes and waiting for settlement. Reply-only sources explicitly forbid both commands.

There is no new Runner effect, lifecycle state, journal schema, resident process or service. Backend owns impact compatibility, authorization consumption, publication and currentness. No v1/v2 manifest or historical command serialization changes.

## Meaningful checks

- CLI socket fixture transports both exact payloads through the existing channel.
- Local tests cover fixed conversation version versus separate execution basis; exact proposal attachment; reply-only, initial, Node, Todo, legacy and invalid source denial.
- Wire tests reject missing/null receipt, changed payload members, fractional basis, duplicate source IDs, incomplete/nullability-invalid impact, unsupported graph/disposition, and unknown guidance authority. Generated impact round-trip retains exact nullable source/completion identities. Generated command result retains proposal/digest/obligation and backend requirement-operation reference without creating a physical operation ID.
- Journal close/reopen tests preserve full Unicode proposal, receipt, basis, source IDs and replacement identity. Altered replay conflicts; another Attempt cannot recover the request.
- Prompt tests distinguish preparation, explicit authorization, independent settlement and terminal turn outcome.

## Actual verification

Toolchain: `/Users/me/.local/share/mise/installs/go/1.27.1/bin/go` on macOS. The plain `gofmt` shim initially failed because no mise version was configured; reran with the installed explicit toolchain. One new journal fixture initially failed its private-directory requirement; fixed the fixture to create mode 0700, then reran successfully.

Final local checks all exited 0:

- `go test -race ./...` from `runner` (all packages; unchanged packages cached on final rerun after added wire tests).
- `go vet ./...` from `runner`.
- `PATH=<installed Go bin>:$PATH /bin/sh infra/runner/build.sh /tmp/monos-specification-runner-build-v1` built all four executables successfully with CGO.
- `git diff --check -- runner`.

These establish local transport/schema/journal regressions only. Root still owns Linux CGO/race/build, backend/PG and installed native proposal/Owner authorization/physical settlement acceptance. Re-run consumer compilation if backend schema generation changes names again.

## Latest generated-enum compatibility correction (2026-10-01)

The first frozen Linux v1 gate exposed new generated `OperationState` enum names after the later requirement-effect read schema was added. Its failure evidence remains retained by root; the earlier local success predates that regeneration.

Updated all 11 Runner consumer references across eight files: `internal/control/inventory_test.go`, `internal/journal/{completion_test,journal_test}.go`, and `internal/daemon/{recovery,recovery_test,daemon_test,revocation_test,node_completion_test}.go`. Generated types now name the unchanged wire values `FluffyAdmitted` (`"admitted"`) and `PurpleRecovery` (`"recovery"`). No generated file, operation wire value, journal data or recovery behavior changed.

Against those latest generated types, all local gates again exited 0: full `go test -race ./...` (all packages, including 22.594s host suite), `go vet ./...`, four CGO builds into fresh `/tmp/monos-specification-runner-build-v2`, and `git diff --check -- runner`. No old enum references remain. Runner source is stable for root's fresh frozen Linux v2 gate; local macOS results do not replace that Linux gate.
