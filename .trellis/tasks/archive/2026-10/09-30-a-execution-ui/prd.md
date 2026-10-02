# Execution Board and Task control UI

## Goal

Let the Owner follow and control actual execution from a responsive Board and Task
workspace, with trustworthy progress, exact decisions and recoverable requests.

## Background and boundary

Follows the accepted [one-Node Replan leaf](../09-30-a-single-node-replan/prd.md).
The backend has canonical execution/conversation/revision/Replan commands and scoped
reads. Web currently has only a minimal Task detail and Execution settings. Missing
collection/result read projections and reload-safe Task request identity belong here.
The Owner authorizes sequential implementation and routine decisions without repeat
approval. Architecture modules remain authoritative.

## Requirements

1. **Board:** canonical Ready to start, Running and Review columns; Done and cancelled
   history remain reachable. Project and attention filtering, bounded pagination,
   factual work counts and all current attention reasons use server projections.
   Queueing stays within Running and does not become an alert. Initial planning is
   identified without fabricated Node progress, percentages or ETA.
2. **Task workspace:** direct links/reload and source Todo navigation; distinct
   Conversation, Overview, Timeline and Execution Details. Conversation defaults;
   effective Specification/history, current work, completion summaries and formal
   Artifacts are readable. Timeline contains formal history, with a separate compact
   execution flow where timestamps exist. Logs remain diagnostic and Node-centric.
3. **Owner exits:** expose every applicable implemented Start, initial Stop/Retry,
   Node Stop/Continue/Retry and completion recovery, Cancel, input/guidance Retry/
   Withdraw/Stop, issue answers, Specification edit/confirm/apply/withdraw/retry/
   explicit input deferral, and Replan confirm/publish/retry/dismiss/deferral. Show
   the reason for unavailable controls and distinguish admitted cleanup/publication
   from completed effects. Preserve each independent blocker and remaining exit.
4. **Exact decisions:** readable full proposed requirements, old/new comparison,
   summary and affected work; concrete replacement work and retained/invalidated
   evidence for Replan. Joint publication requires both exact approvals. Revision
   and impact drift cannot inherit approval. Revise is an explicit edit or new
   conversation request; it never mutates an old proposal or auto-withdraws another.
5. **Recovery and drafts:** drafts and immutable pending chains are isolated by
   Task and action scope, retained through navigation and page reload in the same
   authenticated tab session. Recovery reads the original receipt and replays only
   after authoritative unknown, using identical IDs/payload/basis. Independent Tasks
   remain usable; pending proposals do not disable chat. Corrupt/unavailable local
   persistence must not silently submit a fresh command. Logout/revocation/session
   replacement clear private Task state. No credential/configuration secret storage.
6. **Evidence:** render exact local result identity, summaries/Artifacts and retained
   history; identify current versus historical applicability. REVIEW means local
   work ready for review, with no fabricated PR, acceptance, delivery or V1 success.
   Terminal conversation supports read-only questions and points further execution
   back to Todo; merely opening or chatting never Starts/Continues work.
7. **Visual/accessibility:** use the [neutral visual contract](../../../../spec/frontend/visual-design.md)
   and owned shadcn Base UI controls, compact shared shell/chrome, accessible mobile
   navigation, keyboard focus and full important content. Existing-screen interiors
   are owned by the separate [migration leaf](../10-02-a-existing-screen-visual-migration/prd.md).

## Acceptance criteria

- [x] Board filters, paging, direct reload and all canonical state/attention mappings
  are verified against authenticated real backend projections, including queued work.
- [x] Every applicable implemented Owner exit is reachable and preserves exact
  source/version/activation/proposal/confirmation identity and independent guards.
- [x] Two clients, lost responses across reload, malformed/unknown receipts, version
  conflicts and session replacement retain one canonical effect with scoped drafts.
- [x] Overview/current outputs, paginated Conversation/Timeline and Node diagnostics
  preserve revision attribution, cursor recovery and formal/raw separation.
- [x] Local REVIEW exposes exact result without claiming PR/delivery/Owner acceptance;
  terminal questions remain readable without execution mutation or Task creation.
- [x] Inspected 1440×1000 and 390×844 actual-build screenshots cover Board and each
  Task section, populated/empty/queued/disabled/error/long-content states, with
  reference comparison, build identity, deviations, focus and overflow recorded.
- [x] Full affected lint/type/unit/protocol/build/backend/browser checks pass; shared
  shell changes preserve existing Todo/settings drafts, navigation and recovery.

## Out of scope

No remote PR/merge/acceptance or review-feedback delivery implementation; no new
durable notification subsystem, normal-user DAG, team model, workflow engine,
automatic hang inference, Runtime switch feature, cross-Runner transfer or new
permanent service. Existing Login/Settings/Todo/preview interior migration and the
integrated Todo→Task visual gate remain the separate next leaf. Native execution
package acceptance remains after both UI leaves; UI fixture results do not replace it.
