# Existing-screen migration implementation

## Ordered gates

- [x] Read architecture/invariants, predecessor/handoff, frontend specs and research.
- [x] Converge PRD/design and file ownership under standing Owner authorization.
- [x] Curate/validate contexts and activate after predecessor archive.
- [x] Implement shared form primitives/CSS consolidation and neutral Login/Settings.
- [x] Implement Todo/Discussion/preview composition preserving controller lifetimes.
- [x] Add relevant screenshot/checkbox/error-flow assertions using existing fixture.
- [x] Run lint/type/unit/protocol/build and full actual-build browser regression (41+9 distinct passing cases; see verification).
- [x] Inspect/retain1440×1000 and390×844 images, reference comparison and hashes.
- [x] Complete independent full-scope check; fix findings and rerun affected gates.
- [x] Sync specs/docs and work commit; archive with valid links and journal before next integration leaf.

## Validation

`pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm protocol:check`, `pnpm build`;
`python3 /tmp/monos-ui-test-env.py pnpm --filter @monos/web test:e2e`.
Inspect Login default/error/busy; Settings empty/populated/long/uncertain/conflict;
Todo empty/populated/long; Discussion queued/unavailable/uncertain; preview exact/
disabled/created and Task local REVIEW. Use targeted capture in existing tests or
one coherent visual suite; no new permanent service. Verify zero leftover schemas.
Preserve predecessor screenshot evidence; save this leaf's own images before reruns.

## Risk and ownership checkpoints

The implement-role agent owns product files listed in design; root owns tests and
artifacts. Avoid hook/state changes. Check disabled fieldsets after Checkbox
migration, focus refs after composer replacement, and `[hidden]` after CSS cleanup.
Mobile controls remain44px; full approval content is accessible. Test fixtures
prove UI/HTTP behavior only. Native execution gates are not rerun for this styling.
