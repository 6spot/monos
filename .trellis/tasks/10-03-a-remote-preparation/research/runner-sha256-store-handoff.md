# Runner SHA-256 separate-store review fix

Active task: `10-03-a-remote-preparation`. Narrow follow-up to independent review P2; ownership only `publication_store.go` and the existing `TestPublicationSHA256ObjectFormatCASReplay` case in `publication_candidate_test.go`. Preserved all other writer edits. No shared protocol, target-parent, installed host/provider, lifecycle or commit changes.

## Correction

New public stores now use the actual verified original export's storage object format from bounded `git rev-parse --show-object-format=storage`; only exact sha1/sha256 outputs are accepted. Controlled `git init --bare --object-format=<format>` preserves that format. Existing stores are checked for matching format before object pack import; a mismatch is refused without converting the store or rewriting immutable identity. Pack selection remains exact result tree plus verified public parent graphs, excluding private source commit/ancestry. Original source exports and refs stay unchanged.

The existing SHA-256 test now crosses the actual separate service-store boundary. It checks matching SHA-256 store format, private source commit absence, 64-character candidate/CAS, exact immutable replay after reopening the store, unchanged original source refs, and rejection of a genuinely SHA-1 preexisting store without changing its format. No extra format matrix was added. Optional target-parent transport remains deferred, as explicitly directed by main.

## Exact current inputs

[Current 138-input manifest](evidence/runner-sha256-store-final-inputs.json), SHA256 `0c6f4f1a09def850feee281c00edda7a51d507ce6667c16b1c2a66af9a35af43`, differs from [prior full-lane manifest](evidence/runner-full-lane-final-inputs.json) in exactly these two files; all other 136 inputs are unchanged:

| File | Before SHA256 | Current SHA256 |
| --- | --- | --- |
| `runner/internal/host/publication_candidate_test.go` | `a2e8a64633d759fd4b9481d286a88b4a184510b585f35c01b813ed3145a310c1` | `20182eb61ea58968453187c9db11135d8e6f22b1784a243641ae02ecad5be473` |
| `runner/internal/host/publication_store.go` | `8de30bc185976b9de33aa75dd359eb0535de914dce79dbb1d283d37787c6ce29` | `139c8ea4d0aa012e7ac475942db84b7c908ba5fe610a2ea2b3712e58f8110205` |

[Gate input record](evidence/runner-sha256-store-gate-inputs.json) binds these two hashes. Neither file changed during affected checks. Prior whole-module Darwin gates, permission delta gates and root's already-running full-lane Linuxv1 job retain their original input scope; none is relabeled as proof of this fix.

## Actual command evidence

Pinned Go `/Users/me/.local/share/mise/installs/go/1.27.1/bin/go`; cwd `runner/`, Darwin arm64. Logs are actual captured subprocess stdout/stderr; this prose summarizes them.

| Check | Command/scope | Actual result |
| --- | --- | --- |
| Reproduce before fix | `go test ./internal/host -run '^TestPublicationSHA256ObjectFormatCASReplay$' -count=1`, changed test against original store | FAIL exit1, separate-store SHA256 import failed with `publication object unavailable`; [stdout](evidence/runner-sha256-store-regression.stdout.log), [stderr](evidence/runner-sha256-store-regression.stderr.log), [invocation](evidence/runner-sha256-store-regression.command.json) |
| Focused correction | Same command after store fix | PASS host1.239s; [stdout](evidence/runner-sha256-store-fix.stdout.log), [stderr](evidence/runner-sha256-store-fix.stderr.log), [invocation](evidence/runner-sha256-store-fix.command.json) |
| Affected physical host cases | `go test ./internal/host -run '^(TestPublicationSHA256ObjectFormatCASReplay\|TestRemotePreparation(DurablePush\|UnknownResolution\|Revert\|FreshScan\|WorkflowGrant\|ImmutableScan\|RetainedProof))' -count=1` | PASS host18.982s; [stdout](evidence/runner-sha256-store-affected-test.stdout.log), [stderr](evidence/runner-sha256-store-affected-test.stderr.log), [exact invocation](evidence/runner-sha256-store-affected-test.command.json) |
| Race on same affected cases | Same selector with `go test -race` | PASS host22.091s; [stdout](evidence/runner-sha256-store-affected-race.stdout.log), [stderr](evidence/runner-sha256-store-affected-race.stderr.log), [exact invocation](evidence/runner-sha256-store-affected-race.command.json) |
| Affected host static check | `go vet ./internal/host` | PASS exit0; [stdout](evidence/runner-sha256-store-affected-vet.stdout.log), [stderr](evidence/runner-sha256-store-affected-vet.stderr.log), [invocation](evidence/runner-sha256-store-affected-vet.command.json) |

Table regexp escapes preserve Markdown columns only; invocation JSON contains actual unescaped command arguments. Selected existing remote cases cover real SHA-1 public-store initialization/reuse plus effect/ACK replay, published graph correction/mapping/revert, scan/permission context and store-tamper admission. Path-scoped `git diff --check` passed. No full unchanged module rerun, new process matrix or provider effect was performed.

## Native follow-up boundary

Root owns rebuilding final source and the affected Linux/native scope. The existing `TestPublicationSHA256ObjectFormatCASReplay` is the exact runnable selector for this regression; all filesystem inputs are fresh temporary synthetic Git repositories, no sudo/installed state/network/service operations. Root's full native fixture and GitHub kernel bridge APIs are unchanged. Prior primitive Linux and pre-fix full-lane Linux evidence remain historical, not invalidated for unrelated unchanged physical process claims. Main can refresh only the affected build/store-native boundary.

Source is frozen at the above hashes, ready for independent review. [Original full-lane handoff](runner-full-lane-handoff.md) remains unchanged with its truthful original source/evidence boundaries. No production target transport or live App issuance claim is made.
