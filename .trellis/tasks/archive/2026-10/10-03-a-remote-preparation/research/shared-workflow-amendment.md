# Workflow scope shared amendment

2026-10-04. Active task: 10-03-a-remote-preparation. Root authorized this narrow
amendment after the shared contract READY. All other frozen shapes remain intact.

## Exact change

PublicationScanSummary gains optional workflow_changes:boolean, generated Go
WorkflowChanges *bool. Legacy scan JSON remains valid and absence is preserved;
old accepted publication fixtures/canonical request bytes were not edited.
For every new ordinary remote mutation, the complete CURRENT Runner scan must
carry an explicit boolean and matching canonical scan digest. Absence does not
mean false and never grants remote authority: arrange a fresh scan over the same
immutable construction, retaining original manifest/source/parents/history.
PushRequest.workflow_changes must equal this current verified scan fact.

The boolean is true iff the bounded all-parent PUBLIC COMMIT RANGE includes a
changed path under .github/workflows/, including deletion. Unchanged workflow
files in the separately scanned final tree do not set it. A same-tree mapping has
zero newly reachable commits and false, while still scanning the entire final tree
for every other policy. The Scanner already independently computes this property;
allowed workflow changes can be true with zero workflow_permission findings.

Permission bootstrap is before full finding eligibility and grants no push
capability: under exact source/config/input guards obtain an actual retained grant,
then create a new configuration-bound scan over the same construction. Unknown
workflow findings are evidence of a requested bootstrap scope, never the boolean
authorizing a push. A subsequent allowed scan carries its independent true/false
fact. True selects workflows-write in the minimal push token profile; false selects
contents-write only. No inference from missing findings, historic flags or enum
flips. Current-source/mapping/scan/waiver and immediate exposure guards still apply.

## Shared evidence

- pnpm protocol:generate followed by pnpm protocol:check: PASS, current generation.
- pnpm exec vitest run packages/protocol/test: PASS, 7 files and 331 tests. New fixture
  now 55 shared structural cases, including legacy absence, explicit true, null/text
  rejection; mapped explicit false and changed boolean affecting scan digest.
- go test -race ./internal/wire -count=1 from Runner with pinned Go 1.27.1: PASS.
  Typed push and mapped result round trips preserve explicit true/false and digest.
- Scoped new protocol test lint: PASS. Root tsc passed before subsequent backend
  edits; runtime implementation is ongoing and must receive its own final gates.
- Existing valid supplementary Unicode/path/body/frame cases remain covered.
- Actual Git range/deletion/allowed-with-no-finding/unchanged/mapped regressions are
  owned by Runner writer and pending his handoff. No remote effects or live provider
  tests are authorized by this intermediate evidence until main focused READY.

## Current changed input SHA256

| Input | SHA256 |
| --- | --- |
| `packages/protocol/schemas/v1/contracts.json` | `ab960c4e5f6ddfe1eea0f80d54411ecda4e1d73f04660940930b413b38953c9e` |
| `packages/protocol/generated/types.ts` | `834ff3515d9e4b4dc09c5c26b0d47b0c253acd7f12df7082b698ae75a3a78c12` |
| `packages/protocol/generated/go/types.go` | `dd68abdc5d3227fbedbc73c55debd3e0718d08fe2296ae8950f026e1acd3aa1f` |
| `packages/protocol/generated/go/contracts.json` | `ab960c4e5f6ddfe1eea0f80d54411ecda4e1d73f04660940930b413b38953c9e` |
| `packages/protocol/generated/openapi.json` | `252175e5307537231a1e1a7b2b1c6ca421fde9c132c6ffef0c77a863f1c7793d` |
| `packages/protocol/fixtures/remote-preparation.json` | `593f11cdbea043494c98398d087612123866d5f0f33bc3c0e053e2eab0a1d5e8` |
| `packages/protocol/test/remote-preparation.test.ts` | `bc50dc8bd29689ec24e0083ee0ed444198ec9a83ff0fbda417f1008cccbda77f` |
| `runner/internal/wire/remote_preparation_test.go` | `1c081d260f0f2214fc108e2956f57d26e12f052ef9f65fe74cd6c4f04366d37f` |
