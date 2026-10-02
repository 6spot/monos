# Task execution integration acceptance

## Goal

Verify the full real Task execution package through Owner and native Runner entrypoints.

## Requirements

- Configure task-owned Project/resource/Role through Owner commands on the existing host and execute capture→preview→Task→Start→Plan→Node→local REVIEW.
- Combine real conversation/guidance/revision/replacement/Stop recovery with deterministic race/crash evidence and responsive browser tests.
- Check current model availability/zero pricing before native trials, preserve successes/failures/source hashes and settle every trial process/effect.
- Accept only this package; remote delivery and full Stage A/V1 gates remain separate.

## Visual requirements

Apply the [visual contract](../../spec/frontend/visual-design.md) to the actual capture→preview→Task→local REVIEW browser flow. Integrated visual acceptance waits for both execution UI and the separately planned [existing-screen migration](../10-02-a-existing-screen-visual-migration/prd.md).

## Acceptance criteria

- [ ] Actual build screenshots at desktop/mobile sizes are inspected under the [visual quality gate](../../spec/frontend/quality-guidelines.md); shared shell, controls, Conversation/Overview/Timeline and local REVIEW are coherent, with any deviations recorded.

- [ ] Native Owner-originated execution uses the real Project repository with no fixture/context fallback and preserves exact output/revision provenance.
- [ ] No duplicate process/workspace/completion/revision arises from reconnect/restart; scoped credentials and private lineage remain protected.
- [ ] All package Owner exits and browser flows have recorded outcomes, all trial ownership settles, and parent acceptance reflects evidence only.

## Dependency and scope

Follows [Execution Board and Task control UI](../archive/2026-10/09-30-a-execution-ui/prd.md) and
[existing-screen visual migration](../10-02-a-existing-screen-visual-migration/prd.md).
Parent links express ownership; this ordering is an evidence gate. The Owner has
authorized sequential execution and routine implementation/test decisions.
No new permanent service, team model, generic workflow engine, automatic Runtime
hang inference, mandatory native session resume or cross-Runner migration.

This is a scoped backlog leaf; complete its design, implementation plan and real
context manifests immediately before starting it. See parent research for seams.
