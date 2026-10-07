# Fresh current-version development installation

Active task: `.trellis/tasks/10-03-a-delivery-acceptance`. Research dated
2026-10-08; this document is the sole owned output. No host connection, credential
read, infrastructure change, product edit/test, Owner command or provider/model
effect was performed. Existing shared dirty files were preserved.

## Scope and evidence boundary

Apply the [Owner decision](development-phase-decision.md), revised
[architecture](../../../../ARCHITECTURE.md),
[pre-use policy](../../../../docs/12-product-naming-and-upgrades.md),
[deployment](../../../../docs/11-technology-and-deployment.md), and current
[PRD](../prd.md), [design](../design.md), [checklist](../implement.md).
Fresh current state is the acceptance path. Historical version/data conversion,
ciphertext compatibility, old receipt comparison, clone upgrade trials and
backup/rollback matrices are not installation gates. Current active writers,
current-run original operations, authorization and recovery still require exact
proof. Completed historical reports remain at their original evidence boundary.

The frozen candidate is `63eaa285ab90fdd6de018671a47ba5583f87bc75` (493 files).
Reuse [independently reviewed build evidence](build-evidence-review.md) and
[the composite receipt](build/built.json): receipt SHA256
`066c1a62eade75781491f01dbc68fb938e0daa23ff046a651469d4144a654e13`.

| Artifact | Selected identity |
| --- | --- |
| Frozen source | `/root/monos-delivery-acceptance-src-v2` |
| Four Linux ELF executables | `/root/monos-delivery-acceptance-build-v2/bin/{monos,monos-runner,monos-probe-launch,monos-probe-exec}`; root-owned, mode0755, hashes in the composite receipt |
| Server/SPA | Local tag `monos-delivery-acceptance-server:v2`, exact image ID `sha256:de8f15a1b9b60f9b013abaa167100f84f518ac3304afc0ab98d408efc8fd7434` |
| Node inside server | `v24.21.0`; native app/coordinator imports already passed |
| PostgreSQL | `postgres:17.11-trixie@sha256:d74eeac9a635390a49bc21bd49fccd973de707e2a53a76ac49b552b8712ec46f` |

No rebuild follows documentation-only policy changes. Root must reobserve image,
binary and immutable source identities before installation; tags alone are not
identity proof. Any later product change invalidates its affected build evidence.

## Selected fresh resources

These are proposed identities, not claims that the host resources exist or are
free. Root must fail on any unexpected collision before creating them.

| Resource | Exact selection |
| --- | --- |
| Private staging root | `/root/monos-delivery-acceptance-fresh-v1`, root:root0700 |
| Recipe directory / effective file | `infra/compose/compose.fresh.yaml` beneath that root |
| Compose project | `monos-delivery-acceptance-fresh-v1` |
| Fresh database volume | `monos-delivery-acceptance-fresh-v1_database_data` |
| Fresh containers | `monos-delivery-acceptance-fresh-v1-database-1`, `monos-delivery-acceptance-fresh-v1-server-1` |
| Networks | `monos-delivery-acceptance-fresh-v1_control` (internal), `monos-delivery-acceptance-fresh-v1_ingress` |
| Server endpoint | `https://127.0.0.1:18445`; container port18443; no host DB port |
| Runner enrollment | `delivery-fresh-runner-v1`, capacity2 |
| Sole existing Runner unit | `monos-probe-runner.service` |
| Runner configuration | `/etc/monos-probe/runner.json`, owner `monos-probe`, mode0640 |
| Service-only token / public CA | `/etc/monos-probe/runner-token` (service owner0600), `/etc/monos-probe/ca.pem` (0644) |
| Fresh runtime root / journal | `/var/lib/monos-probe`, `/var/lib/monos-probe/service/journal.sqlite` |
| Sole CLI socket | `/run/monos-probe/command.sock` |

Use a concrete task-owned Compose file derived from the frozen
[recipe](../../../../infra/compose/compose.yaml). Keep its pinned database,
secrets, internal control network, health dependency, readonly server filesystem,
tmpfs, dropped capabilities and restart policy. Replace `name` with the selected
project, replace server `build` with the existing server image tag, and replace
the host binding with exactly `127.0.0.1:18445:18443`. Omit the optional tests
service. Use one effective file: merging another ports list over the base recipe
could retain its18443 binding. Validate selected project labels, volume and the
single published port from safe parsed metadata; do not print expanded secret
configuration. Enforce the recorded image ID before/after `up`, `--no-build` and
`--pull never`. No source, Docker socket, Runner filesystem or credentials are
mounted into Agent workspaces.

## Current host facts and prerequisite refresh

[Host inventory V3](host-inventory-v3.json) was observed at
`2026-10-07T16:15:43.477744+00:00`. It records the old target
`monos-boundary-probe-server-1` running image `sha256:daa468f43a5b13fe67ebeeb79a575131159f241502cc39fb8ded9b27cd161cc3`,
its own database volume, and active `monos-probe-runner.service` PID394453,
invocation `9f74616401924824b49397d7b38ccee7`. The separate monolab services
are unrelated; their Runner was PID5573. These observations do not establish
current process absence, port18445 availability or present transport readiness.

The later [failed transport receipt](legacy-review-inventory-v1-transport-failure.json)
records authentication failure before transfer/query. No successful fresh
installation or current host authentication is established. Root owns a new
bounded transport readiness check and serialized host slot; the discontinued
compatibility observer is not retried.

Root's refreshed read-only prerequisite inventory should include only necessary
current facts: selected path/project/volume/port collisions, exact image/binary
availability, Docker Compose, host Node>=20 and OpenSSL for the preparation recipe,
systemd/cgroup v2/git/sudo, safe existing account/group/unit/sudoers ownership, and
actual current monos process/operation ownership. Unreadable, ambiguous or changed
identity is a blocker, not measured absence. Verify execution account `me` and
its actual nonzero UID/GID rather than assuming the previous UID1000 remains true.
The already Owner-installed OpenCode executable at
`/home/linuxbrew/.linuxbrew/bin/opencode` is reused; no CLI installation/login,
provider credential copy, native model/catalog invocation or provider write is
part of this installation design.

## One Runner, fresh physical scope

[Host constants](../../../../runner/internal/host/types.go) fix the runtime root,
socket, helper, worker and CLI paths. [Runner startup](../../../../runner/cmd/monos-runner/main.go)
also rejects a different socket. A second project/config/unit cannot safely run a
parallel frozen Runner against those shared paths. Select replacement of only the
existing monos Runner, keeping monolab and all unrelated services outside scope.

Before switching shared binaries/config/root, root must exclude target admissions
and release actual writers. Observe current owned work and perform any required
normal status/Stop reconciliation while its backend and Runner remain available.
Then stop only the exact target old server after rechecking its container/image/
project identity; keep its database/volume outside the fresh project. Recheck the
actual ownership under this admission exclusion; a newly observed or unresolved
owner blocks switching until its exact reconciliation/physical cessation plan is
reviewed. Do not assume normal commands can settle after their backend is stopped.
Check pending systemd jobs,
unit invocation/PID birth/boot, full cgroup trees and surviving processes referencing
the shared root/executables. Stop the exact Runner and prove its service cgroup
and socket writer absent. `KillMode=control-group` on the Runner does not prove
absence of sibling Attempt/operation units. Terminal or failed labels alone do not
release physical ownership. Unacknowledged launch/effect ownership blocks this
switch until actually reconciled; never clear a record to make the gate pass.

The last inventory includes seven failed development Attempt units. Their labels
alone do not prove absence. After excluding target admissions and verifying exact
unit/job/cgroup/process absence, retire only the identified stale target units as
needed (`reset-failed` for proven failed units). Preserve original recorded
reports; no old Task/receipt/journal comparison or failed-unit metadata preservation
is a fresh-install gate. Do not remove unrelated or uncertain units.

Reuse [bootstrap.sh](../../../../infra/runner/bootstrap.sh) for its existing
account, sudoers, unit and verified binary installation. It accepts only the
recognized stopped installation and rejects remaining Attempt/operation units;
root must first reconcile actual writers and perform the scoped stale-unit
retirement above. Run its `--check` before its installation command while the
recognized existing root/marker remain present. Do not bypass its collision or
ownership checks or copy a second installation framework.

After bootstrap and verified writer release, detach the prior development runtime
root into an exclusively named private directory on the same filesystem, then
create fresh fixed-root directories/marker and matching fresh UUID storage IDs
with the exact bootstrap ownership/modes below. This small scoped filesystem step
still requires a reviewed execution helper; it does not exist yet. Do not import
old DB/journal, launch records, workspace metadata, caches or storage IDs. No data
translation or old-history verification is required. Directory renaming alone
cannot establish writer release. Fresh canonical operation/Attempt IDs must not
collide with any current native owner.

Create exactly the current bootstrap ownership/modes:

- root:root0755: root, `launch`, `execution`, `tasks`, `launch/workspaces`;
- root:`monos-probe-read`0750: `logs`;
- service:`monos-probe-read`0700: `service`, `results`,
  `service/workspace-locks`, `service/workspace-operations`;
- service:`monos-probe-read`0750: `cache`, `inspection`, `cache/resources`;
- matching fresh UUID storage IDs: root-owned `launch/storage-id`0644 and
  service-owned `service/storage-id`0600, durably written exclusively;
- install all four verified ELF files together at `/usr/local/bin/monos` and
  `/usr/local/libexec/{monos-runner,monos-probe-launch,monos-probe-exec}`, root0755.

The existing service identity must retain its `/var/lib/monos-probe/service` home
and nologin shell. Recheck its existing unit against the bootstrap's fixed
ExecStart, RuntimeDirectory, UMask0027 and KillMode. Do not overwrite unrelated
policy or accounts. New journal tables are created by
[journal.Open](../../../../runner/internal/journal/journal.go); no old SQLite
copy is used. Current canonical Task workspaces are lazily materialized through
resource descriptors/service caches. Do not insert fixture Tasks/Attempts or copy
the historical `fixture.git` for ordinary native acceptance.

The actual fresh configuration is:

```json
{
  "endpoint": "https://127.0.0.1:18445",
  "ca_file": "/etc/monos-probe/ca.pem",
  "token_file": "/etc/monos-probe/runner-token",
  "runner_id": "delivery-fresh-runner-v1",
  "journal": "/var/lib/monos-probe/service/journal.sqlite",
  "socket": "/run/monos-probe/command.sock",
  "execution_uid": 1000
}
```

Use the refreshed actual `me` UID in the final file;1000 is the last observed
value. The service token must not be group-readable: `me` belongs to the shared
read group. [control.New](../../../../runner/internal/control/client.go) enforces
verified HTTPS, CA loading and private token mode.

## Ordered private setup and ordinary access

The commands below are a reviewable execution plan, not executed evidence.
Root produces private inputs without secret argv, echoed bodies or logs, records
safe intent/identity/status only, and stops on each failure.

1. Stage the exact frozen `prepare.mjs` into the new recipe directory, keeping
   frozen build source unchanged. Verify no selected private directory exists.
   Run `node /root/monos-delivery-acceptance-fresh-v1/infra/compose/prepare.mjs`
   only after confirming its host Node/OpenSSL prerequisites. The
   [actual preparer](../../../../infra/compose/prepare.mjs) exclusively creates
   private0700 storage and0600 DB password/URL, fresh signing secret, fresh Runner
   credential, CA/server RSA3072 keys and a30-day localhost/127.0.0.1 certificate;
   it performs strict chain/IP/server-purpose verification. Private CA key stays
   root-only; only public CA is copied to Runner/browser trust. Partial preparation
   remains an explicit failed stage, never an excuse to overwrite existing secrets.
2. Stage/review the concrete Compose file and validate no project/volume/port
   collision. With the exact selected images already present:

   ```sh
   docker compose -p monos-delivery-acceptance-fresh-v1 -f /root/monos-delivery-acceptance-fresh-v1/infra/compose/compose.fresh.yaml up -d --no-build --pull never database server
   ```

   [main.ts](../../../../apps/server/src/main.ts) runs
   [migrate](../../../../packages/db/src/migrate.ts) before listening. On an empty
   volume this initializes current schema25 from all25 bundled migration files;
   it is fresh initialization, not an old-version upgrade gate. Read only safe
   migration version/checksum metadata and selected fresh aggregate counts in one
   readonly snapshot: versions1–25 match candidate checksums, Tasks/Attempts/App
   rows zero before setup, and current Review relations are present. Compare
   migration25 SHA `b3bca7c345ac49f39795ca4f4e5f99abf6fecf094833ccb88c7befcd84266f18`.
3. Verify `/health` with public CA, never disabled TLS verification:

   ```sh
   curl --fail --silent --show-error --cacert /root/monos-delivery-acceptance-fresh-v1/infra/compose/private/ca.crt https://127.0.0.1:18445/health
   ```

   Expected current body is `{"schema_version":1,"database":"ready","probe":true}`.
   This checks DB reachability only. Inspect safe container labels/image IDs,
   volume identity, no unexpected bindings, and served index/JS/CSS hashes against
   the build receipt; HTTP200 does not prove served candidate or Runner readiness.
4. Produce a root-only bounded `owner-bootstrap.json` containing only `password`
   (at least12 characters, at most1024 UTF-8 bytes). Feed stdin to the actual
   [local Owner bootstrap](../../../../apps/server/src/owner-admin.ts):

   ```sh
   docker compose -p monos-delivery-acceptance-fresh-v1 -f /root/monos-delivery-acceptance-fresh-v1/infra/compose/compose.fresh.yaml exec -T server node --experimental-strip-types apps/server/src/owner-admin.ts < /root/monos-delivery-acceptance-fresh-v1/infra/compose/private/owner-bootstrap.json
   ```

   Use fresh bootstrap without rotation; no old session/password compatibility.
   DB URL remains the server's secret file. Record only exit/status and safe
   singleton count, never password/hash/session bearer. The password remains in
   Owner-controlled private storage for ordinary login.
5. Produce a root-only `runner-enrollment.json` with only
   `action="enroll"`, `runner_id="delivery-fresh-runner-v1"`, `capacity=2` and
   `credential` loaded from the fresh private `runner_credential` file. Use the same command prefix as above with
   `apps/server/src/admin.ts` and stdin from that file. The actual
   [enroll primitive](../../../../apps/server/src/fixtures.ts) hashes credentials,
   accepts capacity1–32 and refuses conflicting existing enrollment. Although its
   source helper is named `enrollFixture`, this local administrative enrollment is
   the implemented setup surface. Do not invent a one-use HTTP enrollment endpoint
   or use admin `attempt`/`revoke`/`retry_operation` to manufacture native outcomes.
6. After the shared-runtime physical gate, fresh filesystem provisioning,
   binary/hash checks and private config/CA/token publication, run only
   `systemctl start monos-probe-runner.service`. Record fresh unit invocation,
   PID/birth/boot/cgroup, installed executable identity and one owned socket.
   Confirm fresh SQLite creation/permissions and no starts/requests/effects/events
   before ordinary work. Record the newly enrolled backend Runner's capacity,
   current incarnation and ready/online status.
7. Owner accesses the loopback HTTPS endpoint through a bounded tunnel binding
   local127.0.0.1:18445 to host127.0.0.1:18445, with the public CA trusted in the
   selected browser. Verify actual private transport readiness first. Keep the
   endpoint stable to preserve same-origin and Secure cookie behavior. Ordinary
   [login/session routes](../../../../apps/server/src/app.ts) are
   `POST /v1/owner/login`, `GET /v1/owner/session`; subsequent protected writes use
   their actual `X-Monos-Session` binding and request IDs. Check unauthenticated
   protected reads refuse, login succeeds, session reads match, logout revokes,
   and an actual fresh login accesses the served configuration UI. Do not retain
   cookie/header/password bytes in screenshots or evidence.
8. Read `GET /v1/owner/infrastructure` through that session. Its
   [production projection](../../../../apps/server/src/configuration.ts) requires
   connected+ready+current backend instance and recent heartbeat for `online`;
   installation `current` also binds the current incarnation. The native
   [fixed discovery](../../../../runner/internal/host/discovery.go) runs only
   OpenCode `--version` as `me`, bounded and without model invocation or service
   secrets. Require current detected expected executable/version; detection does
   not prove login/model availability or successful native semantic tools.

Before any Todo/Task launch, use ordinary protected configuration commands/UI to
save the explicit selected runtime/model policy, planner guidance, a small Role,
Project and exact controlled repository resource. Retain actual configuration
versions/command request IDs/receipts. Current installed model catalog and actual
Attempt environment preflight are later native-flow checks; no fallback model,
CLI login or credential installation is performed to bypass missing prerequisites.

## App prerequisite, later acceptance and failure containment

Actual App RSA private key (>=2048 bits), App ID and selected-repository installation
remain unresolved external state. Do not search unrelated files for credentials or
substitute earlier OAuth fixture grants. Configure through protected `save_github`
only once the actual private inputs exist, recording safe IDs/fingerprint/receipt.
The [current App contract](../../../spec/backend/infrastructure-configuration.md)
keeps keys/tokens out of Agent files and requires production scoped issuance.
The selected authorized repository is
`6spot/monolab-feasibility-20260928-160020-public` / numeric1393178791;
Metadata(read), Contents/PR(read-write), Checks/statuses(read), no Workflows.
Closed PR4/merged PR5 are not new open trials.

Fresh installation contributes only prerequisites to AC1. All six AC stay open
until actual ordinary native Planner/Node, new two-purpose local Review, real App
PR/correction, fresh exact Accept/finality, separate Cancel and inspected served
desktop/mobile/current-run ownership evidence exist. The subsequent native loop
uses the current [task design](../design.md); historical native reports supply
unchanged boundary evidence only. No full old provider/test matrix is rerun.

On failure, stop new admissions and preserve the current stage's exact intent,
source/process/operation identities and original receipts. Before any new launch,
reconcile uncertain current-run effects and actual writer absence. Never start a
second Runner or change storage IDs to evade recovery. Root may stop only its
newly identified fresh server/Runner when necessary; target database volume and
failure artifacts remain until an explicit scoped next step. Do not automatically
restart the detached development Runner, reboot, expand stale-unit retirement
beyond its reviewed exact targets, touch monolab, expose private inputs or reset
Task state to fabricate recovery. This is current-run failure
containment, with no historical compatibility rollback matrix.

## Research validation and handoff

Read source contracts above plus the revised backend infrastructure/Owner access
and Runner execution/workspace guidelines. Local documentation link/whitespace
checks are the appropriate validation. No product tests, host query, SSH, install,
model/catalog call or provider effect was run. Root owns provisioner implementation,
independent review, transport and actual installation. Remaining execution blockers
are current transport readiness, exact physical ownership release, fresh resource
availability, safe native account/CLI observations and unresolved App inputs.
