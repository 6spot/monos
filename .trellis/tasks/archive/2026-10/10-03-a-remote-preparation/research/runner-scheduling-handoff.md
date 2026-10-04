# Runner typed provider scheduling wait handoff

Active task: `10-03-a-remote-preparation`. Narrow P2 follow-up; owned only existing handwritten control/host `publication_remote.go` and their existing tests. Preserved root's test-only native bridge timestamp fix and all other writers. No schema, wire, daemon, store, target-parent, provider/host effect, commit or lifecycle edits.

## Exact behavior

Backend confirms scheduling admission precedes push claim and responds uniformly for permission/bootstrap, observe and push access with HTTP429, typed `CommandResult.status=error`, `error.code=rate_limited`, and positive integer `Retry-After` ceil seconds, no token/claim/op mutation. Runner validates the bounded/no-store response using that status/code/header; message prose never classifies recovery.

Control retries the exact original operation/request/incarnation/attempt after the header's wait. Each HTTP exchange remains bounded10s; the total method is bounded120s or the caller's shorter deadline. Waiting uses a context-select timer. If the exact wait exceeds the remaining budget, cancellation ends the timer, or a typed wait header cannot safely be consumed, control returns a distinct scheduling error and a zero grant. It checks current incarnation before each retry. It does not rewrite the request or put transient credentials into a durable record.

Host propagates the typed wait from pre-effect observe, write access and started-operation reobserve. Pre-effect waiting retains only the immutable pending intent, not started/worker/absence/result markers or a terminal blocked/access_denied cache; later replay of that same operation can acquire a grant and push once. A started effect remains started and observe-only while waiting; resolving scheduling never repeats its physical push. Genuine denial still records the existing blocked/access_denied outcome. Connection/context cancellation remains unfinished rather than terminal.

## Source freeze

[Four-file before/after manifest](evidence/runner-scheduling-final-inputs.json), SHA256 `7eba8893262b572f8e886a20aba4cc7181191187b687d60359dfdba4a8ee8c18`. [Gate hashes](evidence/runner-scheduling-gate-inputs.json) match current owned source and did not change during checks.

| Owned file | Current SHA256 |
| --- | --- |
| `runner/internal/control/publication_remote.go` | `54736cb2f40712317404feeb7b780cb7b8ad18bc99151c8dbacd72f0f0167e32` |
| `runner/internal/control/publication_remote_test.go` | `afa5d46efd81fa9b8a4262ad8bbc5aa674a510fba335cf26165e7cddc1ae4001` |
| `runner/internal/host/publication_remote.go` | `8bf3abb4190c746c8fca717cabfb4adfcae8efe5f63616aae6cc0362abdaff41` |
| `runner/internal/host/publication_remote_test.go` | `d6d034a20e5cb2170f7df749564ae161bf0cc5ab3fd0353a22e743dd5cb3b93a` |

## Actual focused evidence

Pinned `/Users/me/.local/share/mise/installs/go/1.27.1/bin/go`, cwd `runner/`, Darwin arm64. Actual commands/results retained, not reconstructed logs:

- `go test ./internal/control ./internal/host -run '^(TestRemotePreparationAccessHTTPBoundScopeAndIncarnation|TestRemotePreparationDurablePushEffectLossAndACKReplay|TestRemotePreparationFreshScanMetadataAndCancellationFence)$' -count=1`: PASS control1.798s, host7.387s. [stdout](evidence/runner-scheduling-affected-test.stdout.log), [stderr](evidence/runner-scheduling-affected-test.stderr.log), [invocation](evidence/runner-scheduling-affected-test.command.json).
- `go vet ./internal/control ./internal/host`: PASS exit0. [stdout](evidence/runner-scheduling-affected-vet.stdout.log), [stderr](evidence/runner-scheduling-affected-vet.stderr.log), [invocation](evidence/runner-scheduling-affected-vet.command.json).
- File-only trailing whitespace and scoped `git diff --check` passed.

Existing TLS HTTP test now exercises typed429→actual1-second wait→same request/attempt200; cooldown60 with a shorter remaining budget returns typed wait/no token; denial containing rate-limit prose is not retried. Existing physical Git host tests now exercise scheduling at observe and pre-push with no physical/terminal marker, exact retained original intent and later single push; genuine denial; and started push response-loss followed by scheduling wait and later observe-only settlement without another push. Existing context cancellation assertions remain in the affected host test. No additional broad matrix, whole module, race or native/provider run was performed; root requested current narrow Linux race/build and owns that final evidence.

## Root native selectors and limits

Exact affected selectors are the three names in the command above. Actual physical fixtures are temporary local Git only; TLS tests use a synthetic local server, no installed state, sudo, provider or service operations. Root's bridge timestamp input is outside this four-file ownership and must be included separately in root's final source snapshot.

Prior full-module/race/vet and native21-path/physical process evidence retain their original input scopes; this narrow scheduling delta invalidates only admission/retry claims and the rebuilt source identity. No other permission/store/crash matrix is requested. Backend's actual authenticated PG/WSS/HTTP scheduling wait/unchanged pending claim proof belongs to its report; these local TLS and Git cases do not replace that database proof. Main owns final integration. Source is frozen at these four hashes.
