# Node execution verification

All implementation, installed native execution and restart gates passed. Final
independent review is recorded in [check.md](research/check.md). Evidence distinguishes
product behavior, model mistakes and rejected intermediate observations.

## Automated checks

- TypeScript: **249 passed**; lint, root/web typecheck, protocol freshness,
  production build and native source/compiled imports passed. See
  [backend report](research/backend-implementation.md).
- Full PostgreSQL on the verified Linux snapshot: **214 passed, 18 files**,
  including independent-process contention, observed terminal lock orders, SIGKILL,
  immutable manifests, frozen grants and Cancel cleanup. Log:
  `/root/monos-node-deploy-v1/docker-postgres-tests.log`.
- Python: **155 passed**, `/tmp/monos-node-python-v5.log`. Negative evidence tests
  cover missing receipts, changed identities/content/selection, exact retained
  policy failure, both duplicate publications and torn observation reads.
- Linux Go module verification, full `go test -race ./...`, `go vet ./...` and all
  four binaries passed. Log `/root/monos-node-deploy-v1/linux-go.log`; see
  [Runner report](research/runner-implementation.md).
- Both Docker images built successfully from the verified snapshot before install.
  Final `git diff --check`, task context paths and new documentation links passed.
  No product code changed after the final Linux test/build snapshot.

## Installation and retained authority

Source `/root/monos-node-source-v1.tar`: **273 files**, SHA256
`51f954e95514d7523412773cbd2ef120984d9c6b0c331e50e4e86da640e40361`.
Manifest `/root/monos-node-manifest-v1.json` was independently checked before build,
installation and final review. DB, SQLite and previous binaries remain backed up
under `/root/monos-node-deploy-v1`.

One install passed migration18, all original receipt multiplicities, exact source
and four binary hashes, unchanged independent monolab container and port **18444**.
`postflight/server-image-binding.json` confirms the built server image was running.
Only the existing backend and Runner services were replaced/restarted. No remote
Git publication, data reset or new permanent service occurred.

Evidence harness overlays are separately manifested; installed product files remain
v1. Latest `/root/monos-node-evidence-tools/v5`, manifest
`/root/monos-node-harness-v5.json`, probe SHA256
`f8c1312d1d7179607e32aee7c22bb7a9f2839babac53ada9f1f9e7421557f80b`.
Earlier v2-v4 overlays and their evidence remain retained.

## Native no-resource Artifact — passed

Canonical carryover Task `e14ad4bb-4688-4647-981c-70911889e17b`, original Plan
`5c99259e-d5d5-4b1f-a784-dc5d2027ddae`, Node
`04fb910d-fdf9-4e2d-9ae2-ae269f53ca74` retained exact initial-planning provenance
and Owner's “Add book” answer. One actual Node Attempt
`e9ef42b7-fe12-40fc-9140-1992bbcbbe8a` completed operation
`64fedc99-939d-4bee-b3f7-6bb35a6169a7`, reaching REVIEW/COMPLETED at activation1.
Physical result is only `writer_absent:true`: no workspace/lease or fabricated Git.

Selected HTML Artifact `c1e9683d-3bbc-423a-abb4-6b3f6dbcb9fd` is **3903 UTF-8 bytes**.
`artifact.json`, `artifact-all-headers.json` and `browser-content-binding.json` under
`/root/monos-node-native-v1` verify exact selected manifest, full historical output
rows, every publication and native journal digest, Agent read-back, both Owner reads
and no-store/nosniff JSON headers. Independent reviewer recomputed the DB/SQLite/
physical facts. Output publication itself never served as completion authority.

Real Chrome interaction checked Add book, finished toggle/pressed state/strikethrough,
Enter submission, focus return, associated label and literal rendering of an
HTML-looking title. Saved [checks](research/browser-checks.json) and
[screenshot](research/reading-list-browser.png) bind to the actual selected bytes.
The isolated local file origin emitted a same-file URL security warning; only local
document requests were observed, with no remote request or authenticated app-origin
HTML execution. This is functional acceptance, not a full accessibility certification.

## Native Git Stop, hard recovery and completion — passed

Accepted v2 evidence: `/root/monos-node-native-v2`. Task
`70810e87-c861-4257-a9c3-ad346abb342c`, Node
`44bba0d4-efef-4aff-8888-ebcc70136687` came through native Discussion, exact Owner
confirmation/creation, explicit Start and genuine one-Node Plan. Three exact
sources, Attempts and Starts stayed at activation1:

1. `6136cca3-46d2-4d45-84ac-9e8105a835c8` created tracked, staged, unstaged,
   untracked and ignored private changes. Live setsid/double-fork descendants,
   two-account permissions and shared-cache write/push denial passed. Exact Owner
   Stop `3e5cef7e-5e2b-4b46-ab88-773accf15e3f` preserved HEAD/index/files and exported
   checkpoint `2ed63b1c665b8ad1cf77c52e294365681bf51925`, parent
   `55ab2e26d8ef29564948453bdcf1c2ff9ea8d5e2`, tree
   `946bdab3247e0178c099cf77dbacb1cd0de54afb` before releasing ownership.
2. `2342622e-6f0c-4768-b61b-525081c6b96e` reopened retained work and deliberately
   broke ancestry. Completion `6500b097-0adc-4ff3-8f96-bfbf5592c550` became hard
   invalid_finalization with ownership held. Exact Owner correction admitted
   settlement `322014b4-0344-4f1d-b5a1-954ef11f2fb9`. Its exported checkpoint
   `fd4a506736c8ce022e22587ed1b6381ce824aa62` retained broken parent
   `d6104d742369afed27842cb4c264e2329592fb15` and the same tree. Original immutable
   operation identity and lease settle pointer remained unchanged. DB, SQLite and
   root records agreed on the atomic successful-settlement/cancelled-original pair.
3. `88fae332-f4ae-4fd9-9bb2-b054d300d517` explicitly repaired ancestry and completed
   operation `2177721d-b3f2-485e-84cd-f2e16a2bd9d6`. Final commit
   `6e967b4fd6293302818b0b1e3a083535af750adc` has tree
   `946bdab3247e0178c099cf77dbacb1cd0de54afb`, exactly matching initial private work
   and actual service export. One current completion retains exact summary,
   `artifact_ids:[]` and manifest digest. Task REVIEW, Node COMPLETED; all three
   leases and whole process trees released.

`git-final.json` passed all ten result/provenance/ownership checks. Independent
review added 25 fresh checks including original receipts, real Git ancestry/files,
root/SQLite pair, all required three opens/two completions and stale-trial isolation.

## Existing service restarts — passed

`restart-idle.json`, `after-backend-restart.json`, `restart-final-idle.json` and
`restart-audit.json` passed after restarting the existing backend, then Runner.
Both accepted Tasks retained all canonical records, complete Attempt identities,
receipts, manifests and Artifact bytes; original PID/birth/boot/cgroup identities
remained historical and all original trees absent. Only the three documented late
raw-log projection fields are excluded from canonical comparison; this makes no
additional raw-log retention claim. Global queue/writer/effect/lease/outbox counts
were zero. The discarded v1 Git Task remained CANCELLED with released ownership.

## Preserved deviations and corrective decisions

- Three historical failed systemd unit markers blocked bootstrap. Initial read-only
  audit used description dispatch IDs rather than unit/ExecStart Attempt IDs and
  failed safely. Corrected exact-identity audit proved DB/journal/PID/cgroup absence
  before resetting only those markers; no ownership/history was removed.
- Initial carryover source truthfully blocked on `policy_missing`: only Planner
  policy existed, and no Attempt/Start was created. Formal configuration saved the
  same freshly verified active zero-price OpenCode/LongCat target for execution;
  exact source/activation/blocker Retry preserved old source, Plan and history.
  Independent reviewer verified the entire request/configuration/source chain.
- Model passed literal JSON as a CLI file-path input, then republished identical
  HTML under a fresh ID. Strict observer retained `artifact-count-failed.json`.
  Explicit duplicate review checked both historical outputs and every native
  publication before accepting the one selected result. Model prose called its
  3901-character length bytes; authoritative stored UTF-8 size is 3903.
- First Git preview separated Markdown heading into its title. Recombining exact
  title/body reproduced every original byte except surrounding whitespace. Actual
  proposal digest was confirmed without rewriting source content. A premature
  git-start observation created only a claim, then failed before any Task command;
  intended Start ran once after verified creation, with retained claim history.
- Git v1 Task `931aa5ba-f844-4230-b350-c9aa53476c3c` had a model-transcribed Task ID
  typo in driver argv. Formal open remained correctly scoped; driver rejected path
  before writing private markers. Exact Stop/checkpoint/export and Cancel settled
  it, retaining all evidence. Independent cleanup checks passed. A fresh canonical
  v2 Task used fixed Task/resource commands and its own cwd-derived Attempt ID.
- v2 first Stop observation combined an older admitted-operation query with a later
  released-process query. Original `git-stopped.json` remains failed. Stable double
  reads and read-only `git-stopped-audit.json` proved exact checkpoint/export/physical
  facts without repeating Stop or changing product state.

The v2 directory imports four accepted Artifact/browser files using an explicit
origin/hash manifest; it does not repeat or replace v1 trials. Detailed evolving
notes are retained in [native progress](research/native-progress.md).

## Scope limits

One Node and one public repository per Task, text Artifacts and local pre-delivery
Cancel. Live private-App access, multiple repositories/Nodes, cross-Runner transfer,
Task Conversation/revisions, accepted delivery and remote publication remain later
roadmap work. Local tests cover additional races and failures; they do not assert
unperformed native scenarios such as a host reboot during this new recovery flow.
