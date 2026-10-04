# Backend remote preparation implementation verification

2026-10-05, `/root/local_result_implement`. Active task: `10-03-a-remote-preparation`.

Backend implementation is ready for independent combined review. No live provider effect, host installation, source push, acceptance, merge, task lifecycle action or commit was performed by this worker. Root owns native effects, Runner/Web evidence and final integration. Live installed App configuration remains an external prerequisite; injected tokens/synthetic RSA tests do not establish that prerequisite.

## Implemented boundary

- Dedicated remote items/operations, immutable intent/result/ACK and original-operation append-only uncertain resolution. Current input/config/source/effective basis and real eligible Owner receipts fence every ordinary effect before grant and after token I/O. No transaction spans Git/Runner/provider I/O.
- Fixed GitHub adapter, selected-repository exact minimal App profiles, calendar expiry/canonical numeric IDs, strict literal PR tuple/head/base/content, safe bounded errors, single lost-create recovery, no repeated started mutation. Internal native constructor accepts narrow `RemoteReviewIntent` / `RemoteRefIntent`; production persists and validates full frozen requests.
- Permission bootstrap uses minimal contents scope when the workflow fact is unknown; explicit complete scan true refreshes workflows scope and current scan over the same construction. Exact false uses minimal profile. Pending permission rescan can refer to a prior complete scan only with equal source, basis, construction and published-range digest. Finding absence and older broad grants are not workflow evidence. Legacy omission creates a new scan run; old bytes remain immutable.
- Mapped scans preserve the old manifest and use new operation/source/effective basis/config/mapping-bound waiver authority. Immediate public credential exposure is appended atomically with exact published proof, including genuinely waived findings; later clean/deleted/mapped output never erases it and PR creation stops.
- Owner history/list/detail/checks, canonical scope-bound cursors, request receipt recovery, current applicability and distinct original reconciliation/cleanup capabilities. Terminal blocked unstarted push Retry creates the actual new operation; started/unknown/settled uncertain facts retain original identity.
- Durable provider polling uses at most eight calls per item turn including grant and PR brackets, 100/page, ten pages per collection, safe staged progress, exact-scope ETag cache and explicit complete/stale/no-checks semantics. Internal spacing/cooldown schedules waiting without inventing provider failure. Actual provider errors retain safe attention; permission failures before any remote operation are visible without a fictional grant or effect.
- Both Cancel paths retain terminal Task state, revoke unstarted admissions, reconcile original effects, close only the owned undelivered PR and retain branch. Spec/Replan/guidance/corrective Node work waits on remote quiescence through their own existing modules.

## Current focused evidence

Environment: Node **v26.3.0**, pnpm **12.6.0**, actual isolated PostgreSQL namespaces migrated to23. Database URL loaded privately from retained locator into child env; no credentials printed.

| Check | Scope and result |
| --- | --- |
| `pnpm exec vitest run apps/server/test/postgres-remote-preparation.test.ts` with private PG env | **11 PASS**, final6:36:41 local run,9.13s. Actual PG and authenticated WSS/HTTP; provider/Git bytes explicitly synthetic. Migration22→23; cross-item refusal and exact ACK; late Owner input during grant + actual Spec wait; contents bootstrap→explicit workflow true without finding; missing-flag fresh run; real waiver→immediate exposure→clean mapped Spec carry guard; Cancel owned PR/branch; lost PR response one POST; immutable uncertain result/ACK + appended original proof; real Owner Retry receipt; 600 checks staged across turns with no partial success and stale unavailable refresh. |
| `pnpm exec vitest run apps/server/test/postgres-publication.test.ts apps/server/test/postgres-remote-preparation.test.ts` with PG env | Initial integrated run **23 PASS,1 FAILED**: old direct-read lock fixture matched a superseded SQL prefix. Twelve other local publication cases passed. Corrected only pg_stat_activity prefix to actual joined candidate query; focused `-t 'pins direct candidate'` **1 PASS,12 skipped**,1.36s. Actual lock blocking/applicability assertions unchanged. Evidence supports all13 local cases without repeating unchanged cases. |
| `pnpm exec tsc --noEmit` | **PASS**, current server/shared consumers and root-owned provider test typing. |
| Scoped `pnpm exec eslint` over owned backend sources, remote/publication tests and three helper fixtures, `--max-warnings 0` | **PASS**. |
| `node --experimental-strip-types -e "import('./apps/server/src/app.ts')…"` | **PASS**, actual Node import. Explicit constructor fields avoid unsupported parameter properties. |
| `git diff --check` | **PASS**. |
| Root-owned `apps/server/test/github-remote.test.ts` | Root reported **30 PASS** after canonical-ID/calendar/body-only-secondary fixes. Later narrow cache-return/numeric-raw-ID changes are identified in current hashes; root owns final affected provider gate, no duplicate worker test matrix. |
| Shared protocol/generation/Go wire | Reuse unchanged **331 TS tests**, generation/check and shared wire race evidence in shared-workflow-amendment.md/review. No shared schema/source changes during backend runtime freeze or root native trial. Root owns final combined integration; no duplicate Go suite here. |

Fastify printed existing FSTDEP023 disableRequestLogging deprecation during WSS runs; this is not a runtime failure and was not expanded into unrelated work.

## Actual failures and corrections

1. Initial real PG trial: `error: operator is not unique: unknown - unknown` at `actualOverrideProofs`, three scoped cases failed. Parenthesized JSON payload extraction and explicitly typed removed key. Same three cases then passed.
2. Browser found ordinary reservation never released: PG microseconds were compared with a millisecond pg Date. Reservation now stores `date_trunc('milliseconds', clock_timestamp())`; conditional release matches the exact retained value. Successful current PG/browser trials cover the fix.
3. Browser positive check label exceeded frozen256 characters; producer correctly refused it. Web owner corrected the positive fixture, retained the failed trial; schema was not widened. Current eight-call budget was never changed to repair this fixture.
4. Browser reproduced internal spacing rendered as rate-limit attention, including pending push, and a40P01 item→Task/FK lock inversion. Nonprovider work now returns before reservation; existing cooldown is scheduling-only `RemoteProviderWaiting`. All attention append transactions take Task before item. Web reports preparing/offline/unsupported/rate/unknown and denied passes after fixes.
5. Preoperation denied grant initially displayed Preparing without safe failure attribution. Permission-stage failure now appends bounded safe attention and exact-operation backoff; actual successful proof observation clears that attention. No fake permission proof or operation was inserted.
6. Intermediate TS failure in root-owned provider test HeadersInit inferred optional union; root supplied explicit type cast. Scoped ESLint also found type-only imports/unused imports and one unnecessary quote escape; corrected mechanically and current gates pass.
7. Actual Cancel trial initially used wrong Owner command envelope (missing scope_id); fixture corrected to actual existing product command, then passed. No product bypass was introduced.
8. First direct-read lock assertion after mapping integration matched the old SELECT prefix; fixed the observation predicate only. Read still pins Task FOR SHARE and real Spec mutation blocks until release.

Full original outputs remain in tool/session evidence; these are accurate excerpts, not reconstructed whole logs. Web retains actual failed browser logs under research/browser-runs. Main/provider/Runner have separate native and source manifests; their claims are not relabeled as this worker's evidence.

## Ownership and current input hashes

Changed product paths are listed below; three shared backend test helpers add only an optional caller-supplied initial Runner enrollment credential so the new test uses actual authentication instead of rotating credentials or bypassing auth. Existing default behavior remains. Other workers own Web/browser fixtures, handwritten Runner and root provider test. Unrelated framework/hooks/AGENTS/spec dirties were preserved.

Current ordered input aggregate: **987f56d2590d926b5c47b2fddf8be70c85da058ba2303c6f995d15331ca7f2ab** (SHA256 of each `hash  path\n`, in table order). This is a backend handoff, not a claim that root native or browser reports already match it.

| Path | SHA256 |
| --- | --- |
| `apps/server/src/app.ts` | `8f0b19a3fb010268ec6dd5b280c524cc3acecc1dd769a439ec22f3a2df79c700` |
| `apps/server/src/main.ts` | `21869e406293c67e3df24a085006028dfc2330abf8b233ade33b8254d5f043c4` |
| `apps/server/src/github.ts` | `ddb07ebdb9e51a06eac159e09aed02745b48afe44475e1d1f56befb21e4dcc1b` |
| `apps/server/src/github-remote.ts` | `5f09908e640846876e2f74663ddd54e48c1bd25ddce3f7d9a3a9b95105b7e040` |
| `apps/server/src/remote-preparation.ts` | `d2fefb84c076309546dc5acebe9947b85d71c9114da93c1c6ac2047137d9f73f` |
| `apps/server/src/remote-preparation-access.ts` | `b415e6122b9afb2e4cfd6563c95327e11344f9da02ceacc70b3854030bd6d6d7` |
| `apps/server/src/remote-preparation-state.ts` | `854b4b7a9280025e4b3b01d3539a7310b51d481b94518485e7a39cd3b578dca3` |
| `apps/server/src/remote-preparation-guards.ts` | `e72f7de56bb252ca10e2b7060def3fae9015796c5fcf92b9f8a9d35ae7f25929` |
| `apps/server/src/remote-preparation-poll.ts` | `db71758ca3d3dd37c527e1af88bc7e6bb2a7ac800c633733aaed56fc67d11606` |
| `apps/server/src/remote-preparation-reads.ts` | `fda8af287b1d865a747cc75faae2795ad57907126bb89ac5c8e953d53de79944` |
| `apps/server/src/remote-preparation-commands.ts` | `26da9f948dfb5ed3ee1306157e8f2c96d810c0cfcfd2ae36df0aceda0820615e` |
| `apps/server/src/publication-candidates.ts` | `232ad50d2b2ebb08504941c372980e3a400dd84d7f61794a1249b7629565bf28` |
| `apps/server/src/publication-candidate-reads.ts` | `fab1331e1711111c120683b6bc9370f4f5742ebd701626f6deff28528d539288` |
| `apps/server/src/publication-commands.ts` | `485dd28898ca996835bf8a48cb7710c77c4d08f4815fd478f6c46e0d4242e7f3` |
| `apps/server/src/publication-policy.ts` | `ac93ad7951bbb3ac32f26ab8a89383f90775582d85f1121e4eb4da170d9e53aa` |
| `apps/server/src/node-execution.ts` | `ac32277ca022350fa18ee63b6f9d95680a6512bfe7370ba4e5c0e4cec3e30a4f` |
| `apps/server/src/task-planning.ts` | `8f31bcec95951bbe81f52aa8b6f6930f03f3d49c1715f7ed8f92f2e4902844af` |
| `apps/server/src/task-guidance.ts` | `52a88afb095ee49cdf43114c6e2f74f5fead458d388057bfd917a2386a3c2287` |
| `apps/server/src/task-replan-state.ts` | `bb4aa9a3b356eb217f95a57e384e55c77783020e67f9c280ee43991a3a9fe5ef` |
| `apps/server/src/task-specification-settlement.ts` | `ed8c08328634d275d84c93d068f1c61b7e1e1e0a6d96334e7e18cc8b18ec6470` |
| `apps/server/test/postgres-remote-preparation.test.ts` | `d6c1cd49bdbedc53df71eb422359c7b6b054092fd47bcff7c6dda2a7082347c0` |
| `apps/server/test/postgres-publication.test.ts` | `5c53f6766c73cc13c8bda649d1e76c49e158857ceb47b4fa70eff5dc4ea28739` |
| `apps/server/test/fixtures/publication-fixture.ts` | `7bde9c32f32770e49300d4b8b35654140ca2b55bd810d0881ef4ef5e839ad401` |
| `apps/server/test/fixtures/result-read-fixture.ts` | `51d2af0fc3cad80b342ae911346e69a57ec3092a8a2949b311cc0cf0456a6ef9` |
| `apps/server/test/fixtures/task-conversation-fixture.ts` | `96227468485f3286cfd98e4b25dc734e641f6d9efe59f3be1d51092be4b2bf33` |
| `packages/db/migrations/0023_remote_preparation.sql` | `44b852add8dc5fed6dce9a510116f94f7e33c0b1d6db647fb7c7488b6aba8d3b` |
| `packages/db/src/migrate.ts` | `8a7a951f4b2629188ceb24726ef8c81b23446355d4fb31b3772cb176c7132d61` |

## Remaining integration

Independent current combined review and root final integration remain required. Root/Web own final screenshots/session fixtures and actual provider/native evidence; live App integration is externally absent. No additional optional test matrix is planned. Any reviewer source fix will invalidate only the affected claims/hashes and be reported before downstream recapture. The inspected root executable remote-preparation spec matches the implemented scope; ephemeral grant issuance and safe permission-stage attention are observations, never fictional repository effects or Owner authorization.

## Independent P2 review corrections — 2026-10-05

This addendum supersedes only the changed-input claims above. Other retained cases,
shared schema/generated/331 TS/full-wire gates, migrations and unchanged product
sources remain valid; no broad suite or external effects were repeated.

1. Push access now validates the pending operation and permission proof before
   atomically reserving installation capacity and claiming the original operation.
   An ordinary spacing/cooldown refusal precedes claim, possible-effect marking
   and push token issuance. `RemoteProviderWaiting` carries typed `rate_limited`
   HTTP 429 with positive integer `Retry-After` (ceil remaining seconds, minimum 1).
   The same safe response applies permission/bootstrap and observe access. A waiting
   operation retains its state, version, claim and reconciliation flags. After a
   successful claim, token I/O still receives the existing fresh source/configuration
   and channel rechecks; post-claim failures preserve conservative reconciliation.
2. Check-run pages must contain the exact advertised page cardinality, including
   retained 304 page data, with matching continuation flag. Poll checkpoints bind
   one total count across all turns. A changed count clears the checkpoint and
   reports `invalid_provider_response`, never an all-pass subset. Old incomplete
   checkpoints without this total restart from page 1. No public shape changed.

Focused checks:

- Private isolated PG environment; `pnpm exec vitest run
  apps/server/test/postgres-remote-preparation.test.ts -t 'authenticated WSS|withholds
  the token|resumes bounded checks'`: **3 PASS, 8 skipped**, 5.94 s, 07:00:10 local.
  Actual authenticated WSS/HTTP observe access is followed immediately by push:
  429 / exact Retry-After 1, no new grant, unchanged pending operation/claim/version.
  The test waits the real spacing (no cooldown-row edit), retries the same attempt
  and receives the claim. Actual Owner input during grant I/O still withholds token.
- After extending the existing poll test with staged 500/600 rows followed by
  total 601, reran only `-t 'resumes bounded checks'`: **1 PASS, 10 skipped**,
  1.64 s, 07:00:42 local. Changed total yields no complete observation and clears
  progress; a fresh stable 600-row collection completes under the same 8-call limit.
  The two unaffected selected cases from the first run remain valid.
- `pnpm exec tsc --noEmit`: **PASS**.
- Scoped ESLint on the six changed source/test paths below: **PASS** (after final
  test amendment). `git diff --check`: **PASS**.
- `node --experimental-strip-types -e "import('./apps/server/src/app.ts')"`:
  **PASS**, actual native Node import; no network/effect.

Root-owned `apps/server/test/github-remote.test.ts` current focused **30 PASS**,
07:00:07 local, includes the single missing-row defect in the existing overflow
case (reported by main); root current typecheck also **PASS**. Original Runner owner owns
HTTP scheduling retry and avoiding terminal blocked cache before effect. These
cross-consumer checks remain required by main before claiming automatic scheduling
completion. Web/API/schema shapes remain unchanged; existing exact 70-row prepared
layout evidence is not relabeled as proof of the new Runner retry behavior.

Current changed inputs (unchanged table rows above remain exact):

| Path | SHA256 |
| --- | --- |
| `apps/server/src/app.ts` | `c1169b26b54c1526b70796e9eba62200d74c274a12a68ab67738bb28dff09fa6` |
| `apps/server/src/github-remote.ts` | `239a1c2622d4f913ba048b1cfd28d7cb3babc23a80302673752343771d0038bc` |
| `apps/server/src/remote-preparation-access.ts` | `0cb63ab9711982c179ddc995d55a870b8b0bbe5c1f51805776c42bc37279098e` |
| `apps/server/src/remote-preparation-state.ts` | `e7f8e495160de65d72834e70aef5a1bed04c24e4cae15a37d0e14f6b701c6b83` |
| `apps/server/src/remote-preparation-poll.ts` | `09a35527b8afe0de5a6a7510364aad13eccab03c896721e6eb8f30d8498d6061` |
| `apps/server/test/postgres-remote-preparation.test.ts` | `3366cb605c3f460f7a3b76c990f15bba52e15cc0872edfdd049c312d579e37b4` |

Current full ordered 27-input aggregate: **cc221e8e91ff656dbe33dba8825e82b5381e547941bf048b5d2bc9d133a1a644**.
