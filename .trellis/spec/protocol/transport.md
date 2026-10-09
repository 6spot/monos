# Optional HTTP and TLS transport

## 1. Scope / Trigger

Server startup, Owner browser sessions, Runner control, bundled CLI submission,
deployment preparation and probe clients. Domain envelopes and authorization are
independent of the transport scheme. Source: [deployment](../../../docs/11-technology-and-deployment.md).

## 2. Signatures

- Server: `MONOS_TLS_KEY_FILE` and `MONOS_TLS_CERT_FILE`; `serverTLS(env)` returns
  a validated key/certificate pair or `undefined` before database initialization.
- Runner JSON: `endpoint` is an HTTP(S) origin; `ca_file` is optional.
- Go: `control.NewHTTPClient(endpoint, ca)` configures both Runner and CLI requests;
  a missing CA uses system trust. Local socket replies may omit CA content.
- Compose: base `compose.yaml` uses HTTP; `compose.tls.yaml` adds TLS secrets/env.
  `node infra/compose/prepare.mjs --tls` explicitly generates probe certificates.
- Vite: `MONOS_API_ORIGIN` chooses the backend; default is `http://127.0.0.1:18443`.

## 3. Contracts

No TLS file variables means HTTP. Both variables enable HTTPS; partial, empty,
unreadable or invalid key/certificate configuration fails before DB/startup effects.
Default host binding stays loopback. Explicit listen-host selection remains valid,
including `0.0.0.0` inside Compose with only a loopback host-published port.

Runner accepts an origin with no userinfo, query, fragment or non-root base path.
HTTP maps to WS and HTTPS maps to WSS at `/v1/runner`. HTTPS verifies hostnames and
certificate chains with TLS 1.2 or newer. Omitted custom CA uses system roots;
supplied PEM augments system roots and must parse. No redirect following or TLS
verification bypass. Missing `ca_file` never prevents HTTP command/socket use.

HTTP Owner sessions use `monos`; HTTPS uses `__Host-monos` with Secure. Both are
HttpOnly, SameSite=Strict, Path=/, no Domain, and revocable server-side sessions.
Only the current protocol's cookie is accepted. Bearer precedence, duplicate-cookie
rejection and exact Origin checks remain as in [Owner access](../backend/owner-access.md).
Untrusted forwarded headers cannot choose the protocol, Host or cookie policy.

Browser commands must also work on ordinary HTTP origins, where `crypto.randomUUID`
and `crypto.subtle` are absent. Use `apps/web/src/lib/browser-crypto.ts`: UUIDv4
uses `crypto.getRandomValues`, and UTF-8 SHA-256 uses WebCrypto when available or
the pinned `@noble/hashes` implementation otherwise. Preserve canonical input bytes
and every result/publication digest comparison; neither `Math.random` nor skipping
verification is an acceptable fallback. HTTP localhost is a secure context, so
localhost-only browser tests cannot establish this behavior.

Plain HTTP is available without certificate setup for local/private deployments;
it does not encrypt traffic. Use verified TLS for public access. The current server
supports direct TLS or pass-through; a proxy terminating TLS into HTTP cannot gain
trusted protocol authority simply by setting forwarded headers. GitHub/provider
HTTPS verification and separate Owner/Runner/Attempt credentials remain unchanged.

## 4. Validation & Error Matrix

| Input / observation | Required behavior |
| --- | --- |
| Neither TLS variable | HTTP listener, no certificate read |
| Both valid TLS files | HTTPS listener |
| Partial/empty/invalid TLS configuration | Fail before database initialization |
| HTTP origin, absent CA | HTTP commands and WS handshake succeed |
| HTTPS origin, absent custom CA | Verify with system trust |
| HTTPS with valid custom CA | Verify chain and hostname |
| Invalid supplied CA, untrusted certificate or hostname mismatch | Fail; no insecure fallback |
| URL credentials/query/fragment/non-root path | Reject origin |
| Cross-origin cookie write or forwarded-header spoof | Reject as unauthorized origin |
| Redirect response | Do not send credentials to redirected target |

## 5. Good / Base / Bad Cases

Good: certificate-free Compose, Owner login and Runner/CLI use the same HTTP origin.
Base: configured HTTPS uses a trusted certificate and Secure Owner cookie.
Bad: adding `InsecureSkipVerify`, ignoring certificate errors, or trusting arbitrary
forwarded headers to make an HTTPS proxy appear to work.

## 6. Tests Required

Test real HTTP/HTTPS Owner login, session read, logout and cookie/origin behavior;
ordinary non-secure HTTP command creation and exact digest/tamper validation;
invalid TLS startup configuration before DB access; authenticated WS/WSS surviving
pre-Ready polling; HTTP CLI submission from a socket reply without CA; system/custom
trust selection, certificate/hostname rejection and redirects. Preparation tests
cover default absence of certificates, explicit TLS validity/private permissions
and refusal to overwrite state. Linux attribution remains a separate host check.

## 7. Wrong vs Correct

Wrong: require a private CA to run local HTTP, or turn off TLS checks for HTTPS.
Correct: select transport from the configured origin and retain verified HTTPS
when selected, with optional custom CA and the same command authorization.
