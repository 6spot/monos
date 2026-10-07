# Independent populated upgrade helper review

Active task: `.trellis/tasks/10-03-a-delivery-acceptance`.

Reviewer: `/root/review_final_check`, 2026-10-07. **NOT READY for execution** at the initial inspected revision. Root has received the concrete findings below; re-review of the owned helper after repair is required. Reviewer writes only this report, performs no helper/test/host/provider execution and preserves concurrent edits.

## Findings (fixed)

None yet at the initial inspected revision.

## Findings (not fixed)

1. File: `research/populated-upgrade.py`, cleanup in `finally`. Any nonzero `docker inspect` is treated as absence. Docker daemon, permission or command errors therefore can set `clone_cleanup_confirmed=true` without proving the original clone was removed. Require a successful authoritative Docker inventory and exact original identity absent; failed observation retains uncertainty.
2. File: `research/populated-upgrade.py`, clone creation and cleanup. `created` is assigned only after successful captured `docker run` output. Timeout/lost response can leave a clone running while the helper has no captured ID and performs no discovery. Retain the predeclared name and unique ownership intent before admission; reconcile exact owned identity after uncertain creation without assuming no container exists or deleting a foreign match.
3. File: `research/populated-upgrade.py`, Node observer launch. The attached Node container is unnamed and untracked. A timed-out attached Docker client can leave it alive with the clone network and private evidence mount; current cleanup targets only PostgreSQL. Retain a separate observer identity/intent, reconcile uncertain launch and stop/verify both original containers.
4. File: `research/populated-upgrade.py`, cleanup failure persistence. A timeout/exception inside `finally` before `save(result.json)` bypasses the failure/cleanup report. Collect cleanup exceptions as uncertainty, persist the original identities and report, then fail. A cleanup error must not erase the original failure or report pass.

These are concrete helper safety/evidence defects, not product architecture changes. Root owns their fixes. No duplicate unit matrix or archived product suite is requested.

## Static boundaries checked

- The only primary command is fixed `docker exec monos-boundary-probe-database-1 ... pg_dump`. PostgreSQL username/database expansion occurs inside that container; no password enters host argv or reports. This is a read-only live snapshot, not the coordinated stopped-service installation backup.
- Clone intent uses an exclusive private root directory, random new container name, pinned PostgreSQL image, no host ports, `--network none`, task-owned password file and tmpfs. The Node image is required to be immutable; its network namespace is the clone's, not host/production. Private password/URL files remain under root-only evidence storage. Root must separately bind the candidate image and current source-container facts before execution.
- The candidate Dockerfile has no ENTRYPOINT, so overriding CMD with the observer starts Node/migrator rather than backend pumps. DB module imports create no server/pump or primary connection; URLs are explicit clone-local identities.
- The observer reads all original public tables/columns in one repeatable-read read-only transaction. Sorted complete JSONB row aggregation plus counts retains duplicates and hashes actual values. After actual candidate `migrate()` twice, it compares the original columns and multiplicities, excluding only newly appended migration versions from the old migration-table comparison.
- Prior21 migration rows/checksums, exact final25 and empty new tables are explicitly checked. Canonical migration code validates existing ordered checksums and runs additive migrations under one transaction/advisory lock. Node24.21.0/PostgreSQL17.11 checks prevent a different runtime from silently claiming the intended environment.
- No actual private dump, clone restore, migration, source table comparison, physical ownership, native/workspace or provider effect has been observed by this reviewer. A static match is not execution evidence.

## Verification

Read-only initial scoped status, both complete helper sources, current design, unchanged DB/migrator modules and candidate Dockerfile inspected. Initial helper files are untracked; root owns both, build worker and SQL research worker remain concurrent and untouched. No source edit or runtime/test invocation performed. Final helper hashes and READY/NOT READY status will follow the frozen repaired revision.
