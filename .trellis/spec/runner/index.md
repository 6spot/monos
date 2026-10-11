# Go Runner and Linux Execution

Current stage: [pre-use development](../../../docs/12-product-naming-and-upgrades.md). Historical architecture, version and data compatibility are not required; implement and verify the current version. Current-run recovery and ownership contracts still apply.

Status: the Go Runner under `runner` passed combined production Runtime integration
acceptance on 2026-09-29; recipes are in `infra/runner`. It also implements canonical
Single-Node workspace and repository-free completion, managed Artifact commands
and trusted hard-completion settlement. Task scheduling/context construction is
backend-owned; multi-Node orchestration and delivery remain later work. The Runtime
integration report records two-slot queueing, ordered logs, scoped commands, missing
outcomes, Stop and service/host recovery. Startup after that reboot trial was manual.

## Pre-Development Checklist

- Read [execution](execution-guidelines.md), [workspace](workspace-guidelines.md) and [quality](quality-guidelines.md).
- Read [Planner inspection](planner-inspection.md) for immutable repository snapshots, source proof and service-worker cancellation.
- Read [protocol](../protocol/commands.md) for CLI identity/replay.
- Read [Node execution](../backend/node-execution.md) for canonical source, repository-free completion and paired recovery contracts.
- Read [Task Conversation](../backend/task-conversation.md) for source-specific reads/replies, Stop-only effects and explicit guidance declarations.
- Read [Specification revisions](../backend/task-specification.md) for canonical prepare/apply and exact Owner authority; neither command adds a physical effect.
- Read [review correction](../backend/review-correction.md) for exclusive scratch sources, phase tools and original Stop recovery.
- Read [Replan](../backend/task-replan.md) for its terminal Planner phase and exact cross-Node workspace transfer.
- Read [Result content reads](../backend/result-content-reads.md) for retained completion identity, immutable Git inspection and bounded read-only WSS.
- Read [Publication candidates](../backend/publication-candidates.md) for verified public ancestry, durable candidate CAS, range scans and the independent Delivery lane.
- Read [Remote preparation](../backend/remote-preparation.md) for public object stores, exact nonforce push, private recovery/ACK and permission boundaries.
- Source contracts: [Runtime](../../../docs/03-runtime-and-execution.md), [Workspace](../../../docs/04-workspace-and-git.md), [host topology](../../../docs/11-technology-and-deployment.md).

## Quality Check

Runner owns processes/effects, never semantic scheduling or direct DB updates. Preserve physical ownership beyond logical cancellation. Use durable journal identities for uncertain starts, Git effects and immutable CLI envelopes. Real Linux supervision, two-account Git permissions and installed CLI access must pass the feasibility gate; fake adapters alone are insufficient.
