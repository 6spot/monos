# Independent remote preparation planning review

2026-10-04. Active task: `10-03-a-remote-preparation`.

**Planning verdict: READY.** No blocking planning defect remains in the reviewed
PRD, design and implementation sequence. This permits the shared-contract freeze
step; it is not an implementation, native App integration or acceptance verdict.
Only this report was written. Product, generated files, specs and task lifecycle
remain owned by the main session and assigned writers.

## Findings (fixed)

No reviewer source fixes. Main incorporated the following research resolutions
into the planning artifacts before this gate:

- `design.md:32`: each new ordinary remote mutation supplements
  `localAdmissionAllowed` with canonical `taskInputGuards`, exact current source,
  effective basis, configuration, scan and applicable Owner receipts. Input is
  serialized on the Task lock; replying to a message is not necessarily resolving
  its transferred requirement, issue or guidance obligation.
- `design.md:46`: remote effect ownership does not borrow
  `task_publication_slots`. Narrow Delivery quiescence integrates at requirement
  publication and withdrawal release, Replan publication and corrective guidance
  reactivation. Admitted unresolved effects cannot be forgotten by revision,
  incarnation change or worker lease expiry.
- `design.md:81`: equal-tree new-source results use an explicit durable mapping
  to the existing published manifest/head/item. Original manifest/source identity
  stays immutable. The mapping grants no new push, override or Accept authority.
- `design.md:100`: prior controlled public objects belong in a service-owned
  candidate object store when needed; the original completion export is never
  repaired or substituted. This supersedes the research proposal in
  `research/runner-remote-design.md` to import into a new source export/cache.
- `design.md:131`: an uncertain started push followed by expected/absent ref is
  possible-publication attention, not proof of never-executed or never-exposed
  work. Any unexpected remote head remains attention; no automatic ancestry
  adoption, reset, force or replacement construction.
- `design.md:178`: native injected-token synthetic GitHub evidence is explicitly
  separate from production App issuance. Existing installed App configuration
  count zero remains an external gate for the later combined delivery leaf.

## Findings (not fixed)

No unresolved blocking finding. The following are explicit implementation
dependencies and evidence limits, not completed behavior:

1. **Shared contract must freeze first.** `implement.md:7` and `design.md:55`
   assign the backend/protocol owner exact published-parent, mapping, permission,
   push/result/ack, read and Retry schema signatures and strict TS/Go fixtures
   before dependent Runner/Web edits. Placement of the same-tree mapping is a
   named producer responsibility, not permission for consumers to invent a
   construction or silently relabel old scan evidence. Any mutation following a
   mapping still needs current configuration/scan and exact applicable receipts;
   a refresh must identify the reused physical head and new mapping context.
2. **Current source is a seam, not the new implementation.** Existing
   `apps/server/src/task-guidance.ts:410` supplies the canonical input union;
   `publication-candidates.ts:23` supplies local admission only. Existing
   requirement slots, Replan quiescence and both Cancel paths require the assigned
   narrow remote integrations. Missing new code at this planning stage is not
   reported as an implementation defect.
3. **Historical observation does not restore current authority.** Reconciliation
   may read and record an admitted push/PR effect after input, revision or Cancel.
   It cannot launch the next ordinary mutation. Cancellation remains terminal
   and has only separately scoped cleanup authority after predecessor settlement.
4. **Installed App gate remains open.** Test App signing/provider responses and
   the native synthetic kernel can verify their stated boundaries. Neither an
   OAuth account nor an injected test token proves actual App JWT issuance,
   repository installation selection or installed workflow permission.

## Verified contract convergence

| Concern | Planning contract and final verification obligation |
| --- | --- |
| Durable non-Attempt work | Delivery-owned immutable intent/result/observation plus separate progress; one unresolved mutation per item survives restart. No Runtime Attempt or accepted-delivery setter. |
| Input/effect race | Persist ownership under the Task/config/item locking discipline before write access; recheck after token I/O. Input first blocks start; effect first requires reconciliation and blocks successors. No transaction spans provider/Git/WSS I/O. |
| Revision and Cancel | Source mutation waits for admitted effect quiescence. Cancel immediately fences new preparation, then reconciles push/create/update and closes only the exact owned undelivered open PR; retain branch and visible cleanup attention. |
| Public ancestry | Initial materialization proof and reconciled published proof are distinct tagged variants. Later proof permits changed activation/generation only with same Task/resource/repository/storage/item and trusted retained receipt. Object availability is not provenance. |
| Construction and no-change | Rescan/retry preserves immutable construction. True correction parents the verified last published head. Revert to original base remains a real FF correction; equal published tree maps to existing head/item, not a first-publication no-item result. |
| Exposure and workflow | Historical known-public credential exposure remains a positive guard through clean/deleted/same-tree/new-source results. Exact eligible overrides cannot cover hard findings. Workflow permission needs authenticated retained grant proof and a new scan when configuration changes. |
| Physical push fence | One explicit nonforce FF ref update; fixed private system pre-push guard checks the actual advertised expected head/ref/local OID. Receiver old/new CAS covers later race. Repository hooks, arbitrary refspecs and source pushes stay excluded. Actual Git tests must prove this behavior. |
| Uncertain provider writes | Exact intended ref or unique repo/head/base/marker PR match can settle the original effect. Zero matches after uncertain create never permit duplicate POST. Lost PATCH reconciles exact immutable content digest; mismatch cannot justify blind overwrite. |
| Checks and paging | PR identity/head/base brackets literal-head check/status reads. Changed head/base invalidates freshness. Bound pagination, body bytes, rate limits and installation cooldown; incomplete/unknown/no-checks never mean success or merge authorization. |
| Metadata and UI | Canonical current Task title/completion/reference rendering, bounded UTF-8 and credential redaction before publication. Preserve local inspector; adjacent scoped current/history/cleanup reads and receipt-backed Retry. Session and late-response fences remain mandatory. |
| Scope | Automatic GitHub only; `after_acceptance` remains local-only with zero write-token requests/new remote mutations. No Accept, merge, Request Changes, new Task states, generic workflow engine or fake controls. |

These boundaries are consistent with the accepted local publication spec and
`docs/04-workspace-and-git.md` input, controlled public ancestry, cancellation,
provider refresh and exact-head requirements. Development autonomy supplies no
product Owner waiver or accepted-batch authority. No further user choice is needed
to execute the recorded planning and implementation sequence.

## Verification

- Loaded `check.jsonl` and applicable source/spec/research context, then PRD,
  design and implement. Read-only targeted `sed`/`rg` inspection confirmed the
  canonical input union, local admission, existing publication slot ownership,
  requirement withdrawal/publication and Replan/guidance/Cancel seams. Previous
  source-backed guard/UI research was reused; the accepted local candidate gate
  was not repeated.
- Initial path-scoped `git status --short` recorded modified task manifests/PRD
  and untracked design/implement/research; all existing changes were preserved.
- Python JSON/path check: **24 curated references, zero missing files**.
- Reviewed planning input SHA256:

  | Input | SHA256 |
  | --- | --- |
  | `prd.md` | `6b9478c2d09132125140bc934fab5dd2f014b96f697793ae95ff4f2f6a61e4f5` |
  | `design.md` | `9dfbb1cd0b5cc5254ef14102f8b197dfecb8c195c03627946b5ee0cb17631785` |
  | `implement.md` | `9f6610a0d3ca0ba8122022c1999e1e8dc178fcbaedf8ce99a4ea04a67ff2f3e7` |
  | `check.jsonl` | `fffaeddc768fa3ca8d4531664f76649c0e6f0f314c6ba042ae1ce2460f0e2ed8` |

- Scoped `git diff --check` and report formatting/reference check: PASS.
- Skipped generation, builds, tests, PG/provider/model/host operations and product
  lifecycle changes: this assignment is planning-only. Implemented current-input
  combined gates and actual image inspection remain required before leaf closure.
