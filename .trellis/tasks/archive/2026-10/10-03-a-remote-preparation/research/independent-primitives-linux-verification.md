# Independent primitive Linux verification

2026-10-04. Covers accepted commit `2095660a1fe546412430b5d630d4837dc550155b`
plus exactly four primitive files from runner-primitives-handoff.md. All **123**
source path/digest pairs match the worker UID-bound isolated manifest. This is not
final shared-protocol or full remote-lane acceptance.

## Inputs and environment

Source manifest, result and original logs are retained in
`evidence/independent-primitives-linux-v2/`. Linux 6.12.107+deb13-amd64 x86_64;
native Git2.47.3. Isolated golang1.27.1-bookworm with offline go.sum dependency
verification, CGO=1, private TMPDIR and exact image/binary/source hashes in result.
Native service UID997/GID986 is distinct from execution UID1000. No installed
service changes, Runtime calls, provider effects or product source push occurred.

## Gates

All **eight stages PASS**: go mod verify; focused remote primitives; focused race;
host vet; host.test build; service-account Git/process/UID tests; retained publication
fixture; retained guarded remote fixture. Cancellation and parent exit require
actual process group absence. Linux actual-child UID binding passed. Remote fixture
constructs a public candidate and pushes to a synthetic local bare repository.
Independent root Git observation verifies actual head/tree/parents equal manifest.
Original intent/result/candidate digests match retained file bytes.

Sixteen remote protected paths plus proof.json are canonical, not symlinked, owned
by exact service UID/GID with 0700/0600 modes and protected ancestors. All **34**
execution-account read/write checks deny access. Five existing publication paths
satisfy ten additional denials. All original step log digests match result.json;
source remains unchanged. Main collection verification records exact result hash.

## Failed trial and limits

v1 lacks container --init. Both parent-exit/cancellation tests failed conservatively
with WorkerAbsent=false and unresolved ownership; original logs/result remain.
No false terminal release occurred. No syscall/zombie observation was captured,
so unreaped orphan groups remain an inferred cause. v2 uses Docker --init and
passes isolated and native host tests. This changes test descendant reaping;
actual ESRCH remains mandatory. Final integrated helper likewise uses --init.
Full Runner death/restart, spawn persistence gap, ACK loss and remote reconciliation
remain required for the full lane.

Both transport sockets were explicitly closed. Module-cache archives were moved
outside the tracked tree with verified unchanged SHA256; paths are in
`evidence/independent-primitives-linux-dependency-relocation.json`. No cache is
vendored. Local synthetic Git fixtures and remote isolated roots remain retained.
An initial main comparison helper assumed a list instead of the worker's inputs
map and stopped before writing this report; corrected exact-map comparison passed.
Later changed primitive inputs require affected revalidation.
