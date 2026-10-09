# Single-Owner access

Run migrations and configure the Owner from a trusted local management shell with
`DATABASE_URL` or `MONOS_DATABASE_URL_FILE` already configured. There is no public
signup or unauthenticated setup route.

The bootstrap command accepts one JSON object on stdin. Prompt without echoing the
password or putting it in command-line arguments:

```sh
python3 - <<'PY'
import getpass, json, subprocess
password = getpass.getpass('Owner password (at least 12 characters): ')
subprocess.run(['pnpm', 'owner:bootstrap'], input=json.dumps({'password': password}), text=True, check=True)
PY
```

To rotate an existing credential, add `--rotate` to that subprocess argument list.
Rotation revokes every old Owner session. The command prints only completion status;
the database stores a random salt and fixed-parameter scrypt hash, not the password.

Browser API sequence:

1. Same-origin `POST /v1/owner/login` with `{schema_version:1,password}`.
2. HTTP sets the HttpOnly, SameSite=Strict `monos` cookie. HTTPS sets the Secure,
   HttpOnly, SameSite=Strict `__Host-monos` cookie. Both use Path=/ and no Domain.
3. `GET /v1/owner/session` revalidates expiry/revocation. Existing Owner APIs accept
   this cookie; cookie-authenticated writes require matching Origin.
4. `POST /v1/owner/logout` revokes the session and expires the cookie.

With both `MONOS_TLS_KEY_FILE` and `MONOS_TLS_CERT_FILE` omitted, the backend serves
HTTP and WS without certificates. Set both to readable matching PEM files to serve
HTTPS and WSS; a partial or invalid pair fails before database initialization.
HTTPS clients must verify the server certificate. Use HTTPS when transport encryption
is needed; HTTP carries credentials and content without encryption.

The application does not trust forwarded origin headers. Cookie selection and
Origin checks use the actual backend connection, so preserve the public Host and
protocol through ingress and keep the frontend same-origin. Explicit Bearer
authentication remains available for existing trusted API clients; Runner and
Attempt credentials are never accepted.

Five failed password attempts in a minute throttle further login with HTTP 429 and
Retry-After. This is persisted across backend restarts. Login/session responses are
no-store. Passwords are bounded to at least 12 characters and at most 1024 UTF-8 bytes.

Build with `pnpm build` and open the backend HTTP or HTTPS origin to use the protected
configuration UI. The server serves its built assets from `apps/web/dist`; container
builds include them automatically. See `apps/web/README.md` for development/testing.
Owner credentials must still be initialized through the local management command.

## Minimum configuration APIs

After login, GET `/v1/owner/configuration` returns the shared control version,
Projects, reusable Roles, execution policies and safe GitHub metadata. POST
`/v1/owner/configuration/commands` uses `schema_version:1`, a stable `request_id`,
`expected_control_version`, `name` and typed `payload`. Supported names are
`save_project`, `save_role`, `save_policies`, `save_github`. Read an uncertain
result at `/v1/owner/configuration/commands/<request_id>` and replay the exact
original request; do not replace its version automatically. Project archive and
Role hide use `archived`; IDs/resources are stable.

A policy has `default_target`, ordered `fallback_targets` and optional
`duration_budget` (seconds; attention only). Targets use `runtime_id`, optional
`runner_id` (hard pin; omitted means Auto), `model_id` and `thinking_level`.
Unknown/new manual model IDs are permitted. Global/Planner policies are members
of the `save_policies` payload; a Role can have `execution_policy`. These settings
are storage for the forthcoming production Runtime integration, not a change to
the boundary probe's fixed/free launch target.

GitHub payload: `app_id`, `installation_id`, and write-only `private_key` PEM.
Send secrets in a same-origin request body, never argv, URLs, logs or source;
use HTTPS to encrypt the transport.
The App must already be installed on the selected repositories with Contents and
Metadata read permission. monos mints only temporary read-only installation
tokens for the repository picker. Future delivery requires separately validated
write/PR permissions. Omit private_key only to retain the key for the same App.
Snapshots show its public-key fingerprint, never PEM or tokens. GET
`/v1/owner/github/repositories?page=1` lists up to 100 authorized repositories;
follow explicit next_page. This does not publish Git refs or verify merge access.

Provider keys are encrypted with a domain-separated key from
`MONOS_SIGNING_KEY_FILE`. Preserve this private secret with database backups.
After signing-key rotation, re-enter the GitHub App key; the service never ignores
a decryption failure. App/installation IDs are authenticated with ciphertext.

GET `/v1/owner/infrastructure` shows enrolled Runners and installation observations.
New Runner builds discover the supported CLI under the configured probe execution
account on reconnect. Online, current observation and detected installation are
separate facts. Install/login to coding CLIs remains an Owner operation; a version
check is not evidence of model access or complete Runtime acceptance.
