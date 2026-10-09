# Single-Owner login and browser sessions

## 1. Scope / Trigger

Owner bootstrap/rotation, login/logout/session status, Cookie authentication and
same-origin writes. Implementation: `owner-access.ts`, `owner-admin.ts`, `app.ts`;
setup recipe: `apps/server/OWNER_ACCESS.md`.

## 2. Signatures

- Local `pnpm owner:bootstrap [--rotate]`, bounded `{password}` JSON on stdin.
- `bootstrapOwner(db, password, rotate=false)` and `OwnerAccess.login(password)`.
- `POST /v1/owner/login`: versioned `OwnerLogin`; returns `OwnerSessionStatus` and
  sets an HttpOnly cookie. `GET /v1/owner/session` revalidates it.
- `POST /v1/owner/logout`: no payload, revokes current token and clears the cookie.
- Migration 7 stores one salted hash and the shared failed-login window/count.

## 3. Contracts

One Owner, no signup/account taxonomy. Local bootstrap requires database management
access, never accepts secrets as argv and never prints them. Rotation is explicit
and atomically revokes prior sessions. Passwords use random 32-byte salt, 64-byte
scrypt output, N=32768/r=8/p=1 and constant-time comparison; accept well-formed
Unicode with at least 12 characters and at most 1024 UTF-8 bytes.

Failed verification commits its counter before returning an error. Five failures
per minute throttle even after backend restart; success resets the window and
creates the opaque hashed-token session in the same transaction. Avoid throwing
inside that transaction for ordinary password rejection, which would roll back
the failure count. Crypto work is bounded by the serialized access-row lock.

HTTPS Cookie is `__Host-monos`, Secure, HttpOnly, SameSite=Strict, Path=/, no Domain.
HTTP Cookie is `monos` with the same flags except Secure, allowing certificate-free
local use. Select and clear only the cookie for the actual listener protocol;
never fall back to the other name. Both modes require the same server-side session.
Explicit Bearer takes precedence; invalid Bearer never falls back to Cookie.
Duplicate Cookie names fail authentication. Cookie writes and login require Origin
equal to the request's HTTP(S) origin. Forwarded headers are not trusted by default.
Keep the frontend same-origin. Forwarded protocol/host headers do not change the
cookie mode or accepted Origin. Direct TLS or TLS pass-through preserves HTTPS
behavior; TLS termination into HTTP is not automatically trusted. See
[optional transport](../protocol/transport.md). All Owner responses are no-store.

Expired/revoked sessions cannot read or mutate. Logout is idempotent for a syntactically
valid token, even after expiry. Runner and Attempt routes still require their own
Bearer scopes. No session token appears in login JSON. Authenticated `OwnerSessionStatus` includes
the existing random `session_id` UUID. It is non-authenticating and only partitions
Task draft/recovery state. Optional `X-Monos-Session` on supplied Owner requests
authenticates the captured Cookie/Bearer and then checks the UUID before routing;
a mismatch is `unauthorized`. Header omission retains old automation compatibility.
A preliminary session GET cannot replace this actual-request check because another
tab can replace the Cookie before POST.

## 4. Validation & Error Matrix

| Condition | Result |
| --- | --- |
| Uninitialized access or wrong password | `unauthorized`, no session |
| Too many failed logins | `rate_limited`, HTTP 429, Retry-After: 60 |
| Invalid password shape/size or logout body | `invalid_input` |
| Repeat bootstrap without rotation | `unmet_precondition` |
| Cross-origin/missing-Origin Cookie write or login | `denied_scope` |
| Missing, duplicate, expired or revoked session | `unauthorized` |
| Supplied session UUID differs from authenticated request | `unauthorized`, no route/receipt/effect |
| Explicit credential rotation | Old sessions revoked; new password required |

## 5. Good / Base / Bad Cases

Good: rotation invalidates every previously issued session. Base: browser sends its
HttpOnly cookie to same-origin reads. Bad: an API error rolls back the failed-password
counter or a password/token appears in process arguments, responses or diagnostics.

## 6. Tests Required

`postgres-owner-access.test.ts` covers initialization/hash storage, concurrent failure
accounting, restart/throttle reset, rotation, real HTTP/HTTPS cookie flags and
session reads/logout, origin/duplicates, forwarded-header rejection, expiry and
a real native CLI bootstrap subprocess with synthetic stdin. Preserve
all earlier Owner/Runner/Attempt scope and protocol fixtures.

## 7. Wrong vs Correct

Wrong: open an unauthenticated setup endpoint or put a password in a shell argument.
Correct: trusted local stdin bootstrap, authenticated same-origin login, and opaque
server-validated sessions.


## Same-origin Web serving

`createApp(service, tls?, webRoot?)` optionally serves the built SPA shell at `/`
with no-store and hashed files under `/assets/` with immutable caching. Use the
static plugin's bounded root/path handling; never serve the source tree or use SPA
fallback for API routes. Preserve 400/403/404 for denied/missing static paths without
exposing filesystem diagnostics. Production `main.ts` points at `apps/web/dist`;
Docker builds the SPA before copying its output to the server image.
