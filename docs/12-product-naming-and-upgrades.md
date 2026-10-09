# Product naming and development deployments

The product and bundled Agent CLI are named **monos**. The canonical repository is
[6spot/monos](https://github.com/6spot/monos). Use lowercase `monos` in UI text,
documentation, command examples and executable names.

| Surface | Current name |
| --- | --- |
| Agent command | `monos` |
| Runner and privileged helpers | `monos-runner`, `monos-probe-launch`, `monos-probe-exec` |
| TypeScript workspace packages | `@monos/server`, `@monos/web`, `@monos/protocol`, `@monos/domain`, `@monos/db` |
| Go modules | `monos.local/runner`, `monos.local/protocol` |
| Product environment variables | `MONOS_*`, including `MONOS_SOCKET` |
| Owner session cookie | `monos` over HTTP; `__Host-monos` over HTTPS |
| Fresh probe Compose project | `monos-boundary-probe` |
| Fresh probe database/user | `monos` |
| Fresh probe service/config/storage | `monos-probe*`, `/etc/monos-probe`, `/var/lib/monos-probe`, `/run/monos-probe` |

Generic third-party settings such as `DATABASE_URL`, `HOME`, `XDG_*`, `POSTGRES_*`
and `OPENCODE_*` retain their upstream names. This naming change does not change
Tool Protocol command names, schema version, formal states or immutable receipts.
Current provider-key derivation and database locking are implementation contracts;
their existing bytes do not create a historical-version compatibility obligation.

## Current stage: before actual use

Owner decision, 2026-10-08: monos is a new development project and has not entered
actual use. Historical version, architecture and data migration compatibility are
outside the current development and acceptance scope. This policy supersedes old
upgrade/preservation requirements in prior plans and verification guidance.

Development databases, fixtures and synthetic/native acceptance Tasks do not mean
the Owner has started actual use. Existing test records alone never activate a
migration or backward-compatibility requirement.

- Implement the current design directly. Breaking API, protocol, schema, naming
  and configuration changes update current consumers and fixtures together.
- Do not add old/new dual paths, aliases, compatibility adapters, historical
  ciphertext support or old-database migration machinery just to preserve earlier
  development versions.
- Validate current behavior and fresh schema initialization. Old development
  database upgrades, prior receipt/data preservation across versions and old
  deployment rollback matrices are not required gates or default tests.
- Use a fresh scoped development database/configuration/journal/storage when
  earlier test state no longer fits. Select the intended environment explicitly;
  a different Compose project or volume creates separate state, not a migration.
- Keep current-run authorization, exact-version acceptance, immutable receipts,
  uncertain-effect recovery and physical writer isolation. A running execution
  cannot be reset to fabricate successful settlement.
- Retain recorded trial results as historical evidence. Stop superseded migration
  work instead of reinterpreting those results as current acceptance.

For example, change a payload and regenerate both TypeScript/Go consumers, then
exercise the current payload. Do not add an old-payload parser and upgrade matrix
solely for a previous development build.

## After actual use begins

Migration and compatibility work becomes relevant when the Owner actually starts
using monos. At that point, scope it against real retained data, deployed versions
and running work. Define the required backup, migration and recovery contracts for
that concrete change; no speculative migration framework is required now.

## Historical evidence

Markdown reports and examples use current product terminology. Marked historical
reports are not new executions: exact original commands, paths and test repository
names remain in Git history and raw attachments. Machine-readable acceptance JSON
is immutable, including process names, paths, digests and hashes. Renaming must not
alter observations or imply that older Runtime acceptance validates new binaries.
