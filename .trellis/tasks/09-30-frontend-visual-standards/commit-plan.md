# Proposed commit batch

One work commit: `docs: align frontend standards and tasks with Multica`

## Included files

- `.trellis/spec/frontend/component-guidelines.md`
- `.trellis/spec/frontend/directory-structure.md`
- `.trellis/spec/frontend/index.md`
- `.trellis/spec/frontend/quality-guidelines.md`
- `.trellis/spec/frontend/visual-design.md`
- `.trellis/tasks/09-28-a-integration-acceptance/prd.md`
- `.trellis/tasks/09-28-a-review-delivery/prd.md`
- `.trellis/tasks/09-28-a-task-execution/prd.md`
- `.trellis/tasks/09-28-v1-install-operations/prd.md`
- `.trellis/tasks/09-28-v1-release-evidence/prd.md`
- `.trellis/tasks/09-30-a-execution-ui/check.jsonl`
- `.trellis/tasks/09-30-a-execution-ui/implement.jsonl`
- `.trellis/tasks/09-30-a-execution-ui/prd.md`
- `.trellis/tasks/09-30-a-task-execution-acceptance/prd.md`
- `docs/07-owner-review-and-ui.md`
- `docs/11-technology-and-deployment.md`
- All task artifacts under `.trellis/tasks/09-30-frontend-visual-standards` (PRD, design, plan, manifests, research, handoff and verification).

## Preserve existing edits

The Task execution parent PRD already had unrelated changes before this session. Stage only the visual requirements/acceptance additions from this task; retain its prior child-completion/archive-link edits as unstaged work. Baseline captured at `/tmp/monos-frontend-visual-baseline.json`. Recheck concurrent changes before staging any file.

## Excluded dirty paths

- `.trellis/spec/backend/index.md`
- `.trellis/spec/protocol/index.md`
- `.trellis/spec/runner/index.md`
- `.trellis/tasks/09-30-a-task-conversation/check.jsonl`
- `.trellis/tasks/09-30-a-task-conversation/implement.jsonl`
- `.trellis/tasks/09-30-a-task-conversation/prd.md`
- `.trellis/tasks/09-30-a-task-conversation/task.json`
- `apps/server/src/app.ts`
- `apps/server/src/artifacts.ts`
- `apps/server/src/dispatch-queue.ts`
- `apps/server/src/main.ts`
- `apps/server/src/node-completion.ts`
- `apps/server/src/node-execution-state.ts`
- `apps/server/src/node-execution.ts`
- `apps/server/src/owner-execution.ts`
- `apps/server/src/runtime-scheduling.ts`
- `apps/server/src/service.ts`
- `apps/server/src/task-planning-state.ts`
- `apps/server/src/task-planning.ts`
- `apps/server/src/task-records.ts`
- `package.json`
- `packages/db/src/migrate.ts`
- `packages/domain/src/commands.ts`
- `packages/protocol/fixtures/validation.json`
- `packages/protocol/generated/go/contracts.json`
- `packages/protocol/generated/go/types.go`
- `packages/protocol/generated/openapi.json`
- `packages/protocol/generated/types.ts`
- `packages/protocol/schemas/v1/contracts.json`
- `packages/protocol/scripts/generate.mjs`
- `runner/cmd/monos/main.go`
- `runner/cmd/monos/main_test.go`
- `runner/internal/adapter/opencode.go`
- `runner/internal/daemon/recovery.go`
- `runner/internal/host/effect_scope.go`
- `runner/internal/host/helper.go`
- `runner/internal/local/node_test.go`
- `runner/internal/local/socket.go`
- `runner/internal/wire/fixtures_test.go`
- `runner/internal/wire/scope.go`
- `runner/internal/wire/wire.go`
- `.trellis/spec/backend/task-conversation.md`
- `.trellis/tasks/09-30-a-task-conversation/design.md`
- `.trellis/tasks/09-30-a-task-conversation/implement.md`
- `.trellis/tasks/09-30-a-task-conversation/research/`
- `.trellis/tasks/09-30-a-task-conversation/verification.md`
- `apps/server/src/task-conversation-reads.ts`
- `apps/server/src/task-conversation-state.ts`
- `apps/server/src/task-conversation.ts`
- `apps/server/src/task-guidance.ts`
- `apps/server/test/fixtures/task-conversation-fixture.ts`
- `apps/server/test/fixtures/task-conversation-worker.ts`
- `apps/server/test/postgres-task-conversation-lifecycle.test.ts`
- `apps/server/test/postgres-task-conversation-process.test.ts`
- `apps/server/test/postgres-task-conversation-review.test.ts`
- `apps/server/test/postgres-task-conversation.test.ts`
- `infra/probe/task_conversation_driver.py`
- `infra/probe/task_conversation_probe.py`
- `infra/probe/test_task_conversation_driver.py`
- `infra/probe/test_task_conversation_probe.py`
- `packages/db/migrations/0019_task_conversation.sql`
- `packages/protocol/test/task-conversation-review.test.ts`
- `runner/internal/adapter/conversation_test.go`
- `runner/internal/daemon/conversation_recovery_test.go`
- `runner/internal/host/conversation_test.go`
- `runner/internal/journal/conversation_test.go`
- `runner/internal/local/conversation_test.go`

## Approval and bookkeeping

The Owner approved this commit batch with “提交” on 2026-09-30. Commit only the described changes, then archive this task and record the session through the project finish workflow. No remote push is requested. Recheck relative links after archive, including inbound migration-handoff links.
