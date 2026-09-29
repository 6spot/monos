# Bug Analysis: comparing late Runtime facts as immutable Task state

## 1. Root cause category

**E — implicit assumption**, crossing the Runtime/domain evidence boundary.
The acceptance harness assumed physical process release also meant that every
Runtime log/exit fact had been delivered. `BoundaryService.event` deliberately
accepts authenticated late observations for the same dispatch. Its ordered-log
projection and `exit_observed` can advance without changing the canonical reply,
Task, Specification, receipt, mutation authority or physical ownership.

## 2. Why the first fix was insufficient

The first read-only preflight failed because earlier archived native snapshots
predated final log drain. The correction allowed unchanged per-stream historical
prefixes with contiguous output/exit appends, but incorrectly kept a blanket
equality assumption for current snapshots across restart.

The actual backend restart then reconciled one preview Attempt's `runtime/exited`
event (stream sequence 2, Attempt order 8). The only Attempt changes were
`exit_observed: false → true`, `log_visible_sequence: 7 → 8`, and `activity_at`.
All prior raw events and all immutable business records remained unchanged;
there was no new Attempt, Start, authorization or model work. The native snapshot
was read before this event arrived while the raw DB collection was read after it.

## 3. Prevention mechanisms

| Priority | Mechanism | Action |
| --- | --- | --- |
| P0 | Narrow comparator | Compare all immutable records and authority exactly; allow only digest-verified same-dispatch output/exit appends and their precisely derived projection fields. |
| P0 | Regression | Valid late exit succeeds; wrong dispatch/boot, altered/lost events, extra Start, gaps, changed receipts/Task/authority and unexplained projection edits fail. |
| P0 | Recovery evidence | Preserve v1 failure and source bytes. Re-evaluate its actual backend restart against the corrected contract, exclusively claim continuation and restart only Runner. |
| P1 | Spec | Runner quality guidance now distinguishes canonical records from asynchronous Runtime observations and acknowledges multi-read snapshots. |

## 4. Systematic expansion

Receipt replay, Task source/history, Specification, workspace ownership and Start
counts remain exact checks. Runtime event persistence is append-only; its current
projection is rebuildable, not immutable. Future delivery/workspace acceptance
must make the same distinction between fixed operation/result identities and
newly reconciled external observations. No product change or general diff engine
is needed to fix this harness error.

## 5. Knowledge capture

- Updated `.trellis/spec/runner/quality-guidelines.md` and acceptance design.
- Preserve `/root/monos-capture-discussion-preflight-v1` and
  `/root/monos-capture-discussion-acceptance-v1` as failed runs.
- The failed actual run's source is retained under
  `/root/monos-capture-discussion-tools/capture_discussion_acceptance-a2e1184c053672e5c239b1d40dc9ac11aec784a6a69d69c9d779b3f5d913b034.py`.
- Corrected comparison and explicit continuation are verified in this task's
  harness tests and final report. This repository has no Trellis template source
  tree to synchronize; its local specs are the applicable knowledge source.
