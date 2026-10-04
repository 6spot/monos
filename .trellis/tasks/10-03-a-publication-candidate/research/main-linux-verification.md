# Main native Linux verification

2026-10-04. Isolated Linux6.12.107+deb13-amd64 x86_64, native Git2.47.3,
cached Go1.27.1-bookworm image. Exact final input manifest has119 regular files:
118 Go/JSON/module inputs plus runner/README.md. Every recorded source byte
matches current checkout; host aggregate61416bb795b07d8a7fbd15f76b9e39eeb6f308d325a1a49a53f773a2b4600bfc
matches final Darwin report. Before/after remote source digest checks pass.
No production installation, service restart, Runtime/model execution or remote
provider effect was performed.

## Final gates

`evidence/linux-validation-v3-private-temp/result.json` reports complete=true:
locked dependency go mod verify, CGO whole-module test, race, vet, host test build
and four CLI/Runner/helper builds all PASS. Containers had network none with
GOPROXY/GOSUMDB off; exact ziphash/go.sum manifests bind offline dependencies.
Four produced binaries are ELF64 x86_64; their complete digests/sizes and main
independent file observations are retained. They were not installed.

Native service-account execution ran ^TestPublication:19 top-level PASS,
one opt-in retained-fixture default SKIP. Explicit retained-fixture second run
PASS separately; new actual multi-rule ordinal regression is among the19 passes.
Actual service Git factory generated exact export/candidate and fsynced journal
intent/pages/candidate. Synthetic public baseline is explicit and does not prove
production remote-open/publication provenance or installed Runtime acceptance.

Service UID997 and execution UID1000 are distinct. Factory-created export and
journal are service-owned0700; intent/pages/candidate are0600. All ten independent
execution-account read/write checks returned1. Main repeated those five path
ownership/mode/denial observations independently after the helper completed;
`main-independent-observation.json` records actual results and ELF file metadata.
Paths remain in the unique isolated service fixture for review.

## Failed trials preserved

v1 did not reach tests: locked dependency network download timed out. v2 offline
mod verify passed, then an existing result-lineage test correctly rejected default
world-writable /tmp ancestry. v3 supplies unique0700 container and service-owned
TMPDIR without changing product trust predicates. Both complete prior failed
logs/results remain task evidence; v3 supersedes them for acceptance.
A local Tcl8.5 synthetic escaping harness initially used unavailable binary encode;
corrected binary scan harness passed four literal cases. Actual private SSH auth
had been independently verified and no credential entered source, argv or logs.
Long default Mac socket location failed; a task-owned short /private/tmp path
succeeded. No unverified cause is asserted for that transport setup failure.

Private cache archives were relocated without byte changes; tracked dependency
manifests and relocation hashes preserve exact inputs. Three task SSH transports
are closed/absent after collection. Earlier bounded transports had expired before
explicit close; Control check confirms no socket. Remote task evidence remains
isolated; existing production/monolab histories and services were preserved.
