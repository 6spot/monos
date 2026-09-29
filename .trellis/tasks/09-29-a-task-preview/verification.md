# Exact Task preview verification

## Implemented boundary

Committed Discussion messages supply exact preview content. Owner confirmation,
creation and cancellation use separate authenticated strict commands and immutable
receipts. Multiple exact Project authorizations may coexist before one unique
source outcome. Creation yields PLANNING with an immutable initial Specification
and Project/source association; it never admits execution. Browser cards recover
from canonical source mappings and link to a read-only current Task Specification.

## Checks

- Full local protocol drift, lint, TypeScript, 151 tests and production build passed.
- Final complete same-host PostgreSQL suite: 138/138 across 15 files (14.13 s).
  Task preview contributes 15 cases including actual lock contention, process
  SIGKILL around COMMIT, duplicate creation, cancel/input races, Project changes,
  rollback, immutable provenance and current/legacy Markdown compatibility.
- Full browser regression: 23/23 (1.8 minutes), including six new real persisted
  Task preview scenarios. Web API tests: 21/21. Final web typecheck/lint/build pass.
- Local Go `go test ./...` passed; shared wire tests passed again after final schema
  changes. No Runner behavior or Agent command contract changed in this leaf.
- Python harness suite: 67/67, including six exact preview acceptance regressions.
- Independent backend/protocol and harness reviews plus root frontend review passed.
  Final `git diff --check` and source-manifest matching were verified.

The first tunnel-based affected DB run exceeded the existing 5 s log-read test
bound once; the isolated rerun passed, and the final same-host full suite passed
with normal limits. No product or test-source timeout was weakened.

## Compatibility fixes and visual inspection

Current Specification text follows current `specification_id`, not the initial
pointer. Existing valid Markdown is readable even without new creation provenance;
legacy JSON object content is not misrepresented as Markdown. The read limit
matches the existing revision budget, including valid content over 65536 characters.

Created preview reads restore the actual Task Project ahead of stale selectors,
archive/freshness guards and defaults. Cancelled projection no longer incorrectly
requires a local Project selection. Creation receipts validate the exact known
confirmation ID. Evidence replay preserves immutable request/result files.

Desktop/mobile preview and Task detail screenshots were visually inspected; root
also inspected mobile preview and desktop detail. Literal Markdown/markup remains
exact readable text. No new frontend dependency was added. Existing nonblocking
Fastify logging deprecation and Vite ~534 KB main bundle advisory remain.

## Deployment and native acceptance

Final staged archive SHA-256:
`a0913337e59aa109940bd2486c1e5b0264d27aba44af54d53c4ac6af39b1a014`.
The manifest binds 205 product files. Private build, DB and native evidence:
`/root/monos-task-preview-evidence-v1` on the existing authorized test host
`100.120.14.84`. Existing monos endpoint is `https://127.0.0.1:18444`;
the independent legacy installation on 18443 is untouched.

Native `task-preview-20260930-a` passed with the installed zero-price OpenCode
model after fresh active/tool-call/pricing preflight. One Todo Planner committed
structured preview content through the native CLI. Unassigned preview required
Project selection; reads and concurrent confirmations created no Task. Two actual
parallel creation requests resolved to one PLANNING Task with exact Markdown,
one initial revision and zero Plan/Node/Attempt/Start. Independent canonical digest,
SQLite command/source, confirmation/resolution/revision and receipt checks passed.

The harness reassigned and archived the source Todo and archived its dedicated
no-Role/no-resource Project. A query carrying another selector, immutable receipt
replay and new same-content confirmation/creation all restored the same Task.
The ready Task remains retained as test history and has never been started.
Final `preview-installation-audit.json` verified all 205 source files and no queued
or unreleased Attempts/unsettled operations; native process/cgroup absence was
rechecked. The existing Runner binary
is retained because this leaf changes only Owner contracts and server/UI behavior.
The model's original `commit_discussion_turn` preview contract remains compatible.

## Remaining scope

Task Start/planning, Task conversation, execution board and repository/workspace
materialization are later tasks. A ready Task is deliberately nonexecuting.
