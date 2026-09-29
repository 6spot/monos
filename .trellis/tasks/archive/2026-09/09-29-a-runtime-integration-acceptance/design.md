# Production Runtime integration acceptance design

## Boundary and evidence

The three implementation leaves are archived. This leaf verifies their combined production scheduling, Runner, command and Owner-read boundaries. Reuse their immutable evidence only after matching current source/binary hashes; do not infer a full Stage A pass. The Owner authorized sequential roadmap execution and routine implementation/test decisions on 2026-09-29, including use of the existing test host. No additional standing service is required.

The remaining behavior gap is integrated queue saturation: two real selected executions must reserve the shared slots while a third Planner remains visibly queued, survives service reconnection and starts exactly once after verified physical release. Add a root-side queue trial using the existing selected fixture, installed OpenCode/monos driver and authenticated Owner reads. Fixture seeding is test administration; actual selection, admission, commands, Stop and reconciliation use production services. Preserve each admission and checkpoint before proceeding.

## Contracts

- Exact selected free-model availability and zero price are checked before every new invocation, including Runner-side launch checks. No provider installation/login or paid fallback.
- Hold a Node and Planner at native tool checkpoints; confirm distinct process identities and two physical reservations. A later Planner has a selected queued Attempt, no process or Start, and is visible through authenticated Owner status/list reads.
- Restart only existing task backend/Runner services while holds are live. Retain dispatch IDs, process birth/boot/cgroup and queued selection; do not create duplicate Starts or release occupied slots on reconnect.
- Release one held driver through its normal formal completion. Verify whole-tree absence before the queued Planner's promotion; assert only one durable Start for each selected dispatch and no oversubscription.
- Release remaining drivers and verify exact formal outcomes, ordered output and all physical claims settled. If a bounded trial fails, save failure evidence and stop only its admitted Attempts through existing authenticated administrative recovery; never delete receipts or journals.
- Existing Stop/reboot evidence is accepted only for unchanged product source and installed binaries. Record the exact checked revision and hashes; rerun affected cases if product code changes. A repeat reboot is unnecessary when the same result already has retained controlled-reboot evidence.

## Change scope and rollback

Expected edits are `infra/probe/queue_probe.py`, meaningful negative evidence tests, harness README, this task's artifacts, and relevant verification/spec records. Product changes require an observed integration defect and a regression at its owning boundary. No Task conversation, second CLI, delivery or release implementation belongs to this leaf. Failed trials retain physical ownership until explicit Stop/reconciliation succeeds. Persistent service/database state and historical evidence are never reset for a clean-looking rerun.
