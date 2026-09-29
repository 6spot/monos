# Node execution implementation plan

Owner standing authorization covers sequential implementation, test-host use,
commits and routine decisions. Review persisted planning/research then activate;
do not ask permission again. Workers implement directly without further delegation
and preserve others' edits in this shared tree.

## Ownership and sequence

1. Backend/protocol worker owns `apps/server/**`, `packages/db/**`,
   `packages/domain/**`, `packages/protocol/**` and root test registration. Stabilize
   wire schemas and notify Runner, then migration 18, source/context/pump, Artifacts/
   manifests, controls/read APIs, cancellation and paired settlement. Preserve probes.
2. Runner worker owns `runner/**` (generated protocol is backend-owned). Implement
   CLI tools, repository-free complete and trusted completion recovery from Runner
   research. Coordinate wire fields. Cover journal replay, worker exclusion,
   checkpoint/export durability and already-successful completion races.
3. Root owns `infra/probe/**`, task/spec docs, integration and host operations.
   Native tests use actual Owner APIs/canonical Plans/CLI. Inspect carryover Task
   before pump rollout. Reuse services/port override; retain all failed evidence.
4. Independent check worker reviews full contracts/diff/races, then deployed native
   evidence. Coordinate fixes by ownership; fake results do not prove native safety.
5. Full gates, verified source/build deploy, native acceptance, executable specs,
   commit/archive/journal exactly once; continue automatically to Task Conversation.

## Validation

Use the complete test matrix in backend and Runner research. Include observed
independent PG contention/crash; canonical discovery; frozen context/byte limits;
offline vs queue vs exhaustion; physical exclusivity; Artifact scope/immutability/
exact manifest; terminal races both lock orders; no-resource completion; hard/soft
Git effect arrival ordering, same-ID repair/fresh correction; Cancel during admitted
completion; stale activation, receipt rollback and original replay.

Run `pnpm protocol:check`, `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm test:db`
using unique schemas/private test URL, `pnpm build`, native Node module imports;
Runner `go test -race ./...` and `go vet ./...`;
`python3 -m unittest discover -s infra/probe -p 'test_*.py'`.
Linux builds use complete verified snapshots and require a successful final exit
before installing any binary. Native tests compare exact Artifact bytes/digest,
Git input/output trees, receipts and real PID/cgroup/journal release across recovery.

## Baseline

Host `100.120.14.84`; SSH master `/tmp/monos-runtime-acceptance-ssh`;
source `/root/monos-boundary-probe-src`; `monos-probe-runner.service`; backend HTTPS
18444. Always include `/root/monos-boundary-probe-ports.yaml` in Compose up.
Current migration 17, accepted planning source v2. Private test DB URL
`/tmp/monos-task-planning-db-url` forwards existing PostgreSQL at 15439.
Never print secrets. No push, new permanent service or private-App claim.
