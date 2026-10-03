# Exact local result review

## Goal

Let the Owner inspect the exact immutable local Task result, changed files and diffs before delivery, even when remote preparation is unavailable.

## Background

The Task execution package is accepted and archived. Current completion records retain exact Runner-owned result manifests, but Owner result reads only expose metadata. This first Review/delivery leaf adds bounded read-only inspection; publication and acceptance remain later leaves.

The user explicitly delegates planning, implementation and routine decisions for successive roadmap tasks without further authorization. Apply that standing authorization through the Trellis planning transition.

## Requirements

- Resolve current result evidence from the effective Specification, Plan and valid completed Node activations; preserve history as distinctly historical evidence.
- Read immutable files and Git diffs through the owning Runner and its exact storage/materialization/result identity. The backend must never open Runner paths locally or substitute a mutable worktree/current remote revision.
- Bind each read to the selected result identity, use bounded responses, validate repository paths, and report stale, missing, offline, binary or oversized content honestly.
- Present the result and changed files in the existing Task detail UI with usable desktop/mobile layouts, safe text rendering and accessible controls.
- Reads cannot start Agents, mutate Task state or workspaces, expose delivery credentials, or perform remote Git writes. Provider failures cannot hide the local result.

## Acceptance Criteria

- [x] An authenticated Owner can list changes and inspect text files/diffs for the exact current completed result; previous completion evidence remains distinguishable.
- [x] Wrong Task/result identity, mismatched retained materialization, traversal and unavailable Runner/storage do not return substituted content.
- [x] Responses have explicit size limits and clear binary/oversized/scan-limit outcomes; all supported repository collections remain complete within documented bounds.
- [x] Result reads leave Task control, result refs and workspace files unchanged and do not invoke an Agent or provider mutation.
- [x] Cross-layer tests cover exact identity, failure states and meaningful file/diff behavior; desktop/mobile screenshots are captured and inspected against frontend quality guidance.

## Out of Scope

Public candidate construction, publication-range findings/overrides, GitHub push/PR/check/merge operations, Owner delivery acceptance, Request Changes delivery guards, distributed workspace transfer and disk-loss recovery.

## Integration Compatibility

Real PostgreSQL verification exposed existing Board pagination rejecting Singapore's historical minute-offset epoch text. Include a minimal valid timestamp-offset decoding fix and real pagination regression; preserve exact timestamp/cursor semantics and existing UTC behavior.

## Technical Notes

The source-backed research selects the existing service-private completion export, exact original operation/start/effect/storage verification and a bounded correlated read-only WSS channel. `design.md`, `implement.md` and the curated implementation/check contexts are complete. No blocking product or technical question remains.

Read limits are 512 KiB encoded response, 64 KiB raw file/diff, 64 changes per page, separate complete-scan ceilings of 8 MiB/8192 records, 10-second Runner round-trip/physical-read budgets and 8 global/4 per-Runner concurrent reads. These are inspection limits, not capture or publication limits. The time budget does not promise end-to-end HTTP completion within 10 seconds: initial/final database authorization retains existing Owner-read semantics, and delayed final authorization never permits returning unchecked private content. Unsupported names/size/storage must remain explicit.

Inspection uses original fixed base versus exact integrated result and supports deletion/base inspection, symlink target text without following, and gitlink metadata without fetching. Full repository browsing is outside this leaf. Browser fixtures prove interaction separately from actual Go Git and authenticated WSS/PG tests; native installed acceptance belongs to the final package leaf.
