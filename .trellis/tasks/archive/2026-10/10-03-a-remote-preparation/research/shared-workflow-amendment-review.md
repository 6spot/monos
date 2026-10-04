# Main focused workflow amendment review

2026-10-04. Scope: the narrow shared optional boolean addition. **READY** for
consumer implementation and isolated effect/fixture checks. All four active slots
are occupied by main/backend/Runner/Web, so main performed this focused review;
the independent final combined reviewer must also cover the runtime seam.
This does not accept the complete remote lane or any live provider effect.

## Verified

Main read the current schema, generated Go pointer representation, TS/Go typed
true/false round-trip assertions, all55 structural fixtures and actual scanner
range/deletion/final-tree behavior. All **8/8** report input SHA256 values match.
Removing only PublicationScanSummary.properties.workflow_changes and serializing
reconstructs the original entire schema byte hash16477ae... exactly. No other wire
shape changed. The accepted legacy publication.json fixture remains byte-identical
to commit2095660. The optional field is not in required; null/text reject, omission
is valid history, explicit false survives typed canonical round-trip.

Producer evidence applies to these exact inputs: generation/check PASS,331 TS
protocol tests PASS, full Go wire race/typed canonical tests PASS, scoped protocol
lint PASS. Main did not repeat unchanged broad gates. Exact verification manifest:
main-workflow-amendment-verification.json. Report SHA256
b334a9bd9580ceadec63c93b97c2ff4d5ab53431021e73a6c507855812187536.

## Runtime requirements remain open

Fresh complete current scans must emit the boolean and bind its digest. Missing
metadata forces fresh scan, never false. Allowed workflow change still true without
a permission finding; deletion true; unchanged final workflows and zero-range
mapping false. Grant/bootstrap/rescan avoids circular admission and keeps full
current source/config/input/receipt/physical guards. Production push requires exact
flag/profile agreement after token acquisition. Actual Git/PG/WSS/browser/native
and independent combined acceptance remain pending their writer handoffs.
