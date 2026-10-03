# Independent review matrix

This matrix is a check aid for the agreed PRD/design, not additional scope. Trace actual implementations and executed assertions; report any unsupported gate rather than infer it from mocks.

| Boundary | Review assertion |
| --- | --- |
| Owner read authorization | Task/operation ownership, exact caller digest and session header validation; revoke/replace session during pending I/O must suppress bytes |
| Result projection | Selected operation beyond first history page resolves directly; exact carry applicability remains separate from original Spec/Plan attribution |
| Backend/Runner boundary | Backend opens no Runner path, creates no new effect/receipt/Agent; no transaction spans read I/O |
| WSS correlation | Ready capability and active instance/socket/incarnation; mismatched/late/duplicate response identity/mode/path/side cannot settle another request |
| Bounded lifecycle | Deadline, disconnect/shutdown cleanup, receiver and heartbeat responsiveness, concurrency limits and cancelled Git worker reap |
| Runner chain | Retained original operation/start/successful effect plus canonical operation and manifest digests; no requirement for original Attempt to remain running |
| Recovery/history | already_finalized completion resolves original export; later current lease/generation/head does not relabel old result; actual storage mismatch still rejects |
| Private export | Fixed service-owned private directory and ancestors, no symlink substitution, exact retained result ref/commit/tree/base; no fallback clone/fetch/re-export |
| Byte fidelity | Leading/trailing spaces, final newline, empty versus absent, strict UTF-8/binary handling; file contents never pass TrimSpace or raw HTML rendering |
| Git/path safety | NUL parsing and literal valid unusual paths; traversal/absolute/pathspec injection rejected; symlink text and gitlink metadata never traversed; no ext diff/textconv/lazy fetch |
| Complete bounds | 64+ changes pagination, crossed cursor rejection, explicit total-scan cap, 64 KiB text and 512 KiB serialized reply including worst-case JSON escaping |
| UI state | Current/history exact selection, late selection/session fencing, on-demand content, offline retry preserves metadata, contained code scrolling and keyboard reachability |
| Evidence | Actual Git versus authenticated PG/WSS versus synthetic browser distinctions; inspected screenshots have actual source/build/route/state identity |
| Scope | No publication candidate, provider mutation, final acceptance, new Task state, database migration or source push |

Read specification update proposals against actual exported names/statuses and test observations, not illustrative research naming. Original provider/installed execution reports are upstream context only.
