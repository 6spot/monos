# Owner delivery Web implementation handoff

Snapshot: 2026-10-05 15:36 Asia/Singapore. Assignment `/root/owner_delivery_protocol`.
Planning approval and integration remain with main. Shared framework, backend,
migration and provider changes were preserved. No commit, lifecycle operation,
native Runtime or live provider effect was performed by this worker.

## Changed product files

- `apps/web/src/features/owner-delivery.tsx`: exact Prepare, separate Confirm and
  Accept, complete frozen evidence disclosure, immutable batch progress and exact
  Retry/Cancel. Current authority remains separate from navigable older proposal
  and batch pages. Selection survives history navigation without granting authority.
- `apps/web/src/lib/owner-delivery-api.ts`: strict protected reads, Task/session
  fences before returning awaited evidence, canonical manifest/evidence identity,
  complete selected membership, exact repository/PR identity and bounded cursors.
- `apps/web/src/lib/task-api.ts`: `delivery` family in the existing Task command
  journal and transport; exact action-specific committed receipt binding, original
  request recovery, and strict unknown outcomes before any replay.
- `apps/web/src/features/task-overview.tsx`: composes the dedicated delivery feature.
- `apps/web/src/features/task-conversation.tsx`: frozen conversation cutoff,
  later-input attribution outside the batch, and terminal continuation copy.
- `apps/web/src/features/task-controls.tsx`: accepted Tasks use the dedicated
  batch Cancel in Overview; ordinary `cancel_task` is unavailable after acceptance.
- `apps/web/src/lib/owner-delivery-api.test.ts`: meaningful receipt, source,
  Artifact attribution, history scope and retained async read boundary cases.

Protocol changes and all generated output paths are documented in
`frozen-owner-delivery-contract.md`. Its final history extension includes strict
`OwnerDeliveryHistoryQuery` and conditional next-cursor fields. The mechanical
nonempty tuple fixture repair preserves the existing 257-output rejection input.

## Actual API assumptions and authority

All five dedicated actions POST `/v1/owner/tasks/delivery/commands`; recovery GETs
`/v1/owner/tasks/{task}/delivery/commands/{request}`. The envelope uses `task_id`,
not `scope_id`; no fresh chat control version is added to frozen Retry/Cancel.
These send exact operation ID, frozen digest and batch version. A committed Retry
or Cancel binds the original batch and increments its capability version once.

Status uses protected GET `/v1/owner/tasks/{task}/delivery` with optional independent
`proposal_cursor` and `batch_cursor`. Detail routes hydrate proposal/accepted batch
separately. Nullable no-Plan read basis is truthful; it never authorizes acceptance.
Saved proposal basis and actual confirmation ID authorize admission, rather than a
silently refreshed result. Current status and detail must agree before batch actions.
Commands never run on mount, read, history navigation or dialog opening.

Manifest validation preserves each Artifact's own immutable Attempt, Specification
and Plan, including earlier Attempts within the same canonical Task/Node/original
activation. It requires literal selected metadata and digest membership; it does
not rewrite attribution to the completing Attempt. The server rechecks those rows.
Repository-free evidence contains no invented Git source. Zero modified items can
complete locally; unsupported Stage A modes expose the canonical disabled reason.

The command journal remains the existing session-scoped allowlist. Committed
receipts require real action-specific identities; malformed or unrelated receipts
cannot clear uncertainty. Recovery reads the original request before any replay.
Task navigation and logout prevent retained reads from repopulating another scope.
No optimistic formal status or accepted pointer is installed.

## Scoped verification and currentness

| Check | Actual scope/result |
| --- | --- |
| `pnpm exec vitest run apps/web/src/lib/owner-delivery-api.test.ts apps/web/src/lib/task-api.test.ts apps/web/src/lib/task-storage.test.ts` | **28 PASS**, 15:29:40; includes valid earlier-Attempt Artifact attribution and wrong activation |
| `pnpm --filter @monos/web typecheck` | **PASS**, refreshed after final browser fixture cleanup changes |
| `pnpm exec eslint` on all ten assigned Web executable files | **PASS**; later test-helper edits received focused `--max-warnings 0` lint |
| `pnpm --filter @monos/web build` | **PASS**, 15:29; `index-DXeFz8dn.js` 907.86 kB / gzip 226.55 kB, CSS `index-CDYDw6Vm.css` 49.50 kB |
| `pnpm exec playwright test -c owner-delivery.playwright.config.ts` from `apps/web`, private test DB environment | **3 PASS**, final complete run 15:34–15:35, 12.3 seconds |
| `pnpm protocol:check` | Main **PASS** at 15:10, after history generation; source/generated protocol inputs unchanged afterward |
| Shared schema and encoded Unicode/collection protocol tests | **305 PASS** at 15:11:23, including five new strict history query fixtures |
| Go 1.27.1 `go test ./... -run '^(TestSharedSchemaFixtures\|TestSharedCanonicalFixtures\|TestSharedCompletionIdentityFixtures)$' -count=1` from `runner` | **PASS**, 15:30; all consumers compile and shared wire selectors pass after history extension |
| Scoped `git diff --check` | **PASS** |

The known Vite >500 kB chunk warning remains; this feature adds no library or lockfile
change. Browser-only helper edits followed the build; product source, protocol and
built assets in the final screenshot metadata are current. No full native/host/race
suite or unchanged historical 14-image matrix was repeated.

## Browser behavior and boundaries

Added `apps/web/test/owner-delivery.e2e.ts`, isolated
`apps/web/test/owner-delivery-server.ts`, and
`apps/web/owner-delivery.playwright.config.ts`. The dedicated loopback HTTP process
serves the current built SPA and forwards actual protected routes through
`createApp.inject`. Genuine PostgreSQL fixtures migrate unique schemas. Session
cookies are set by same-origin test-only initialization; credentials are never
returned in test JSON or screenshots.

Final browser cases establish:

1. Actual Prepare → close/reopen without another command → actual Confirm → actual
   Accept of one modified frozen batch. Dialog focus returns to its trigger. Later
   actual chat is attributed outside the same batch/digest/cutoff. Explicit synthetic
   failed progress and unknown checks remain factual. A committed Retry reply is
   withheld, reload preserves uncertainty, and original receipt recovery records
   only one Retry. Dedicated Cancel commits against the same exact batch.
2. Actual repository-free Prepare/Confirm/Accept completes the Task locally; frozen
   accepted manifest and zero items remain readable, with zero provider calls.
3. Held canonical delivery responses cannot restore a previous Task after navigation
   or restore private state/journal after actual logout.

The fixture's Git/process/provider evidence and mutable scheduling projections are
synthetic. There is no provider worker pump and no live merge claim in these images.
The parent owns separate current native/live-provider evidence. Initial browser
failures were test observer SQL and dependent-command synchronization issues;
neither required product changes. The cleanup observer's first two attempts could
not resolve a direct `pg` import; using the actual database module resolved that
observation without rerunning product/browser tests.

Final fixture cleanup proof:
`evidence/browser-cleanup-20261005073441.json`. All three exact owned schemas closed
on graceful SIGTERM and were independently verified absent using exact namespace
membership. No arbitrary prefix cleanup was performed.

## Inspected current build images

Authoritative representative set:
`evidence/web-owner-delivery-20261005073442671/`.

Source snapshot HEAD `41251b6006a91ce1dc221cc0697fd3608f1f50b2` plus dirty candidate
inputs. All 74 recorded source/helper paths, built assets and six screenshot hashes
were verified current after the final run. JS SHA256:
`79a245131d4f5e2c600c7eee578dad218f36d9366d0aebf111bbaf47098b2839`;
CSS SHA256: `90913bdae0315da53398e57a8ae6f76c4cbaf2493692e8a6bda01a0b9a364f64`.

| State | Desktop/mobile companions | Inspection |
| --- | --- | --- |
| Actual exact Owner confirmation, before admission | `exact-confirmation-desktop.png`, `exact-confirmation-mobile.png` | Complete review uses a scrollable Base UI dialog; mobile scrolling exposes the actual Accept action and its waiting disclosure |
| Actual frozen accepted batch, synthetic failed scheduling/readiness | `frozen-failed-desktop.png`, `frozen-failed-mobile.png` | Exact head and unknown checks wrap; Retry/Cancel stay reachable, 44 px mobile targets, no horizontal overflow |
| Actual local completion with zero modified items | `local-completed-desktop.png`, `local-completed-mobile.png` | Clear completed state, no false remote effect, independent continuation and frozen evidence preserved |

All six images were opened and inspected at 1440×1000 / 390×844. Each state has a
JSON companion containing HEAD plus all relevant source hashes, browser helper
hashes, current built asset hashes, route, state, screenshot hashes and synthetic
evidence boundary. Bodies were checked for the fixture secret canary. Earlier
development images are superseded by this final set.

Reference: the repository's self-contained Multica-derived visual contract,
`frontend/visual-design.md`, reference HEAD
`44ea3b40c8b4f54f4c76d1dd3e3c92e0c0cabd19`. The shared 256 px neutral shell, compact
chrome, semantic surfaces, restrained typography and existing Task gutters remain
coherent. Intentional monos difference: an exact review overlay discloses retained
result identities, while advanced technical attribution stays collapsed. Mobile
review content scrolls inside the existing dialog, preserving reachable actions.

## Remaining integration responsibilities

No concrete Web or protocol blocker remains. The parent owns final integration,
delivery spec updates, SQL/provider audits and any later deployment/commit. History
keyset authenticity and complete admission authority remain server responsibilities;
browser validation adds consumer checks without replacing server authorization.
Later changes to source/wire/build invalidate only the affected evidence.
