# Task Conversation lifecycle PostgreSQL coverage

## Ownership

Added `apps/server/test/postgres-task-conversation-lifecycle.test.ts` and this
report. Product changes, shared fixture, other suites, protocol generation and
`test:db` registration belong to the backend owner. No commit, service start or
deployment was performed in this assignment.

## Assertions

The dedicated suite has 11 real PostgreSQL cases, each using a unique temporary
schema through `conversationFixture()`:

1. Pre-Start replies and durable guidance preserve the original execution facts,
   create no planning intent/Node and retain guidance as an acceptance guard.
2. Owner Stop followed by reply/guidance preserves the exact Node blocker, source,
   activation and paused state, with no automatic continuation.
3. Actual Owner Cancel followed by conversation permits a canonical reply and
   rejects action routing without reopening Task/Node execution.
4. Canonical history of 65 withdrawn inputs plus two live sources proves bounded
   64-item pages, exact Unicode content, withdrawal labels, bounded frozen recent
   context, source-cutoff search and cursor scope. A prior reply appended after
   the current Owner input remains visible by its earlier source watermark.
   Later input, another Task's message/Spec and Todo capture/discussion stay out.
5–7. `exited`, `process_absent` and `capture_failed` each fail the exact input and
   increment conversation state while preserving execution control. Retry keeps
   the original input and immutable old source, creates a fresh source, fences
   old authority and waits for the old Stop before promotion; later input cannot
   skip the failed head.
8. Exact input-issue answers plus Retry/Withdraw retain independent issue and
   guidance obligations. Recorded answers survive; withdrawing a parent does not
   silently withdraw its separate re-evaluation input. Recovery remains available
   with Runtime policy removed.
9–10. Exact planning-issue/Node-blocker answers reject stale targets, preserve the
   existing execution blocker and do not start work. Explicit Owner Retry then
   consumes the saved answer into fresh execution context.
11. An admitted Node workspace lease in PostgreSQL remains held while a
   canonical scratch-only Planner uses another slot on the same Task host. The
   Planner cannot open the resource; its reply/Stop preserves the Node lease,
   live mutation authority, source and execution version.

## Findings and fixes coordinated with backend

- The `capture_failed` Task branch initially lacked conversation-specific version
  isolation. Backend added the canonical branch before the first complete run;
  the regression covers failed input status, exact end reason and both versions.
- Saved planning answers could be consumed by backend Retry logic but the public
  OwnerCommand schema still required the answer field whenever issue_sequence was
  present. The test exposed the validation failure. Backend updated the schema
  and shared fixtures and regenerated consumers; the saved-answer path passed.
- The long canonical history setup outlasted Runner heartbeat freshness. The test
  now refreshes the fixture heartbeat before promotion, preserving all history
  assertions rather than treating an offline Runner as a product failure.
- Newly typed public status uses numeric versions. The failure test checks both
  exact inputs as a bounded set and
  separately requires the source to remain bound to the oldest unresolved input.
- Reported a separate read risk to backend: deriving top-level current-input
  actions from only the first 64 identity-sorted summary rows can omit the actual
  head. Backend subsequently corrected input summary ordering to message sequence,
  ensuring the oldest unresolved input remains in the summary. Root's final
  gates cover the combined checkout.

## Executed checks

- Initial real PostgreSQL run: 9/11 passed; remaining failures were the saved-answer
  schema gap and the long-setup heartbeat fixture.
- Corrected history test: 1 passed, 10 skipped (31.43 seconds).
- Post-protocol run: 8/11 passed; the three old string-version expectations were
  updated to the new public numeric representation without changing execution or
  physical-ownership assertions.
- Final complete PostgreSQL rerun: **11/11 passed**, 112.35 seconds (run started
  2026-09-30 07:33:53 local tool time).
- `pnpm exec eslint apps/server/test/postgres-task-conversation-lifecycle.test.ts
  --max-warnings 0`: passed.
- `pnpm exec tsc --noEmit`: passed after protocol regeneration.
- From `runner`, `mise exec go@1.27.1 -- go test ./...`: passed after regeneration.
- From `runner`, `mise exec go@1.27.1 -- go build ./cmd/...`: passed.
- Whitespace checks on both new files: no findings.

The private existing PostgreSQL URL was supplied only through the subprocess
environment; no credentials were printed. Trusted Stop/workspace result fixtures
prove database settlement and claim guards only. They do not prove Linux writer
absence, Git materialization, native CLI execution or provider delivery. Root's
native evidence and full integration gates remain separate.
