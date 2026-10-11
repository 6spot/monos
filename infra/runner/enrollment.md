# Enroll a new Runner

Use this after provisioning the service and execution accounts and persistent
paths described in the [Runner recipe](README.md). Enrollment registers a new
Runner; it does not install or authenticate coding CLIs or certify host readiness.

## Issue a temporary grant

On the backend host, use the local administrative command with its existing
`DATABASE_URL` or `MONOS_DATABASE_URL_FILE`. The database connection remains local
to administration; the Runner never receives it. Save this nonsecret input as
`enrollment-options.json`:

```json
{ "schema_version": 1, "capacity": 2, "ttl_seconds": 900 }
```

Issue a 15-minute grant into a private file:

```sh
umask 077
pnpm runner:enroll-token < enrollment-options.json > enrollment-grant.json
```

The output intentionally contains the short-lived enrollment token. Keep it in
administrator/service-only storage and pass it through stdin, never an argument,
Agent workspace, chat or log. Each issuance creates an independent grant. Allowed
capacity is 1–32; lifetime is 60–3600 seconds. An expired unused grant cannot enroll
a Runner. There is no public grant-issuance endpoint.

## Configure and enroll

Create `/etc/monos-probe/runner.json` as a regular file owned by root or the Runner
service account, without group/other write permission. Set the actual non-root
execution UID. For a fresh installation use:

```json
{
  "endpoint": "http://127.0.0.1:18443",
  "token_file": "/var/lib/monos-probe/service/runner-identity.json",
  "runner_id": "",
  "journal": "/var/lib/monos-probe/service/journal.sqlite",
  "socket": "/run/monos-probe/command.sock",
  "execution_uid": 1000
}
```

The identity's parent directory must be owned by `monos-probe` with mode `0700`.
The identity and journal must not exist. Configuration and CA paths must have
trusted ownership and no writable or symlinked ancestors. Select the backend
origin reachable from the host. Local HTTP requires no certificate; public access
uses HTTPS with normal hostname/chain verification. Add `ca_file` only for a
custom CA. Redirects are rejected.

As an administrator with the private grant file available:

```sh
sudo -u monos-probe /usr/local/libexec/monos-runner enroll --config /etc/monos-probe/runner.json < enrollment-grant.json
```

The command runs under the service account and writes a mode `0600` identity
file. It does not modify the configuration. Its success output contains only the
Runner ID. Start the daemon after the remaining host prerequisites are ready:

```sh
systemctl start monos-probe-runner.service
```

Ordinary startup reads the enrolled identity from `token_file`; leave `runner_id`
empty in this configuration. Reconnection reuses that identity and obtains a new
connection incarnation through the existing control protocol. Explicit nonempty
`runner_id` with a raw token file remains the current probe configuration form;
it is not an enrollment input.

## Recover an interrupted enrollment

The command retains its original request and credential in service-private
pending state before contacting the backend. If a reply is lost, retry with the
same configuration and no new grant:

```sh
sudo -u monos-probe /usr/local/libexec/monos-runner enroll --config /etc/monos-probe/runner.json < /dev/null
```

It reuses the original request; it does not mint another Runner. An exact already
consumed request can recover after the grant expires. A saved successful response
also permits finishing the matching local installation while the backend is
offline. Endpoint, trust or configuration changes must be restored to the recorded
values before retry. An unused token that expires remains denied.

A fresh invocation refuses existing identity or journal/WAL/SHM files. Never
delete those records to force registration. Restore the original matching private
identity when recovering an existing Runner. This enrollment slice does not
implement credential replacement or remove unresolved execution ownership.

Validation uses real local file operations, controlled HTTP/TLS and PostgreSQL.
Installed service/account permissions, coding CLI access and reboot recovery
still require the separate native acceptance gate.
