# Reproducible Linux boundary trials

These scripts are an explicit test harness, not a product administration API.
Main-session host operations install/build the reviewed backend/Runner first.
Run only on the Owner-authorized Linux host with the staging checkout at
`/root/monos-boundary-probe-src`. They never reboot, publish Git, configure a
paid provider, or print bearer/config/environment contents.

`task_planning_probe.py` covers canonical initial Task planning after migration 17
is deployed. It uses the current Owner APIs and the real native Planner, without
the fixture Plan/Node admission helper. On the existing host, run the stages in
order using the same fresh private evidence directory:

```sh
python3 infra/probe/task_planning_probe.py --evidence /root/monos-planning-native-v1 --password-file /etc/monos-probe/owner-password create
python3 infra/probe/task_planning_probe.py --evidence /root/monos-planning-native-v1 --password-file /etc/monos-probe/owner-password start
python3 infra/probe/task_planning_probe.py --evidence /root/monos-planning-native-v1 --password-file /etc/monos-probe/owner-password issue
python3 infra/probe/task_planning_probe.py --evidence /root/monos-planning-native-v1 --password-file /etc/monos-probe/owner-password retry
python3 infra/probe/task_planning_probe.py --evidence /root/monos-planning-native-v1 --password-file /etc/monos-probe/owner-password plan
python3 infra/probe/task_planning_probe.py --evidence /root/monos-planning-native-v1 --password-file /etc/monos-probe/owner-password audit
```

Each stage preserves an exclusive claim and exact command before admission. A
timeout retains the source for inspection; repeating a stage or changing its
evidence directory is not recovery authority. The trial confirms an exact native
preview, proves zero execution before Start, then resolves a deliberately missing
Owner choice through issue + answer/Retry. Pass requires native journal/receipt
identity, one Start per Planner, physical Stop settlement, frozen Task-only
context and an exact one-Node Plan. Its final Node is PENDING, with no Node Attempt
or repository workspace. The next execution leaf must account for this retained
Task before enabling new scheduling. These commands do not restart services.

`probe.py` runs as root for private read-only evidence and explicitly targeted
service restarts. `driver.py` is installed root-owned under
`/var/lib/monos-probe/probe-tools`, then invoked by the **real OpenCode native
bash tool inside the `me` Attempt cgroup**. It invokes the bundled `monos`,
including formal lifecycle handoff; a prose response does not pass the trial.
The deterministic driver makes the sequence reproducible. This establishes
tool/transport compatibility, not autonomous semantic planning quality.

Before each real trial the harness rechecks the installed model catalog and
requires zero input/output/cache pricing for `opencode/longcat-2.5-preview-free`.
An unavailable/changed catalog fails; there is no paid fallback. It does not
install or log into any Runtime. Driver and root evidence files refuse overwrite,
so failures cannot disappear behind a rerun with the same trial ID.

Each start writes `prepared-<attempt>.json` before admission and
`started-<attempt>.json` after its acknowledgement, including source hashes.
If only the prepared file exists, admission is uncertain: inspect the canonical
Attempt before any recovery action. These files are evidence, not permission to
relaunch. Pair trials also retain `before-restart-<prefix>.json` and
`after-restart-<prefix>.json` before releasing the held drivers. A missing final
report never proves that a dispatched process stopped. The 240-second wait is a
polling deadline; bounded subprocess calls within a snapshot can extend it.
Timeout reports preserve live ownership; explicit authenticated revocation and
physical Stop verification are separate administrative recovery steps.

## Local harness checks

```sh
PYTHONDONTWRITEBYTECODE=1 python3 -m unittest discover -s infra/probe -p 'test_*.py' -v
```

These regressions check receipt/effect correlation, exact finalized-tree comparison,
required driver evidence, physical identity, reboot checkpoint comparisons and
zero-cost model validation. They perform no host operations.

## Ordered execution log trials

After the selected Runner and Compose server are installed, use fresh Attempt
IDs for each run. `logs_probe.py` seeds a selected Node or Planner owner, checks
the exact model's current zero prices, launches through the installed OpenCode
and `monos` CLI, restarts the task Compose backend, and resumes authenticated
Owner log pages from the last retained cursor. It compares the complete page
sequence with canonical storage and checks that raw output did not enter formal
Task Events. Its final evidence is `logs-final-<attempt>.json`.

```sh
python3 infra/probe/logs_probe.py --evidence /root/monos-logs-evidence --password-file /etc/monos-probe/owner-password --kind node logs-node-01
python3 infra/probe/logs_probe.py --evidence /root/monos-logs-evidence --password-file /etc/monos-probe/owner-password --kind planner logs-planner-01
python3 infra/probe/missing_outcome_probe.py --evidence /root/monos-logs-evidence logs-missing-01
```

The missing-result trial uses a selected Node that exits without
`complete_node` while detached descendants are still live. It requires
`BLOCKED`, revoked mutation authority and verified whole-tree Stop/release.
Neither script overwrites earlier evidence. A failed or interrupted trial may
still own processes; inspect and settle it before installing another Runner
binary or reusing the host.

## Shared-slot queue acceptance

`queue_probe.py` requires an idle, connected two-slot Runner and uses three fresh
Attempt IDs derived from a prefix. It holds a selected Node and Planner at their
native driver checkpoints, then admits another selected Planner through
`selected-attempt.ts` in the existing one-shot Compose tests container. Both
Planner fixtures are pre-Plan so the existing Owner Stop command can cancel
them even before Start. Each admission performs the inherited free-model
preflight; Runner also checks the exact catalog in its launch environment.

```sh
python3 infra/probe/queue_probe.py --evidence /root/monos-queue-evidence --password-file /etc/monos-probe/owner-password queue-01
```

The trial requires authenticated Owner status/list/log reads to show the third
Attempt as `QUEUED`, without a process, Start intent, log or inferred activity.
It restarts only the existing task Runner and Compose backend, preserving both
live process identities, dispatch selections and Start IDs. It releases the
Node through normal formal completion, checks capacity and predecessor release
in atomic database snapshots during promotion, verifies the Node's exact Git
result and absent descendants, and completes the remaining two Planners.
Resumed Owner log pages must equal canonical ordered history for every Attempt.

Every checkpoint is root-private and refuses overwrite. `queue-final-<prefix>.json`
records successful completion, one durable Start per selection, physical release
and settled operations. A failure retains `queue-failure-<prefix>.json`, prior
checkpoints and cleanup evidence. Cleanup first submits authenticated Owner Stop
for the last queued selection before freeing any occupied slot. If that action
is uncertain, cleanup retains the other claims for inspection; it never retries
admission, deletes evidence or treats missing records as absence. Inspect and
settle any unknown claim before another trial. Use a new prefix for each run.

Polling bounds are fixture observation limits. Atomic capacity samples and live
physical snapshots do not observe every instant; the concurrent promotion guard
is separately covered by PostgreSQL race tests. This trial adds no standing
service and does not replace controlled host-reboot evidence.

## Owner Stop and reboot recovery

`stop_probe.py` uses the selected native CLI fixture and authenticated Owner
commands. The Node trial holds a live execution through a task backend and
Runner service restart, checks its process identity and physical reservation,
then submits Stop. It checks same-request replay, changed-payload rejection,
whole-tree absence, released ownership and Continue of the same Node without
automatically admitting another Attempt. The Planner trial starts before an
initial Plan exists, stops its held execution and checks Retry restores planning
eligibility without manufacturing a Plan or successor Attempt. Each step writes
root-private evidence under the chosen directory and refuses overwrite.

```sh
python3 infra/probe/stop_probe.py --evidence /root/monos-stop-evidence --password-file /etc/monos-probe/owner-password --kind node stop-node-01
python3 infra/probe/stop_probe.py --evidence /root/monos-stop-evidence --password-file /etc/monos-probe/owner-password --kind planner stop-planner-01
```

For the separately authorized host reboot, first confirm that neither this
task nor unrelated services have unresolved work. Use a fresh selected Node ID
and preserve the `reboot-before` checkpoint. Reboot the host while the recorded
hold remains live, reconnect, then perform read-only verification. The verifier
requires a changed boot ID, unchanged original dispatch and receipts, absent
old writers, a BLOCKED interrupted Node, and physical release. These commands
do not initiate the reboot themselves.

```sh
python3 infra/probe/stop_probe.py --evidence /root/monos-stop-evidence --action reboot-hold reboot-stop-01
# Explicit host reboot by the authorized operator within the recorded hold.
python3 infra/probe/stop_probe.py --evidence /root/monos-stop-evidence --action reboot-verify reboot-stop-01
```

## Recommended sequence

First run native Linux `go test -race ./...` with CGO enabled and the isolated
PostgreSQL test suite from `infra/compose/README.md`. Then provision the Runner
config/token and the service-owned Git fixture after the reviewed
`infra/runner/bootstrap.sh` and `infra/compose/prepare.mjs` have completed:

```sh
cd /root/monos-boundary-probe-src
python3 infra/probe/provision.py
```

The default endpoint is `http://127.0.0.1:18443`; no certificate or OpenSSL is
required. For the optional TLS Compose recipe, use:

```sh
python3 infra/probe/provision.py --endpoint https://127.0.0.1:18443 --ca-file infra/compose/private/ca.crt
```

For system-trusted HTTPS, set `--endpoint` and omit `--ca-file`. A custom CA is
accepted only with HTTPS and extends normal certificate/hostname verification.
Recovery and Owner probes use the configured scheme; the Owner cookie jar handles
the HTTP `monos` cookie or HTTPS `__Host-monos` cookie. Probe Compose restarts add
`compose.tls.yaml` when the configured endpoint uses HTTPS. For manual Compose
commands in this guide, also add `-f infra/compose/compose.tls.yaml` in TLS mode.

Provisioning validates the bootstrap marker, identities and task-owned paths.
It privately copies the generated Runner credential to a service-owned `0600`
file, copies the public CA only when supplied, writes non-secret `runner-a` settings with the
actual `me` UID, and creates a one-commit local Git fixture **as the service
identity**. Enrollment uses capacity 2. Different existing files/repositories
are preserved and rejected; identical valid material is verified on rerun.
It performs no service start, CLI install/login, publication or recursive chown.

```sh
cd /root/monos-boundary-probe-src
python3 infra/probe/probe.py --evidence /root/monos-probe-evidence enroll
systemctl start monos-probe-runner.service
python3 infra/probe/probe.py --evidence /root/monos-probe-evidence profile
python3 infra/probe/probe.py --evidence /root/monos-probe-evidence trial node-01 --kind node
python3 infra/probe/probe.py --evidence /root/monos-probe-evidence trial planner-01 --kind planner
python3 infra/probe/probe.py --evidence /root/monos-probe-evidence permissions node-01
python3 infra/probe/probe.py --evidence /root/monos-probe-evidence restart-pair concurrent-01
python3 infra/probe/probe.py --evidence /root/monos-probe-evidence delayed-revoke never-started-01
# Run at least 65 seconds after terminal admission (the command enforces this):
python3 infra/probe/probe.py --evidence /root/monos-probe-evidence recover node-01 --require-expired
# No model call; requires all Attempts released and this handoff committed:
python3 infra/probe/probe.py --evidence /root/monos-probe-evidence idle-restart node-01
```

Every trial writes a 160,000-character formal payload. The driver retains that
complete envelope through the attributed socket, changes the input file,
requires changed-content reuse to conflict, then submits the retained original
using `retry --request-id probe-handoff`. The earlier workspace request also
replays its admitted result after an input-file change. These cover immutable
content replay; exact uncertain-admission crash windows use the separate fault
tests below.
Node trials perform a native Git commit through the isolated worktree/common
directory and start detached/double-fork descendants that ignore TERM. Formal
completion must stop these writers, finalize/export Git and release the backend
claim only after physical absence. The finalized tree must equal the native Git
commit tree recorded by the driver; nonempty object IDs alone do not pass. Planner trials inspect a service-owned
snapshot, verify shell writes/chmod/root-directory rename fail there and normal
writes succeed in scratch, then commit a
formal Planner reply. Both test rejected caller-supplied scope/PID/Attempt hints
after a successful request without hints. The denial must identify an unknown
field, rather than an unrelated missing request. Forged environment hints still
return the caller's own workspace; the pair trial uses its actual peer's ID.

The pair trial runs two same-UID Attempts concurrently using the same request ID
but separate authoritative scopes. It holds each at an explicit checkpoint,
restarts only `monos-probe-runner.service` and this Compose `server`, verifies
the original PID/birth identity survives, then releases both to complete. Process
identity evidence is read from live `/proc`, cross-checked against the journal,
and records boot/cgroup/UID as well as PID/birth. Early
normalized output is recorded separately from token streaming; OpenCode's JSON
interface does not establish token-by-token streaming.

`idle-restart` verifies an already committed handoff across Runner/backend
restarts without contacting the model. It refuses unresolved Attempts, saves a
checkpoint before restarting either service, then compares canonical receipts,
operations, retained requests, ownership, runtime events and recovery output.
It does not satisfy live concurrent restart or whole-host reboot acceptance.

The delayed-revoke scenario requires no existing unresolved Attempts. It stops
only the task Runner, creates and revokes a dispatch before delivery, restarts
that Runner and requires a successful Stop with a retained root/local revocation
tombstone, no Runtime start and no Attempt unit. It refuses to interrupt another
trial or clear an existing unknown claim. An already failed prepare intent can
only settle after formal revocation and the same helper proof that no launch,
job, cgroup or system-operation ownership exists; missing records alone do not
prove writer absence.

`pass` requires independent PostgreSQL receipts, retained Runner digests,
long-payload size, final Git evidence and process-absence records. Exit code 2
means an observed failed trial; exit code 1 means the harness itself could not
complete. Preserve all evidence and unresolved workspaces in either case.

## Evidence matrix and limits

The commands are recipes, **not recorded passing host results**. The final task
report must cite the actual output files from the authorized host.

| Acceptance area | Harness / test | Evidence kind and remaining limit |
| --- | --- | --- |
| AC1 HTTP/WS or HTTPS/WSS/schema/scope | Real trial receipts + Go/TS shared corpus + backend socket tests | Real host trial required; backend socket test uses fake control actor with real transport |
| AC2 installed CLI, help, long payload, Planner access | `trial node-01`, `trial planner-01` | Real OpenCode invokes deterministic native-bash driver; unexpected permission outcome fails |
| AC3 lazy workspace/common directory and snapshots | Node/Planner driver checks, finalized service export, `permissions node-01` | Real host cache/journal/credential denial and service result reads |
| AC4 same-UID caller attribution | `restart-pair`, forged fields, shared request ID, Linux SO_PEERCRED unit test | Real concurrent cgroups plus kernel test; deliberate PID reuse is a local deterministic test |
| AC5 whole-tree stop | Node detached/double-fork sentinels + actual cgroup absence | Covers these real descendants; no hostile containment or arbitrary user-manager escape claim |
| AC6 immutable retry / journal failure / uncertain admission | Real changed-file retry; SQLite forced-write-failure test; PostgreSQL admission fault tests | Journal failure and crash windows remain deterministic injected tests, not real disk exhaustion |
| AC7 duplicate/lost start ACK, reconnect/restart/reboot | Real `restart-pair`, `delayed-revoke`, `reboot-hold` / `reboot-verify`; backend lost-ACK tests; Go duplicate-start test | Exact lost-ACK window remains deterministic; whole-host reboot needs its agreed window and actual evidence |
| AC8 completion/expired credential recovery | Real Node completion + delayed `recover --require-expired`; backend expiry denial test | Real Runner recovery read occurs after all prior Attempt grants must expire; new Agent mutation denial is separately tested |
| AC9 report | `profile` + immutable trial evidence | Source fingerprint, versions, catalog pricing and failures preserved; complete report still required |
| AC10 later gates | Final report | Full multi-worker PostgreSQL claims and GitHub expected-head/check/merge remain separate |

## Checkpoint and recovery

```sh
python3 infra/probe/probe.py --evidence /root/monos-probe-evidence checkpoint node-01
python3 infra/probe/probe.py --evidence /root/monos-probe-evidence inspect node-01
```

These generic snapshots record facts but do not establish the reboot criterion.
Use a fresh trial ID for the explicit interrupted-work case below, **after the
Owner agrees to the reboot window**. All commands run from the staging root.

```sh
python3 infra/probe/probe.py --evidence /root/monos-probe-evidence reboot-hold reboot-01
```

Require exit 0, `outcome: ready`, and all checks true in
`reboot-before-reboot-01.json`. This durably records live PID/birth/boot/cgroup,
two active detached writers, the completed workspace receipt, and the retained
160,000-character handoff that has **not** been submitted to the backend. The
hold expires after 300 seconds; `state.driver.hold_expires_at` is the recorded
deadline. The command refuses readiness with less than 45 seconds remaining.
Perform the separately authorized host reboot within that window. The harness
never executes a reboot command or treats elapsed time as permission.

After SSH returns, check the task-owned services. Docker's `unless-stopped`
policy should recover the Compose services. If necessary, start only these
existing services, preserving their storage:

```sh
docker compose -f infra/compose/compose.yaml up -d database server
systemctl start monos-probe-runner.service
python3 infra/probe/probe.py --evidence /root/monos-probe-evidence reboot-verify reboot-01
```

`reboot-verify` only reads backend/journal/process state and writes a new private
evidence file. It allows up to 120 seconds for normal reconciliation. A pass
requires a changed boot ID, retained original dispatch/process identity,
physical writer absence, a succeeded Stop and released claim, the interrupted
Node/Task in `BLOCKED`, unchanged request digests/old receipts, and no replacement
Start. Scoped recovery must still return the existing workspace result while
the unsent handoff remains `unknown`. No request is replayed, no hold is released,
and no Runtime is launched by this command. The result is recorded in
`reboot-after-reboot-01.json`; missing evidence or unresolved ownership fails.

If the window is missed or any check fails, retain all evidence. Do not touch
`probe-release` to force completion or rerun the same ID. Resolve a retained live
claim through the existing local authenticated admin surface, then observe its
Stop rather than deleting any journal or worktree:

```sh
printf '%s\n' '{"action":"revoke","attempt_id":"reboot-01"}' |
  docker compose -f infra/compose/compose.yaml exec -T server \
    node --experimental-strip-types apps/server/src/admin.ts
python3 infra/probe/probe.py --evidence /root/monos-probe-evidence inspect reboot-01
```

Before updating a previously installed driver, settle any live trial and copy
the old root-owned driver to a new root-private evidence filename, recording its
SHA256. Then install the reviewed staged `infra/probe/driver.py` at the existing
root-owned `probe-tools/driver.py` path with mode 0644. `install_driver` rejects
different existing bytes deliberately; do not remove earlier trial evidence to
make an updated harness run. Earlier results stay tied to their original source
fingerprint and are not retroactively upgraded to the new assertions.
