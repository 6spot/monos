# Initial Task planning verification

Status: accepted within this leaf’s scope. Implementation, deterministic gates,
deployment, native trial and independent final evidence audit all passed.
See `research/check.md`; Node execution and delivery remain later work.

## Scope

Explicit authenticated Start creates an immutable Task-only initial-planning
source. The endpoint is one PENDING Node in an immutable Plan, or an issue with
exact Owner answer/Retry, Stop and pre-Plan Cancel exits. No production Node
execution is included.

## Executed checks so far

- Runner worker: full Go race/vet, gofmt, root lint/typecheck and diff check passed
  after initial-planning CLI/authority and narrow Stop reconnect recovery.
- Independent reviewer: 25 strict protocol cases and focused daemon race tests
  passed; static/data-flow review reports no remaining known product defects.
- Root: complete Python suite passed at 142 cases (including six initial-planning
  evidence tests); final TS suite passed 217 cases. Protocol freshness, production
  build and native Node imports of the app/planning modules passed.
- Backend: final Linux PostgreSQL entrypoint passed 183 cases in 17 files,
  including 32 initial-planning cases, global Plan/Node identity collisions and
  stale-scheduler-replay regression. Fresh migrations and populated version-16
  upgrade are covered. Full Linux Go race/vet and four-binary build also passed.

## Corrected findings

- Repository-free initial Planner Stop could remain in recovery after a temporary
  host error, indefinitely retaining the claim even after process absence. The
  existing finite reconnect batch now handles the exact source-bound original
  Stop; successful results replay without Host effects. No periodic retry or
  backend state reset was introduced.
- Initial-planning fixed context used CLI syntax that the bundled CLI did not
  support. Review required actual `--input FILE` and `command-status` syntax.
- Native evidence now cross-checks canonical context bytes, queued prompt,
  digest, scoped read projections and retained issue/answer lineage.
- QUEUED Attempts are physically released before first launch. Native polling
  now waits for terminal state plus release before claiming an outcome.
- Global Plan/Node ID collisions now return a correctable `payload_conflict`
  from the public planning boundary instead of an uncertain server error.
- Initial source snapshot v1 captured an intermediate shared fixture using a
  scalar root, while Go wire validation accepts transport objects. Its Linux
  test/build stopped at that fixture and no binaries were installed. Final v2
  replaces the fixture with an `ExecutionPlanNode` goal, preserving Unicode
  coverage through the actual wire object. The failed build log is retained at
  `/root/monos-planning-deploy-v1/linux-go-build.log`.

## Existing host baseline

Host `100.120.14.84`, source `/root/monos-boundary-probe-src`; existing backend on
127.0.0.1:18444 and `monos-probe-runner.service`. Independent monolab uses 18443.
Every Compose `up` must include `/root/monos-boundary-probe-ports.yaml`.

`/root/monos-planning-deploy-v1/` retains the pre-deploy DB dump, consistent SQLite
journal backup, four installed binary copies/hashes, container/service identity,
receipt fingerprints and eight globally idle ownership/queue counts, all zero.
This backup step did not restart or replace any service. The previous installed
version is migration 16 / workspace build-v6. PostgreSQL regression tests use
unique schemas through a temporary SSH forward to the existing database; no new
database service was started.

Final candidate source v2 has 254 files, archive
`/root/monos-planning-source-v2.tar`, manifest
`/root/monos-planning-manifest-v2.json`, SHA256
`a1d2601559e907b7d91938c0c691bc8f5646ddfd51e9018edda378194b074485`.
It was built at `/root/monos-planning-build-src-v2`, with successful artifacts
under `artifacts/planning-v2`. First install preflight stopped because two settled
historical workspace Attempt units retained failed systemd status. Their PID-zero,
empty cgroup, exact journal identities and released DB ownership were recorded in
`stale-units-reset-intent.json` before resetting only those failed unit markers.
The original install intent and failed bootstrap log remain retained.

`installed.json` records successful installation: migration 17, original receipt
fingerprints, all four binary hashes, all 254 installed source hashes, fresh ready
Runner registration and unchanged independent monolab container. Postflight's
eight original idle counts plus pending initial-planning count are all zero.
No service was added; only existing backend/Runner were replaced. The canonical
native trial passed at `/root/monos-planning-native-v1/`.

## Native trial recipe

`infra/probe/task_planning_probe.py` stages `create`, `start`, `issue`, `retry`,
`plan`, `audit`. Create uses a real Discussion preview, exact Owner confirmation
and canonical Task creation. It deliberately defers one label choice to initial
planning. Before Start must have zero source/Attempt/Plan/Node/workspace. Native
issue and answer/Retry must preserve exact source, Specification, prompt, journal
envelope and receipts; final Plan has one PENDING Node and zero Node Attempts.
Each stage is exclusively claimed. A failure/timeout preserves the original
state for inspection, never authorizes a new source or overwrites prior evidence.

The retained PENDING Task must be accounted for before the next Node-execution
leaf enables scheduling. It is not an executed or delivered result.

## Native results

Every stage exited 0: create, Start/replay, issue, exact answer/Retry/replay, Plan
publication and final global-idle audit. The actual Specification remained
unchanged; only the initially unresolved button label was answered as `Add book`.

- Task: `e14ad4bb-4688-4647-981c-70911889e17b`
- Specification: `a9b8ee1f-af68-45c0-948e-5af22902e05e`
- Plan: `5c99259e-d5d5-4b1f-a784-dc5d2027ddae`, digest
  `c4a032128eb2052be317fb3585b3d3a778b0e4e1f01d7cfd3fc6e2f561439df3`
- One PENDING Node: `04fb910d-fdf9-4e2d-9ae2-ae269f53ca74`, Role
  `planning-native-v1-role`, active Project `planning-native-v1-project`.
- Native Discussion Attempt: `1fc1216e-bc84-4962-b546-bf3e53c9f4e4`.
- Initial source `b5da0236-b45e-4449-ae6f-d854eeafa011`, Planner
  `738d01d2-c431-434f-a74a-ad6582e88510`, exact issue sequence 3, Stop
  `a3b9aa28-f4c6-41a9-b301-9073ad99f1b6`.
- Retry source `bbe96d5b-4c8f-45ea-a7c1-fcbdf3074aa8`, Planner
  `39ef9b6c-e2ec-4639-9632-9141d5ced80f`, Stop
  `0b822ea2-e345-4101-81da-09370e25f9b6`.

Both Task Planner Attempts SUCCEEDED with one Start each and successful original
Stops. Independent journal envelopes match committed command digests and exact
outcomes. Source/context/prompt/Spec bindings and scoped read projections match
the database. The old source, issue/event/receipt history and Specification remain
unchanged across Retry. The Plan preserves four hard requirements and three
expected outputs, with no dependencies. No workspace, lease or Node Attempt was
created. All global queue/physical ownership counts are zero.

The active no-resource Task can supply the next leaf's honest optional-Artifact
completion case; enabling Node scheduling must explicitly account for it.

| Evidence | SHA256 |
| --- | --- |
| created.json | `ea828c6953bc99b01337fbd49e900d5a68b9cab9e419545e80c0cc59015cbfd4` |
| before-start.json | `463ae83c9d7324039b651891d62efe3752630d587503d602623ea684b48c61a1` |
| issue.json | `dd91487d037fe1da5b80a8a01d11502bbf7eacdbe25d9d4c42b068eb99ed1fc3` |
| plan.json | `0baa39c4f3b6ec2e1953e9808c93a1f73a29962fd56d9f958d1ed04060d18f93` |
| final-idle.json | `a772cdb5fd41b65b3c21074512398efd58136f3699d3408289013c06bff3b46b` |

Installed binary hashes:

- monos: `a2f64e198163f9091f9365235d5a95d66bc0cf5ed0f04e42ad0804f6b711688a`
- monos-runner: `8848485e089cca97346acd069c18462e61dd4f606b495f55456dd90d9bd13fe7`
- monos-probe-launch: `8bb456dc550b61fb7f28e881660cef2bf66cd035043f64981ded25562ced3f6e`
- monos-probe-exec: `1c626a068a92fbfabec55a833a4a5c25114dcffc4c3d3aea917e0af696bea568`

Limits: no Node execution/delivery, no new live service-restart trial, no native
provider-session resume or private GitHub App access is established by this leaf.
Race/crash windows use observed PostgreSQL contention and deterministic tests;
native evidence establishes the actual installed CLI and process settlement.
