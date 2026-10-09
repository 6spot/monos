# Installed native delivery acceptance

Status: core acceptance completed on 2026-10-09 (timestamps below are UTC).
No Trellis task lifecycle or journal changes were made for this continuation.

## Final outcome

| Acceptance | Observed outcome | Evidence |
| --- | --- | --- |
| Native execution and effective Review correction | Same Node, activation 3; independently verified 8 tests; exact final tree published | `native-http-effective-results.json`, `native-http-effective-result-tests.json`, `native-http-effective-public-commit.json` |
| Accept response loss and recovery | One successful Owner HTTP 200 response discarded in the browser; original committed receipt recovered after reload; one new batch | `native-http-final-browser-response-loss.json`, `native-http-final-browser-receipt.json`, `native-http-final-original-receipt.json` |
| Automatic merge and completion | PR 6 merged; final batch completed; Task A COMPLETED/version 14; held Attempts and open operations both 0 | `native-http-final-provider.json`, `native-http-final-batch-observation.json`, `native-http-final-task-observation.json` |
| Separate unaccepted Cancel | Task B CANCELLED/version 6; PR 7 closed unmerged; branch retained; held Attempts and open operations both 0 | `native-http-final-cancel-task.json`, `native-http-final-cancel-remote.json`, `native-http-cancel-provider-final.json` |

PR 6: <https://github.com/6spot/monolab-feasibility-20260928-160020-public/pull/6>

PR 7: <https://github.com/6spot/monolab-feasibility-20260928-160020-public/pull/7>

Final main/merge commit: `bebe1aec1544b5fae107d80c23fafc8b00f27947`.
Final tree: `565493dbd713eb9e05dad9bcffaca50de100a1a8`, exactly matching the
independently tested activation-3 result. Merge parents are the original main
`aa274b45f50c514ed1be500473bc4a284325f375` and accepted public head
`fab7aead32830a3ec0c655975a5d6948cc47f680`.

## Runtime and installation

Native Discussion, planning, repository work and effective correction used
OpenCode 2.0.20 with explicitly selected
`volcengine/deepseek-v4-flash-ga-260731`. No fallback was used for these results.
The user subsequently reported that DeepSeek was out of credit and authorized a
free model. The remaining evidence and cleanup required no model calls; no
model-policy switch or successful free-model cold startup is claimed.

Current backend source: `acff7663209949929c11d7543eb6453e19cee6ea`.
Current Runner source: `e2cbca97d529692c61f18aa60a6c7f45981d2592`.
Runner `delivery-fresh-runner-v1` reconnected at incarnation 27.
Current server/image, retained database/storage and installed binary digests are
recorded in `review-context-installed-result.json` and
`workflow-guard-installed-result.json`. Endpoint: `http://127.0.0.1:18445`.
All formal product transitions used authenticated Owner commands or the Tool
Protocol. Diagnostic production database access was read-only.

## Native result and accepted revocation

Task A: `b5fa877d-7e24-4472-a13f-9c53944157a4`.
Specification: `309ac1ef-d174-418c-be9d-5d373fa04dbc`.
Plan: `plan-d0ab3670-d333-44b9-8356-2ddc215a563b`.
Node throughout: `node-4b65aed1-7fed-4ad8-b956-0e76e39fb367`.

Initial result commit `4066b2bf5588fb8e462f3169bc7f1099d3876f0c`, tree
`c0340695ded1d63c17758794712f3246d1fa4fab`, passed the README command
`python3 -m unittest discover -s tests -v`: 6 tests, independently run as `me`
with `PYTHONDONTWRITEBYTECODE=1` and unchanged Git status.
The product created PR 6 at public head
`4df7bbf61d05d3db97c1a6865ea1a4d9c8a9b2af`, with the exact initial result tree
and only the original main as parent.

Real user `6spot` produced pending required status `monolab/probe` (status
55957604147). Required-check policy has `app_id: null`. The original accepted
batch `256ad5c3-aac9-4060-b426-754912328d39`, input cutoff 0, actually waited at
`required_check_pending`, with no finalized item.
Later ordinary input `6f85dd3b-4e94-430e-8ca0-73412c22e781` received formal reply
`bf63e6f6-0302-4867-a8d7-bd070fd25241`.

The first Request Changes returned HTTP 409 with original receipt unknown.
A fresh binding and new request `324aa168-6c4e-4395-8429-fcc1276c4ef1` committed
and revoked the exact accepted batch. Native reconsider-input operation
`c7972bd2-a362-41d7-bdc6-2c1e7447bca6` succeeded before route-feedback operation
`d866958c-5c11-4a73-a5bd-1607e3cb3745` selected same-Node rework. Both released
physical ownership. See `native-http-request-changes-v2-result.json`,
`native-http-correction-review.json` and `native-http-correction-attempts.json`.

Activation 2 returned commit `1cdb6f65c8e7788a5f9aaabb4084f03259e5c2b3` with the
unchanged initial tree. This failed the requested behavioral correction and was
not accepted as sufficient. Same-tree public mapping retained PR 6 and its head.
The backend context defect and repair are described below; this historical
unsuccessful rework is retained without rewriting its frozen source.

## Effective correction and exact accepted result

After the context repair, ordinary unaccepted Request Changes
`32ceaaea-3db9-4f8e-b260-84147e05fb5a` created feedback
`0bd0380c-dc9d-4ec7-af0f-19158f729324` and a fresh native rework.

| Identity | Final value |
| --- | --- |
| Node activation | 3 |
| Attempt | `d5706933-fe21-4781-a10f-4feb496bfade` |
| Completion operation | `80a92fb1-2436-4481-ae28-a883b75e8160` |
| Source | `82bde556-5647-4542-9222-8d319eeac9fe` |
| Finalized local commit | `4cfcb0a809d06c08b0355fe8e4a3d26b7fd4cffc` |
| Tree | `565493dbd713eb9e05dad9bcffaca50de100a1a8` |
| Source digest | `80335e37b51ee7d2f35fa39b9a50ab77521edd40d2d5815274800b08d0dd551d` |
| Public candidate | `c740abd5-cb77-4e87-874e-f645dfe4b2af` |
| Public head | `fab7aead32830a3ec0c655975a5d6948cc47f680` |

Only `tests/test_greeting.py` changed versus result A. The correction adds a
meaningful `builtins.open`/`socket.socket` failure guard, Unicode surrounding
whitespace coverage, and decomposed combining-mark preservation coverage.
The literal README command passed 8 tests independently as execution user `me`;
Git status was unchanged. The final public commit has the exact tested tree and
only the original public head `4df7bbf...` as parent. Product push/update kept
the same PR 6, provider PR ID 4796113908, item
`ab9e9063-9dab-48ab-82e4-1da932228754` and branch, without force or recreation.

## Browser response recovery and merge finality

The served UI performed Prepare, Confirm and Accept for proposal
`705481be-dc12-4ee1-a54f-ae5f89583983`, confirmation
`3004cc3c-241c-44b4-a714-4f43ffc8dbd9`, digest
`151e9b4a2234b22676381199cc7856fb9887cb9d3e9c9bbea38b6477c6fe9599`, at control
version 13 and the same Specification/Plan.

A one-shot browser fetch interceptor discarded exactly one successful HTTP 200
Accept response, then restored fetch. The original request was
`15bcb869-eaeb-41b1-9a4e-7f6e2bb07e58`. After reload the browser explicitly read
that original receipt and received HTTP 200 committed. Exactly one new batch,
`30389a92-ed08-44f3-a7bd-90c937f11701`, was admitted with input cutoff 2. The
other batch is the earlier revoked acceptance, not a duplicate final acceptance.
This tests loss of the **Owner browser response**, not a lost provider merge
response.

Accepted waiting/recovery views were inspected at desktop 1440×1000 and mobile
390×844 without horizontal overflow. Screenshots were inspected inline; the
browser workspace did not support saving screenshot files.
A later ordinary chat was submitted, and the task browser page closed at
05:54:10. A real `monolab/probe` success status (55960135824) was published at
05:54:12 based on the independently tested 8-test result and exact provider tree.
The product merged PR 6 at 05:54:52, after the page had closed.

Final batch: `completed`, version 42, one finalized item. Merge operation
`3e9aed77-2df6-4337-96e4-7452a5d020d8` succeeded. Task A is `COMPLETED`, control
version 14, with zero held/queued Attempts and zero open operations. There is
exactly one `delivery_completed` event (sequence 15).

The final post-acceptance chat input `f47528d9-fcbe-4a14-8c6c-768e973797eb`
did **not** receive a formal reply: Attempt
`a19218c5-2c9c-4166-b38a-ffbb2cb61146` failed with `missing_formal_outcome` and
was physically absent/released. This failed later chat did not block the
accepted delivery. Billing is not established as its cause by these receipts.
See `native-http-final-conversation.json` and `native-http-final-attempts.json`.

`native-http-final-delivery.json` is an earlier waiting snapshot. Finality is
established by the final batch/task observations and provider evidence.
The frozen batch's nested `review.state: "open"` is historical review metadata;
the live provider fact records the merged PR and exact final main commit.

## Separate Cancel

Task B: `a53d17f3-451b-4616-82f5-559f2ef29f59`. Native execution produced a pure
farewell module, tests and additive README, reaching unaccepted REVIEW.
Result commit `350e21d72ab7f700540efd8d79ebbe358f0cdc9c`, tree
`69d52185e9b33192241d017365ae2dacf9bf7357`, passed 6 documented tests
independently as `me`, without changing Git status.
Only `README.md`, `farewell.py` and `tests/test_farewell.py` differ from the base.

Owner Cancel request `74b8276f-2ebe-4b74-b1c9-ae321682fff9` committed.
Task B is `CANCELLED`, control version 6. Product close operation
`a8fd65fd-fd16-4098-bb59-c8e8b6883f79` settled/version 3/worker absent.
PR 7 was closed unmerged and its branch/head
`9cb5e554e4f7cd59bec5cdf05b7d13aa1cfb25d8` retained, independently checked.
Desktop/mobile terminal views had disabled terminal actions, readable retained
results/history and no horizontal overflow.

## Installed blockers fixed and verification

1. **Named delivery reference resource IDs — `0a1e62f`.** Both Owner delivery
   reads originally returned HTTP 409 because `delivery_ref` accepted only a
   UUID resource segment, although `delivery-acceptance-repo-v1` is a valid Id.
   Eight fields now share DeliveryRef with the existing resource Id alphabet
   and length, retained Task segment/exact binding, and complete bound 187.
   Lint/typecheck/build/generation checks and 609 unit tests passed (408
   database-gated cases skipped in that invocation). The dedicated actual
   PostgreSQL route regression passed for both GETs with no provider mutation;
   shared TS/Go fixtures, real Git named-resource/crossed-ref race coverage and
   all Go consumer compilation passed. Independent review found no blocker.
2. **Least-privilege publication without workflow changes — `e2cbca9`.** The
   Runner rejected `workflow_write=unknown` despite a complete
   `workflow_changes=false` scan and matching proof. Workflow-write authority
   is now required only for actual workflow changes; proof, scan and identity
   checks remain. The bug was reproduced before the fix; focused real remote
   host race tests (37.8 seconds), vet and independent review passed. The
   installed Runner resumed the original retained push operations.
3. **Review feedback in reworked Node context — `acff766`.** Activation 2's
   frozen backend prompt and actual Runner launch omitted Review feedback.
   Context now freezes `review_rework`, including Owner text, Planner reason
   and provenance, selected by exact Task/Spec/Plan/Node and reviewed
   activation + 1. Guidance and Specification remain separate and historical
   prompts are immutable. All 44 existing affected PostgreSQL cases and the
   new sequential correction/Stop-Continue regression passed, plus lint,
   TypeScript, native import and independent review. Fresh activation 3 then
   implemented the correction successfully on the installed system.

Earlier OpenCode v2 support/version parsing fixes are `74fc8a8` and `f4240fb`;
`opencode-v2-installed-result.json` preserves their installed verification.

The first delivery-ref install preflight stopped before effects because an old
observer assumed only one systemd unit; released historical Attempt units are
valid retained history. A later assertion stopped after component replacement
because Docker environment arrays differed in order. Continuation verified
configuration maps/image defaults and exact canonical released ownership,
then started the installed Runner. The two failure records and successful
installation receipt remain separate evidence. No Task or Attempt was reset or
reconstructed, and historical systemd units were not deleted.

## Final ownership and cleanup

`native-http-final-ownership.json` combines the existing read-only physical
observer with a bounded repeatable-read/read-only database snapshot. Missing
historical cgroups alone are not absence proof; use canonical absent/released
Attempts together with the complete `/proc` scan, unit identities, jobs,
workspace leases and current operation ownership. Settled historical
`may_have_mutated` records describe completed remote effects and are retained.
The final 06:47:32 observation classified all 260 scanned processes; the sole
selected live process was the installed Runner daemon. All 13 canonical Attempts
were absent/released; there were zero jobs, unreleased workspace leases, open
operations, pending active delivery operations or current remote/merge owners.
The only observer warnings concerned retained historical missing cgroups, all
matched to canonical released Attempts with MainPID 0. The combined conclusion
is quiescent execution ownership; the observer warning list is preserved.

The backend and Runner remain running. The temporary local browser tunnel
(session 90921) had already exited successfully when polled; no service stop
was needed. See `native-http-final-cleanup.json`.
