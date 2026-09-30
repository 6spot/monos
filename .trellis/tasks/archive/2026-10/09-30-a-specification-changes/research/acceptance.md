# Specification change acceptance plan

## Baseline

Conversation accepted at `609e392`, archived as `a2350da`, journal Session21
`af58401`. Host remains migration19 with293 frozen files, existing backend on18444
and existing monos-probe Runner; all canonical work is idle. Original Conversation
evidence `/root/monos-conversation-native-v1` stays immutable.

## Database and protocol gates

- Two independent processes must actually contend during confirm/apply. Same
  request replays exactly; another valid request sees one operation/revision.
  Changed request content conflicts. Drafts cannot be confirmed before attachment
  by a canonical reply; source failure/withdrawal cannot orphan visible proposals.
- Bind full content and impact, Task/base/Plan/control, source cutoff, activation,
  source and evidence identity. Direct Owner edit uses the same exact guards and
  receipt semantics. Negative SQL and command tests reject substituted attribution.
- Add input before confirm/admission/publication in both lock orders. A status-only
  reply discharges its own guard, not a scope/impact change. Exact explicit deferral
  stays recorded; unrelated guidance and issues remain independent.
- Pre-Start revision creates no Plan/Node/Attempt/Start. Race initial Plan publication
  with change admission: old authority stays stale, physical cleanup remains owned,
  and only currently permitted planning can resume on a fresh source.
- Race completion admission/physical success, guidance, Owner Stop and Task Cancel
  with publication. Old physical completion must not strand on stale-spec validation
  or become current evidence for an invalidated basis.
- Inject crash before/after admission/publication COMMIT and restart between Stop
  and publication. Freeze guards cover Node/guidance/planning pumps and promotion.
- Completed affected work gains a fresh activation. Unaffected evidence and retained
  unfinished activations require exact immutable applicability; no history rewrites.
- Hard-completion Retry/correction retains manifest/operation/lease identities.
  Withdrawal cannot revive old Attempts or prematurely release ownership. Replacement
  cannot compete with admitted settlement or accumulate orphaned input guards.
- Strict generated TS/Go schemas, bounded scoped reads/context, terminal and
  accepted-batch rejection, receipt recovery and immutable Agent retry pass all
  relevant existing suites alongside new cases.

## Native host proof

Create a fresh canonical Todo -> native preview -> exact Owner confirmation -> Task.
Prove a pre-Start edit changes only effective requirements and formal revision records.
Explicit Start produces the one-Node Plan; native execution creates private tracked,
staged, unstaged, untracked and ignored work.

Use the actual Task Conversation CLI to prepare complete requirements/impact and
commit an attached reply. Record exact Owner confirmation/apply requests/receipts.
Observe old requirements while settlement remains pending, trusted Stop/checkpoint,
and a fresh new-revision source. Verify stable Plan/Node definitions and retained
files/index/HEAD/lineage with a real final Git result. Owner Stop during settlement
must survive publication; explicit Continue alone can resume it. Use deterministic
PG tests for hard-to-force provider timing races and label their evidence separately.

Restart only existing backend/Runner. Compare proposal, authorization, settlement,
publication, applicability, source, completion and receipt records, plus original
process-tree absence. Deploy only a frozen Linux-verified snapshot after full PG,
Go module/race/vet/four binaries and image builds, with fresh backups, old-history
and unrelated-service checks. Retain every failed observation. A fixture timeout
is not product Runtime failure; late observation must bind the same identity.

## Scope limits

Replacement graph/joint Plan publication, feedback UI, provider delivery and
acceptance remain separate leaves. Reject unsupported graph changes and retain
an actionable source obligation. Infrastructure failures during settlement never
invent REPLAN_REQUIRED.
