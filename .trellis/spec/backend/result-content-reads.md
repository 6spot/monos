# Exact local result content reads

## 1. Scope / Trigger

Owner inspection of an original successful Git completion through its owning
Runner. This read-only cross-layer contract adds no command receipt, Agent run,
Runtime execution capacity, workspace repair or provider effect. Repository-free
results retain `git:null` and do not offer Git inspection. Publication candidates
and delivery use separate contracts.

Sources: `task-result-reads.ts`, `result-content-reads.ts`, `result-read-broker.ts`,
Runner `internal/{daemon,host}/result_read.go`, protocol `contracts.json` and Web
`result-inspector.tsx`. See [Owner reads](owner-reads.md),
[Node execution](node-execution.md) and [workspace](../runner/workspace-guidelines.md).

## 2. Signatures

```text
GET /v1/owner/tasks/:task_id/results/:operation_id/changes?identity_digest=...&cursor=...
GET /v1/owner/tasks/:task_id/results/:operation_id/file?identity_digest=...&path=...&side=result|base
GET /v1/owner/tasks/:task_id/results/:operation_id/diff?identity_digest=...&path=...
```

`identity_digest` is required in every query; `path` and `side` are required as
shown, and only the changes query accepts an optional cursor. Unknown parameters
fail validation. Use generated query schemas and OpenAPI required flags.
The Owner session cookie authenticates; Web also sends its `X-Monos-Session` UUID.
Responses use `Cache-Control: no-store` and `X-Content-Type-Options: nosniff`.

Ready optionally advertises `result_read_modes:["git_objects_v1"]`. Dedicated v1
Frames `result_read` and `result_read_result` bind incarnation, correlation UUID
and the complete `ResultReadRequest`; they are not effect/command envelopes.

## 3. Contracts

### Immutable identity and authorization

`TaskLocalResult.git.identity_digest` is SHA-256 of canonical JSON for the full
`ResultReadIdentity`. Backend resolves the selected original operation directly,
including operations outside the first 32-item history page. It joins the exact
canonical completion manifest, successful operation, Node completion and Attempt.
The identity retains original attribution rather than current revisions:

| Group | Required fields |
| --- | --- |
| Semantic | `task_id`, `operation_id`, `attempt_id`, `dispatch_id`, `node_id`, `node_activation`, `specification_id`, `plan_id`, `manifest_digest`, `operation_identity_digest` |
| Physical | `workspace_id`, `resource_id`, `runner_id`, `storage_id`, `generation`, `lease_id`, `repository_identity`, `base_commit`, `git_commit`, `git_tree` |

Browser supplies the advertised digest and read selection, never a filesystem
path, arbitrary OID or executable command. The backend constructs the identity.
Before I/O authenticate the session and resolve the result in short DB reads;
after I/O authenticate again, re-resolve the identical immutable identity, and
derive fresh `current` applicability. No DB lock/transaction spans Runner I/O.
Historical content remains inspectable; current applicability is a separate fact.
Cancellation/revision/replacement cannot relabel an old result current.

Runner checks retained SQLite operation, Start and successful raw effect. Validate
Start with `wire.ScopeID` and `host.ValidateEffectScope`, including consistent
dispatch kind/Task/Node/activation/source. Verify canonical operation and workspace
digests, effect identity and exact physical facts. Do not require the historical
Attempt, boot, lease or generation to be live now. Do not expect raw effects to
contain backend-added completion attribution.

Validate both initialized storage records, trusted private export ancestors,
ownership/modes, retained `refs/monos/result` bound to the original operation's
directory/identity, exact commit/tree and fixed base. Read
only the existing service-private `Root/results/<original operation_id>` export,
including settlement that finalized that original operation. Missing evidence
does not authorize clone/fetch/re-export, cache substitution or mutable-worktree
reads. Normal completion preserves append-only ancestry; exporting the exact
result also retains its reachable fixed base.

### Content, limits and response

`ResultReadRequest` has `identity`, `identity_digest`, `mode` (`changes`, `file`,
`diff`) and only that mode's selection fields. `ResultReadResponse` has required
`schema_version:1`, complete `request` echo and `status`; content fields are
strictly mode/status specific. Runner must omit `current`; backend adds fresh
boolean `current`, which Web requires. Correlation/socket/incarnation and exact
request echo must all match before resolving an outstanding read.

| Bound | Contract |
| --- | --- |
| Reply | 512 KiB encoded JSON, including nested frame validation |
| Text | 64 KiB raw UTF-8 file/diff bytes, not JavaScript character count |
| Path | 4096 UTF-8 bytes; valid Unicode, no lone surrogate |
| Changes | Up to 64 per page; complete scan capped at 8 MiB raw output / 8192 records |
| Concurrent reads | Broker 8 global / 4 per Runner; daemon separate 4-slot read semaphore |
| Time | 10-second broker round trip after initial authorization/resolution; Runner physical reader also has a 10-second budget |

These time limits are not an end-to-end HTTP SLA. Initial/final DB authorization
retains existing Owner-read transaction behavior. Delayed final authorization can
never permit unchecked private bytes to be returned.

Changes compare original fixed base with exact integrated result, use A/D/M/T and
represent renames as deletion/addition. A requires only `new`, D only `old`, M/T
both. Objects have OID/mode and byte size; gitlinks (`160000`) omit size. Complete
scan overflow returns `scan_limit`, never a silently partial list. Cursor is
canonical base64url JSON `{version:1,identity:<digest>,after:<safe integer>}`.
It binds an immutable position, not authority; replay is deterministic.

Git commands use literal argument/path handling, no shell, external diff or
textconv. Reject traversal, absolute/drive paths, backslash, NUL, empty segments
and dot segments; preserve valid spaces, tabs, newlines, dashes, colons and Unicode.
Shared path schemas must distinguish actual end-of-string from ECMAScript `$`,
which also matches before a final line terminator. `a/\n` and `..\n` are valid
literal names; `a/` and `a/../b` are invalid. Add shared TS/Go fixtures for both
outcomes instead of assuming the regex engines have identical anchor behavior.
Read a symlink's target blob as literal text without following it. Gitlinks expose
metadata without fetching. Preserve empty files and exact UTF-8 whitespace; render
text as React text in `pre/code`, never HTML. Diff is fixed base to result.

Web opens inspection on demand, keeps content in memory scoped to session/result,
and cancels/fences late responses on close, selection change and logout. Fresh
`current:false` updates the label even if ordinary metadata polling is delayed.
Desktop/mobile layouts contain code overflow and retain usable 44px mobile controls.

## 4. Validation & Error Matrix

| Condition | Outcome |
| --- | --- |
| Invalid query/path/Unicode/noncanonical cursor | `invalid_input`; reject before WSS admission |
| Unknown Task/result or cross-result cursor | `denied_scope` |
| Session mismatch/revoked/expired, including after read | `unauthorized`; suppress bytes |
| Advertised digest or post-read identity changed | `version_conflict`; refresh metadata |
| No connected owning instance/incarnation, closed socket or send failure | `offline`; release pending timer/slot |
| Runner lacks capability | `unsupported` |
| Concurrency/time limit | `busy` / `timeout` |
| Retained identity or initialized disk/ref/commit/tree mismatch | `identity_mismatch` or `unavailable`, with no substitution |
| Complete scan cannot fit or filename cannot be represented | `scan_limit` / `unsupported_path` |
| Missing selected side, binary, excessive bytes | `absent` / `binary` / `oversized` |

Success is `available`. The generated schema also retains `no_git` as an explicit
outcome. Do not attach text/objects/change pages to failure statuses where schemas
forbid them. Unrecognized/malformed Runner responses cannot become accepted facts.
After async Ready DB work, only an OPEN socket can register; obsolete incarnations
cannot evict a newer connection. Disconnect clears that socket's pending reads.

## 5. Good / Base / Bad Cases

Good: a completion older than 32 results still reads its original export; a
concurrent requirement change returns identical bytes with fresh `current:false`.
Base: a zero-byte file is available with empty text; a deleted file is absent on
result side and readable on base side. A symlink displays its target literally.
Bad: serving the latest worktree file because an old export is missing, counting
64K Unicode characters as 64 KiB, or treating Runner's `current` as authority.

## 6. Tests Required

- Shared TS/Go fixtures: strict mode/status/object facts, Unicode, encoded/raw byte
  bounds and generated required-query flags.
- Broker/WSS: correlation/echo/incarnation, delayed closed Ready, throw/false send,
  capability, busy, timeout, disconnect and final session revocation.
- Actual Git/SQLite: crossed/missing retained fields and corrupt Starts; actual
  storage/ref lineage, no mutable substitute, fixed base, 64/64/2 page replay,
  literal hostile-looking paths, empty/deletion/binary/oversized/symlink/gitlink,
  bounded stdout and cancellation. Writer must not bypass bounds via `ReadFrom`.
- Real PostgreSQL/WSS: genuine command-admitted completion chain beyond page one,
  carried/historical applicability, read racing cancellation and unchanged formal
  state/operation/lease/receipt/outbox facts.
  Result fixture setup after acquiring a base fixture must close it on failure
  before rethrowing; assert disappearance of that exact owned namespace, not a
  global namespace count that can race other tests. Privately load the fixture's
  `DATABASE_URL` as well as the test gate env keys; never drop schemas by prefix.
- Built SPA: session/digest binding, modes/pagination/retry, safe literal rendering,
  current-to-historical and late-response fences. Inspect source/build-bound
  desktop/mobile screenshots. Synthetic peers do not prove installed Linux effects.

## 7. Wrong vs Correct

```text
Wrong: Owner path -> backend filesystem -> current worktree file -> browser HTML
Correct: selected original completion + digest -> authenticated owning Runner
         -> retained operation/Start/effect + initialized immutable export checks
         -> bounded exact Git object -> post-read Owner/identity validation
         -> fresh applicability + literal text rendering
```
