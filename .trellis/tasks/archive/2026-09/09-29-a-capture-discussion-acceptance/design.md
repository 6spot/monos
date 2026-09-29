# Capture and Discussion acceptance design

## Boundary

The three completed leaves already establish model-free capture, native ordered
Discussion, Stop/Retry/Withdraw, exact confirmation and one nonexecuting Task.
This leaf combines those versioned results and closes the remaining persistence
check across idle backend/Runner restarts. It adds acceptance tooling and evidence,
not execution features or new permanent services.

## Evidence model

Reuse the archived leaf verification reports and final Task Preview source manifest.
Inspect existing host evidence rather than rerunning paid/model work. Record the
current ready Task, archived source Todo, exact created preview, immutable receipts,
Specification and zero execution footprint before and after sequential restarts of
the existing server and Runner. Require globally settled work before any restart.
Verify reconnect, stable identities and exact retained content, no extra model
Attempt/Start and physical absence for all native Discussion trial Attempts.
Runtime output/exit facts may reconcile after physical release. Retain every
earlier event unchanged; accept only contiguous, digest-valid output/exit records
for the same released/revoked dispatch and the precisely explained log progress,
activity timestamp and exit-observed fields. All other canonical records and
execution authority must remain exact. API/local/DB reads are not one transaction;
native event summaries may be an earlier prefix of the raw event collection.

The harness must persist intent before restarting and preserve uncertain/failed
evidence; a retry must never silently overwrite evidence or restart again. Read-only
queries and existing authenticated Owner reads are sufficient. No fixture writes,
new Task, new model invocation, or direct database state changes are necessary.

## Compatibility and limits

Migration 15 and the existing Discussion-compatible Runner remain unchanged.
Idle restart evidence supplements earlier live Runtime and browser recovery tests;
it does not establish Task execution, delivery or full Stage A/V1 acceptance.
If interrupted, inspect current service/ownership facts before further action;
do not replace processes from harness timeout alone. An explicit resume after a
completed backend restart must bind the retained failed report and its actual
before/after service identities, exclusively claim that continuation, and restart
only the still-unperformed Runner stage. Preserve original failure evidence.
