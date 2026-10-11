# Install monos on a fresh Linux host

The installer combines the current backend, Owner bootstrap, Runner host setup
and one-use enrollment commands. It serves the Web app at
`http://127.0.0.1:18443`, enables the Runner systemd service, and keeps its identity
across restarts. It does not install or authenticate coding tools, run a model,
or access a Project repository. Successful installation is not native acceptance.

## Prerequisites

- Linux with cgroup v2 and systemd, Docker with Compose supporting `up --wait`,
  Node 20 or later for credential preparation, Python 3.11 or later, Git and sudo.
  The backend itself uses the pinned Node image.
- The existing non-root execution account `me`, with no passwordless sudo and no
  membership in the control-plane Docker group. The installer keeps this fixed
  execution-account boundary and creates only the existing `monos-probe` service
  identity through the [Runner bootstrap](../runner/README.md).
- A complete current checkout in a root-owned directory with mode `0700`, such
  as `/root/monos`. Parent directories and installer inputs must be root-owned
  and not writable by other accounts. Never run this from an Agent workspace.
- The four current Linux binaries (`monos`, `monos-runner`, `monos-probe-launch`,
  `monos-probe-exec`) in a separate root-owned directory. Build them from this
  checkout with `sh infra/runner/build.sh /root/monos-binaries` using Go 1.26+ and
  a C compiler, or transfer a complete successfully built matching artifact set.
- No existing `monos-boundary-probe` Compose resources, Runner installation or
  listener on loopback port 18443. Existing unrelated resources are refused.
  Use the local Docker Unix-socket context without `DOCKER_HOST`/context overrides.

Review the repository's service templates before invoking the installer as root.
It starts only monos services and does not install OS packages. No Docker socket,
database volume or backend secret is mounted into the Runner or execution account.

## First run

Create `/root/monos-owner.json` with mode `0600` using a private editor. Its only
field is the Owner password, which must have 12–1024 characters:

```json
{ "password": "<your Owner password>" }
```

From the private checkout, inspect the steps without side effects, then install:

```sh
python3 infra/install/install.py --artifacts /root/monos-binaries --plan
python3 infra/install/install.py --artifacts /root/monos-binaries < /root/monos-owner.json
```

The stages are:

1. Generate private Compose credentials with the existing preparation command.
2. Build and start PostgreSQL and the Web/backend service; wait for health.
   Current migrations run through the backend's existing migration lock.
3. Bootstrap the sole Owner and authenticate the supplied password using `doctor`.
4. Install the confined launcher and Runner service using the existing bootstrap.
5. Write a private Runner configuration, pointing at its enrolled identity.
6. Issue a one-use enrollment grant privately and enroll under `monos-probe`.
7. Enable and start `monos-probe-runner.service`, then check it is active.

The generated Runner config uses two execution slots, a 200% CPU quota, 4 GiB
memory limit, 512 process limit, a 1 GiB free-space threshold, 168-hour log
retention and 24-hour inspection retention. These are host settings, not Task
timeouts. Review them for the host before beginning execution.

The same 1 GiB threshold applies to the backend database-volume observation.
The server mounts that volume read-only only to measure filesystem free space;
PostgreSQL still owns its data. This observation does not verify backup or
durability. The database has no published host port.

The installation record and temporary grant stay in root-only
`infra/install/private/`, excluded from Git and the Docker build context. Compose
credentials remain in `infra/compose/private/`. The nonsecret Runner config is
mode `0640`, owned by `root:monos-probe-read`. The service can read it but cannot
raise its own execution limits; the execution account's group membership grants
read access only. The long-lived identity remains service-owned mode `0600` in
the private service directory. Passwords and grants never appear in process arguments or installer
output. Child diagnostics are suppressed because they may contain private data.

## Continue an interrupted installation

Use the same checkout, binary directory and original Owner password:

```sh
python3 infra/install/install.py --artifacts /root/monos-binaries --resume < /root/monos-owner.json
```

The fsynced stage record binds the installation identity and input hashes. Resume
skips completed stages and verifies retained credentials/configuration/identity.
An Owner bootstrap reply lost after commit is recovered by authenticating the
original password; the installer never rotates it. Runner enrollment with pending
state uses the original request and no new grant. If enrollment completed and
removed its pending file before the installer saved its stage, the existing
identity is verified against the original grant's consumed receipt and current
credential hash using the local administrator's read-only `--verify` command.
That check never creates or changes a Runner. Starting an already active unit
does not restart it. No failure triggers destructive rollback or volume removal.

If credential preparation or host bootstrap stopped partway through its own
non-atomic work, resume proceeds only when the complete matching private files or
the bootstrap's ownership marker can be verified. Otherwise it stops for explicit
local repair. Preserve its state, identity, journal and workspaces; do not rerun
under a new directory to bypass ownership. A changed input/binary requires a
separate reviewed maintenance operation, not `--resume`.

An unused grant can expire before enrollment creates pending state. In that case,
verify that neither `runner-identity.json` nor `runner-identity.json.enroll.pending`
exists under `/var/lib/monos-probe/service/`, then archive the expired
`infra/install/private/enrollment-grant.json` in the same private directory and
resume to issue a fresh grant. Never replace a grant when pending enrollment or an
identity exists; use the [enrollment recovery procedure](../runner/enrollment.md).

After completion, keep the installation state for identity checks. Ordinary
service restart uses the saved configuration directly and does not rerun the
installer. Protect or remove the separate Owner input file according to your
local credential-storage practice.

## Finish setup and verify

Sign in to the Web app and open Execution → Setup status. Configure a global or
Planner policy with an explicit model, create reusable Roles and Projects, and
select Project Roles. Install/authenticate the desired supported coding CLI as
`me`; monos does not do this for you. Configure GitHub or plain Git access when
the Project needs repositories. Use the exact recovery action shown by setup
diagnosis or the Task's existing controls.

This entry point supports loopback HTTP. Verified TLS and alternate listening
configuration remain available through the [Compose recipe](../compose/README.md),
outside this fixed fresh-install invocation. Do not expose the loopback HTTP
recipe publicly. [Doctor](../compose/diagnostics.md) provides a terminal setup
report. CLI login, model execution, Git read/write and host durability require
their own actual operations; health or an active systemd unit does not prove them.

## Local validation

```sh
python3 -m unittest discover -s infra/install -p 'test_*.py'
python3 -m py_compile infra/install/install.py
sh -n infra/runner/bootstrap.sh
node --test infra/compose/test-prepare.mjs
```

These checks use temporary files and fake installer command execution. They cover
private publication, refusal of changed state/symlinks, bounded secret input,
stage interruption/resume, uncertain Owner bootstrap and original enrollment
recovery, including a completed enrollment whose pending file was already removed.
Configuration ownership changes are asserted with a simulated `fchown`; the tests
do not require root. The eight installer cases, Python compilation, shell syntax,
and both existing HTTP/TLS preparation tests passed in this development slice.
They do not invoke Docker, systemd, sudo, installed CLIs or real host
provisioning. The installer has not been accepted on a native host in this slice.
