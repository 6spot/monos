# Available evidence

- Capture: `.trellis/tasks/archive/2026-09/09-29-a-todo-capture/verification.md`, work 9c3ce55;
  private `/root/monos-todo-capture-evidence-v1`.
- Ordered Discussion: `.trellis/tasks/archive/2026-09/09-29-a-todo-discussion/verification.md`,
  work d623444; private `/root/monos-todo-discussion-evidence-v1`.
  Native IDs: discussion-ordered-20260930-a and discussion-interrupted-20260930-a.
- Exact creation: `.trellis/tasks/archive/2026-09/09-29-a-task-preview/verification.md`,
  work 61f140b; private `/root/monos-task-preview-evidence-v1`.
  Native ID task-preview-20260930-a; Task 0c24174a-6910-4810-b4b6-14f68d202f0b.
- Current snapshot: migration 15; 205 product-file manifest, archive SHA-256
  a0913337e59aa109940bd2486c1e5b0264d27aba44af54d53c4ac6af39b1a014.
- Reused product checks: 151 local, 138 PostgreSQL, 23 browser, 67 Python, Go tests.
  Earlier Runtime integration owns live shared-slot queue/reconnect and host reboot.

Integrated persistence is now verified: backend and Runner each restarted once;
24 Owner receipts, exact Task/Specification and no-execution footprint remain.
Final evidence: `/root/monos-capture-discussion-acceptance-v2`, linked to the retained
backend v1 report. All six native Attempts/two known children are absent and global
guards are zero. See `research/restart-evidence.json` (relative to this task) for
hashes and checks. Integration adds one passing real PostgreSQL concurrency case
and the final 90/90 Python harness suite.
