# Independent installed/native acceptance review

Status: **ACCEPT — frozen v2 source and installed native acceptance complete**.
Reviewer independently verified deployment, pre-Start edit, native exact proposal
and attachment, active settlement with Owner Stop, fresh same-activation execution,
completion, explicit carry, and backend/Runner restart persistence. No remaining
confirmed defect or acceptance gap within this task's scope. Replan, UI and actual
delivery remain later task leaves.

Reviewer performed read-only host inspection and pure evidence recomputation;
no runtime commands, deployment, new service or product edits by this reviewer.

## Frozen source and deployment

- Independently hashed v2 tar: `996211bfa1acf3eb5eaeef5c9a7d7a5994c13dab0ad7350e94d470ba1d3293d2`.
- Compared v1/v2 manifests: both 318 files; non-Runner mappings exactly equal.
  Only the eight previously reviewed Runner enum-reference files differ.
- Rehashed every v2 manifest entry in both build source and installed source:
  zero mismatches. Rehashed all four installed binaries and v2 build artifacts:
  exact matches to `installed.json`. Deployment-directory binaries are the old
  rollback backups and match `before.json`, not the new installed binaries.
- Read v1 PostgreSQL log: 292 tests / 27 files passed. Both image builds passed.
  v1 Go failed on old generated enum names; failure is retained. v2 Linux Go log
  and result pass. Identical non-Runner source justifies recorded PG/image reuse.
- `installed.json` has eight passing checks: migration20, original receipts,
  binary/source identity, separate monolab service, localhost18444, running image,
  canonical idle. Reviewed installation script implementing those assertions.
- Independently compared complete before/installed receipt hash-count maps:
  exactly equal. All recorded runtime pending counts are zero at install readiness;
  v2 additionally reports no requirement changes or publication slots pending.

Evidence: `/root/monos-specification-deploy-v1`,
`/root/monos-specification-deploy-v2`, v1/v2 manifests and frozen archives.

## Pre-Start direct Owner edit

Task: `89effbce-76d8-40c6-8702-70d856c369ba`.
Evidence: `/root/monos-specification-native-v1/prestart-specification-published.json`.

- Recomputed publication, proposal-envelope and authorization-chain checks from
  saved raw rows: all pass. Saved independent Owner request's `command` exactly
  matches the command used for review; its canonical receipt binds the edit,
  authorization, consumed request and published revision.
- Old revision retained, one additive revision published, no execution artifacts
  introduced: both before and after contain no Attempt, Node, Plan or operation.
- Effective revision `5940a224-dbbb-401f-95d2-82416b90ccb9` has parent
  `ac4a7271-f33b-44cd-afaf-e28d3f1e39d6`; publication/change authorization agree.

## Native script review

Prestart/active scripts match local reviewed files, installed script bytes and
preserved SHA records. Active script hash:
`d3820138b5a955cd520668941a9825ee37c351a8cf7632ec4adc2039673b8930`.

Reviewed active and carry scripts without executing them. Active checks bind
native prepare/attached-reply journals, full exact Owner confirmation/apply,
old effective revision while settling, change-owned Stop, physical identity and
released descendants, retained Owner Stop, preserved private checkpoint, same
activation/fresh source, original Plan definition, exact completion manifest,
all Node command journals and actual/private/exported Git tree. Carry checks
immutable completion and source/history rows, explicit new applicability,
additive revision and exact idempotent replay with no execution.

## Actual active publication and Stop evidence

Independent read-only review of `specification-attached-reply.json`,
`specification-exact-prepared.json`, `specification-after-admission.json`,
`specification-pending-90716836.json`, `specification-published-stopped.json`
and Stop/Continue replay records passes.

- Recomputed all four Planner command canonical byte hashes and matched them to
  native SQLite journal envelopes/digests: read context, read history, prepare,
  commit. Prepare payload exactly equals the requested full proposal plus actual
  input ID. Prepare is nonterminal; commit attaches the exact proposal/basis to
  that same input/source. Planner ownership becomes absent with empty cgroup.
- Recomputed publication/proposal/authorization checks using separately preserved
  Owner confirmation and apply commands: all pass.
- Pending state retains revision `5940a224-dbbb-401f-95d2-82416b90ccb9`, fences
  the old writer, has only the original Node Attempt, and holds the exact change's
  publication slot. Published revision becomes
  `8e9f3816-421a-491f-89a5-b17a3b26e61e` only after recorded settlement.
- Independently reran physical/checkpoint checks: original children were live;
  original writer and descendants are settled afterwards; exact checkpoint
  preserves private work. Dispatch, PID birth, boot ID and cgroup identity match
  between running and absent observations.
- Change `2bbcd182-3f50-4964-aa2e-9a3c6a5c9803` owns Stop
  `ef3cef99-d1a1-4079-80d0-7adac5955e0b`, now succeeded. Owner Stop uses the same
  Stop effect and leaves the Task and Node BLOCKED after publication. There is no
  automatic successor. Activation remains 1; Plan and membership rows unchanged.
- Stop and Continue saved replay responses equal their original receipts exactly.

## Fresh execution and carry

`specification-fresh-execution.json` and `specification-carry-final.json` both pass.
Independently recomputed source context digest, canonical prompt/launch identity,
manifest/result digest, effective revision identity, prior driver report hash,
private fingerprint preservation and native open/complete journal bindings: all
pass. Fresh Attempt `440afa40-4452-426c-a7b5-13f9abce0bfb` retains activation 1,
uses the new revision, completes physically, and leaves Task REVIEW. Exactly two
Node Attempts exist across the change.

Read actual private Git commit with read-only `git cat-file`:
- Commit: `b68cefada4cba3737e55b4ea7f5ea6c9b86444b9`
- Tree: `946bdab3247e0178c099cf77dbacb1cd0de54afb`
- Parent: `6c3f5a85739fc42f0d10541c1e48247f1cbed90c`

These match saved private/exported objects and the original fixed lineage.
Initial root read was rejected by Git ownership checking; rerun used a
command-local exact `safe.directory`, without changing host Git configuration.

Carry's separately saved Owner command matches its canonical receipt and full
proposal. Recomputed publication/proposal/authorization chain all pass; 16 classes
of execution/source/history rows remain exactly unchanged. Replay returns the
same receipt. The additive revision `01e65b38-5b22-4083-837b-62b6387cf91a`
explicitly carries completion `cdc7f5f6-a6bd-497c-9a46-3cda2fd7c5e5`, digest
`e14e9c62a9847811699406f149ce231443c2b607f7aa4f63d9fc81296563a02b`,
from parent revision `8e9f3816-421a-491f-89a5-b17a3b26e61e`. Original
refresh applicability and historical completion remain unchanged.

## Restart failure retained and explained

Backend restart passed all checks. Original Runner restart final evidence is
retained with outcome **fail**, solely `canonical_records=false`. Independently
compared every saved record group: only four Attempt rows changed, each only
`activity_at`, `exit_observed` false→true and `log_visible_sequence` +1. Every
other record value is equal. All original physical identity, receipt multiplicity,
Git, global idle and current registration checks passed.

Source `service.ts` runtime-event handling inserts an ordered log entry and then
updates precisely those three projections for exited/process_absent events.
The actual read-only `specification-restart-observe-v2.json` now passes all 12
checks. Independently recomputed its pure explanation from raw saved rows:
exactly four additional `exited` entries, each runtime stream sequence 2, at
ordered cutoffs 9, 10, 9 and 32. Every entry matches its runtime event's canonical
digest, dispatch, boot, body and stream identity. Before→failed and before→live
explanations are identical; both current raw snapshots are exactly equal.

Only the three individually explained Attempt log projections and the original
four tables' `last_checked_at` poll timestamps are excluded from semantic equality.
All remaining records are equal. Native receipt, operation and request journals
are independently unchanged. All 13 fresh global idle counts are zero; Runner
heartbeat is fresh and ready. No further backend/Runner restart occurred and all
original physical identities remain absent. Historical raw event bytes were not
saved before restart: proof honestly compares retained native summary prefixes,
then validates all current raw events and exact exit appends. It does not claim
unavailable historical byte equality.

All four retained before/backend/failure/carry file hashes match the observer's
references; the original failure remains unchanged. This is an explained
observation-field difference, not a waived authority or execution invariant.

## Final installation recheck

After the complete native sequence, independently rehashed all 318 installed
source files and four installed binaries: still exact v2 matches. monolab retains
its original container ID, image, start time and localhost18443 binding, running.
monos remains running on localhost18444 with the v2 image and same container as
the restart evidence. No unexpected service or source drift was found.

**Final verdict: ACCEPT.** Task source checks and installed native gate are
complete. Original v1 Go failure and original restart log-projection failure
remain in the evidence chain with verified corrections/explanations.
