# Capture and Discussion integration acceptance

## Goal

Verify the complete capture → Discussion → exact preview → independent Task boundary through real service and browser entrypoints.

## Requirements

- Follow the preceding three leaves. Verify capture/open causes no model invocation, assigned and unassigned Discussion, ordered concurrent messages, shared-slot queueing and atomic final reply/requirement-state commit.
- Verify failed/interrupted input Retry and Withdraw, backend/Runner/browser reconnect and no duplicate final replies.
- Verify stale and repeated preview confirmations from two clients, one independent PLANNING Task, Project association preservation after moving the Todo, and no leaked Todo context or automatic execution planning.
- Recheck exact model availability and zero pricing before new real model calls. Reuse existing host services, preserve failed/successful evidence and settle all trial-owned processes.

## Acceptance criteria

- [ ] Combined deterministic, real-service and browser cases pass with versioned evidence.
- [ ] No trial process, physical claim or unresolved operation is left behind.
- [ ] Parent acceptance is updated from evidence only; full Stage A/V1 is not claimed.

## Scope

No Task execution or delivery implementation. Integration defects are fixed at their owning boundary with regression evidence.
