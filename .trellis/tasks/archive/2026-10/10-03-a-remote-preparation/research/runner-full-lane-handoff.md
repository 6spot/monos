# Runner full lane handoff

## Scope and freeze

Implementation handoff to main; no task lifecycle transition. Owned handwritten Runner host/daemon/control source and tests are ready for independent review and main's final Linux/native gates. No live provider, installed service, model, commit, push or host operations were performed by this worker.

- Accepted base commit: `2095660a1fe546412430b5d630d4837dc550155b`.
- Current shared frozen contract SHA256: `2382a244d00fbcd6564271b705b9a6d3b2b6dc8c2545656e65b027c5b8858154`; includes root-approved optional `workflow_changes` amendment. Shared wire/schema/generated files belong to the backend writer.
- Final [138-input manifest](evidence/runner-full-lane-final-inputs.json), SHA256 `1a1c7f6c2840ca1ac984eb6d79886bee9c14dc6234c16157dc51326837751840`, contains exact current Runner Go/module, generated Go and protocol fixture inputs plus all 29 owned file hashes.
- Whole Go gates ran once against [original 138-input manifest](evidence/runner-full-lane-go-inputs.json). Exactly `publication_remote.go` and `publication_remote_test.go` subsequently changed for immutable scan permission context. The final manifest records both old/new hashes; the other 136 inputs are unchanged. Current scoped checks cover this delta. Do not describe the original full-module run as having used the final two hashes.

## Implemented behavior

The dedicated two-worker, bounded 120-second remote lane runs outside Runtime/Attempt scheduling. Ready advertises the capability; current authenticated control incarnations carry bounded requests/results/ACK. Retained unacknowledged results replay after Ready without another construction/scan/push. ACK appends synchronously beside immutable local result and absence evidence, avoiding the full effect queue.

Original result export/ref/tree, original open journal/service pin/cache and repository/storage identity remain the source authority. Original parent descriptors use their frozen pointer variant; later published parents require the original private push intent/result/ACK, exact scope/digests and physical absence evidence. Source generations can differ only through an explicit new source proof. The service-owned public Git object store imports verified public parent graphs and the exact result tree, excluding private source commit ancestry and preserving original exports.

Candidate dates/head/construction remain fixed across permission/config scan retries. No-change compares the actual first public parent tree. A source reverting to the original base after a different published tree creates a real new fast-forward candidate. Same-tree source correction reuses the old immutable manifest/head through an explicit new-source mapping and new scan; old manifest source attribution is never rewritten.

Every new scan records actual workflow changes across the publication range. Missing legacy metadata requires fresh admission; workflow writes require verified current workflows-write grant. Permission HTTP responses bind original operation/request and immutable repository/App/installation/key/config/grant fingerprint; an authenticated fresh proof may renew observation/expiry without rewriting the original proof. New pushes require the immutable scan's retained proof context to match that stable authority. Claims and tokens are checked again for freshness before starting.

Fixed service-owned pre-push hook validates exact advertised single ref, destination, local candidate and expected remote old OID. Hook installation/validation occurs immediately before push; ordinary nonforce receiver CAS remains authoritative. No repository hook or arbitrary executable/URL is accepted. Credential material stays RAM plus anonymous pipe to fixed askpass; it is absent from files, argv, Agent environment, Git config, journal and WSS.

Private item flock, fsynced intent, started marker before spawn, persisted actual worker UID/boot/birth/group and immutable group absence prevent effect repetition. External cancellation retains unfinished intent. Started uncertainty observing expected/absent/unavailable remains possible publication and cannot retry the effect. Missing/tampered identity, birth reuse or spawn-to-persistence gap stays unresolved without unsafe signals or fabricated worker absence. The process primitive kills the whole controlled group, bounds output/deadline/WaitDelay and requires physical absence before settlement.

An ACKed `reconciliation_required` result stays immutable. Independently observing the exact candidate ref through the original operation can append `resolution.json`; later parent verification uses that retained resolution. It never mutates the original result/ACK or repeats the original effect.

## Actual checks and retained bytes

Pinned tool: `/Users/me/.local/share/mise/installs/go/1.27.1/bin/go`; commands below ran in repository `runner/` on Darwin arm64. Raw subprocess stdout/stderr and structured invocation metadata are retained; this prose is a summary, not reconstructed raw output.

| Input boundary | Command | Result and raw log |
| --- | --- | --- |
| Original integrated 138 inputs | `go test ./... -count=1` | PASS all packages; host 76.435s. [stdout](evidence/runner-full-lane-go-test.stdout.log), [stderr](evidence/runner-full-lane-go-test.stderr.log), [invocation](evidence/runner-full-lane-go-test.command.json) |
| Same original inputs | `go test -race ./... -count=1` | PASS all packages; host 95.178s. [stdout](evidence/runner-full-lane-go-race.stdout.log), [stderr](evidence/runner-full-lane-go-race.stderr.log), [invocation](evidence/runner-full-lane-go-race.command.json) |
| Same original inputs | `go vet ./...` | PASS exit0. [stdout](evidence/runner-full-lane-go-vet.stdout.log), [stderr](evidence/runner-full-lane-go-vet.stderr.log), [invocation](evidence/runner-full-lane-go-vet.command.json) |
| Final two-file permission context delta | `go test ./internal/host -run '^TestRemotePreparation(DurablePush\|UnknownResolution\|Revert\|FreshScan\|WorkflowGrant\|ImmutableScan\|RetainedProof)' -count=1` | PASS host17.827s. [stdout](evidence/runner-permission-context-delta-test.stdout.log), [stderr](evidence/runner-permission-context-delta-test.stderr.log), [exact invocation](evidence/runner-permission-context-delta-test.command.json) |
| Same final delta | Same selector with `go test -race` | PASS host20.756s. [stdout](evidence/runner-permission-context-delta-race.stdout.log), [stderr](evidence/runner-permission-context-delta-race.stderr.log), [exact invocation](evidence/runner-permission-context-delta-race.command.json) |
| Same final delta | `go vet ./internal/host` | PASS exit0. [stdout](evidence/runner-permission-context-delta-vet.stdout.log), [stderr](evidence/runner-permission-context-delta-vet.stderr.log), [invocation](evidence/runner-permission-context-delta-vet.command.json) |

The `\|` escapes in the Markdown table preserve columns; the linked command JSON contains the actual unescaped regexp. Full input hashes did not change during full gates. Scoped final `git diff --check` and file-only trailing whitespace inspection of all 29 owned files passed. No broad gate was repeated after this narrow delta, consistent with the verification stopping rule.

Physical local Git cases cover push effect loss, original result/ACK loss replay, original-operation resolution, new-generation same-tree mapping, real revert fast-forward, fresh workflow grant rescan with stable construction, cancellation with retained unfinished state, exact scan/pages/store tampering before claim, and missing ACK/worker proof. Control uses actual TLS HTTP/WSS to test current-incarnation access/result/ACK bindings; its handler fixture is distinct from physical host journal/Git cases.

`TestRemotePreparationRunnerSIGKILLAndIdentitySafeRecovery` actually kills a separate Runner subprocess while its controlled Git-like/helper process group and descendant remain alive. Darwin proves lost flock does not imply absence and conservatively refuses missing Linux boot/birth identity. Linux-only positive identity recovery and tampered-birth no-signal branch need root's final native run. `TestRemotePreparationSpawnPersistenceGapKeepsOwnership` refuses to settle/repeat when the persisted started marker lacks worker identity. Ordinary cancellation cases do not substitute for these process-death cases.

The final missing-scan-proof negative assertion also has stale prepared request digests; it is an integration rejection assertion, not an isolated proof of that one predicate. Positive physical fixtures use matching immutable/fresh proof contexts and pass the final validator. The validator's explicit context requirement is present in reviewed source.

## Retained fixture and native handoff

`TestRemotePreparationNativeRetainedPermissionFixture` skips unless `MONOS_REMOTE_PREPARATION_EVIDENCE_DIR` names a fresh empty absolute service-owned0700 directory beneath safe service ancestors. Root may run only this selector with its exact final test binary; no sudo, provider, installed state or service mutation is used by the fixture. It executes the actual new full journal/store/candidate/scan/push/ACK/proof code against a synthetic local bare Git remote and synthetic permission authority.

Darwin retained v2 actual invocation passed host2.394s: [invocation](evidence/runner-full-lane-retained-darwin-v2.command.json), [stdout](evidence/runner-full-lane-retained-darwin-v2.stdout.log), [stderr](evidence/runner-full-lane-retained-darwin-v2.stderr.log), [safe proof](evidence/full-lane-retained-darwin-v2-t8hw047h/proof.json). It predates the final permission-validator delta; root must use final source for its new native fixture.

Initial retained attempt failed because bare clone did not carry custom `refs/monos/result`; raw [stdout](evidence/runner-full-lane-retained-darwin.stdout.log), [stderr](evidence/runner-full-lane-retained-darwin.stderr.log), [invocation](evidence/runner-full-lane-retained-darwin.command.json) remain. Fixture setup now restores the exact source result ref in its retained clone; it does not alter the original export.

`proof.json` shape: `{schema_version,fixture_scope,service_uid,operation_id,item_id,request_digest,result_digest,candidate_manifest_digest,published_proof_digest,head,tree,parents,remote_ref,observed_head,source_head,source_tree,paths:[{kind,path,mode}]}`. Scope is exactly `full_lane_actual_git_synthetic_baseline`. Paths are root, journal, item, operation, intent, started, worker, absence, result, ack, published, lock, hooks, pre_push, public_object_store, original_source_export, synthetic_remote, candidate_intent, candidate_manifest, scan_pages: 20 entries plus proof.json itself, total21. Files0600, hook0700, service-private directories0700. **Synthetic public-data remote.git is Git-created0755 beneath the enclosing private0700 evidence root**; report that fixture exception explicitly. Root can still verify independent execution UID read/write denial through the private ancestor. File-only inspection found all21 modes match their recorded values, no symlinks and UID501 in this Darwin run: [inspection](evidence/runner-full-lane-retained-path-inspection.json). This does not claim different-account denial or native Linux ownership.

Useful Linux selectors are the above full-lane host cases plus `TestRemotePreparationRunnerSIGKILLAndIdentitySafeRecovery`, `TestRemotePreparationSpawnPersistenceGapKeepsOwnership`, `TestRemotePreparationProcessLinuxUIDBinding`, `TestRemotePreparationProcessGroupCancellationAndParentExit`, `TestRemotePreparationGuardedPushRevalidatesFixedHook`, and the opt-in retained fixture. All regular fixtures are temporary, controlled subprocess/Git only. Root owns final native source/permission validation.

Historical [independent Linux primitive report](independent-primitives-linux-verification.md) remains valid only for its accepted-base+four-file source. Root's Linuxv2 `--init` all8 stages and native serviceUID997/GID986 versus executionUID1000 proof had17 protected paths/34 denials, not the new full lane's21 paths. Linuxv1 failed group absence conservatively; changing container reaping is an inference from v2, not measured zombie/syscall proof. Original failed quarantine race remains explained in [primitive handoff](runner-primitives-handoff.md): the synthetic receiver hook unsets quarantine to exercise a competing receiver writer; the production controlled guard never performs that write. No historical evidence is relabeled as current integrated protocol proof.

## Root-only GitHub lower-kernel bridge

`TestRemotePreparationGitHubKernelFixture` skips unless root explicitly supplies `MONOS_REMOTE_GITHUB_EVIDENCE_DIR` as a fresh private absolute directory. Strict bounded stdin JSON carries safe fixture metadata; credential is **only anonymous inherited FD3**, never a token JSON field/env/argv/file. The bridge is confined to repository `6spot/monolab-feasibility-20260928-160020-public`, numericID `1393178791`, fixed canonical GitHub URL and stable `refs/heads/monos/task/<task UUID>/<resource UUID>` ref.

Input: `{action:'prepare_push'|'correction_push'|'observe',repository,repository_id,task_id,resource_id,item_id,operation_id,previous_operation_id?,base,expected_head:null|OID,synthetic_text?}`. IDs and OIDs are validated, JSON <=16KiB with no trailing value, synthetic text<=4096 and finite credential detection. Candidate adds only fixed `monos-remote-preparation-fixture.txt` using exact public parent, controlled metadata/date, immutable candidate CAS and real scan. Initial baseline requires supplied base to equal observed actual main; correction needs prior retained separate kernel proof/absence. Safe intent/candidate/scan/started/worker/absence/result/proof artifacts persist; operation retry observes rather than repeats started effect. Observe emits a safe observation artifact. Output logs safe artifact filenames only.

This bridge is explicitly `oauth_injected_remote_kernel` and supplies no fabricated formal workspace/App/PublicationPushRequest provenance. It uses actual fixed credential plumbing and controlled push primitives. Main's native provider helper consumes these real artifacts with narrow provider intents. Worker has run **no live GitHub effects**; root must review final inputs then perform any explicitly authorized trial. An OAuth-injected trial cannot establish live production App JWT/installation issuance. Existing native App configuration count0 and OAuth availability are not an App grant. Fully installed App issuance remains the visible external prerequisite.

## Remaining integration boundaries

Root owns independent review, final integrated Linux CGO/native service UID/process restart/permission evidence and authorized actual GitHub lower-kernel effects. Production original-open/pin/cache authority uses the existing retained journal path; local synthetic fixtures prove the lower deterministic factory/remote lane, not an installed production original-open or live App issuance chain. No optional testing expansion or repeated provider effect is proposed. Original immutable evidence remains retained.

## Owned source hashes


| Owned file | SHA256 |
| --- | --- |
| `runner/internal/control/client.go` | `c1467d13f2014bda18ae02dcce7c37489513bb28d728a828be6eb488f04646f6` |
| `runner/internal/control/publication_remote.go` | `47abbb6bb9a2f081ae4c5f9e8dec67679c7ae589771ac966ecc1b198b7ecb95e` |
| `runner/internal/control/publication_remote_test.go` | `f6c22baefdf4f6f98bd9a7e83adc040991eda8b1efa00814b11e788bbb881059` |
| `runner/internal/daemon/daemon.go` | `af12419def1b99940bd4db002d03ebbe4ff4d71ffaab8218cc49cdc2906a6bfc` |
| `runner/internal/daemon/daemon_test.go` | `cb151e6f4a66aca32382e2a270d7d31c18b4b9c3f82ab7753fd619689a34a673` |
| `runner/internal/daemon/publication.go` | `8a03bfa178bfa3d1ddaa165769ecc5233d0ce1aad30bc6854289027dd9ef9fd2` |
| `runner/internal/daemon/publication_remote.go` | `454f79347af48bd8b5503ab030528449843a34434fbc875752af278d49a02395` |
| `runner/internal/daemon/publication_test.go` | `de1e84ea55de24d9f6eb58cc60c03f0dc510660c7539ff9f099262ce3394be71` |
| `runner/internal/daemon/recovery.go` | `72b21a10061cd7d0208987cc3fab43985c0c4d53b4f38d28a72c2bbbab3647cf` |
| `runner/internal/host/publication_candidate.go` | `833d35da5af20a1cc0c794db71f08fafd932ead65b96c7cf6dc47bee6a7ea649` |
| `runner/internal/host/publication_candidate_test.go` | `a2e8a64633d759fd4b9481d286a88b4a184510b585f35c01b813ed3145a310c1` |
| `runner/internal/host/publication_credentials.go` | `0fc992c9b0a53f4340d01a0af3221f62398a02f92c5490443a71b5f41bd67468` |
| `runner/internal/host/publication_credentials_test.go` | `81dd390f7d0687bded4b5711c4ac8abe4d002021477cd249cb8d1ef553d18d7e` |
| `runner/internal/host/publication_mapping.go` | `6a4b30c807f2d4941a31e50444c10d6d77ca1001b81808914bfa7c644b57e6ec` |
| `runner/internal/host/publication_pages.go` | `e5ecc73be023497b3d3e4ed35130a9f9f021ff371bc7b2f557c175a511da7967` |
| `runner/internal/host/publication_permission.go` | `51a0d1fb2afcbc9c0846242a6decd0efe114cb2df66fc6d02ff2fae29b21d808` |
| `runner/internal/host/publication_published.go` | `da02e3ac84f654b4153b2fe3d05048f49cc752235b80e1e5ea4018723e1aedd2` |
| `runner/internal/host/publication_remote.go` | `820336c272dceb7a605fa60b5e117e684d3188b77b9a95bf808b3473211a1cf1` |
| `runner/internal/host/publication_remote_crash_test.go` | `3ccb537d3c0c5011722e0074585dbaff00fcf8981a76863181771dd393420b57` |
| `runner/internal/host/publication_remote_journal.go` | `24276d50ab186e5661405efd8dac69cb148b305a641bcf4e9ec54dde64412545` |
| `runner/internal/host/publication_remote_native_test.go` | `967f0fb50301108b8104a5996ae3b37d5b80bf89917a76c5c1ae257192fa4276` |
| `runner/internal/host/publication_remote_primitives.go` | `3037cd722ab5b9b1a04dcf20ab929a009313506d69182c2c327d603301fd9623` |
| `runner/internal/host/publication_remote_primitives_test.go` | `492b5f233d6d72adc07cafb27ded9f67846b451b1e1834c2b333ddb92da225b2` |
| `runner/internal/host/publication_remote_process.go` | `df50e0a227527bd3e91103b51a00935e400898028c7a93137fb5d1793f759a74` |
| `runner/internal/host/publication_remote_process_test.go` | `6cd0741556588eed84f969b421160f4537b066e99ef6952abdd2b080b18baef9` |
| `runner/internal/host/publication_remote_test.go` | `d165c6bdeeb85497de372d4b74b379fa43470e886231d55a65de94af61d25718` |
| `runner/internal/host/publication_scan.go` | `804557817a925f35d201f8ed296863da1a9f5118e413e32d32e5430c7e40995d` |
| `runner/internal/host/publication_scan_test.go` | `a3cdae102bd731568b93b181fa7e01d3f55d38c9e52db8ad0bd40417b0ee9cb3` |
| `runner/internal/host/publication_store.go` | `8de30bc185976b9de33aa75dd359eb0535de914dce79dbb1d283d37787c6ce29` |
