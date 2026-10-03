# Frontend Quality Gate

Sources: [UI contract](../../../docs/07-owner-review-and-ui.md), [Stage A](../../../docs/09-first-executable-slice.md), [technology](../../../docs/11-technology-and-deployment.md).

## Current status

`apps/web` uses root lint, a separate TypeScript check, Vite production build,
Vitest API-boundary tests and Playwright interaction tests. Run `pnpm lint`,
`pnpm typecheck`, `pnpm test`, `pnpm protocol:check`, `pnpm build` and
`pnpm --filter @monos/web test:e2e` with `MONOS_TEST_WEB_DATABASE_URL` set privately.
The browser fixture migrates a unique test schema, uses synthetic credentials,
serves the built SPA from the actual backend and drops only its own schema.
See `apps/web/README.md`; screenshots/traces are ignored test artifacts.

Implemented evidence covers login/logout/revocation, Role/Project/policy/provider
persistence, record/view drafts, two-tab version conflict, repeated submit,
interrupted write/receipt recovery, keyboard navigation and mobile overflow.
Provider repository responses are explicit fixtures, not live GitHub evidence.
Todo/preview and Board/Task interactions are implemented and verified by their
owning tasks. The matrix below also includes later delivery requirements; those
remain unaccepted until the corresponding backend/product scope exists.

## Required interaction evidence

- Capture/open a Todo without an AI call.
- Switch Todos and retain per-Todo drafts and unread state.
- Reconnect without duplicated committed replies or lost previews.
- Confirm one preview from two clients and show the same Task.
- Show queued Runtime work as normal waiting.
- Accept exact content; render admitted delivery separately from completion.
- Later chat does not block accepted delivery or Retry.
- Show local hard-limit failure at Node scope and publication findings in REVIEW.
- Correct/withdraw/dismiss through their explicit commands without implicit resume.
- Preserve terminal history and report partial delivery honestly.

Test the user-visible behavior introduced by a change. Prefer focused interaction/integration tests to markup snapshots or tests that mirror private state.

For sequential decisions, await the visible canonical result before submitting a
dependent command (for example, `Exact requirements confirmed.` before sending a
later input). A completed click does not imply the command has committed. When a
test holds a request for a busy-state screenshot, release it and await the result
before removing its route handler; early `unroute` can race `route.continue`.

## Component and dependency checks

Use shadcn Base UI consistently. Check keyboard/focus, labels, error association, responsive layout and reduced motion. Review generated component imports and lockfile changes; do not add Radix, another UI suite or unused components. Check actual bundle impact before making size claims.

## Visual acceptance

Apply the [visual contract](visual-design.md) to every new or visually changed surface. Retain inspected screenshots at 1440×1000 desktop and 390×844 mobile, tied to the tested build/source revision, route and fixture/data state. Cover the changed surface's populated and empty views, errors, loading/queued/disabled states, and long titles/messages where applicable; record why a state is not applicable instead of inventing backend behavior. Review the mobile navigation, focus, overflow, composer and action reachability in the browser.

Compare the screenshots to the reference-derived surface hierarchy, typography, gutters, header/toolbar geometry and component treatments. Record the reference source/revision or reference image, inspection result and intentional monos-specific differences. A saved screenshot without inspection is not acceptance. Pixel-diff automation is optional and cannot replace the initial reference review; avoid broad brittle markup snapshots.

The combined Todo→Task→Review flow must look coherent across shared shell and controls, not just pass isolated-page checks. Existing-screen migration evidence and new execution UI evidence are both required before integrated visual acceptance. A documentation-only standards update does not establish either.

## Reporting

Run affected lint/type/unit/browser checks after scaffolding makes them available. Distinguish mocked UI results from real CLI/GitHub evidence. Documentation-only changes use links, consistency and formatting checks.


## Browser fixture shutdown

Configure Playwright webServer.gracefulShutdown with SIGTERM and a bounded deadline.
Without it Playwright kills the fixture directly and skips the schema cleanup handler.
After fixture lifecycle changes, check that a full browser run leaves zero new test
schemas. Never clean arbitrary prefix matches without proving fixture ownership.

## Installed browser observations

Use the actual accessible role/name from the built UI for browser automation.
Task sections are links; the initial button is **Start task**. Keep a successful
Owner command's retained request/receipt when a later observer wait fails. Recover
that result and its existing Task instead of submitting another creation command.
Distinguish the source loaded by a running browser process from a subsequently
corrected on-disk helper; attribute screenshots and traffic to the loaded source.
Long JSON commands must bypass a terminal's canonical line limit. Verify that the
whole request actually reached the browser before treating a terminal echo as
submission. Retain viewport companions for full-page images captured after scroll,
and inspect populated result/reload/source-Todo continuity at both required sizes.
