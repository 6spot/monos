# Research: Existing execution evidence and next native integration trial

- Query: Locate authoritative installed baseline and reusable acceptance evidence; identify the missing final Owner-originated capture→preview→Task→Start→Plan→Node→local REVIEW proof and the smallest safe integration plan.
- Scope: internal repository and retained local evidence/scripts only; no host connection, mutation, deployment, test process or model call
- Date: 2026-10-02
- Task: `.trellis/tasks/09-30-a-task-execution-acceptance`

## Findings

### Conclusion and exact gap

The package already has accepted native canonical Task creation/planning, real repository Node execution/Stop/Continue/hard-completion recovery, Task Conversation/guidance, sufficient Specification changes, one-Node standalone/joint Replan, independent exits and restart evidence. Do not rerun the entire historical fault matrix.

The missing proof is **one fresh Owner-configured real-repository chain on the final combined installed build, through the finished browser surfaces**, with exact command/source/result provenance and inspected desktop/mobile screenshots. Execution UI and the ongoing existing-screen migration have only browser fixture Runtime/effect acknowledgements, not a deployment/native model trial. Prior Node native v2 did traverse Discussion→preview→Task→Start→Plan→Git REVIEW, but used a deterministic native driver and older product/UI. It must not be described as a missing historical chain or as proof of the final UI/no-driver semantic implementation path.

For a clean no-fixture integration claim, use normal authenticated Owner configuration/capture/Discussion/preview/Start and the actual installed Planner/Node `monos` tools. Do not use `__test__` endpoints, selected-attempt helpers, SQL inserts of Plans/Nodes/sources, fake effect acknowledgements, prewritten output/driver instructions masquerading as Agent implementation, or fixture repository fallback. Read-only root/SQL/SQLite/Git observers remain appropriate and necessary.

### Sources read

- Current task PRD; parent `.trellis/tasks/09-28-a-task-execution/{prd.md,research/decomposition.md}`. Parent research explicitly assigns this final leaf native combined proof and keeps delivery separate.
- Accepted `verification.md` for archived `09-30-a-serial-workspaces`, `09-30-a-task-start-planning`, `09-30-a-node-execution`, `09-30-a-task-conversation`, `09-30-a-specification-changes`, `09-30-a-single-node-replan`, `09-30-a-execution-ui`; Replan independent `research/acceptance-review.md`.
- Earlier Runtime/capture package verification for `09-29-a-runtime-stop-recovery`, `09-29-a-runtime-integration-acceptance`, `09-29-a-capture-discussion-acceptance`.
- Current migration `verification.md` is **in progress** at inspection: Web presentation only, build `index-DVkmoQ-z.js` / `index-CIqFVtS4.css`, full50-case browser run and final visual acceptance pending. Do not freeze these transient asset names as the future native candidate.
- `infra/probe/README.md`, `probe.py`, `logs_probe.py`, `discussion_probe.py`, `task_preview_probe.py`, `task_planning_probe.py`, `node_execution_probe.py`, `workspace_probe.py`, `task_conversation_probe.py`, `task_specification_probe.py`, `task_replan_probe.py`; retained `/tmp/monos-replan-runtime-install-v4.py`, its audit/build scripts and `/tmp/monos_replan_audit_common_v3.py`.
- Architecture/frontend invariants from current session: Tool Protocol owns transitions, Owner confirmation is exact, physical release differs from logical terminal state, REVIEW is local inspection rather than delivery; frontend visual/quality and state/session contracts apply.

### Last verified installation: historical evidence, not a fresh host assertion

| Item | Authoritative retained baseline |
| --- | --- |
| Host | Owner-authorized Debian `100.120.14.84`; authentication supplied to root separately, never record secrets in task artifacts |
| Installed source | `/root/monos-boundary-probe-src` |
| Compose project/container | `monos-boundary-probe`; `monos-boundary-probe-server-1`, existing database service |
| monos endpoint | HTTPS on host loopback `127.0.0.1:18444`; actual URL and CA are read privately from `/etc/monos-probe/runner.json` by `LogsProbe.login` |
| Port override | **Every Compose up uses** `-f /root/monos-boundary-probe-src/infra/compose/compose.yaml -f /root/monos-boundary-probe-ports.yaml`; base YAML publishes18443, which would collide with preserved monolab |
| Runner | Existing `monos-probe-runner.service`; service account `monos-probe`, execution account `me`; observed capacity2, but recheck current identity/config before use |
| Private paths | `/etc/monos-probe/runner.json`, `/etc/monos-probe/owner-password`; Runner journal location comes from config; state root `/var/lib/monos-probe` |
| Binaries | `/usr/local/bin/monos`; `/usr/local/libexec/monos-runner`, `monos-probe-launch`, `monos-probe-exec` |
| Last installed release evidence | `/root/monos-replan-runtime-deploy-v4/installed.json`, verified final343-file source/migration21; matching tar/manifest `/root/monos-replan-source-v4.tar`, `/root/monos-replan-manifest-v4.json` |
| Build source/evidence | `/root/monos-replan-build-src-v4`, `/root/monos-replan-runtime-deploy-v4/build/`; old v3 server/tests images were reused only after exact Docker COPY-input equality |
| Unrelated installation | `monolab-boundary-probe-server-1` and monolab18443; preserve container/image/mount/port/service identity and all unrelated work |

Final Replan archive SHA256 `89cf028d514b3b3bd080068db1cdcef9d7962b78f5a0db6941ae9c7a8c95ca1c`; manifest SHA256 `e125d117b5b337cc15f6889c23c5fa2beba2356956dd481b6f17ca58f2e669aa`. Installed binary hashes:

| Binary | SHA256 |
| --- | --- |
| monos | `8586c8fedb9c1b4634a1ecd8a9882b0e1d257c1267077bb5559ff43f7e37a4b3` |
| monos-runner | `bc0239303d4f599c36f3d7bd471a8572028ebe0f9aaa40486a17aa93a4b4b604` |
| monos-probe-launch | `8ccda249ce49f52d196085dccab5934b5d8c160dc7bd5e1236ccf47d540be582` |
| monos-probe-exec | `d4d5e8aaaae04b972a42810a68a6030818ae3340789ba2118cfbf8ea57edbbca` |

Root's previous SSH master/tunnels are ephemeral transport, not installation facts. Recheck available transport; do not claim it is live from old paths. Browser can reach the existing TLS server through an explicitly scoped temporary SSH forward, with its CA/certificate expectations preserved; no dev server or permanent ingress is necessary.

Execution UI feature `d28fd8b` and test-only narrowing correction `333c9e3` are accepted locally. UI verification explicitly says **no production deployment**. Current migration also states no backend change. Therefore the final native candidate must include current UI/narrow reads/session binding and its generated consumers, not merely copy old v4 assets or claim old binary tests match new generated schema.

### Accepted evidence inventory to reuse

| Capability | Evidence / source anchors | Scope and retained limitations |
| --- | --- | --- |
| Passive capture, ordered Discussion, exact preview/two-client Task creation | Archived capture/discussion acceptance `verification.md`; `/root/monos-capture-discussion-acceptance-v2`, source directories `/root/monos-todo-capture-evidence-v1`, `/root/monos-todo-discussion-evidence-v1`, `/root/monos-task-preview-evidence-v1` | Real native replies and exact PLANNING Task; earlier scenarios began unassigned, so new assigned Project-origin native path should be explicit |
| Source-only initial planning, issue/answer/Retry | `/root/monos-planning-native-v1`; archived Planning verification | Task `e14ad4bb-4688-4647-981c-70911889e17b`, real exact preview, zero work before Start, one native issue then one complete Plan, no workspace; first scope ended before Node execution |
| Repository-free completion and selected Artifact | `/root/monos-node-native-v1`; archived Node verification/research browser checks | Carryover Task above, real HTML Artifact/read-back, exact selected bytes and no fabricated Git/workspace; do not rerun merely to obtain final UI screenshots |
| Canonical real Git loop, Stop/private work, hard correction | `/root/monos-node-native-v2`; Node verification | Task `70810e87-c861-4257-a9c3-ad346abb342c`, three same-activation native Node Attempts, explicit Stop/Continue, invalid-finalization correction, preserved tracked/staged/unstaged/untracked/ignored files, exact final Git/export, REVIEW; deterministic driver/native shell compatibility, not autonomous coding quality |
| Stable serial workspace, two identities, scoped cache/credential boundary | Archived workspace verification; `/root/monos-workspaces-build-v4` and referenced native evidence | Public GitHub repository; no live private-App token claim; initial selected admission is explicitly fixture based; reuse physical/permission proof, not as final Owner-chain source |
| Ordered Task input, guidance, no implicit resume, terminal exits | `/root/monos-conversation-native-v1`; archived Conversation verification | Task `6462642a-b5f0-4590-a372-43b386ff2966`, actual busy-input ordering and Task-only prompts, controlled Stop/private work and two handled guidance IDs; later terminal conversation settled; retained failed driver invocation before successful continuation |
| Exact sufficient requirements pre-Start/edit, settled revision, carry | `/root/monos-specification-native-v1`; archived Spec verification and independent review | Task `89effbce-76d8-40c6-8702-70d856c369ba` remains REVIEW; exact proposal+Owner authorization+publication, retained Plan/activation/Stop, explicit Continue, exact completion and carry applicability; restart late-log deltas separately justified |
| Node/Conversation Replan, joint/standalone publication, both inheritance paths, expiry/independent exits | `/root/monos-replan-native-v1`; archived Replan verification + independent review | Task `dd67088b-1886-4d2c-b402-62c242f9f07b` remains REVIEW; exact own new completions, expired-proposal Retry, native issue dismissal and requirements-withdraw/graph-dismiss; issue-answer and COMMIT races remain PG/process coverage |
| Shared capacity, no premature Start, live service reconnect | `/root/monos-integration-evidence-v1/queue-final-integration-queue-20260929-01.json` and checkpoint set | Native selected Node/Planner hold+queued third; retained live identities through backend/Runner restart, exactly one Start and verified promotion; explicit selected fixture, historical source |
| Ordered logs, missing formal outcome, descendants | Runtime integration `logs-final-*` and `missing-final-integration-missing-20260929-01.json` | Real CLI/process/record proof; log text never lifecycle authority |
| Earlier controlled host reboot/scoped recovery | `/root/monos-stop-evidence-v1/reboot-after-reboot-stop-20260929-a1.json` plus before/issued/preflight; Stop verification | Changed boot, retained original dispatch, old writers absent, no replacement Start; old Runner units were disabled and manually started after reboot. Reuse with this limit; do not repeat host reboot or claim auto-boot readiness |
| Concurrent command/crash/SQL attribution boundaries | Planning32, Node full214, Conversation suites, Spec independent8-process and final PG, Replan independent18/18/full328/328 plus affected17/17 | Actual PostgreSQL PIDs, observed lock waits, SIGKILL before/after COMMIT establish atomicity. Synthetic process/effect fixtures are not native writer-absence evidence; reuse at recorded revision and rerun only changed affected contracts |
| Final UI recovery and controls | Archived Execution UI verification:46-case full run +4 final focused;47 final inventory; current migration complete suite pending | Real backend/DB commands and generated reads; synthetic Runtime/effect/Git scenario data. Exact lost approval/publication reload recovery, two clients, pagination, queue/disabled/errors; no native claim |

Strongest final Replan evidence is already independently accepted:

- `replan-native-supplement-v4.json`:69/69, SHA256 `86eb0562119fcd2df813695fe6595c87a1c8b26eb7194f031498eabd52d64a59`.
- `restart-v13-backend-observe.json`:132/132, SHA256 `3b6800f35f7c1683e60465ab8186eb0678c6b95697b4057da962f5770da5a769`.
- `restart-v13-runner.json`:136/136, SHA256 `263268a50423c9ca20a158a64c7fe6b798d44a3a5489684cbacbc51f12c9b8d0`.
- Independent final144/144 report SHA256 `92b3607098da38083d3db300ab13eaaeecfa3867bbb9713c8edae852baf40b03` (retained local `/tmp/monos-replan-final-audits-review-v1/independent-v13-final-v1.json`).

That final gate restarted existing backend **once**, then Runner **once**, at idle. Eight late `exited` events appended253 versus245 raw rows; original rows remained byte-exact and only corresponding `activity_at/exit_observed/log_visible_sequence` projections changed. Old v7/v8/v11 failed observers remain retained; final v13 distinguishes current heartbeat freshness from historical identity. Reuse these lessons in any new observer rather than ignoring arbitrary changing fields.

### Model availability and zero-price gate

Historical known target is `opencode/longcat-2.5-preview-free`; historical OpenCode version1.18.30 is **not** a current availability assertion. `infra/probe/probe.py:137–161` runs, in the execution user's actual home/environment:

```sh
runuser -u me -- /home/linuxbrew/.linuxbrew/bin/opencode models opencode --pure --refresh --verbose
```

The existing `Probe.catalog()` strips ANSI, finds the exact model entry, requires matching ID, `status=active`, native `capabilities.toolcall=true`, and numeric zero input/output/cache read/cache write prices (reject missing/bool/nonzero values). It saves a bounded nonsecret catalog result. Runner independently performs its own exact-environment launch preflight. Reuse these checks before each admitted native scenario and record version/time/hash; do not blindly reuse old catalog JSON.

If unavailable or no longer explicitly free, stop model-dependent admission, preserve drafts/current requests and inspect available zero-priced supported alternatives before an explicit normal configuration decision. Never silently fall back to a paid model, install/login a runtime, weaken price parsing, or treat elapsed time as a failed model result. This researcher has performed **no** current catalog check.

### Smallest concrete integration plan

1. **Finish predecessor gate, then freeze one candidate.** Archive/record migration after its full browser/visual result. Record exact candidate commit/source manifest, generated protocol/Web asset hashes and current tests. Compare candidate against installed343-file v4 to identify actual server/protocol/Runner/Web changes. Build changed artifacts and compile all generated consumers from this candidate. Existing domain fault tests stay reused; targeted affected reads/session plus required quality checks cover the delta.
2. **Read-only fresh host preflight and backed-up additive install.** Snapshot current monos/monolab container identities/ports, Runner invocation/registration/ready/heartbeat, source/binary/image hashes, canonical receipt fingerprints, outstanding ownership and preserved Tasks. Preserve fresh DB dump and consistent SQLite backup plus binaries/config/unit/port override with private0600 modes. Prepare exact scoped installer and rollback inputs before changing existing services. Use prior install scripts as patterns, not executable reusable installers (they contain one-time claims/hardcoded old hashes/tasks). Never run Compose down or remove volumes. Only replace existing monos backend/Runner if required by candidate.
3. **Fresh trial identity and Owner configuration.** Create one unique private evidence directory (suggestion `/root/monos-task-execution-acceptance-v1`) and exclusive stage claims. Configure fresh Project/resource/Role via real Owner commands. Reuse the authorized public repository `https://github.com/6spot/monolab-feasibility-20260928-160020-public.git` as a new Project resource, `remote_preparation:'after_acceptance'`; record its actual remote/default/base facts. Historical base `9ac3353e97ed6a0cb96a80bb8e136d44cac982e4` is useful comparison, not a current HEAD assumption. Use a scoped Role execution policy/current Planner policy matching freshly verified free target; do not mutate unrelated Roles/Projects or global policy unnecessarily.
4. **Real browser capture and Discussion.** Use finished Login/Projects/Todo UI or exact UI-produced authenticated requests, preserving full noncredential request bytes and receipts. Capture assigned to the fresh Project, then read/open it: assert no Discussion/Task/Planner effects. Submit a concise bounded real repository task (e.g. one small documented feature/update with clear verifiable output) with no harness driver instruction. Require actual native Discussion `commit_*` reply/preview and release; preserve any failed/malformed outcome honestly and use only supported exact Retry/Withdraw if needed.
5. **Exact preview and pre-Start checkpoint.** Show and independently retain full title/Specification/Project/digest. Confirm and create through normal UI. Bind native source message→preview→authorization→creation receipt→one Task/initial Spec. Before Start snapshot proves no Task Plan/Node/planning source/Attempt/workspace/lease. Capture desktop/mobile preview and Ready-to-start states with route/Task identity/build.
6. **Start→Plan→Node via production scheduling.** Save exact Start request/control/Spec basis before send; recover by scoped receipt after uncertainty. Observe actual source/prompt/context digest, Planner native `publish_execution_plan`, one complete Node definition/Role membership and no writable planning workspace. A genuine missing Owner choice is answered through existing issue/Retry, not fixture SQL. Let production scheduler launch the Node; record one Start per selected Attempt and the authorized resource descriptor, fixed base/target and actual `open_workspace` through native CLI. No cache `fixture.git` fallback or copied Task resource binding.
7. **Small live semantic/exit supplement only where it adds final-build value.** Read current progress through ordinary Task Conversation and verify recorded reply/source scope without changing execution. If the chosen work is long enough, one explicit Stop/Continue may demonstrate new UI controls and retained private work; do not force a timing race into a short task or recreate every destructive recovery scenario. Reuse accepted native guidance/Spec/Replan/hard-correction exits and current browser exact-action evidence with clear source mapping. If a required gap remains after mapping, add a separately named, bounded task-owned scenario rather than silently altering the successful chain.
8. **Exact local REVIEW and result inspection.** Require native `complete_node`, immutable manifest/summary/selected Artifacts, trusted Git finalization/export, applicable current Spec/Plan/Node/activation and physical release. Independently read real Git commit/tree/files and verify requested result (tests/review as appropriate). Compare browser Overview/result/diagnostics against these exact identifiers; repository-free path must not fabricate Git. Capture actual build at1440×1000 and390×844 for Todo/preview/Task Conversation/Overview/Timeline/Execution Details/local REVIEW. No PR, push, merge or Owner acceptance claim.
9. **Continuity and final audit.** Reconnect browser/reload and recover an intentionally lost response only if needed to bind final installed UI; the complete synthetic fault suite already exists. A single task-owned idle backend and Runner restart can be added for the new result if required by final candidate delta; do not repeat old restarts as a ritual or reboot host. Preserve exact before/intents/after and compare canonical records, receipts, real Git, process identity and allowed raw-event appends. End with no newly unresolved owned input/source/effect/lease/outbox and unchanged preserved historical Tasks/monolab. Keep successful REVIEW result for handoff.

### Reusable commands/scripts and traps

- `TaskPreviewProbe.task_command`, `DiscussionProbe.execute/submit`, `WorkspaceProbe.exact_post`, `NodeExecutionProbe.exact_node_control` demonstrate retain-before-send/exact receipt recovery. Current browser Task commands additionally bind `X-Monos-Session`; use finished browser adapter to prove that path, not an older probe alone. Server header is optional for old nonbrowser harnesses, so old harness success does not establish new browser session fencing.
- `TaskPlanningProbe.records/phase_checks`, `NodeExecutionProbe.records`, `TaskConversationProbe.records`, `TaskSpecificationProbe.records`, `TaskReplanProbe` provide read-only canonical table/journal checks. Prefer a single statement snapshot for correlated checks; sequential queries can observe valid settlement at different moments and produce false failures.
- `NodeExecutionProbe.create_git/start_git` (`node_execution_probe.py:421–490`) proves normal Owner lineage but binds deterministic `driver_instructions`; copy the **command/provenance pattern**, not its old task/Role/specification/driver content for the new no-fixture scenario.
- `WorkspaceProbe.start_workspace` and `selected-attempt.ts` are explicit test admission helpers and must **not** create the new acceptance Task/Plan/Node/Attempt. Likewise browser `__test__/execution-*` routes are fixture-only and absent from production.
- `Probe.catalog`, `Probe.save` exclusive0600 evidence/fsync, `WorkspaceProbe.runner_identity/git_object`, `settled_checks`, `native_requests_bound` and final v13 late-exit/never-started predicates are reusable observer ideas. Existing high-level stage methods may mutate/restart/admit; inspect each before invoking.
- `/tmp/monos-replan-runtime-install-v4.py` shows exact backed-up copy/bootstrap/Compose steps with required port override. `/tmp/monos-replan-native-restart-v13.py` and common_v3 show last accepted historical/current comparison. These are retained one-time evidence scripts, **not commands to rerun** against their old directories.
- Existing full tests reference root `pnpm` checks, Linux `go mod verify`, `go test -race ./...`, `go vet ./...`, four binary build, and isolated PostgreSQL schemas/one-shot test image. Reuse existing cache/database/container network; no new permanent database/Runner service.

### Cleanup and ownership requirements

Track an explicit ledger: trial prefix, fresh Project/Role/resource/Todo/Task, every input/source/proposal/authorization/Attempt/operation/workspace/lease, unique evidence paths, temporary SSH forward PID/socket, build container/image ownership and any one-time helper root path. Immutable evidence/receipts/history/workspaces are intentionally retained, not “cleaned” by deletion.

- Failed/timeout observation is not a failed Runtime or absence proof. Inspect same IDs first; use exact scoped receipt reads, then supported Owner Stop/Retry/Withdraw/Cancel only. Never create another Task/Attempt to hide uncertain work.
- Settle owned queued inputs before freeing a shared capacity hold that could promote them unexpectedly. After Stop require process-tree absence, successful/cancelled effects, released leases/claims and no pending owned outbox; `state=FAILED/CANCELLED` alone is insufficient.
- Process proof binds PID+birth+boot+cgroup/dispatch and detached children. Never-started cancellation instead needs exact source/cancellation chain plus zero Start/journal/unit/spool evidence; do not require a nonexistent launched-process identity.
- Global audit should separately count writable/unreleased/nonabsent/queued Attempts, unresolved operations/leases/outbox, Discussion controls/sources, initial/Node/Conversation sources, pending/failed inputs, guidance/followups, settling requirements/publication slots, unresolved Replan requests/sources/holds and **canonically runnable** Nodes. Use common_v3 predicates as baseline; do not equate every historical PENDING label with runnable work.
- Preserve three legacy nonrunnable `task_stopn-20260929-a1/a2/a3` records exactly; they lack canonical scheduling authority. Preserve accepted Spec Task `89effbce-76d8-40c6-8702-70d856c369ba` and Replan Task `dd67088b-1886-4d2c-b402-62c242f9f07b`, both REVIEW, all result/evidence/receipt lineage. Do not use them as new trial targets.
- Preserve monolab18443 and its container/service identities. Do not `pkill`, broad reset-failed, chmod/chown recursively, erase raw journal rows or delete arbitrary schemas/workspaces. If a released historical failed unit marker blocks bootstrap, record exact identity/PID/cgroup/DB release and scope any metadata-only reset to proven units; retain the failed preflight.
- Browser/PostgreSQL test schemas must be dropped only by the owning run's fixture shutdown (SIGTERM), with before/after ownership recorded. Do not clean prefix matches globally. Temporary transport/process cleanup targets only the recorded IDs and leaves current permanent services running.

## Caveats / Not Found

- This report did not access the host or run a catalog/test/model/deployment command. All service/version/idle facts above are the latest **retained** accepted evidence; new preflight is required before action.
- Current migration is not yet accepted at research time. Candidate source/assets/check totals must come from its final report, not this in-progress snapshot.
- Live private GitHub App access is not established by public-repository trials. The required Project resource path can use the authorized public repository; do not imply private credential acceptance.
- Old native controlled tests used deterministic drivers; the new ordinary Owner request should make any remaining semantic prompting/intervention visible. Replan's retained31999-token Runtime failures, same-input retries with explicit Owner Project clarification, expiry rejection and one external Host cleanup must remain disclosed rather than reclassified as unchanged-context autonomous success.
- Final package acceptance may combine revision-specific native fault evidence with final-build targeted tests. It must state that old reboot/live hold proofs are historical and new Replan restart is idle, not claim an unperformed full final-build reboot or every native race.
- Delivery/publication/PR/Owner final acceptance and full Stage A/V1 release remain separate roadmap gates. Passing local REVIEW and this package does not close them.

## External references

No external lookup was performed. The existing authorized public Git remote is recorded above; verify live availability/base when admitted. Repository specs, accepted immutable manifests and native raw evidence are authoritative; model catalog is time-sensitive and must be rechecked through the installed Runtime.
