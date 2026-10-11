# Isolated backend/database probe

This deploys only the boundary probe, not the Stage A product. Use the Owner-authorized Linux test host. Backend and PostgreSQL have no Runner filesystem mounts; PostgreSQL has **no published host port**. The default published endpoint is `http://127.0.0.1:18443`, with authenticated HTTP/WS and no certificates. HTTPS/WSS is optional. Agents never receive backend/Runner credentials or access to the Compose private directory.

The server joins a separate ordinary `ingress` bridge as well as the private `control` network. Docker 29 did not install the loopback port mapping when the server joined only an `internal:true` network. The ordinary bridge enables the explicit `127.0.0.1:18443` binding; PostgreSQL remains attached only to `control`, with no published database port.

Prerequisites: Docker/Compose, Node >=20 for the dependency-free preparation script, and no existing `monos-boundary-probe` project, owned volume, listener on 18443 or `infra/compose/private`. OpenSSL is needed only for explicit TLS preparation. Product/backend execution uses the isolated pinned Node 24 image, not the host Node installation. Main host operations must inventory collisions before running these commands. No CLI/provider login is changed by these scripts.

```sh
node infra/compose/prepare.mjs
docker compose -f infra/compose/compose.yaml build server tests
docker compose -f infra/compose/compose.yaml up -d database server
docker compose -f infra/compose/compose.yaml --profile test run --rm tests
curl http://127.0.0.1:18443/health
```

For current product configuration and Runner connection observations, use the
[authenticated installation diagnosis](diagnostics.md). `/health` alone does not
establish execution readiness.

To prepare a fresh HTTPS deployment instead, generate the optional localhost certificate and use both Compose files for subsequent commands:

```sh
node infra/compose/prepare.mjs --tls
docker compose -f infra/compose/compose.yaml -f infra/compose/compose.tls.yaml build server tests
docker compose -f infra/compose/compose.yaml -f infra/compose/compose.tls.yaml up -d database server
docker compose -f infra/compose/compose.yaml -f infra/compose/compose.tls.yaml --profile test run --rm tests
curl --cacert infra/compose/private/ca.crt https://127.0.0.1:18443/health
```

Both preparation modes refuse an existing `private/` directory, including switching modes. For an existing installation, preserve credentials and provision any TLS key/certificate separately before selecting the override. The base Compose file contains no TLS settings or secret mounts. The override adds both required TLS files; startup rejects a missing, unreadable or invalid pair. Custom certificates can replace the override's file paths through a reviewed deployment configuration. HTTPS clients verify system trust by default, and a custom CA extends that trust; never disable verification. HTTP carries credentials in cleartext, so keep the default loopback binding or use a trusted private transport. Authentication and same-origin guards apply in both modes.

The repository must be staged under a root/service-private host directory. `private/` is 0700; generated credentials/keys are 0600. With TLS enabled, signing keys remain private; copy only `ca.crt` into the Runner/execution trust location. The server container reads private secret mounts as its container root with all Linux capabilities dropped, read-only root filesystem, no Docker socket, no privileged mode and no-new-privileges. This is a backend container identity, never the Agent execution identity. Runner runs separately under its dedicated service account.

Images are pinned to official multiarchitecture manifest digests checked through Docker Hub metadata: Node 24.21.0 and PostgreSQL 17.11. Runtime image installs only production dependencies. The test target includes the pinned generation/lint/test toolchain. `pnpm test` skips PostgreSQL unless explicitly selected; `pnpm test:db` requires a real database. The tests create/drop only a randomly named `probe_test_*` schema inside this private database, without dropping production tables or resetting Runner journals.

The Runner connection row also binds the current backend process instance. After backend restart, new Agent effects wait for Runner reconnect/reconciliation even if the previous heartbeat was recent. Existing authenticated receipt/recovery reads remain available. This probe has one backend process; future multi-backend routing must forward to the connection owner instead of dropping this guard or using a stale heartbeat as authority.

Migrations currently end at version 3. Migration 2 adds backend connection-instance ownership; migration 3 retains typed capture failure classification on the original operation. Startup checks previously applied migration checksums before applying new versions. Runner inventory uses byte-bounded pages and a consistent snapshot token; clients must collect every page before reconciliation. See the [protocol contract](../../packages/protocol/README.md).

## Local fixture administration

The local command reads a JSON object from stdin. Pipe it into `docker compose -f infra/compose/compose.yaml exec -T server node --experimental-strip-types apps/server/src/admin.ts`. Do not place credentials in argv or print input.

- Enroll: `{ "action":"enroll", "runner_id":"probe-runner", "credential":"<read private/runner_credential in the administrative process>", "capacity":2 }`. Repeating identical enrollment is safe; differing credentials/capacity do not overwrite the existing row.
- Create: `{ "action":"attempt", "runner_id":"probe-runner", "attempt_id":"trial-1", "task_id":"task-1", "kind":"node", "resource_id":"fixture-repo", "prompt":"..." }`. Use `kind:"planner"` for a read-only Planner. This creates a fixture Specification/Plan and transactional ownership/dispatch, not a general scheduler. Each trial uses a distinct Task/Attempt. The selected Runtime/model is fixed to the authorized OpenCode free model.
- Revoke delayed dispatch: `{ "action":"revoke", "attempt_id":"trial-1" }`. This denies new credentials/mutations and durably queues Stop; capacity stays held until whole-tree stop is reported.
- After repairing an operation failure: `{ "action":"retry_operation", "operation_id":"..." }`. This retries the same admitted operation identity, never a new Agent request.

No fixture or fault endpoint exists on HTTP. Crash hooks are constructor-only integration-test dependencies. To test actual service restart, use `docker compose ... restart server`; receipts, outbox and claims remain in the database volume. Read service logs only after sanitization; never dump environment/configuration or credentials.

## Recovery and cleanup

Renamed templates target fresh `monos` installations. An existing deployment needs
the coordinated [upgrade procedure](../../docs/12-product-naming-and-upgrades.md);
a new Compose project otherwise selects a new empty database volume.

First reconcile/stop all task-owned Runner Attempts and preserve unresolved journals/workspaces. Stop only this Compose project with `docker compose -f infra/compose/compose.yaml down`; **do not add `--volumes`** during ordinary cleanup. The database volume contains canonical receipts/claims. Private files and unresolved data remain for explicit inspection/recovery. Do not reset the database while Runner records still reference it. No automatic destructive rollback or down migration is provided. Whole-host reboot requires its separately agreed execution window.

Optional TLS uses a short-lived private probe CA (30 days); it does not replace Owner authentication. This recipe does not establish public deployment, native delivery or GitHub expected-head feasibility.

The CA explicitly carries critical CA constraints and certificate-signing key usage;
the leaf carries non-CA constraints, server authentication usage and localhost SANs.
Preparation verifies the chain with OpenSSL strict verification, also required by
current Python recovery clients. Run `node --test infra/compose/test-prepare.mjs`
to check certificate-free preparation without OpenSSL, strict TLS verification, hostname rejection, private permissions and refusal
to overwrite existing state. An older incomplete CA needs an explicit certificate
repair and trust-copy update; do not disable TLS verification or rerun preparation
over the existing credential directory.
