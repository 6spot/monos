# Execution UI visual verification

## Build and evidence

Captures use the production Vite SPA served by the isolated real Fastify/PostgreSQL
browser fixture on loopback18555. The full46-case run uses
`index-6eFJJQ-h.js` / `index-B0ijfbLx.css`, based on predecessor `78f4ff8` plus
this leaf's uncommitted changes. The final Task-switch refresh rebuild uses `index-D7bq4c-w.js`; its four focused
browser cases passed. Screenshots and SHA256/dimensions
are retained in [screenshots/manifest.json](screenshots/manifest.json).
Only PNGs are retained, not browser network traces/session data.

Each state has `-desktop.png` (1440×1000), `-mobile.png` (390×844), and
`-desktop-full.png` / `-mobile-full.png` (same widths, content-dependent heights).
Root opened and inspected every full-page desktop/mobile state below; viewport
captures preserve the corresponding initial viewport. The screenshot helper
checks document width against viewport width for every state. Full-page content
outside the initial viewport remains reachable by normal vertical scrolling.

The test schema and Task UUIDs are ephemeral and deleted after the run. Route
patterns and fixture kinds below identify reproducible data rather than claiming
that discarded Task links remain reachable. Synthetic Runtime/effect facts use
real canonical service transitions. Git fixture OIDs and repository are deliberate
examples, not a real remote delivery.

## State and route matrix

| Screenshot prefix | Route / fixture and capture state | Inspection |
| --- | --- | --- |
| board-populated-queued | `#board`; ready + queued + review | Three canonical columns; ordinary queued work; readable names/controls |
| board-empty | `#board?project_id=<ready-project>` after reset | Three explicit empty columns with history action available |
| task-local-review | `#task?task_id=<review>&section=overview` | Repo-free current result, formal artifacts, explicit local REVIEW meaning |
| task-uncertain | `#task?task_id=<ready-A>&section=conversation`; lost response + newer draft | Recovery remains next to preserved draft; visible focus ring |
| task-planning-issue-disabled | `#task?task_id=<planning_issue>&section=conversation` | Full issue and answer; unavailable Retry before answer explained |
| task-execution-blocked | `#task?task_id=<blocked>&section=execution` | Blocker, exact Retry and fully loaded Runtime/workspace-empty diagnostics |
| task-timeline | Same blocked fixture after Retry; `section=timeline` | Formal history plus work-grouped execution Flow; diagnostics kept separate |
| task-exact-requirements | `#task?task_id=<specification>&section=conversation` | Full old/new requirement text, impact and independent explicit controls |
| task-joint-replan | `#task?task_id=<joint>&section=conversation` | Full proposal, two exact approvals and independent exits |
| task-long-content | `#task?task_id=<ready>&section=conversation`; long title + Chinese draft | Title wraps; textarea scrolls; composer/actions reachable; focus visible |
| task-read-error | Same ready Task, injected503 read error | Concrete read failure and usable Retry; test verifies preserved draft after recovery |
| task-terminal-conversation | Running fixture stopped/continued/cancelled; Conversation | Terminal explanation and question composer; no execution restart action |
| task-completion-recovery | `#task?task_id=<completion_recovery>&section=execution` | Cleanup Retry stays distinct from final result; asynchronous panels not used as populated diagnostic evidence |
| task-running-workspace | `#task?task_id=<running_workspace>&section=execution` | Recorded Runtime/model, held workspace, successful open, exact base/head; no fabricated result |
| task-finalized-git-result | `#task?task_id=<review_git>&section=overview` | Exact commit/tree/repository/base plus current result and formal artifact; no delivery claim |

## Reference comparison and intentional differences

Reference: Multica checkout `/Users/me/IdeaProjects/multica`, recorded HEAD
`44ea3b40c8b4f54f4c76d1dd3e3c92e0c0cabd19`; source paths and inspected
reference images are listed in [frontend research](frontend-seams.md#6-multica-reference-paths-and-visual-inspection).
The workspace-overview image and reference-derived visual spec provide comparison
for surface hierarchy, compact sidebar/Board chrome and restrained borders.

The rendered UI follows neutral shell/canvas layers, a256px desktop sidebar,
48px global chrome,16px shared header gutters and owned Base UI control variants.
Long text uses readable wrapping; metadata stays secondary; focus is visible.
Mobile removes the persistent sidebar, stacks Board columns and uses44px primary
touch controls. The browser suite checks sheet Escape/focus return and navigation.
No animated motion was introduced; reduced-motion does not hide any information.

Intentional monos differences: three active Board columns plus explicit terminal
history, four Task sections, no team/organization controls, no normal-user DAG.
Task content is centered with a1100px readable maximum; its variable-height title
keeps full important text rather than forcing a48px single-line identity header.
Long exact proposals can extend well below the first mobile viewport. Compact
native work selection truncates its closed label, with full work text available
in the option and Overview. Raw logs may scroll inside their bounded container.
Read failures use a direct page-level recovery surface. Existing-screen interiors
remain the next independently planned migration and are not visually accepted here.

## Final refresh correction

Initial planning-issue, terminal and Git-result captures exposed a stale Project
name after Task→Task fragment navigation. Root added `taskId` to the existing
configuration-refresh effect and strengthened the shared browser Task opener to
wait for the Project name. Final rebuild and four focused cases passed. Planning-issue, terminal, running
workspace and Git-result images were replaced with final-build captures. Root
re-inspected their desktop/mobile images: correct Project names, usable actions,
readable content and no page-wide overflow. The remaining44 images retain their
full-suite build identity; the final source-only change refreshes configuration
on Task identity changes and does not change their rendering contracts. The
manifest includes final asset/source hashes and per-image build attribution.
