# Go Runner and Linux Execution

Status: the Go Runner under `runner` passed combined production Runtime integration
acceptance on 2026-09-29; recipes are in `infra/runner`. It also implements canonical
Single-Node workspace and repository-free completion, managed Artifact commands
and trusted hard-completion settlement. Task scheduling/context construction is
backend-owned; multi-Node orchestration and delivery remain later work. The Runtime
integration report records two-slot queueing, ordered logs, scoped commands, missing
outcomes, Stop and service/host recovery. Startup after that reboot trial was manual.

## Pre-Development Checklist

- Read [execution](execution-guidelines.md), [workspace](workspace-guidelines.md) and [quality](quality-guidelines.md).
- Read [protocol](../protocol/commands.md) for CLI identity/replay.
- Read [Node execution](../backend/node-execution.md) for canonical source, repository-free completion and paired recovery contracts.
- Read [Task Conversation](../backend/task-conversation.md) for source-specific reads/replies, Stop-only effects and explicit guidance declarations.
- Source contracts: [Runtime](../../../docs/03-runtime-and-execution.md), [Workspace](../../../docs/04-workspace-and-git.md), [host topology](../../../docs/11-technology-and-deployment.md).

## Quality Check

Runner owns processes/effects, never semantic scheduling or direct DB updates. Preserve physical ownership beyond logical cancellation. Use durable journal identities for uncertain starts, Git effects and immutable CLI envelopes. Real Linux supervision, two-account Git permissions and installed CLI access must pass the feasibility gate; fake adapters alone are insufficient.
