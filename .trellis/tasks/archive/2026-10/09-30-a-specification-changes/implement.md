# Specification revision implementation plan

## Ordered work

1. [x] Read owning architecture/current specs, research proposal/settlement seams,
   converge the PRD and complete design within the already authorized leaf scope.
2. [x] Curate and validate implementation/check contexts; activate under continuing
   user authorization. No new approval request or permanent service.
3. [x] Backend/schema: immutable proposals and attachment, exact impact/Owner receipt,
   direct edit, stable source obligation, replacement/withdrawal and bounded reads.
4. [x] Backend: serialized change admission, existing physical Stop/settlement,
   authoritative freeze hooks, applicability-aware atomic publication and explicit
   later-input deferral/recovery. Preserve Stop/guidance/history/lease identities.
5. [x] Runner/protocol consumers: expose exact source-scoped prepare/apply commands,
   bounded context guidance, schema generation and immutable retry/phase validation.
   No new physical Runner operation or live steering.
6. [x] Meaningful real PG direct-SQL negatives, independent-process contention/crash,
   completion/Stop/guidance/input/withdrawal races and prior regression suites.
7. [x] Independent full-scope review; resolve findings and synchronize owning specs.
8. [x] Freeze source, run full local/Linux PG/Go/image gates, back up and install into
   existing host services; prove native exact proposals/authorization/private-work/
   new-revision sources and service restart with immutable historical evidence.
9. [x] Final independent acceptance, scoped feature commit, task archive and session
   journal; continue next leaf `09-30-a-single-node-replan` automatically.

## Ownership

- Backend implementer owns `apps/server/**`, `packages/db/**`,
  `packages/domain/src/commands.ts`, `packages/protocol/**`, root DB test command.
  Dedicated reviewer suites may be assigned separately; coordinate shared file edits.
- Runner implementer owns `runner/**`; never edits generated protocol output by hand.
- Root owns task/spec docs, `infra/probe/**`, source freeze and host acceptance.
- Reviewer owns its findings and agreed independent regression fixtures; fixes in
  other owners' files require coordination, never reverting their concurrent work.

All workers share the checkout. No push, new service, broad framework refactor or
rewriting old migrations/receipts/manifests. Existing deployment remains accepted
migration19 until the next verified additive installation.

## Required validation

Use isolated real PostgreSQL schemas; load the private URL into subprocess env,
never print credentials. Standard checks:

```sh
pnpm protocol:check
pnpm lint
pnpm typecheck
pnpm test
pnpm test:db
pnpm build
node --experimental-strip-types -e "import('./apps/server/src/app.ts')"
python3 -m unittest discover -s infra/probe -p 'test_*.py'
git diff --check
```

Runner: module verification, full race tests, vet and all four production binaries
on Linux, using existing verified module cache if the network is unavailable.
Run scoped tests during development; one final full suite on the frozen snapshot.
Repeat expensive checks only for real changes, failures or unresolved concerns.

## Risk checkpoints

- Currentness must become applicability-aware without renewing old source/Attempt
  authority. Every retained completion stays attributed to its original revision.
- All scheduling and physical-result projections must obey the same admitted
  change; no old-basis auto-correction/guidance pump or stale-result rollback.
- Unfinished private work stays on its activation unless successful finalized
  completion warrants a new activation as explicitly disclosed by approved impact.
- Admission may advance its own control basis; later Owner Stop is not erased and
  material changes cannot be laundered by substituting a current version.
- New input and its child obligations remain independent of reply processing and
  exact deferral. Replacement has one originating guard and one active publication.
- Existing host18444 and unrelated service18443 retain identity/history; use fresh
  source/backups/claims. Fixture timeouts and malformed native commands retain their
  original evidence, and observer corrections never rewrite product state.
