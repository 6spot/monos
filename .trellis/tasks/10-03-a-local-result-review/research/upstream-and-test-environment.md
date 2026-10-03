# Upstream evidence and isolated validation environment

## Upstream gate

- Task execution package is archived and accepted in `../archive/2026-10/09-28-a-task-execution/`; installed native proof is `../archive/2026-10/09-30-a-task-execution-acceptance/verification.md` (paths relative to tasks root; resolve from repository when using).
- GitHub feasibility child `../archive/2026-09/09-28-github-head-checks/research/verification.md` records actual old-SHA 409, required pending/failure checks 405, unchanged open head and exact-head successful merge 200 on the explicitly authorized synthetic public repository. Private branch protection failed 403 and is not accepted evidence.
- `../archive/2026-09/09-28-github-uncertain-effects/research/verification.md` records one PR-create and one merge with discarded application replies, then fresh exact-identity reconciliation. This does not establish production delivery or packet-level loss injection.
- The feasibility parent remains administratively open. This local read-only leaf needs no new remote effect.

## Current environment

- Node 26.3.0 and pnpm 12.6.0 are available.
- The generic Go shim has no selected version. Use `/Users/me/.local/share/mise/installs/go/1.27.1/bin/go` explicitly or prepend its directory for subprocesses; do not change global tool settings.
- Old test URLs refer to an unavailable local port. A new isolated PostgreSQL 17.10 instance was initialized using the existing embedded binaries. Its private temporary root is recorded in `/tmp/monos-local-review-pg-path`; the root contains `database-url`, `data`, `init.log`, and `server.log`. Read the URL into the child environment without printing it. The instance listens only on 127.0.0.1:55438; each test must still use/drop its own schema.
- Load `pg` through the existing `packages/db` dependency scope (a root bare import fails). A SELECT server_version readiness query passed.
- No native host transport remains open from the preceding installed acceptance, and no host replacement is authorized by this leaf's local validation plan.

These setup observations do not constitute product quality gates.
