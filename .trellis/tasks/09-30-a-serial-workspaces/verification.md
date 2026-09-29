# Serial workspace verification

Status: **passed**, including both native trials and final independent review.
The first Stop/export failure is preserved, both product gaps were fixed, and the
same operation recovered without changing root records. The explicit continuation
passed fresh-Attempt reuse and completion. The original live-restart stage was
not repeated; the later Runner replacement was a recorded repair deployment.

## Completed automated gates

- Local TypeScript: 182 passed; Python: 129 passed (39 workspace/cancellation).
- Protocol generation freshness, lint, typecheck and native Node imports passed.
- Root build passed; existing Vite chunk-size advisory only.
- Full real PostgreSQL: 151 passed in 16 files, including 12 workspace cases.
  Five contention cases observe actual lock waits using independent connections.
- Local and Linux Go race/vet passed; Linux verified dependencies and built all
  four executable targets. Explicit probe TypeScript checks also passed.

Host build evidence: `/root/monos-workspaces-build-v4/` (backend images and full
PostgreSQL suite), `/root/monos-workspaces-build-v3/` (Linux Go verification).
The retained v2 Go build failure was a dependency-proxy timeout; v3 used exact
locally verified module archives without dependency/version changes.

## Deployment

Existing installation only, on `100.120.14.84`. Source snapshot v4 has 245 files:
`/root/monos-workspaces-source-v4.tar`, SHA256
`c9d09dce65c7656bc2051cc14293b671220a4c00aa4ee7f1cf37bb8f9e4d9020`.
Runner source snapshot v2 has 80 files, SHA256
`45fdc2c8a627cc5552eb90352a360d1fd7ad92427dd98f829529f70891e4fbe4`.

`/root/monos-workspaces-deploy-v1/` retains a root-private PostgreSQL custom-format
backup, old binaries, before/after identities and immutable receipt digests.
Pre-deployment pending/unreleased/writable counts were all zero. Six old failed
transient units had MainPID 0 and empty/absent cgroups; their identities were
saved before clearing only their failed-unit registrations for bootstrap.

The repository Compose default uses port 18443. A deployment-only file,
`/root/monos-boundary-probe-ports.yaml`, replaces the server port binding with
`127.0.0.1:18444:18443`; use both Compose files for every subsequent `up`.
The independent monolab container on 18443 retained its exact container/image ID.

Bootstrap preflight/install and updating the existing backend passed. Post-deploy
checks confirmed migration 16, HTTPS Owner login, fresh ready Runner registration,
global idle, four installed binary hashes, and unchanged command/Owner/configuration/
authorization receipt counts and hashes. No new permanent service was introduced.

## Native trial v1

Evidence: `/root/monos-workspace-native-v1/`.

- Task `ws-native-v1-task`, first Attempt `ws-native-v1-first`.
- Real public GitHub repository ID `1393178791`, base
  `9ac3353e97ed6a0cb96a80bb8e136d44cac982e4` independently verified.
- `first-open.json`: all six top-level checks pass, including native driver,
  cache isolation, exact receipt provenance, and two live detached descendants.
- `runner-restarted.json`: all three checks pass, preserving original process,
  child identities and open result across the one retained restart.
- Stop `540d85fa-f866-4bcc-b44f-ba63eae4753a` entered recovery. The retained
  snapshot shows empty cgroup and both descendants absent, but lease release and
  export/acknowledgement are incomplete. Root-side Stop already recorded
  `writer_absent=true` and the checkpoint commit/tree exactly match the driver.
  The Runner owner localized failure to service-side checkpoint fetch: the bare
  destination exists, but has no result ref or checkpoint object. Preserve and
  retry this same Stop rather than generating a replacement checkpoint.

This trial uses a test-only Plan/Node
admission seam; it does not claim the next product Start/planning leaf or live
private GitHub App access.

## Native failure follow-up

The cross-account Git 2.47.3 reproduction showed that `upload-pack` rejects the
worktree-directory source, while its exact `common/worktrees/worktree` entry
returns the original checkpoint using the same narrow protected trust config.
The export source fix and real-Git partial-export regression passed independent
review, local race/vet/lint/typecheck and Linux race/vet/build. Intermediate build
evidence is `/root/monos-workspaces-build-v5/`, Runner source v3 SHA256
`b26fede40f8ca78722bfe717dfdec328e3daaf9e2a3894a6fda48fe20b454ebc`.
This build has **not** been installed.

Recovery inspection also identified the missing reconnect retry edge documented
in design.md. Both fixes passed independent review and the final Linux gates;
no fixture state reset was used.

The explicit `--resume-after-stop` harness is ready. It requires the already
succeeded/released original Stop and validates retained native proof, exact Owner
receipt/envelope, dispatch/lease/workspace lineage, physical absence and absence
of any attempted future stage before taking an exclusive continuation intent.
It shares subsequent steps with the original trial, without restarting, recreating
the Task or resubmitting Stop. All 136 Python tests pass. Harness v2 archive SHA256:
`aaf92a52a46c73e31c776a0262b87f66d6a5e5a1d50c60bcc934e44b00051f24`.

## Final repair and completed workspace trial

- Complete source v5: 248 files, archive SHA256
  `2a54b7bd925a8c8a5517250a9f984d7fbbdf0e2aa9e682ad69e002f7d1dad4fa`;
  staged paths all verified against `/root/monos-workspaces-manifest-v5.json`.
- Runner source v4: 83 files, archive SHA256
  `e4edaf25e5380e1f5ef1b9835619a1510999e06d753db08b5d9596aa01ceef68`.
- `/root/monos-workspaces-build-v6/`: dependency verification, full Linux Go
  race/vet and four executable builds all passed. The existing backend image and
  migration 16 were retained during this Runner-only repair.
- `/root/monos-workspaces-repair-v1/`: before/after state, DB/journal backup,
  original root-record hashes and verified empty transient-unit evidence.
  Post-repair all 10 checks pass: same Stop/checkpoint, all root records unchanged,
  exact native receipts, original main/child absence, one Start, fresh ready
  Runner and global idle. Recovery used the new connection's original Operation
  result path; no admin fixture/SQL transition or replacement Stop was used.
- `/root/monos-workspace-native-v1/resume-after-stop-intent.json` binds all old
  evidence hashes and both harness versions. `resumed-stopped.json` passes the
  original Stop checks; the earlier recovery snapshot remains present.
- `final.json`: all nine checks pass. Task is REVIEW with no legacy resource
  binding; one stable workspace, one formal completion and both leases released.
  Changed Project defaults did not change the established base/target or reset
  private HEAD, staged/unstaged/untracked/ignored data. Dedicated Project archived;
  `final-idle.json` passes.

Completion operation `660f0d9a-b17b-4b6c-9090-c0766a132714`, second Attempt
`ws-native-v1-second`, finalized commit
`44393a6d649619b7779586171393ceb310de6e1f`, exact tree
`946bdab3247e0178c099cf77dbacb1cd0de54afb`. The base remains
`9ac3353e97ed6a0cb96a80bb8e136d44cac982e4`, target branch `main`.

## Unexposed-open cancellation

`/root/monos-workspace-cancel-native-v1/` passes initial-idle, unavailable-open,
final exact-cancellation and final-idle gates. Task `ws-cancel-v1-task`, Attempt
`ws-cancel-v1-node`: unavailable initial ref leaves a retained recoverable open;
Owner Stop then cancels only open `4b535481-3e64-4092-b2e5-44f0a4400229`, with
`cancelled_by_operation_id=50c89726-1771-4e20-85e0-edbe17405954`. That same Stop
succeeds with writer absence. No workspace was granted, the scoped command receipt
is an error, all leases/processes settle, and the dedicated Project is archived.
All eight global pending/ownership counts are zero after the trial.

## Final independent review and limits

The independent reviewer verified archive members and all 248 staged/local source
hashes, 83 Runner-source members, installed binaries, 12 retained pre-continuation
evidence hashes, raw journal/DB command bytes and six terminal effect results.
All three native Attempts have one Start and zero legacy provenance; original
Owner Stop bindings, service-owned Git exports, current physical process absence,
archived Projects and global idle all pass. See `research/check.md`.

`final-environment.json` also confirms the earlier public Task
`0c24174a-6910-4810-b4b6-14f68d202f0b` remains PLANNING with one Specification and
zero Plans/Nodes/Attempts. The backend was not restarted for the repair, the
independent installation remained unchanged, and port 18444 was preserved.

Acceptance is for the public GitHub resource and existing two-account Linux
installation. Private App scope/expiry/denial has deterministic tests, not live
private-repository evidence. The native Plan/Node admission seam is test-only;
product Start/planning, Node scheduling and delivery remain the following leaves.
These records prove the observed trials, not adversarial per-Attempt filesystem
sandboxing or every possible filesystem/power-loss failure.
