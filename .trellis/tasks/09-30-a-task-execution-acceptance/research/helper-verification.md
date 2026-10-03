# Acceptance helper verification

Worker owns the temporary helper implementations and this report. Root owns all
host mutations, backup/install operations, Owner commands, model work and native
admission. This worker performed read-only SSH observations and isolated local
helper checks; it did not run a host service, unit reconciliation or install step.
No product source or previous evidence was changed, and no commit was made.

## Frozen helper identities

| Local helper | SHA256 |
| --- | --- |
| `/tmp/monos-execution-observer-v4.py` | `d4c26530d8e90ae3929801e87d0979c6a3da6896937f527b9fd480dffc581a3b` |
| `/tmp/monos-execution-install-v1.py` | `05c750153e1e51f1563d2f6e8045350c183899f44c93b21a768686e131c6f6f8` |
| `/tmp/monos-execution-native-v1/browser-original-b08f24b5.mjs` (actual running version) | `b08f24b5ccc1ca6fb2d89d75dd3d26f92815017a3f98711ac8aa9510c88a6893` |
| `/tmp/monos-execution-native-v1/browser.mjs` (corrected source; not reloaded) | `513fd39769ce59480c1d2d690531e947911e87d1d7fbdc6c3919c9a38714f8a7` |
| `/tmp/monos-execution-install-resume-v1.py` (failed observation; retained) | `6b0f80723c82e3917b143c14af9cb2cbc8ddbfd010549e02ac29f487a32b6c44` |
| `/tmp/monos-execution-install-resume-v2.py` | `96dc6ab77696aced84e18892382715564e09d0720022f690acd4142af9d74184` |
| `/tmp/monos-execution-native-audit-v1.py` | `c13e76045145386f179104d388101dbdcd9d9a2211462d8093009a1b2d2b1915` |

The final native helper supersedes drafts `d94c5af…` and `f2ab605…`, which were
reviewed before root execution. Earlier draft checks incorrectly equated the UI
Ready column with canonical state; the final gate uses canonical `PLANNING` and
requires zero Attempts, Plans, Nodes, planning sources, starts, workspaces, leases
and operations. The draft capture receipt filter was also corrected to actual
`response.todo.todo_id`; preview receipts bind `proposal_message_id`. Final reads
include the actual finalized private Git export, not only worktree objects.

## Observer and installation

Observer intents now hash the observer, imported common module and external
never-started module. `revalidate-before` writes fresh exclusive intent/result
files, binds both original baseline file hashes and compares current history,
source, binaries, containers and Runner with that baseline. It preserves the
original `before-v4.json` and its older intent rather than rewriting provenance.
Installer revalidation and intents carry the same dependency/baseline identities.
The candidate commit check requires the full frozen commit. After-install checks
also require the candidate server to run with a positive PID.

Actual Python function execution in an isolated temporary directory passed:

- Observer unchanged-installation positive case and ten altered-state negative
  cases: nonzero ownership, changed receipts, source, binaries, process incarnation,
  backend incarnation, image, database state, Git result and canonical Task state.
- Actual installer gate accepts the unchanged snapshot, records current provenance
  and rejects a changed receipt before any installation action.
- Evidence uses exclusive creation and mode0600, fsyncs file and parent, and refuses
  an overwrite. Rollback binary replacement restores the original bytes/mode while
  preserving a stranded installation temporary file, using its distinct phase name.

Python syntax passed. Earlier independent install review supplies the actual
missing-added-source rollback and rollback-only missing-server checks; these
contracts were not changed by this worker. Installed source lint/type/build gates
remain the accepted unchanged-candidate checks, with no repetition for temporary
helper changes.

## Interrupted installation and continuation

Root's first install stopped Runner, then failed the unchanged bootstrap preflight
before replacing source, binaries or server. Inventory contained exactly eight
failed and four active/exited historical Attempt units. Bootstrap deliberately
requires those retained unit records to be reconciled before installation; no
product change is required. The unit Description contains a dispatch identity,
while the unit name contains the Attempt identity. Read-only SQL against the exact
Attempt identities found eleven existing canonical released/absent/no-mutation
records; the accepted host-exited fixture intentionally has no canonical/journal
row, as explicitly recorded in its retained evidence.

The resume wrappers bind the original install intent, bootstrap failure, build,
backup, helpers, baseline and image overlay; require unchanged source, binaries,
canonical/native/Git/configuration/database/monolab/receipts and all nineteen global
ownership counts zero; and permit only the expected inactive Runner. They prove
and retain every exact unit's dispatch, trusted root manifest, journal/fixture
identity, original PID/birth, no current MainPID/ControlPID/job, kernel cgroup and
matching `/proc` writer absence. Only four explicit empty active/exited units may
be stopped, and eight explicit failed units reset. No broad reset, DB restore or
formal lifecycle mutation exists. A fresh exclusive bootstrap log precedes the
remaining original install steps; the original install intent remains unchanged.

V1 actual execution failed before any unit action because SQLite `starts.body`
was bytes and the journal-hash serialization called `.encode()`. Local predicate
checks did not cover that serialization. V1 artifacts remain intact. V2 handles
both bytes and strings, binds exact v1 intent/gate/caller-failure/helper hashes,
rejects any prior advanced action, and uses new exclusive v2 artifacts/logs.

Actual unit predicate functions passed two positive and28 altered-state cases.
More decisively, **the complete v2 `prove_unit` ran read-only against all12 host
units and serialized every proof successfully**:73895 bytes, SHA256
`302271b0f76c427f652e69c0efa773f3b1b3fb2cdf03589e17054f67328b763e`, all checks true,
exit0. Probe allocation bypassed constructors so no mkdir/chmod/save/control method
was invoked. Root subsequently reported successful reviewed v2 installation;
root/reviewer evidence owns that installation claim.

## Browser helper

The SSH socket is `/tmp/monos-execution-acceptance-ssh-v2`. Login navigates to
`/#projects`, waits for the actual authenticated Projects UI and reads normal
Owner session status. Generic POST retains its exact intent plus the actual
non-authenticating session UUID and sends `X-Monos-Session`. The request observer
checks this header on all four Task command families before sending. Cookie,
Authorization and password are excluded from evidence; login bodies are skipped.
Fill/select/check/waitText allow root to operate normal installed UI controls.

Response jobs catch JSON and evidence-save failures, report them, and drain with
`allSettled`; there is no detached rejecting observation promise. Action response
waiters have immediate rejection handlers. Shutdown waits for routes, closes the
browser and drains remaining observations. Screenshot names are checked against
all six expected files before PNG writes, avoiding overwrite, and wait for loaders.

Node syntax passed. VM execution of the actual helper functions verified normal
session GET and POST header binding, valid/missing/wrong Task headers, credential
exclusion, JSON/save failure handling, successful read capture, exclusive intent
creation and retained screenshot refusal. These are helper checks, not browser
product acceptance or visual inspection. Root owns actual browser traffic/images.

### Actual creation observation failure and source correction

The running browser process loaded original source SHA256 `b08f24b5…`. It created
Task `7d51dfb7-3ce9-4258-bb76-b91248a60c8b`, then its create action timed out waiting
for exact button label `Start Task`. The actual installed TaskControls label is
`Start task`, as confirmed in `apps/web/src/features/task-controls.tsx`. This was
an observation failure after committed creation, not failed creation. The runtime
process continues to use its original loaded code. Root captured the ready Task
through generic screenshot and uses the existing generic click with the correct
visible label; no duplicate creation or new browser process is needed.

Original helper bytes are retained exclusively as `browser-original-b08f24b5.mjs`.
The two create/start selectors in `browser.mjs` are corrected to `Start task`;
corrected SHA256 is `513fd39769ce59480c1d2d690531e947911e87d1d7fbdc6c3919c9a38714f8a7`.
The corrected file has **not** been loaded into the original running process and
cannot be credited as its execution source. Node syntax passed. Scoped VM execution
of the actual corrected create/start action functions passed their exact wait/click
labels and preserved creation receipt capture; actual TaskControls source confirms
the label. No browser, service, model or Owner command was executed by these checks.

`created-recovered-v1.json` reconstructs the exact saved confirmation and creation
request/HTTP200 receipt records, retaining their source filenames and SHA256 hashes.
It is an observation artifact and performs no submission. Its SHA256 is
`8865b47bb86cf0ba3bba6a5b11387ea0f04182646946aee3e366de8fc2e0827b`.
The unique retained create request is `0166b95c-2e5b-4c5f-9142-cc7abe3e4fc9`, with
Specification `4bf3e831-4659-40ca-b120-fdd5c04cd8e8` and confirmation
`a5dac654-db40-4c24-9973-fdaaa6763edf`. The record asserts neither Start nor execution.

## Native audit helper

Root executes these explicit stages:

- `passive TODO`
- `prestart TASK`
- `task LABEL TASK`
- `final TASK TODO`

Evidence lives in `/root/monos-execution-native-evidence-v1` with exclusive stage
intents/results and helper/dependency hashes. SQL is inherited from read-only
`AuditProbe`. `NativeProbe` also inherits `WorkspaceProbe`, giving its native
snapshot methods the correct Python MRO. Todo captures use actual Discussion
snapshot/audit methods and consistent scoped SQL for capture/config/preview/Owner
receipts, Project/resources/Roles/policies, messages, sources and confirmations.
Task captures retain complete canonical records, Attempt native snapshots and
confirmed rereads; only polling timestamps are normalized for stability comparison.
An active observation reports `observed` without implying terminal consistency.

Final Git reads use actual trusted workspace identities and paths. They retain
HEAD, refs, index/status, immutable commit/tree identities and all committed blob
bytes/base64/SHA256 (bounded to2MiB per observed commit). They call the actual
read-only private-export observer for each identified completion operation and
require its exact result ref/commit and tree to match recorded worktree objects.
No historical driver filenames, driver/admission method or repository code is used.
Root separately verifies requested behavior and current completion applicability.

Actual read-only Task/Todo capture functions ran on the retained Replan chain:
19Task native snapshots,1Todo snapshot,1Git workspace, stable confirmed rereads,
10395988 serialized bytes and exit0. Initial test caught an invalid unbound
WorkspaceProbe call; corrected MRO was then verified through the full real call.
The final scoped SQL query returned its actual1capture and2preview receipts. Its
zero configuration receipts reflect the earlier harness's setup, not a new Owner
configuration success. New trial receipt lineage must be checked on its own data.

Actual final Git/export reads verified two retained completion operations, both
export refs matching exact commits and both trees matching worktree objects; JSON
Git evidence serialized successfully. Scoped checks passed canonical prestart,
eight prohibited prestart effects and incorrect READY-state rejection, mandatory
capture receipt, and final export positive/wrong-tree/wrong-ref/missing-export
negative cases. Exclusive0600/refused-overwrite and Python syntax also passed.

These historical helper runs establish that observation functions work. They do
not establish the new native Owner chain, native model behavior, final requested
repository result, installed screenshots, delivery or Owner final acceptance.
Those facts remain root's actual trial and independent review responsibility.


## Final observation extensions (2026-10-03)

`/tmp/monos-execution-native-audit-v2.py` SHA256
`a1d1caf86a4ea0e39a8c5d07d004fba8fe03652ddd818d3e6e0dca61486cf23a`
adds only `final-named LABEL TASK TODO`, normalizing to the unchanged final
capture/Git/check/outcome branch. Evidence is exclusively named
`final-LABEL-intent.json` and `final-LABEL.json`. Original v1/helper/final.json
remain untouched. Syntax passed. A constructor-free read-only test evaluated
all 12 original final checks against the genuine retained final snapshot and
serialized the full result; isolated main verified original argv, exclusive
names and with_git=true using substituted captures/save. This did not create
host files or perform admission.

`/tmp/monos-execution-final-preservation-v1.py` SHA256
`2c9cf85659356a6a489c27ba7b80fbf7fbbcdcd253ac4ac552bfe4617cdfd3a7`
is a separate read-only observer importing the unchanged original v4. It binds
installed `after-v4.json` SHA
`88e1abec25cb531132da97358533de29f4c6db97a8f0b7e0401ac4d598d0818c`,
install-complete SHA
`d9be3280def641aa0f333abef1f0df579af03920e5f7a4cfa93a348284dcd325`,
and full candidate manifest SHA
`aeb0d0c92ecb02788dc2bc881d603de0ab34cbaa0a0a9ed2e217aa030e4c5ffb`.
It compares all historical Task canonical/native/Git and legacy facts exactly,
retains each previous receipt hash multiplicity while permitting new receipts,
and checks full candidate source, binaries, private configs, database/container
identities, Runner process and registration identity excluding only last_seen,
current ready heartbeat and exact 19 ownership dimensions zero. It has no
install/service/Owner/model action. Root uses an explicit unique LABEL to create
exclusive `final-preservation-LABEL-intent.json` and result in the deploy folder.

Syntax and actual complete read-only capture/JSON serialization passed; the
fresh observed gate returned 31/31 true. Constructor allocation was bypassed,
so this worker made no host writes. The private verification result is
`/tmp/monos-execution-native-v1/final-preservation-readonly-verification-v1.json`,
SHA256 `5bcfe73e5fe6364aeec5ac1e0611b31fbbddc0576d0765faf7fe57b3499c6ebf`.
Historical self predicates pass except the correctly expired ready heartbeat;
receipt multiplicity loss and receipt-table mismatch negatives reject. Early
verification scripts encountered the inherited CONFIG location and historical
heartbeat expiry; these were test allocation/expectation corrections, with no
helper or host-state mutation and no fabricated successful gate.

Independent first-result Git inspection is retained at
`/tmp/monos-execution-native-v1/initial-result-git-preservation-v1.json`, SHA256
`420b549bbe4ff551d0a526ea453111fa1252a08e1e37b329a7388b2ae98d6ab7`.
It verifies exact first result HEAD/tree, clean worktree, preserved original
files and README prefix. Native test output uses python3 but first README and
completion summary spell python; this bounded result defect and exact recovery
request/context lineage are documented in
[native recovery lineage](native-recovery-lineage.md). Root owns ordinary
semantic correction, live independent behavior tests, fresh final named capture
and final source/artifact manifest. No package quality gate was repeated because
these edits affect external evidence helpers/research, not product code.
