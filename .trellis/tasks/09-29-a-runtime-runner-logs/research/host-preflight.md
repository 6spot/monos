# Real-host preflight (2026-09-29)

Owner supplied password SSH access to the previously authorized Linux test host `100.120.14.84` for this task. Read-only checks confirmed Debian 13, Linux 6.12.107, Docker and the `me` execution account. Installed OpenCode 1.18.30 remains at `/home/linuxbrew/.linuxbrew/bin/opencode`. No live model call or catalog price check has yet run for this task.

The accepted historical installation still runs as `monolab-probe-runner.service` with its separate Compose server/database and port `127.0.0.1:18443`. Its `/var/lib/monolab-probe`, `/etc/monolab-probe` and binaries remain intact. Fresh `monos-probe` paths, account/group and unit do not exist. Do not migrate or replace the old installation as part of this leaf; `docs/12-product-naming-and-upgrades.md` requires coordinated quiescent migration.

Real acceptance should use a fresh task-owned `monos-probe` installation beside the old one, with an alternate host HTTPS port (for example 18444) and matching Runner endpoint in its private non-secret config. The fresh staging copy may adjust its Compose host port; source templates in this repository remain unchanged. Preflight/bootstrap must reject any unexpected collision. Build Runner binaries in a task-owned Linux Go environment, keep credentials private, and run only test fixtures. Do not reboot the host or alter the old `monolab` services. Before any LongCat invocation, refresh the exact Attempt catalog and verify active tool support and zero input/output/cache prices.

Any deployment or smoke result must identify its source revision, private staging path, selected model and service/attempt identities, and retain unresolved journals before cleanup. Do not infer production readiness from local tests or historical `monolab` evidence.
