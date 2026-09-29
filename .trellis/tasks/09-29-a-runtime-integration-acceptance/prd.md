# Production Runtime integration acceptance

## Goal

Verify the complete production Runtime integration before its parent package is accepted.

## Confirmed context

The preceding three Runtime leaves are complete. Current work uses existing test-host services and their immutable evidence, verifying source/binary identity before reuse. On 2026-09-29 the Owner authorized sequential roadmap execution and delegated routine planning, implementation and test decisions without further approval prompts.

## Dependencies

Follow the target scheduling, Runner/log and Stop/recovery leaves. This task checks their combined behavior and owns any integration fixes that cannot be assigned to an earlier leaf.

## Requirements

- Verify the real installed CLI, native `monos` commands, two shared slots, queue visibility, ordered output, scoped command recovery and whole-tree Stop using production service entrypoints.
- Exercise backend/Runner restart and a controlled host restart under the accepted host profile; preserve exact process/operation lineage and no stale writer.
- Record source versions, host/runtime/model facts, successful and failed trials, and limits. Verify model availability and zero price before any new model invocation.

## Acceptance criteria

- [x] Integrated local and real-host cases pass with retained evidence, including queue saturation, missing formal completion, Stop and restart.
- [x] No leftover process, unreleased Attempt or active test resource remains after controlled validation; historical evidence and workspaces remain retained.
- [x] Parent Runtime-integration acceptance is updated only from this evidence; full Stage A/V1 is not claimed here.

See [verification](verification.md) and the source/evidence manifests under `research/`.

## Out of scope

Task conversation, second real CLI/fallback, delivery and full Stage A/V1 acceptance.
