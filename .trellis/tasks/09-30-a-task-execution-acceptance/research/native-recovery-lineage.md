# Native recovery lineage

This worker inspected existing nonsecret requests/receipts, private snapshots,
and read-only Git objects. No Owner command, model call, lifecycle admission,
fixture, service action or result edit was performed by this worker. Full raw
browser reads and provider streams remain private in
`/tmp/monos-execution-native-v1/`.

## Preserved failure

Task `7d51dfb7-3ce9-4258-bb76-b91248a60c8b`, Specification
`4bf3e831-4659-40ca-b120-fdd5c04cd8e8`, Plan
`74368623-02ba-413c-8aaa-008033553901`, Node
`179a7f54-56a9-47f5-97d7-cb59b38c7b85`, activation 1 remain unchanged.
Initial Node Attempt `374ee8e5-29f4-4e7d-b5fe-8623308521dc`, dispatch
`3dfe6c74-2b9e-4b8f-9df0-5a5cd089657b`, source
`0be7021f-a53c-4a5c-92c4-421bdf00227f` retains configuration 41 and context
digest `2f315ab0926b5ac98d8d15067a4cc8ecaaabf33dcc6a6c128952d5b704e3753a`.
All 53 ordered logs are retained: JSON-as-input-filename misuse caused local CLI
errors before any successful workspace command; order 50 records actual provider
HTTP 429 FreeUsageLimitError, followed by exit 1 and verified process absence.
The exact factual blocker is `c1af4901-72a4-41ee-b40e-4a025884e7b2`, reason
`missing_formal_outcome`, at Task control version 4. This Attempt is released,
mutation authority false, with no admitted completion. See
[initial diagnosis](node-missing-outcome-diagnosis.md) for raw stream identities.

## Owner clarification and free model observation

Actual Owner `save_role` request
`execution-native-20261003-v1-role-cli-clarification` targeted Role
`execution-native-20261003-v1-role`, configuration version 41, and committed
HTTP 200 at `2026-10-03T02:33:29.987Z` as version 42. The instructions explain
`--input` requires a JSON FILE or stdin `-`, constrain work to the authorized
resource, and require formal `complete_node` or `block_node`. They supply no
duration implementation. The new context Role instructions equal the command
payload exactly. Policy remains `opencode` / `opencode/longcat-2.5-preview-free`
/ `runner-a`, with no fallback targets.

The fresh catalog from execution user `me`, cwd `/home/me`, records active
LongCat 2.5 Preview Free, native tool calling and numeric zero input/output/cache
prices. Its raw hash matches metadata. The initial invocation from `/root`
failed config access; its zero-byte output remains separately retained, and the
retry used the actual execution home without changing runtime/configuration.
Catalog availability and price do not prove a provider quota reset time.

## Exact Retry binding

Actual browser POST `/v1/owner/commands` at `2026-10-03T02:33:49.597Z` used
the observed session header and request `009b1bb2-79aa-44fc-80b7-ddab713fdcf9`:
`retry_node`, scope the same Task, expected control version 4, payload the exact
Node/activation 1, prior source `0be7021f-a53c-4a5c-92c4-421bdf00227f` and blocker
`c1af4901-72a4-41ee-b40e-4a025884e7b2`. HTTP 200 at
`2026-10-03T02:33:49.677Z` committed version 5, new source
`05b5049a-41ea-46b9-bdcc-5a8a03078e23`. The canonical Owner envelope equals the
captured request body; recomputed receipt SHA256 is
`f3a280a64aa8451caf385e8ce3512c9f242e0f72fe23c5dcd618959027dcd564`.
Captured response equals the canonical receipt. Its `attempt_id` refers to the
previous failed Attempt, not the newly launched execution.

The new source binds the previous source/blocker/reason, Owner request,
configuration 42, control version 5 and planned Attempt
`399596a8-3c15-4591-b140-31f5aa98e9d7`. Context SHA256 is
`8074357b581336d83f3405e008ef604ec03962545de52ef528a863a773472c81`;
canonical compact UTF-8 JSON equals source prompt and actual launch prompt.
Node requirements and effective Specification equal the previous context.
Dispatch `4ec265cf-0727-4f09-86d5-ab8a47dfe9bc` resolves the current Role at
configuration 42, OpenCode 1.18.30 and the same free model; selection request
digest is `807a516bbdfc84e45f61c86b42bef5f021ed53283f593436fb1afdb4935f4021`.
The launch snapshot observes RUNNING with mutation authority and unreleased
process, establishing launch lineage without inferring completion from launch.

## First finalized result and bounded defect

Retained `final.json` observes REVIEW, 12 final checks true and all 19 ownership
counts zero. Completion operation `629a3749-6968-42ff-b2a1-a29e66f57743` belongs
to the new Attempt. Commit `62b31283d1fbd01a01073359a2fac1f55467ef72`, tree
`0350806386edfa8d0ecf7bf37391a83d8b96af87`, parent
`9ac3353e97ed6a0cb96a80bb8e136d44cac982e4` match the actual private exported
ref/tree. Independent read-only Git checks confirm exact HEAD/tree, clean
worktree, byte-identical original probe files and intact README prefix. Only
README.md changed; duration.py and test_duration.py were added. The utility
validates nonboolean integers, rejects negatives and formats unbounded hours
with divmod/minimum-width fields. Tests cover boundaries and invalid inputs
using only unittest and duration.

Native order 21/stdout 20 actually ran
`python3 -m unittest test_duration -v 2>&1`, exit 0, 9 tests OK. README line 32
and completion summary instead claim `python -m unittest test_duration -v`.
Root independently reproduced exit 127 for the literal README spelling in the
same Linux account because `python` is absent, while functional Python 3 tests
pass. This is a bounded documentation/claim defect against the requested exact
test command. The original completion and Git evidence remain retained;
requested-output acceptance awaits ordinary semantic correction and an updated
independent result check. This worker made no alias, installation or result edit.
Delivery and Owner final acceptance remain outside this report.

## Scoped checks and private inventory

Recomputed Retry canonical envelope/digest and response equality; context digest
and exact source/launch prompt equality; Role instructions equality, configuration
42, unchanged Spec/Node and empty fallback; successful catalog raw hash; and
independent Git base/result object preservation. Raw snapshots stay private;
this inventory does not assert visual acceptance or replace root's live tests.

Private paths below are relative to `/tmp/monos-execution-native-v1/`.

| Private file | Bytes | SHA256 |
| --- | ---: | --- |
| `task-attention-1.json` | 2258338 | `0c0240f2f1f7a21c500d5cd6c5ca65d64399c58db5aba382e0e5caf2a9a032e7` |
| `node-missing-outcome-diagnosis-v1/summary.json` | 2908 | `dbd0025f1a22fbb892f938ddc6d4bd5017f08139559d2ef4f8def7a3ef25b1d4` |
| `intent-execution-native-20261003-v1-role-cli-clarification.json` | 1772 | `f50ad118611b4413fa1ca0dcc7b3199384a4b2ab64fc9d63bd12e7476fc85089` |
| `role-cli-clarification-command.json` | 1601 | `23362bbfff9cdbf2cdf5af34ff174e92b84ff0aa3f59d5cf0419bc934541e69f` |
| `request-execution-native-20261003-v1-role-cli-clarification-69207.json` | 1828 | `fdf79f96c5e3648a03787dc410e5f3fff0bd22f021641900a0a81411c8ffcd4a` |
| `response-execution-native-20261003-v1-role-cli-clarification-69208.json` | 324 | `492442e289588c0ba14979ba0b446ec613ea91d85a29d3ff55e64bcf8b86dbdf` |
| `catalog-retry-1-raw.txt` | 0 | `e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855` |
| `catalog-retry-1-home-raw.txt` | 11443 | `1f28723bc141b10277424381a02da869c50e2b16a0b682d380af402c571fa76b` |
| `catalog-retry-1.json` | 1722 | `0d2ea8af22918ed05b4115dc5d3fd8cf8a136b371ba4fa4ffc5e47e3b54b7c75` |
| `request-009b1bb2-79aa-44fc-80b7-ddab713fdcf9-69293.json` | 587 | `696a0d4ef56084dbdd0f11200c3e3279847e62c5b90277e607c594425c1f2543` |
| `response-009b1bb2-79aa-44fc-80b7-ddab713fdcf9-69294.json` | 410 | `7ad0c7b7f5fc86ce3612ba8bceaec39d0f47b8cb07d51a853216947ec594c1fd` |
| `task-retry-1-launched.json` | 2328720 | `813ef25ba8d6cf8fe90f778018d40f3f94347699cdc7acbd6f8865b838c74cc2` |
| `final.json` | 3055456 | `12e8af6988d7aa99fef97b2b162aa1e77f01152c8d215200c468ce362ff31145` |
| `initial-result-git-preservation-v1.json` | 2030 | `420b549bbe4ff551d0a526ea453111fa1252a08e1e37b329a7388b2ae98d6ab7` |
