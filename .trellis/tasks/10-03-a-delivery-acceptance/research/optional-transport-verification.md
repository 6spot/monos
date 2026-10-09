# Optional HTTP/TLS implementation and installed verification

User decision recovered from session `01a11b8b-2d61-74a3-b191-5c7706c00027`:
certificates are optional; HTTP/WS must work. Product commit:
`4a48cdc7f7eb78f201828733307b030c3de4448a`.

## Result

- Server starts HTTP without TLS variables; both valid files enable HTTPS. Partial
  or invalid TLS configuration fails before database initialization.
- Owner HTTP cookie is `monos`; HTTPS retains Secure `__Host-monos`. Both preserve
  server-side sessions, HttpOnly, Strict SameSite, same-origin and Bearer rules.
- Runner/CLI support HTTP/WS without CA, and verified HTTPS/WSS with optional
  custom CA plus system trust. Credentials never follow redirects.
- Compose defaults to loopback HTTP; explicit TLS override and `prepare.mjs --tls`
  enable certificates. Probe/Vite consumers follow the configured origin.
- Ordinary non-localhost HTTP browser contexts also work: secure-context-only
  UUID/hash APIs have supported implementations, retaining exact digest checks.
  The pinned MIT `@noble/hashes` 2.4.0 dependency has no runtime dependencies;
  production gzip grows approximately 2.61 KB.

Independent reviews passed both product changes and the bounded installer/App
helpers. A reproduced cross-origin credential leak in Python probe redirects was
fixed and regression-tested before the product commit.

## Verification

| Boundary | Evidence |
| --- | --- |
| Final TypeScript integration | `pnpm lint`, `pnpm typecheck`: pass; `pnpm test`: 596 passed, 406 DB-gated skipped |
| Protocol/build | `pnpm protocol:check`: current; production build pass |
| Actual PostgreSQL | 55 distinct affected Owner/cookie/configuration/Task/read/WS/WSS cases passed |
| Browser crypto | 35 focused hash/API cases passed, including ordinary HTTP digest mismatch rejection |
| Browser interactions | 3 Owner delivery, 4 review correction, 1 login/configuration and 1 non-secure HTTP flow passed |
| Go | Full local `go test -race ./...` and `go vet ./...` pass; actual Linux race checks for control/local/CLI pass, including kernel peer attribution without CA |
| Deployment/probes | Preparation tests and 197 Python cases pass; 26 affected cases pass after the redirect fix; actual local TLS chain/hostname checks pass |
| Installed release | 506 committed inputs frozen; 309 server-image source files verified; Node 24.21.0 native imports and four Linux ELF builds pass |

The non-secure browser test asserts `isSecureContext === false`, missing
`randomUUID`/`subtle`, and available `getRandomValues`. A test-only request bridge
maps its hostname to the isolated loopback fixture while preserving Host/Origin;
the initial direct hostname trial was blocked by the environment proxy before
reaching the application. It does not enable an insecure-browser flag.

Retained failed checks were environment issues: an initial SQL_ASCII temporary
database caused two Unicode cases to fail; UTF-8 reruns passed. Concurrent browser
runs shared an artifact directory; the affected case passed with isolated output.
The first Linux package archive omitted existing protocol fixtures; adding those
unchanged fixtures made the affected package run pass. No product checks were
weakened. The temporary local PostgreSQL cluster was stopped after verification.

## Actual installation

[Build result](optional-transport-build-result.json) and
[installation result](optional-transport-install-result.json) bind the committed
source, image, binaries and served assets. A single server-only Compose update and
Runner start passed all current physical/journal/identity guards.

- Endpoint on the authorized host: `http://127.0.0.1:18445`.
- Server: `ed4742360c0362d95e16d5cb172f35b46f739fbc366e77e03bee1a0cb8a9e27d`.
- Image: `sha256:f8577deb0497677c32c4ff4ed9121dcd5400a5722a5bdf5fa78c8c0dbbff5d32`.
- Database: unchanged `a650c142fb83ff89b93de6ec4e5f3584a330927b4c40f4796bff4a2afcb0fa01`.
- Runner: `delivery-fresh-runner-v1`, connected/Ready, incarnation 22, exact command
  socket and installed daemon ownership verified. OpenCode 1.18.30 detected.
- Storage: unchanged `864d3d99-24dc-43fe-9a19-ffce52557648`; credentials retained.
- At installation completion, Task/Attempt/operation/workspace counts were zero.

[Installed Owner verification](optional-transport-owner-result.json) passed login,
session read, cross-origin logout rejection, logout and revoked-session rejection.
The actual served login page was inspected in Chrome over a loopback SSH tunnel,
including 390×844 with no horizontal overflow and no certificate import/bypass.
Screenshot previews were inspected; the browser tool denied saving to the local
workspace, so no saved installed screenshot artifact is claimed.

[App verification](optional-transport-app-result.json) confirms App `5237783`,
installation `169256543`, original committed request
`b175aca2-34a0-4a39-83b7-923c47d2da9c`, expected public-key fingerprint, and selected
repository `1393178791` through the actual production repository picker. The Owner
session was revoked. The PEM-bearing original command remains root-private on the
host for recovery; it is not included in repository evidence.

## Acceptance boundary

This completes optional transport and the installed prerequisites. App catalog
access does not establish PR publication, correction, required-check revocation,
merge/finality or Cancel. The original integration task remains open for its native
semantic flow and final installed Review evidence. Old HTTPS continuation helpers
remain historical and must not be rerun against the current installation.
