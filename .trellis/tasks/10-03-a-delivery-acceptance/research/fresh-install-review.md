# Independent fresh installation design review

Active task: `.trellis/tasks/10-03-a-delivery-acceptance`. Review dated 2026-10-08.
Sole write ownership: this report. Product, helpers, planning files and shared
framework changes were read-only and preserved. No host connection, credentials,
provider/model call, service action, product test, commit or task transition.

## Decision

**READY — design only.** Final reviewed
[fresh-install-design.md](fresh-install-design.md) SHA256
`cc70fccbf151966b27264bec24b687a039a1855d32ca136545e71d29ecf4ecae`.
The current-version fresh-install approach follows the Owner's pre-use decision.
The parent corrected the two details found in the initial static review, and the
final source-backed design has no remaining blocking findings. This review does
not approve an executable provisioner or claim installed/native acceptance.

## Findings (fixed)

Both fixes were made by the parent, then independently reread; the reviewer
changed only this report.

- Enrollment step 5 now explicitly uses JSON field `credential`, privately loaded
  from `private/runner_credential`. Actual
  [admin.ts](../../../../apps/server/src/admin.ts) consumes `input.credential`;
  [enrollFixture](../../../../apps/server/src/fixtures.ts) checks and hashes that
  value. No private value appears in the design.
- Shared-runtime replacement now observes/reconciles any actual required normal
  status/Stop while the old backend/Runner are available, stops the exact target
  server to exclude admissions, then rechecks actual ownership. New or unresolved
  owners block switching pending an exact reviewed reconciliation/physical
  cessation plan. The text explicitly refuses to assume normal commands can
  settle after backend shutdown. Actual
  [control.Run](../../../../runner/internal/control/client.go) requires backend
  inventory/WSS/Ready; [Host Stop](../../../../runner/internal/host/helper.go)
  establishes physical facts separately from canonical settlement. No historical
  Task/receipt comparison, translation or preservation gate was added.

The initial reviewed design hash was
`fdc154d380d66e714636eb02a9d33ac5e3ab5817f2bf0de19c078706cbbdc714`.
That earlier source review is superseded only for the two changed details;
unchanged product/build evidence remains valid.

## Findings (not fixed)

None in the bounded design scope. Actual transport, physical ownership release,
resource availability, provisioner review and installed audit remain unperformed
steps, and App inputs remain missing factual prerequisites. These are recorded
implementation/acceptance boundaries, not defects in the reviewed design.

## Source reconciliation

- [Current policy](../../../../docs/12-product-naming-and-upgrades.md), task
  PRD/design/checklist and development-phase-decision agree: a new scoped DB,
  configuration, journal and physical runtime root replace old-version upgrade,
  ciphertext/receipt preservation and rollback compatibility gates. Current-run
  receipts, exact authorization, recovery and physical ownership still apply.
- Candidate `63eaa285ab90fdd6de018671a47ba5583f87bc75` has no current changes in the
  tracked product/deployment/build scope. Composite receipt SHA256
  `066c1a62eade75781491f01dbc68fb938e0daa23ff046a651469d4144a654e13`
  matches its retained bytes. The design uses its exact server image and pinned
  PG17.11 image, retains source/four-binary identities, and requires installed
  reobservation rather than relying on tags. Existing build evidence is reused.
- Host constants and Runner main fix the root, socket and executable paths, so
  replacement of the sole target Runner is required. Bootstrap recognizes the
  stopped marker/account/group and rejects any remaining Attempt/operation unit.
  Its `--check` precedes installation while the recognized root still exists.
  Exact proven-stale unit retirement is scoped; unrelated/uncertain units and
  monolab remain outside the assignment. The replacement root's directory modes,
  service identity, matching UUID storage IDs and four ELF destinations match the
  actual bootstrap. A provisioner review remains necessary.
- Actual prepare.mjs creates exclusive private storage, fresh random credentials,
  RSA3072 TLS keys, localhost/127.0.0.1 certificates and strict chain/IP/purpose
  verification. Proposed Compose retains private secret mounts, internal network,
  fresh volume, readonly server filesystem and one selected loopback port.
  `main.ts` initializes schema25 before listening; the health body and migration25
  digest are source-backed. No older populated schema is imported.
- Owner bootstrap's bounded stdin JSON, password bounds and no-rotation path
  match owner-admin/owner-access. Relative Node commands match Docker WORKDIR
  `/app`. Secure same-origin Owner login/session/logout, session binding and
  protected infrastructure routes exist. Runner config matches the actual
  Config shape; the service-only token satisfies private-mode validation.
  Infrastructure online/current predicates and version-only discovery are
  correctly separated from native login/model/tool acceptance.
- Actual App key, ID and selected installation remain unresolved. The document
  supplies no fake provider outcomes, secrets or OAuth substitution and marks
  the plan unexecuted. All six acceptance criteria remain open.

## Verification

- Path-scoped `git status --short` recorded task/manifests/research dirty state;
  no preexisting changes were staged, reverted or modified.
- Read assigned context plus relevant architecture, deployment, current policy,
  collaboration, infrastructure/Owner access, Runner workspace/quality and
  protocol specs; inspected actual bootstrap/preparer/Compose/Dockerfile, Runner
  startup/config/discovery/journal/Host Stop, migrator, server startup/admin/
  Owner session/infrastructure routes. Static source reconciliation only.
- Inline Python checked all **27 relative links**, balanced fences and trailing
  whitespace in both reviewed design revisions: **PASS**. The final revision was reread after
  the parent corrections. Recomputed composite hash: **PASS**.
- `git diff --name-only 63eaa285ab90fdd6de018671a47ba5583f87bc75 -- infra runner
  apps packages scripts package.json pnpm-lock.yaml pnpm-workspace.yaml
  tsconfig.json tsconfig.build.json eslint.config.mjs`: **empty**, so unchanged
  product/build evidence remains valid after policy-only changes.
- Product suites, fresh runtime initialization and all host/provider/model effects
  were skipped: this is a read-only design review, and repeating unchanged tests
  would not resolve the two planning details or external App prerequisites.
