# Step 3 dependency release

2026-10-04. Independent shared-contract review is READY; B1 and history placement
are closed in the clarified freeze. Main released backend, handwritten Runner and
Web owners under the current implement context and scoped shared-workspace rules.

- Frozen report SHA256: `696d179ace2e234f5f612bc63e68cf362c975427ff275a51b8e1377ce43580b7`.
- Design SHA256: `cf18d256f01f6617c2890f1dae4792f0e3ea964b9f7bc54102dcbbbac0765314`.
- All 15 shared/migration/test inputs verified unchanged in main v2 manifest.
- Reviewer only changed `research/shared-contract-review.md`.
- New runtime resolution/history cases remain mandatory acceptance work.

Backend owns provider/coordinator/access/commands/reads, protocol, PG/WSS tests
and narrow Task input/Cancel/revision/quiescence integration. Runner owns handwritten
host/daemon/control/private journal/public graph/proof/mapping and physical tests.
Web owns features/API/task journal/CSS/browser tests and only the two explicitly
assigned server browser fixtures. Root owns specs, integration, host/provider
trials, source/evidence manifests, commits, archive and journal. Framework changes
remain excluded. No child performs host/provider effects, commits or lifecycle.

Native process verification is independently scoped to accepted commit2095660
plus exactly four primitive files (123 manifest inputs), not current full lane.
First Linux isolated-container trial failed conservatively with WorkerAbsent=false
in both parent-exit/cancellation tests; original logs are retained. The test image
lacked a container init; a separate trial enables Docker --init. No syscall/zombie
observation was recorded, so cause is an inference pending evidence. No production
absence rule is weakened. Final integrated Linux helper also enables init for
controlled orphan reaping and still requires actual worker-group ESRCH.
