# Check installation configuration

For a fresh host, start with the [single-host installer](../install/README.md).
The Web app exposes the same observations and recovery steps in Execution →
Setup status after sign-in.

After [Owner bootstrap](../../docs/11-technology-and-deployment.md) and
[Runner enrollment](../runner/enrollment.md), run a configuration and connection
check without creating a Task. The existing `/health` endpoint remains a lightweight
database liveness check.

Create a private JSON input file, outside Agent-accessible storage:

```json
{
  "endpoint": "http://127.0.0.1:18443",
  "password": "<the configured Owner password>"
}
```

For HTTPS using a custom CA, also set `ca_file` to the public certificate path.
Normal system trust and hostname verification stay enabled. The endpoint must be
an HTTP(S) origin. Passwords are read from stdin, never command-line arguments.

```sh
pnpm doctor < private-doctor-input.json
```

The command creates a temporary normal Owner session, reads
`/v1/owner/setup-readiness`, then logs out. It prints only the validated JSON
report; it does not save the password or session token. Protect the input file
with service/administrator-only permissions.

| Exit code | Meaning |
| --- | --- |
| `0` | Observed schema, connection and configuration checks are satisfied |
| `2` | The report identifies missing or unavailable configuration |
| `1` | Input, authentication, transport, response or logout failed |

The report includes schema/configuration versions, current Runner installation
facts, Planner policy and selected Role policies for each active Project.
Selection errors use the same rules as scheduling. Recovery actions identify
the existing configuration entry point:

| Action | Recovery |
| --- | --- |
| `configure_policy` | Set the Planner or global execution policy in Execution settings |
| `configure_role` | Select an available Role or configure its execution policy |
| `enroll_runner` | Follow the one-use Runner enrollment recipe |
| `start_runner` | Start or reconnect the configured Runner daemon |
| `refresh_runtime` | Check the installed CLI under the execution account and reconnect for fresh discovery |
| `select_runner` | Choose an explicit Runner when Auto placement is ambiguous |
| `review_target` | Select a supported Runtime, model and thinking setting |
| `restore_storage` | Repair the affected volume/free space, then refresh and reconnect for a current observation |

These are observations, not reservations. Full capacity may queue future work;
it does not invalidate otherwise usable configuration. No repository or GitHub
credential is required for repository-free tasks.

Database and Runner storage reports show free space, minimum thresholds and
observation currentness. Runner reports also carry execution limits and retention
periods. Missing or expired reports do not certify current storage health.

Storage durability, CLI login, model invocation and Git read/write permissions remain listed
under `unverified`. Exit `0` does not certify these capabilities or native host
readiness. Their real execution checks remain a separate acceptance step.
