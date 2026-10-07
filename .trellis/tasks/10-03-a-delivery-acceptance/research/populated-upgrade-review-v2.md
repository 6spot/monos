# Populated upgrade helper re-review

Active task: `.trellis/tasks/10-03-a-delivery-acceptance`.

Reviewer: `/root/review_final_check`, 2026-10-07. **READY for the isolated preflight after root confirms the build worker has released the host slot and binds the candidate image.** This approves the repaired helper's static safety boundaries; it does not establish successful clone execution, coordinated installation backup, quiescence or upgrade of the existing installation.

The original [NOT READY report](populated-upgrade-review.md) is retained unchanged, SHA256 `8a0eaea1500b7adb03eb050dd0aa4e4595a82469e30b423cde989db9feb6b460`. Reviewer writes only this v2 report; root owns both helpers and execution.

## Findings (fixed)

- File: `populated-upgrade.py`. Root replaced nonzero-inspect absence inference with successful full-ID Docker inventories. Failed or malformed observations remain unconfirmed. Missing-name and post-stop branches require the original captured ID absent when known and a successful empty run-nonce/role inventory; renamed original containers cannot silently pass absence.
- File: `populated-upgrade.py`. Both clone and observer names, random run nonce, roles and intended images are retained before admission. Cleanup discovers an uncertain original creation by its declared name and validates actual ID, captured ID when available, immutable expected image and both ownership labels before stopping. Unknown or foreign ownership is retained as failure without a foreign stop.
- File: `populated-upgrade.py`. The observer now has its own declared name/role and cleanup runs observer first, then PostgreSQL. A timed-out attached Docker client no longer leaves an untracked observer. Per-container cleanup catches exceptions/timeouts, preserves their uncertainty and attempts both cleanup paths. The exclusive result is persisted before an unconfirmed-cleanup error is raised.
- File: `populated-upgrade.mjs`. The `pg` loader is anchored at its owning `/app/packages/db/package.json`, matching the candidate's production dependency layout. Actual DB/migrator imports remain the candidate's code, without server pumps.

These repairs were root edits; no helper source or production file was changed by the reviewer.

## Findings (not fixed)

No actionable issue remains at the reviewed hashes. The private live dump is deliberately not the later coordinated stopped-service backup. Root must retain fresh actual source-container/candidate identities and the exclusive execution artifacts; no installed/native/workspace/provider acceptance follows from this static READY.

## Confirmed boundaries

- Primary access remains only the fixed local-container `pg_dump`; source credential expansion stays inside that container. No primary SQL/migration, service restart or workspace/provider command is introduced.
- The new PostgreSQL container uses the pinned image, tmpfs, no host ports and `--network none`; Node shares only that clone network namespace. Clone credentials live in root-only files rather than host argv/reports. Candidate CMD is overridden by the observer, so backend pumps are not started.
- The observer verifies Node24.21.0/PostgreSQL17.11 and explicit clone database/user/loopback identity. Complete original public tables/columns are read under repeatable-read read-only snapshots; sorted JSONB row hashes and counts preserve actual values and multiplicity. After actual candidate migration twice, all old columns/rows and prior21 checksum rows must match, schema25 must exist and newly created delivery/review tables must be empty.
- Failed commands and unavailable cleanup remain failures. Successful Docker inventory absence is the evidence basis; a failed inspect/stop or lost response alone supplies no absence claim. This preflight makes no native physical-settlement assertion.

## Verification

- Read both repaired helpers completely; then inspected the final added exact-ID/nonce inventory guards and reconciled final hashes. Reviewed unchanged candidate Dockerfile and actual DB/migrator callees during the initial pass.
- Root-reported Python/Node syntax checks: PASS, reused without rerun. Static inspection only by this reviewer; no helper runtime, product test, host/provider/Agent action, commit or lifecycle dispatch performed.
- Scoped `git diff --check` and retained original-report hash checked. Files are untracked task artifacts; final report whitespace is inspected directly because an untracked file is not included in Git diff output.
- No duplicate unit or archived-suite replay is required. The actual clone run will provide the appropriate restore/migration/comparison and cleanup evidence; any failed run remains a separate immutable trial.

## Reviewed SHA256

| Input | SHA256 |
| --- | --- |
| `populated-upgrade.py` | `f25edbabf59cb077d50d6c71a906ee665062447ac1db99cebab61456f873aa7f` |
| `populated-upgrade.mjs` | `3ab65e5cf3d5afa90275c42c247f2f640cf583f15c3c620d05bf7188129c4f13` |
