# Backend Development

Current stage: [pre-use development](../../../docs/12-product-naming-and-upgrades.md). Historical architecture, version and data compatibility are not required; implement and verify the current version. Current-run recovery and ownership contracts still apply.

Status: `apps/server` implements the Stage A foundation, Todo Discussion/Task creation,
explicit initial planning and canonical Single-Node execution with Artifacts and
completion recovery, ordered Task Conversation, explicit guidance handling and exact
Specification revision settlement and independently accepted one-Node replacement
Plans with standalone/joint publication and independent exits, exact local/remote
preparation and Owner delivery for zero/one modified automatic GitHub repository.
Explicit review correction is implemented; combined installed acceptance remains a later gate. See [root](../index.md), [quality evidence](quality-guidelines.md)
and [technology](../../../docs/11-technology-and-deployment.md).

## Pre-Development Checklist

- Read [directory structure](directory-structure.md) for ownership.
- For Runtime policies, registry or GitHub secrets, read [infrastructure configuration](infrastructure-configuration.md).
- For Project/Role edits and selection guards, read [configuration](configuration.md).
- For login/bootstrap/Cookie security, read [Owner access](owner-access.md).
- For overview/Timeline/cursors, read [Owner reads](owner-reads.md).
- For Todo capture, organization and Inbox reads, read [Todos](todos.md).
- For ordered Todo input, Planner replies, cache and Retry/Withdraw, read [Discussion](discussion.md).
- For exact proposal confirmation and independent Task creation, read [Task preview](task-preview.md).
- For explicit Start, initial Plan/issue and pre-Plan controls, read [Task planning](task-planning.md).
- For Single-Node dispatch, Artifacts and completion recovery, read [Node execution](node-execution.md).
- For ordered Task input, independent conversation authority and guidance handling, read [Task Conversation](task-conversation.md).
- For exact requirement proposals, authorization and settled publication, read [Specification revisions](task-specification.md).
- For replacement graphs, joint publication and private-work transfer, read [Replan](task-replan.md).
- For selected Attempt status, ordered output and resumable log cursors, read [Execution logs](execution-logs.md).
- For exact local completed-result files/diffs through Runner, read [Result content reads](result-content-reads.md).
- For automatic local candidates, immutable scans and exact finding receipts, read [Publication candidates](publication-candidates.md).
- For exact GitHub push/PR preparation, uncertain effects, checks and Cancel cleanup, read [Remote preparation](remote-preparation.md).
- For selected Attempt queue/promotion, read [dispatch queue](dispatch-queue.md).
- For canonical repository admission, serial leases and ephemeral fetch access, read [workspaces](workspaces.md).
- For production Runtime target choice and shared capacity, read [Runtime scheduling](runtime-scheduling.md).
- For verified native failure, settled same-Runner fallback and source recovery, read [Runtime continuation](runtime-continuation.md).
- For revision/activation publication, read [Task records](task-records.md).
- For Owner sessions/proposal consumption, read [Owner commands](owner-commands.md).
- For commands/persistence, read [database](database-guidelines.md), [errors](error-handling.md) and [protocol](../protocol/commands.md).
- For acceptance/messages/provider effects, read [delivery contracts](delivery-contracts.md).
- For exact Owner prepare/confirm/Accept, frozen Retry/Cancel and GitHub finality,
  read [Owner delivery](owner-delivery.md).
- For Request Changes, immutable input reconsideration and review-origin exits, read [review correction](review-correction.md).
- Read [logging](logging-guidelines.md) and [quality](quality-guidelines.md) before workers.
- Linux effects require [Runner](../runner/index.md); UI requires [Frontend](../frontend/index.md).

## Quality Check

- State, receipts and outbox commit atomically; external effects run outside transactions.
- Database and host/provider ownership prevent duplicate effects.
- Later chat cannot block a frozen accepted delivery batch.
- Rejected commands, admitted recovery and objective Runtime failures remain distinct.
- Run established affected checks and report unverified external assumptions.
