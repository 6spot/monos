# Actual populated upgrade preflight

Active task: `.trellis/tasks/10-03-a-delivery-acceptance`. Root execution, 2026-10-07. **PASS for the isolated real-data copy only.** Existing services/database remain unchanged; installed/native/App acceptance and coordinated maintenance backup remain open.

## Frozen input and execution

- Candidate commit `63eaa285ab90fdd6de018671a47ba5583f87bc75`; exact server image `sha256:de8f15a1b9b60f9b013abaa167100f84f518ac3304afc0ab98d408efc8fd7434`.
- Original private live `pg_dump -Fc` SHA256 `2322f194cabf970cb5ae482f2459d72a587c07ba1024ccf04ae65194d33f0abb`. V2 caches and verifies those exact V1 bytes before copying/restoring; no second primary dump or primary SQL migration occurred.
- Reviewed Python helper `2f61ad0ac1dc23fb551410a3590dbcfb8e23b37b9d6f526cc3717c49f49c177d`; Node observer `3ab65e5cf3d5afa90275c42c247f2f640cf583f15c3c620d05bf7188129c4f13`. Exact transferred hashes and successful SSH closure are retained in [transport receipt](populated-upgrade-v2-transport.json).
- Fresh private namespace `/root/monos-delivery-populated-upgrade-v2`; PostgreSQL17.11 pinned digest, no host ports, network none, tmpfs. Candidate Node24.21.0 shares only this clone network namespace. Actual DB/migrator imports override the server CMD; no backend pump/Owner/Agent/provider action runs.
- Restore and migration observer commands returned0. Actual candidate `migrate` executed twice against the copy. Private raw streams/dump/password/URL remain in root-only directories; only safe hashes/counts/status metadata is tracked.

## Observed preservation

[Actual observation](populated-upgrade-v2-populated-upgrade.json), SHA256 `fc94944e9ddeee4326e10be6569755e3a289a94750fbdf12e6f400c32ace0d9b`, has all four checks true:

1. All85 original public tables,3478 original rows, original columns and duplicate multiplicity have identical sorted-row SHA256/counts before and after; this includes32 Tasks and88 Attempts.
2. Original21 ordered migration checksums remain exact.
3. Exact25 applied migration versions exist after two migration calls.
4. All37 new delivery/review/publication tables remain empty without pumps.

[Result/cleanup](populated-upgrade-v2-result.json) records actual task-owned observer absence and exact clone Stop with successful Docker inventory absence on its second post-stop observation. It checks original ID, name and nonce/role; no unrelated service/container was stopped. Controller returncode0 and SSH closure are confirmed. This clone cleanup does not claim installed native process quiescence.

## Retained first failure

[V1 result](populated-upgrade-v1-result.json) remains failed. It produced no Node observation and retained only generic RuntimeError; its precise runtime cause is unknown. Its first immediate cleanup observation was unconfirmed after Stop0. A separate [actual reconciliation](populated-upgrade-v1-reconciled.json) confirms original ID absent and zero matching task clones; it resolves cleanup only, not the failed preflight.

The reviewed V2 helper adds private per-stage diagnostics, exact prior-byte reuse and bounded read-only post-stop inventory polling. V2 success does not prove the cause of V1 failure. All previous NOT READY/READY reports remain separate and immutable.

## Remaining gate

The live snapshot is not the authoritative stopped-backend/stopped-Runner backup. Installation still needs full ownership/native/workspace observation, old REVIEW prospective canonical-source review, exact maintenance exclusion/backup/rollback approval and installed history reconciliation. Actual App configuration remains absent in current observed databases. All six PRD acceptance criteria remain open.
