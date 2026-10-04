# Remote preparation Web implementation and verification

2026-10-05 Asia/Singapore. **Web handoff ready for main's independent review.**
Active task: `10-03-a-remote-preparation`. No commits, lifecycle, installation,
live provider or model calls. Concurrent framework and other workers' edits were
preserved. Exact current owned paths/hashes and selected image inventory are in
[frontend-final-inputs-and-images-v2.json](frontend-final-inputs-and-images-v2.json).
The original inventory remains preserved.

## Implementation

- Task overview places Remote review preparation after Local results. Original
  source, effective Specification/Plan, candidate tree/head/public parents,
  published proof, reused mapping, stable branch, PR state and scan applicability
  remain distinct. Local result inspection stays usable.
- History selects item + immutable operation, with a tagged local-only fallback.
  Latest item detail is a separate query and never replaces selected historical
  bytes. Ordinary/current authority also requires the fresh overview's REVIEW
  state and exact effective Specification/Plan, plus exact latest operation
  scope/version. Historical rows cannot adopt a later operation's Retry.
- Canonical `read_retry_allowed` enables original effect reconciliation. Admitted
  uncertain/started effects may reconcile after basis or terminal changes;
  unmutated pending/failed preparation retains the fresh overview fence. Backend
  terminal cleanup capability is separate. No Prepare PR, Accept, Merge or
  Request Changes control was added.
- Checks bind Task/session/item/operation/observation/head/base and page cursor.
  Every loaded page must be current, complete and nonstale for the current label.
  Fresh continuation flags beat cached first-page flags. Neutral, skipped,
  cancelled, missing checks and unknown mergeability never become readiness.
- Typed APIs validate schemas and full source/basis/manifest/mapping/published
  digests and scope. Reads send actual session, no-store and AbortSignal, including
  an abort fence after asynchronous digest validation. React renders literal
  provider names; PR links validate the fixed GitHub repository/path/number/head.
- Retry uses the existing session Task command journal with exact family
  `remote-preparation`. Actual envelope persists before POST. Unknown recovery
  replays only that envelope; committed receipt requires actual operation
  ID/digest/version, including a legitimate new before-start operation identity.
- Mapped local records permit an old manifest/new basis only through the complete
  checked mapping. Override prepare/confirm/apply and saved review retain its
  exact mapping digest, scan, configuration, finding IDs, head and parents.
  Hard limits, incomplete coverage and published credential exposure stay blocked.
- Mobile controls are at least 44px. Repository refs, digests and long names wrap;
  the provider list has contained scrolling. Visuals retain the neutral contract.

## Owned product files

| Area | Paths |
| --- | --- |
| Features | `apps/web/src/features/remote-preparation.tsx`, `publication-candidate.tsx`, `task-overview.tsx`, `task-ui.css` |
| APIs/journal | `apps/web/src/lib/remote-preparation-api.ts`, `remote-preparation-api.test.ts`, `publication-api.ts`, `task-api.ts`, `use-task-command.ts` |
| Browser | `apps/web/test/remote-preparation.e2e.ts` |
| Test-only server fixtures | `apps/server/test/fixtures/execution-ui-fixture.ts`, `web-server.ts` |

The browser fixture injects synthetic scoped grants and fixed-host HTTP replies
into the real GitHubRemote/coordinator. Actual Owner configuration saves RSA App
metadata; each scenario uses a distinct synthetic installation, preserving real
installation cooldown isolation without deleting or changing cooldown rows.
An authenticated Runner WSS peer consumes the real request-bound access/claim
endpoint before its explicitly synthetic push result. No authoritative remote
projection/result rows, authorization or time values are seeded or changed.
Formal same-tree mapping uses the existing Owner TaskSpecification carry command,
new effective basis and a fresh authenticated Runner scan. No invented rework
command or Runtime implementation is supplied.

## Checks and evidence reuse

| Command | Scope and result |
| --- | --- |
| `pnpm exec vitest run apps/web/src/lib` | PASS 56 before final UI/fixture work. Six remote/API/mapping tests plus 50 existing tests. Unchanged units were reused. |
| `pnpm exec vitest run apps/web/src/lib/remote-preparation-api.test.ts` | PASS 6 after the final API flag relation; its test/API/fixture inputs remain unchanged. Output retained in tool trace. |
| `pnpm --filter @monos/web typecheck` | PASS final source, including the strengthened held-response browser case. |
| `pnpm exec eslint apps/web/src apps/web/test/remote-preparation.e2e.ts apps/server/test/fixtures/execution-ui-fixture.ts apps/server/test/fixtures/web-server.ts --max-warnings 0` | PASS full owned source; after driver-only visual/fence changes, affected driver/fixture lint passed again. |
| `pnpm exec tsc --noEmit` | Root gate reused from backend owner's current frozen-runtime PASS. Our intermediate run caught optional `impact.nodes`; fixture now guards nonempty Node impact. |
| `pnpm --filter @monos/web build` | PASS final product inputs. JS `index-Dzy6MNDM.js`, CSS `index-SX4vxlNY.css`; existing >500kB chunk warning. Later changes only affect the browser test driver, so bundle remains valid. |
| `git diff --check -- apps/web apps/server/test/fixtures/execution-ui-fixture.ts apps/server/test/fixtures/web-server.ts` | PASS final owned changes. |

All **13 distinct browser cases** have retained passes. There was no unnecessary
final combined 13-case rerun; source and relevant dependencies were reconciled.
Commands use `pnpm --filter @monos/web test:e2e test/remote-preparation.e2e.ts`
with the filters below, privately loaded isolated PG URL and capture disabled
except the required visual runs. Logs are under `research/browser-runs/`.

| Retained log | Scope / result |
| --- | --- |
| `prepared-valid-long-label-20261004T143948Z.log` | Prepared PR/checks/local inspector, PASS 1 (23.8s). |
| `remaining-after-spacing-fix-20261004T145143Z.log` | Eight passes: preparing, offline, unsupported, rate limit, uncertainty/reconcile, lost committed Retry reply, initial history/Cancel, held-detail logout. Four failures retained; corrections below supersede only affected claims. |
| `remaining-four-and-carry-20261004T223647Z.log` | PASS denied, exact unknown replay/session replacement, fresh historical check continuation; two fixture expectation failures retained. |
| `carry-and-deferred-corrected-20261004T223859Z.log` | PASS 2: actual Specification carry/mapping/direct old candidate/history/fresh overview Cancel (8.1s); no checks/deferred/repository-free (19.4s). |
| `final-six-layouts-20261004T224042Z.log` | PASS 5, six representative layout pairs plus only two material full-page companions. |
| `long-check-label-visible-20261004T224323Z.log` | PASS 1 (20.0s), recaptures only prepared/checks with long label visible in bounded inner list. |
| `deferred-populated-20261004T224414Z.log` | PASS 1 (23.1s), recaptures only populated deferred local candidate. |
| `late-task-and-checks-fences-20261004T224814Z.log` | PASS 1 (20.0s): actual held detail released after Task switch; actual held checks released after logout; old bytes/journal cannot revive. No images. |

The current tests also assert: one coordinator PR POST, exact stable push identity,
64→70 check pagination, inert literal HTML, exact journal before POST, committed
receipt recovery without another POST, authoritative unknown replay of the exact
original envelope, real cookie replacement with accepted login and no old-session
command, retained published manifest/new effective Specification/scan, same PR
and no extra create, terminal owned PR closure/branch retention, and truthful
no-remote-record for after_acceptance/repository-free results. Fresh canonical
Task Cancel is tested while old remote responses are intentionally held. Fresh
historical continuation is an explicitly labelled transport-only supplement.

Existing broad execution/publication/result suites were not repeated: accepted
ordinary behavior remains unchanged; scoped API tests and actual prepared/local
inspection, mapping/direct selection and journal recovery cover the affected
seams. No native Git, Linux or live-provider evidence is claimed from browser
transport; those gates belong to Runner/backend/main.

## Visual inspection and exact provenance

Final selected set: **14 inspected PNGs**, six desktop 1440×1000/mobile 390×844
pairs and two full-page prepared/checks companions. Inventory includes SHA256,
actual PNG dimensions, route/state, capture metadata/source hashes, dirty HEAD
and actual built assets. Main can select these exact paths for independent review.

- Preparing: pending push stays distinct from local Review, empty observations
  and available scoped Retry; mobile controls/ref wrapping fit.
- Current PR/checks: exact head/base, informational checks and unknown readiness.
  Long provider name wraps inside the bounded list on desktop and the mobile
  full-page companion; literal script text is inert. No page horizontal overflow.
- Mapping/history: actual unchanged manifest plus new effective basis, current
  local mapping and separately selected historical remote Push. IDs/ref remain
  readable with mobile wrapping; no inherited ordinary Retry.
- Reconciliation/cooldown: failed provider attention and recorded deadline stay
  visible; Retry cannot authorize bypass or infer success.
- Terminal cleanup: closed owned PR and retained branch, historical evidence and
  mapping notice, no ordinary action/acceptance inference.
- Local-only/empty: retained local candidate/scanned source with after_acceptance
  notice; remote section truthfully remains empty. Initial loading image is kept
  as intermediate evidence and excluded from final selected set.

Product/server/schema/fixture and bundle bytes are **identical across selected
images**. Their source aggregates differ only in `remote-preparation.e2e.ts`:
inner-scroll visual correction, deferred populated wait, then a tighter unused
held-response test. The inventory explicitly records reuse of unaffected images
with their original actual driver hashes; original images/manifests are preserved.
No product input changed after the final build.

Current aggregate (including final driver):
`ffc8d7e6e461e53fccc0db0f3fc6022f4afca81aff9243015e8ba7378f43a7d5`.
Actual bundle aggregate:
`3a4f6473e167adc1265ca7d207ca11fe1d033e5dc5d82fcfc31d36eb9cf434f5`.
JS SHA256 `33375585294cfac00ee229732ed98c5d608b9af9aa85db3422135048ce5bb14b`;
CSS SHA256 `2dcaa7ea2d352e018d07a539822479816e542e763385e47d4c6aaf9161864ce3`.

## Preserved failures and cleanup

Earlier producer/runtime trials caught ambiguous JSON SQL, microsecond reservation
release equality, internal spacing incorrectly recorded as persistent failed
checks attention, reversed Task/item lock/FK deadlock, and missing preoperation
permission denial projection. Backend owner fixed their owning modules. A positive
fixture long check name exceeded the frozen 256-character limit; it was shortened
without widening schema. My initial budget-starvation inference was incorrect:
actual loaded budget is eight and was never changed.

Fixture expectation corrections are explicit: use same-Origin login and assert
200 before session replacement, select exact newly current operation after a
formal Specification carry before Cancel, and assert the existing local deferred
notice plus zero remote records instead of inventing a remote item. New unit
constructor/type failures and optional carry-impact guard are retained in the
tool trace. Failed browser logs remain; raw traces with possible Owner cookies
are private 0700 `/tmp/monos-remote-browser-failure-*` / 0600 files. Only nonsecret
path/hash inventories enter task research. No raw trace is copied into repository.

Observed browser schema prefix count is **0→0** in
`browser-runs/final-capture-schemas-before.json` and `final-capture-schemas-after.json`.
It remains zero after the two visual corrections and final fence test, recorded
in their respective `*-schemas-after.json`. Fixture source creates/drops exactly
its own `web_test_<uuid>` namespace and drains pump/WSS/app before dropping it.
No observed UUID is invented, no prefix wildcard cleanup is performed, and other
concurrent backend schemas are untouched. Port 18555 has no listener after final
runs. Main owns independent combined review and integration.
