# Ordered Todo Discussion verification

## Deterministic checks

- Full local protocol drift, lint, TypeScript, 131 unit tests and production build passed.
- Final full same-host PostgreSQL suite: 123/123 across 14 files (13.04 s).
  This includes 14 Discussion tests and the new actual heartbeat/Auto deadlock
  regression. The previous SHARE ROW EXCLUSIVE implementation reproducibly
  deadlocked; EXCLUSIVE passes while observing the new installation report.
- Full browser suite passed 16/16; the subsequent targeted waiting-reason case
  passed 1/1 (4.6 s), including retained saved input/draft and no extra writes.
  Desktop/mobile Discussion layouts were visually inspected. Final web lint,
  typecheck and build passed after waiting-reason copy changed.
- Linux Go race tests and vet passed on the Discussion Runner snapshot; all four
  binaries built and were installed on the existing test service. Shared protocol
  fixture updates passed the Go checks. Subsequent OpenAPI-only cursor metadata
  regeneration did not change Go/TS contracts or Runner source.
- Python acceptance harness regression suite: 61/61. Cases include uncertain
  receipt recovery, cursor boundaries, committed native handoff provenance, and
  PID/birth/boot plus actual sleep-child absence independently of cgroup placement.
- Final generator lint and protocol drift check passed after documenting Todo
  Attempt list/log pagination parameters. No package dependencies were added.

Nonblocking existing diagnostics: Fastify disableRequestLogging deprecation and
Vite's approximately 518 KB minified main bundle advisory.

## Independent review and resulting fixes

Backend/protocol and Runner review covered exclusive ownership, composite receipt
scope, source ordering, retries, cache Project epoch/digest and physical settlement.
Frontend review covered scoped drafts, uncertain command recovery, recent-window
pagination, focus after organization actions and canonical replies. Fixes include
combined prompt byte/code-point limits, withdrawal cache continuity, the shared
Runner Auto lock, actionable waiting reasons and documented pagination inputs.

## Host acceptance

Both live scenarios passed with the actual installed OpenCode/LongCat Runtime:

- `discussion-ordered-20260930-a`: pure capture caused no Attempt; two immediate
  messages produced two ordered native formal commits, exact source watermarks,
  updated requirement cache and released processes, with no Task/Node/resource.
- `discussion-interrupted-20260930-a`: observed a real native `sleep 45` child,
  stopped and proved its absence, retried the same source with a new Attempt,
  observed/stopped that child again, withdrew the source and processed the later
  message. The two interrupted Attempts had no fabricated reply; the later one
  committed successfully. All three released ownership and settled operations.

Preflight verified active native tool calls and zero input/output/cache prices.
Existing host is
`100.120.14.84`, monos endpoint `https://127.0.0.1:18444`; the independent legacy
installation on 18443 remains untouched. Private receipts, native journal and
process evidence live at `/root/monos-todo-discussion-evidence-v1`.

Final staged archive SHA-256: `4b569a6bf70bf8bc5e96d611bafec6c6d0f4a5bc9194c4ede4e38b4496fba263`.
The private manifest binds all 192 staged product files. The four installed binary
hashes are recorded in `runner-updated.json` and retained build evidence.
Final `discussion-complete.json` passed: both trial Todos were archived through
Owner commands; all 192 source hashes matched; global queued/unreleased Attempts
and unsettled operations were zero. Trial process/cgroup absence was rechecked.
The existing Runner service uses the same shared capacity and process supervision;
no additional permanent service was introduced.

## Scope limits

Todo repository inspection is explicitly unavailable while the Runner only has a
fixture repository implementation; it never exposes that fixture as a Project.
The current OpenCode adapter is one-shot and does not claim a live reminder hook.
Task creation, Task-side planning and real resource materialization are later leaves.
