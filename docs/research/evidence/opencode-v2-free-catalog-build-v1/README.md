# Free-catalog Linux build and native preflight

Status: **passed** for `a93f3002ae0127098063bc08006a854af547d160`.
The four Linux binaries, race-instrumented adapter suite and native no-model
preflight passed. See [result.json](result.json),
[source-manifest.json](source-manifest.json) and
[adapter-linux-native.log](adapter-linux-native.log).

`build.py <commit>` archives `runner` and `packages/protocol/generated/go` from
only that Git commit (144 files; 1,771,520 tar bytes), creates the exclusive
`/root/monos-free-catalog-release-v2` directory, and records SHA-256 for every
archived source file. The existing pinned Docker Go image is used with no pull,
no network, read-only module dependencies and a new release-owned build cache.
All four product binaries are built before any verification-only source is added.

`native_catalog_preflight_linux_test.go` is then added only to the staged adapter
package and its digest is recorded separately. A race-instrumented adapter test
binary runs the existing adapter suite and one opt-in native `verifyModel` call.
The opt-in test uses the production `Environment` and a new synthetic Attempt
directory. It does not call `Run`, create a session, submit a prompt or perform
model inference. The observed OpenCode 2.0.20 binary hash must still match.

`supervise.py` runs in one new transient systemd unit. It drops supplementary
groups/GID/UID to `1000:1000` before starting the test executable; native OpenCode
therefore also runs as the execution account. The root supervisor only observes
and reaps its descendants, using process birth identities for cleanup. This
avoids treating unreaped Docker PID 1 descendants as live probe failures.

The test source retains the production 30-second preflight deadline and bounded
cleanup. The wrapper records test exit, observed process identities and cleanup
intervention. Successful evidence requires no live descendants and no wrapper
kill intervention. The caller then stops only its transient unit, verifies its
cgroup is absent and removes only its own fixture. Failures remain recorded;
uncertain cleanup does not authorize an automatic retry.

No binary installation, existing service restart, policy change or business
command is included. Build/native results belong in `result.json` and the remote
source manifest; verification-only source is not a product binary input.

## Recorded outcomes

The first full-repository upload to `/root/monos-free-catalog-release-v1`
included 131,298,073 bytes of tracked file content, mostly unrelated historical
evidence. It timed out after 700 seconds before the archive was fully received.
An intended targeted interruption found the original process already absent;
no signal was sent. The retained directory was empty, no source or build had
started, and the verification unit did not exist. This failed transport is
preserved in [upload-v1-observation.json](upload-v1-observation.json).

After that reconciliation, the exact same commit was archived using only its
Go module and sole local replacement module. Their complete file digests were
compared with a fresh local Git archive. A fresh v2 release directory received
that reviewed source set. The product builds completed before adding the native
verification test. Both build commands exited zero; the native/test executable
also exited zero under UID/GID 1000. The supervisor recorded no cleanup signal,
joined its reaper, and observed no remaining descendants. The transient cgroup
and synthetic Attempt directory were absent after cleanup.

This proves the actual Go preflight against the installed OpenCode 2.0.20 in a
fresh environment. It does not itself prove inference, formal reply submission,
quota availability or complete Stage A acceptance. The selected-entry catalog
snapshot is not a guarantee of future pricing or all-plugin stability.
