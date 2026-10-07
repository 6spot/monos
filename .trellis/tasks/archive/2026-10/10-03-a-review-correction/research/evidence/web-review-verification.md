# Focused Web review correction verification

Status: **PASS at the Web boundary**, 2026-10-07. No commit or task lifecycle operation was performed by the Web implementer.

## Scope and boundaries

The four focused cases use the current Vite SPA, genuine isolated PostgreSQL, and protected production routes from `createApp`. Helpers create actual Planner sources, promote canonical dispatches, submit source-bound Agent commands, and acknowledge real Stop receipts. They never insert review/revocation/Replan outcomes or terminal Task states. Runtime start/process-absence acknowledgements and upstream Git/permission data are explicitly synthetic. This report does not establish native Runtime, physical absence, live provider, or installed GitHub App behavior.

## Current verification

| Check | Result and scope |
| --- | --- |
| `pnpm exec eslint <16 owned Web paths> --max-warnings 0` | PASS. Later changed correction component, browser fixture and case were each linted again; no other owned inputs changed. |
| `pnpm --filter @monos/web typecheck` | PASS after the capability fix. |
| `pnpm --filter @monos/web build` | PASS; current bundle below. Existing large-chunk warning retained. |
| `pnpm exec vitest run apps/web/src/lib/review-correction-api.test.ts apps/web/src/lib/task-api.test.ts apps/web/src/lib/task-storage.test.ts apps/web/src/lib/owner-delivery-api.test.ts` | Reused 37 PASS from 2026-10-06 09:45 Singapore. API/journal inputs are unchanged by the subsequent component/fixture correction. |
| From `apps/web`: `pnpm exec playwright test --config review-correction.playwright.config.ts` | Current run: 3 PASS, 1 fixture assertion failure, 20.9 s. Issue/receipt/Rework, main-feedback Dismiss/Cancel, and session/selection cases passed. |
| Same command with `--grep 'eligible real accepted revocation'` | After correcting only its input-origin fixture branch, 1 PASS, 10.9 s. Unaffected three cases are reused. Together all four cases have valid evidence. |

The private isolated database URL was loaded from the existing private fixture file into child environment only. It is absent from these reports and command output.

### Observed behaviors

1. Opening/closing/reopening Request Changes submits nothing and restores its draft/focus. Actual Request → source-bound issue → exact Answer & Retry. The committed Retry response is withheld; reload recovers the original receipt once and retains the same operation ID/version advance. Real same-Node Rework enters Running and remains readable in history.
2. Real modified Prepare/Confirm/Accept → later chat → exact eligible revocation. Original accepted attribution survives. Actual `resolve_review_input` with Replan routing transfers the reconsideration; real Owner Dismiss creates its distinct successor. Its issue, Answer & Retry, and independent Withdraw remain usable while the original reconsideration stays **Transferred**. Main feedback is withdrawn separately; revoked batch Retry/Cancel never returns.
3. Main-feedback source-bound graph-insufficient Replan → actual Owner Dismiss with retained feedback and distinct successor. Genuine generic Task Cancel then leaves Cancelled and removes correction mutation authority.
4. Held feedback responses cannot restore private correction text after switching Task or actual logout. Logout clears the previous session journal.

### Defects and failed observations retained

- Earlier runs exposed missing Replan origin projection and generic Cancel leaving correction active. Backend/main fixed actual owning reads and cancellation paths; current main-feedback Dismiss/Cancel passes.
- Read-only final review found `ReconsiderationCard` enabling controls solely from immutable `input.status='pending'`. Transferred input-origin successors could lose Retry/Withdraw. The component now follows the selected operation purpose/canonical capabilities without rewriting history. Withdrawal copy describes the routing obligation for both source purposes.
- The first extended current browser case used generic `request_replan` for an input source, so it observed **Pending**, not the intended terminal input transfer. The fixture now invokes actual `resolve_review_input` with `routing.kind='replan'`. Its first narrow rerun was rejected for missing the required routing basis; adding that exact current basis made the second narrow rerun pass. These were fixture defects, not fabricated product outcomes. No unaffected full run was repeated.
- Earlier selector failures were corrected to actual product labels and explicit history navigation. Earlier screenshots are diagnostics only.
- Final independent review also confirmed the generic input `request_replan` path
  itself was wrongly admitted. Backend and Runner now deny it for reconsideration
  sources and require the canonical `resolve_review_input` Replan transfer. The
  affected PG and Go purpose cases pass. The four browser behaviors already use
  that canonical path; their original loaded hashes and images remain unchanged.

## Input and build identity

All selected metadata records HEAD `0fd3f654704e0ef558aec98dba26312aa107dbe0` plus the dirty candidate, route, test/state, full source SHA-256 inventory, bundle hashes, viewport and image SHA-256. They all captured migration 25 SHA `b3bca7c345ac49f39795ca4f4e5f99abf6fecf094833ccb88c7befcd84266f18`.

| Current artifact | SHA-256 |
| --- | --- |
| `index-mkoA3kwR.js` | `1f5275cc68455ccd9d5a70ad80f0eddbd060a6db6f1b243df4ea2191a7db18f5` |
| `index-CDYDw6Vm.css` | `90913bdae0315da53398e57a8ae6f76c4cbaf2493692e8a6bda01a0b9a364f64` |
| `review-correction.tsx` | `cdb46f23001ac0397cf7eec640e7aed24f3d0eb047265de160b2127e29ddd090` |
| final `review-correction-server.ts` | `b303d36b60bc39bd747ebb09c6f601279a1ce8d26d774c118aff6e176e9cc118` |
| final `review-correction.e2e.ts` | `887dbf2423e5d03ca795c621eff91c40db90fe9a596be336d81a4c19c1a97c3d` |

The narrow fixture correction affects only Replan invoked from `reconsider_input`; source hashes in the reused main-feedback/session metadata honestly retain the earlier fixture. Their exercised branch and production/bundle inputs are unchanged. A later narrow backend fix disables original Conversation Retry/Withdraw after reconsideration. These browser cases submit original chat before revocation and afterward use only the review endpoints for independent reconsideration controls; Conversation is visited solely for actual Replan Dismiss. No old original-input action is asserted, so its focused backend rejection proof suffices without repeating these unchanged browser behaviors. Loaded source hashes are preserved.

## Six inspected selected images

Each row includes the actual inspected desktop **1440×1000** and mobile **390×844** images plus its source/state metadata.

| State | Desktop | Mobile | Metadata |
| --- | --- | --- | --- |
| Actual review issue | [desktop](web-review-correction-20261007040209902/feedback-issue-desktop.png) | [mobile](web-review-correction-20261007040209902/feedback-issue-mobile.png) | [identity](web-review-correction-20261007040209902/feedback-issue.json) |
| Revoked batch and independent late input | [desktop](web-review-correction-20261007040318721/revoked-reconsideration-desktop.png) | [mobile](web-review-correction-20261007040318721/revoked-reconsideration-mobile.png) | [identity](web-review-correction-20261007040318721/revoked-reconsideration.json) |
| Main-feedback Dismiss successor | [desktop](web-review-correction-20261007040226792/dismissed-successor-desktop.png) | [mobile](web-review-correction-20261007040226792/dismissed-successor-mobile.png) | [identity](web-review-correction-20261007040226792/dismissed-successor.json) |

Inspection compared the six images to the reference-derived contract in `.trellis/spec/frontend/visual-design.md`, based on Multica `44ea3b40c8b4f54f4c76d1dd3e3c92e0c0cabd19`. Neutral sidebar/canvas, compact headings, quiet borders, consistent shared Task gutters and bounded decision groups are preserved. Mobile replaces permanent navigation with the existing menu; digest and batch IDs wrap, answer fields remain usable, and primary correction actions remain reachable with touch targets. Browser assertions also verified no page-wide horizontal overflow and no fixture grant text leakage. Issue versus settlement/successor explanations are readable without color alone. Intentional monos differences are exact result/approval identity, separate reconsideration obligations and physical-settlement disclosure; technical details remain collapsible. Existing Task detail widths/interior spacing were retained without new shared CSS. Identical successor/input layouts use authority assertions rather than additional screenshots.

Empty/pre-request and queued/routing states are exercised in the same scenarios. Dedicated failed-routing browser layout is not separately captured: it shares the operation card and its Retry behavior is covered by the backend focused failure test; this report does not invent a native failure. Existing shell/navigation migration and unrelated native/provider evidence retain their original scope.

## Cleanup

[Independent cleanup proof](web-review-cleanup-20261007.json) combines exact ownership lists from the full run and both narrow reruns. All **6 exact owned namespaces** were closed by fixture cleanup and independently queried absent from `pg_namespace`; **0 remain**. No unrelated prefix cleanup was performed.
