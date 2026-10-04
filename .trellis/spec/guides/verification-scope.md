# Verification Scope and Stopping Rule

Select checks from the changed behavior and a concrete failure risk. Test counts
and coverage percentages are not acceptance criteria. Historical gate reports in
layer guidelines describe past evidence, not a checklist for every task.

## Select the smallest sufficient check

| Change | Default verification |
| --- | --- |
| Documentation or instructions only | Links, formatting and instruction consistency; no product build/runtime suite |
| Local reversible UI/copy/style change | Existing affected checks and visual inspection where appearance changes; no new test that repeats markup or implementation |
| Behavior or bug fix | Focused observable behavior/regression at its owning boundary; representative normal, failure and relevant limit cases |
| Wire, persistence, concurrency or external effects | Relevant generation/consumer, real DB, physical process/Git/provider or recovery checks required to prove the changed contract |

- Before adding or running a check, identify the behavior/risk it proves and whether
  an existing result already covers it. A concise task note or handoff is enough;
  do not create another plan/report for every command.
- Reuse existing tests before adding tests. Add a case only for a distinct behavior,
  real defect, authority boundary, limit or failure mechanism not already asserted.
  Avoid private-helper mirrors, duplicate assertions at every layer, exhaustive
  permutations of equivalent inputs and speculative failure cases without evidence.
- During implementation, run the affected files/packages. An independent reviewer
  reviews current evidence and code; a separate agent does not require rerunning
  the same commands. Narrow fixes invalidate only checks whose inputs/claims changed.
- At integration, reconcile source, relevant shared contracts, dependencies,
  fixtures/assertions and environment with retained evidence. Run missing or
  invalidated checks. Broad suites/builds are for a concrete integration risk or
  required final gate, normally once after the relevant writers settle.
- A new commit, documentation edit, handoff, archive or journal entry alone does
  not invalidate unchanged product/build inputs. If a final run reveals a defect,
  fix it and rerun the affected checks; repeat a broad gate only when its remaining
  risk or required contract calls for it.

## Stop when the claim is supported

Once the affected contract and required acceptance claims have valid evidence,
continue to integration/delivery. Do not expand the test matrix, add another
wrapper, recheck unchanged binaries, repeat provider effects or generate more
screenshots solely for confidence. For changed UI, inspect representative states
and required viewports; states with distinct interaction/authority behavior still
need their own assertions, but identical layouts need not each produce new images.

Preserve the distinction between evidence boundaries: mocks do not prove real DB
locks, physical process absence, native permissions or remote effects. Run these
only where the task changes or explicitly claims that boundary. Missing required
external evidence remains visible; it is not repaired by more unit tests.

See the applicable layer quality guideline for concrete commands and assertions.
