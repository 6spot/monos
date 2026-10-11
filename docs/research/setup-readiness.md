# Installation configuration and connection diagnosis

Status: implemented as the next installation/operations slice after `11f221e`.

The current health endpoint verifies a database round trip. The installation
contract also needs actionable configuration and connection observations before
creating a Task. This slice adds an Owner-authenticated read and a local command
that consumes it. It keeps host execution and provider verification explicit.

## Contract and change boundary

`GET /v1/owner/setup-readiness` returns a bounded `SetupReport` with a single
observation time: migration version, configuration version, current Runner
connections and installation facts, effective Planner policy, and each active
Project's selected available Roles and effective policies. A missing policy or
unavailable target includes the actual selection reason and a recovery action.

The backend takes one repeatable-read snapshot before authentication and shares
one timestamp across heartbeat checks. The read reuses scheduling's target,
installation, Auto placement and fallback rules. It does not reserve capacity,
lock Runners for admission, create Tasks/Attempts or execute repository/model
operations. Admission retains its existing locks and queue behavior. Busy capacity
does not make configuration invalid, and repository-free work needs no GitHub
configuration.

The report always identifies storage, CLI authentication, model execution and Git
read/write permission as unverified. A detected CLI version or online Runner does
not establish those facts. An available policy is a current selection observation,
not authorization or a promise that a later Task will execute.

`pnpm doctor` reads a bounded private JSON object from stdin with backend endpoint,
Owner password and optional CA path. It logs in through normal Owner access,
reads the report and revokes that session in a bounded cleanup request. Only the
validated report reaches stdout. Credentials remain in memory; standard session
maintenance is the only write performed by the command. Network errors, malformed
responses and cleanup failure return sanitized errors. HTTP(S) origin checks,
normal TLS trust plus optional custom CA, deadlines and redirect rejection apply.

This slice does not add a monitoring service, Web dashboard, automatic repair,
storage probes, coding-CLI login or model execution. The diagnostic module and
shared selection helpers belong to the backend; the protocol owns the response;
the local CLI owns only transport/session cleanup and presentation.

## Verification

Use real PostgreSQL for empty/configured states, authentication, current versus
stale Runner facts, policy priority/fallback/Auto ambiguity and absence of domain
writes. Exercise actual HTTP/TLS CLI login/read/logout, malformed or oversized
responses, redirects, session cleanup and secret-free output. Run focused
scheduling regressions after extracting shared read logic. Native acceptance
remains deferred.

## Verification results

- `pnpm test`: 916 passed, including 11 report contract cases and 24 controlled
  HTTP/TLS/native Node CLI cases. Typecheck, lint, build and protocol generation
  drift checks passed. Native type-erasure import of the server module passed.
- PostgreSQL: 11 setup-report cases and 19 existing Runtime scheduling cases
  passed. They cover Bearer/cookie authentication, a consistent snapshot during
  concurrent commits, stale/offline/ambiguous selection, exact fallback parity,
  no Runner locks or domain writes, migration gaps and response bounds.
- Generated Go consumers all compiled; existing wire tests passed. Runner source
  is unchanged from `11f221e`, whose complete race suite passed, so the Host
  Git/workspace race suite was not repeated for this Owner-only diagnostic read.
- Independent read-only review closed the missing-Runner action mismatch and
  logout session-header issue. The report GET retains its expected-session
  header; idempotent cookie logout omits that live-session guard so expiry or
  rotation during diagnosis does not prevent cleanup.

No SSH, deployed service, installed coding CLI, model execution or provider
operation was used for this slice. All five unverified capabilities remain
explicit in successful reports; configuration success is not native acceptance.
