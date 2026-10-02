# Task feature implementation

This worker owns Board and Task feature composition plus `task-ui.css`; root owns
shared shell/primitives, Task adapters/controller/storage, fixture/e2e and final gate.

## Feature files

- `execution-board.tsx`: bounded independent column queries, hash-bound Project,
  attention/history filters, canonical counts and explicit attention overflow.
- `task-detail.tsx`, `task-shared.tsx`: default Conversation, hash section routes,
  source Todo link, scoped Task remount, first-open title focus, typed bounded reads,
  shared recovery/read error/empty/loading presentation.
- `task-controls.tsx`: applicable exact Start/Stop/Retry/Cancel, blocker answers,
  Node recovery/completion cleanup and guidance Stop/Continue through existing Tool
  Protocol commands. Eligibility remains canonical backend authority.
- `task-conversation.tsx`: ordered messages, exact input decisions and Planner
  status, per-Task/action drafts, structured guidance and paginated independent exits.
- `task-decisions.tsx`: full original/new requirements and impacts, immutable edit
  basis, resumable closed editor drafts, explicit direct Apply requirement change,
  separate exact requirement/Plan confirmations and joint publication, Replan issues,
  independent deferrals/withdrawal/retry. Closed history loads details on disclosure.
- `task-overview.tsx`: current Specification/Plan work and current vs historical
  immutable local completion results; Artifact attribution retains original
  Spec/Plan/Node activation/Attempt/digest/supersedes/reference identity.
- `task-timeline.tsx`: readable formal event history, routine bookkeeping collapsed,
  grouped work flow with current goal/state and factual admission/activity times.
  Planner activity separate. Cursor reset refreshes authoritative Task first.
  Per-work status query errors render the same explicit read/retry surface.
- `task-execution.tsx`: current Node/Attempt status, logs with retained page/cursor
  pairs, gap notice, all previous/replaced work and Planner filters, exact workspace
  operation snapshots, and admitted Runtime/model/thinking choices. No Runtime
  setting changes or raw DAG. Logs and workspace metadata never assert completion.
- `task-ui.css`: neutral shared tokens, compact cards/forms, responsive layout.

## Reviewer fixes retained

Answer drafts bind exact issue/source identities. Reopened requirement editor
resumes the saved original basis/impact. Requirement comparison loads the proposal's
base revision. History scope reaches replaced Nodes and Planner work. Summary overflow
is visible. Historical proposal detail reads stay lazy. Flow groups executions under
human-readable current work goals; unknown old definitions remain explicitly earlier
work. Local REVIEW never claims PR publication, delivery or Owner acceptance.

## Verification and limits

Root/Web typecheck and touched ESLint pass. Backend read/session evidence is in
`backend-implementation.md`. Root owns real built-browser interactions, desktop/mobile
screenshots, visual inspection, full gates and final acceptance. Fixture acknowledgements
do not replace native Runtime/host trials. This worker does not commit or deploy.

## Final fixture follow-up delegated by root

Root temporarily assigned `apps/server/test/fixtures/execution-ui-fixture.ts` for
four additional real-canonical browser scenarios (no network/Git process or build):

- `running_workspace`: recorded Project repository plus real `open_workspace`
  command, explicit synthetic successful metadata, RUNNING with a held lease.
- `review_git`: same opened workspace plus formal Artifact/completion and synthetic
  trusted finalized Git commit/tree (`c`×40 / `d`×40), REVIEW with released lease.
- `log_pages`: running repository-free Node plus 70 contiguous ordered stdout
  events via `service.event`; bounded reads are 64 then 6 with exact cursor order.
- `board_pages`: genuine captured/confirmed Task plus 33 explicitly legacy Tasks
  from `initializeTask`, no invented title or creation provenance; Project-filtered
  ready pages are 32 then 2. Extra Tasks are cancelled through Owner commands on reset.

All scenarios preserve existing fixture input withdrawal/reset behavior. Workspace
reset synthesizes an attributed Stop checkpoint, retaining canonical lease guards.
The fixtures provide identifiers to root's browser tests and screenshots; synthetic
metadata is never represented as native execution evidence.

Private-schema smoke `/tmp/monos-ui-diagnostics-smoke.mjs` passed all four scenarios,
canonical diagnostic/result/log/Board reads and reset-to-empty active Project.
Root/Web typecheck, affected fixture/feature ESLint and diff check passed afterward.

Final display corrections: historical failure kinds are labelled Recorded failure
unless the open/settle state is actively recovery; an already-admitted requirement
operation shows its settlement progress without the unadmitted-proposal stale-basis
warning. Backend action eligibility/guards are unchanged.
