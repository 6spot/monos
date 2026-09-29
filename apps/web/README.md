# Owner Web client

A same-origin React/Vite SPA for Todo capture/organization, Owner login, Projects/repositories, reusable Roles,
execution policies, Runner installation observations and GitHub App configuration.
The backend remains authoritative; UI writes use versioned commands and immutable
receipts. Session cookies and provider keys never enter browser persistent storage.

## Run

Use the root workspace Node/pnpm versions and `pnpm install --frozen-lockfile`.
`pnpm build` builds both backend and Web output. The normal HTTPS backend serves
`/` and hashed `/assets/` files after the local Owner bootstrap described in
`apps/server/OWNER_ACCESS.md`. The production Docker target includes Web output.

For development, run the TLS backend at `https://127.0.0.1:18443`, trust its test CA
with `NODE_EXTRA_CA_CERTS`, and run `pnpm --filter @monos/web dev`. Open exactly
`http://127.0.0.1:5173`. The fixed loopback proxy verifies TLS and translates only
this local Origin to the backend origin; foreign/missing Origins still fail guards.
Do not use the development server as production ingress.

## Verify

- `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm protocol:check`, `pnpm build`.
- Install test Chromium with `pnpm --filter @monos/web exec playwright install chromium`.
- Set `MONOS_TEST_WEB_DATABASE_URL` privately to a test-capable PostgreSQL database,
  then run `pnpm --filter @monos/web test:e2e`. Do not put credentials in argv or logs.

The browser fixture creates/migrates a unique `web_test_<uuid>` schema, uses synthetic
Owner credentials, listens only on `127.0.0.1:18555`, and drops only its own schema
on graceful shutdown or startup failure. Playwright explicitly sends SIGTERM and
allows up to 15 seconds for cleanup. PostgreSQL must allow schema creation; ports 18555
and any chosen local DB tunnel must be available. Tests use real HTTP/backend/DB
flows; only GitHub repository access is mocked. Chromium's loopback secure-context
exception permits the Secure cookie in this test harness; production requires HTTPS.
Screenshots and failure traces are local ignored `test-results/` artifacts.

## Boundaries

`src/lib/api.ts` consumes generated protocol types and the shared browser-safe AJV
entry. Never import DB/server code or the Node crypto protocol entry into Web.
The source-owned shadcn Button uses Base UI (`base-nova`); add primitives only when
needed. Todos is the default view. Explicit settings routes and Todo scopes use
native hash navigation; mounted views retain scoped memory-only drafts.

Todo capture preserves the exact original text and invokes no model. The workspace
provides All active, Inbox, Project and Archived scopes, bounded list pagination,
Project assignment and archive/restore. No Todo opens until selected or captured
in the visible scope. Mobile detail has an explicit return to the list. Discussion
and Task creation are separate follow-up work.

Todo commands retain their exact request and draft until a committed response is
validated. Check Todo result first looks up the receipt and only replays the same
command when the server reports it unknown. Stale organization drafts retain their
original version until explicitly reloaded. Browser regressions cover these cases,
keyboard opening, scope changes and mobile list/detail behavior against the real
backend and isolated PostgreSQL schema.

Save conflicts retain the draft/version for explicit review. Unknown write outcomes
retain the original request for Check save result; keep the tab open to recover it.
Reloading the whole page discards local drafts/pending requests. Installation detected
means a reported version check, not CLI login/model/tool readiness. Stored policies
are consumed by future production Runtime integration, not the fixed boundary probe.
