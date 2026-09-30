# Task Conversation verification

Status: **ACCEPT**. Implementation, full frozen-source gates, deployment, native
conversation/guidance/recovery and service restart passed independent final review.

## Automated gates and source identity

- Protocol freshness, lint, root/web typecheck, production build and native TS
  app import passed. TypeScript unit tests: **263 passed**. Python: **162 passed**.
  Local logs: `/tmp/monos-conversation-local-gates`.
- Complete real PostgreSQL suite on the frozen Linux snapshot: **254 passed in
  22 files**, including main Conversation17, reviewer8, lifecycle11 and process4.
  This includes actual independent-process contention and before/after-COMMIT
  crashes, immutable attribution, scoped reads, Stop/Retry/Withdraw, guidance and
  hard-completion ordering, manifest compatibility and accepted-cutoff guards.
- Linux Go module verification, `go test -race ./...`, `go vet ./...` and all four
  production binaries passed. Both Docker image builds passed.
- Code review cleared source freeze; see [check](research/check.md). Owning specs
  were synchronized for independent conversation versions, source scopes, explicit
  handling and legacy manifest preservation. Both JSONL files contain 34 valid paths.

Snapshot `/root/monos-conversation-source-v1.tar`: **293 files**, SHA256
`12d6b6bcc223b4e802db2dd56739da79dd68c00c498d50ea5f9d0780ab04b72f`.
Manifest `/root/monos-conversation-manifest-v1.json` binds the frozen build source
and installed product files. No product code changed after the verified snapshot.
Build logs and result files: `/root/monos-conversation-deploy-v1`.

## Additive installation and history

Backups and installed checks: `/root/monos-conversation-deploy-v2`.
Migration19, exact source/binary hashes, built/running server image, port **18444**,
unchanged independent monolab container and global idle all passed. All original
receipt multiplicities were retained across the six receipt tables, independently
verified against database and binary/SQLite backups. Only existing backend and
Runner services were replaced. No new permanent service or Git publication.

See [independent acceptance review](research/acceptance-review.md) for recomputed
hashes, raw native command bytes, cutoff checks and physical evidence.

## Canonical native task

Evidence: `/root/monos-conversation-native-v1`. Task
`6462642a-b5f0-4590-a372-43b386ff2966` came from real native Discussion, exact
preview confirmation and Owner creation. Node
`e57e5ff3-a2fc-4ecb-b937-2227fbb7011c` came from explicit Start and canonical Plan.

Two pre-Start messages passed actual busy-input intermediate proof, ordered native
replies, source/launch/receipt/journal binding and physical cleanup. Full execution
records stayed unchanged. Independently checked history preserves source cutoffs,
including earlier replies indexed by resolved input. Todo capture and concrete
other-Task completion sentinels are absent from frozen prompts and scoped reads.

Four Node Attempts remained at activation1:

1. `b1ab398b-9566-4bfe-ac4c-9af753ac629c` created tracked/staged/unstaged/untracked/
   ignored private work and live descendants. Native Planner guidance caused
   trusted Stop, checkpoint/export and physical release, then fresh source admission.
2. `a9cff687-4a2f-4a74-815c-0cf49306cb78` received the exact guidance assignment but
   its verification invocation failed before workspace open. This retained failure
   is not reported as successful handling or private-work continuation.
3. `3cb6bf09-dd6b-4295-9e2e-be115e23d837`, admitted by explicit Owner Continue after
   fixing the harness invocation, verified unchanged original private HEAD/index/
   files/lineage and a new lease. Owner Stop then checkpointed it and removed its
   entire process tree. Stopped chat changed no execution records; additional
   guidance remained pending without automatic resume.
4. `2773a2e7-7a2b-40f7-b7a2-99ab91148740` followed explicit Continue,
   reopened retained work and completed with exactly two assigned guidance IDs.
   Version2 manifest, successful operation, completion and handled obligations
   agree with native immutable CLI bytes/receipts. Independent review verified the
   exact full Attempt identity from the source, manifest and journal.

Actual final commit `28f9550221224448dbcc4ddd40f2dcf5d77a8ee9` has tree
`946bdab3247e0178c099cf77dbacb1cd0de54afb`, identical to original private work.
Its parent is original private HEAD `dc5738abcc7b294b9ab761e0d9f7a504c9a943b0`,
whose parent is base `9ac3353e97ed6a0cb96a80bb8e136d44cac982e4`. Actual service
Git objects and private file hashes were independently read and checked.

The local trial was then explicitly Cancelled. A real terminal conversation was
stopped, its queued successor withdrawn, and the original input explicitly retried.
The fresh Planner `971c4dd3-8ec6-453f-86a2-84a5a90c3006` produced exactly one
formal reply; both sources were reply-only. Stop/Retry/Withdraw/reply left execution
unchanged and all physical owners settled. Historical completion remains retained.

## Existing-service restart

`conversation-backend-restarted.json` and `conversation-restart-final.json` passed
after restarting the existing backend and then Runner from a verified idle boundary.
All canonical Task/input/source/resolution/guidance/assignment/operation/completion/
manifest/workspace records and receipt multiplicities remain equal. Attempt
comparison excludes only the documented late raw-log projection fields
`activity_at`, `log_visible_sequence`, `exit_observed`. Original PID/birth/boot/
cgroup/dispatch identities remain historical and every original process tree is
absent. Global queue, writer, effect, lease, input and guidance counts are zero.
This makes no additional raw-log retention or live provider-session claim.

## Preserved deviations

- An implementation rerun lost its private PG tunnel after five cases. That failed
  run remains documented; the later full frozen Linux suite passed all cases.
- Initial Linux Go download timed out. `linux-go.log` remains; separate successful
  `linux-go-cached.log` used existing cache with GOPROXY=off plus module verification.
- First installer preflight parsed raw PostgreSQL boolean as JSON and failed before
  changes. Corrected v2 used fresh exclusive evidence claims.
- Bootstrap --check rejected nine historical failed Attempt unit markers. Exact
  DB released/absent/nonwritable status, zero PIDs and empty cgroups were preserved
  before resetting only those markers. The continuation rechecked original install
  intent, sources, binaries, containers and receipt baseline before proceeding.
- Successor2 first misquoted the authorized Python invocation; its correction
  exposed missing runpy module path. Both failures and explicit Stop/Continue are
  retained. Successful successor3 compares against actual predecessor1's held
  report, never an invented predecessor2 report.
- First extra Git audit incorrectly required final parent=public base. Its failure
  remains. The corrected read-only audit checks preserved private HEAD and then
  its actual base parent. No Git history was changed to satisfy the observer.
- Terminal Retry exceeded the first 300-second observation window, then the same
  Attempt committed at 12:52:34 UTC. A new read-only observation passed; the failed
  timeout is retained. No product Runtime failure or automatic retry was inferred.

## Evidence limits

Completion-first/new-activation, hard-completion Retry/correction and accepted-cutoff
races are established by real PG/Runner tests; this native trial establishes the
specific controlled Stop/private-work/handling path above. No live provider steering,
provider-consumption acknowledgement, Task Conversation UI, exact Specification
publication, replacement Plan or provider delivery is claimed in this leaf.
