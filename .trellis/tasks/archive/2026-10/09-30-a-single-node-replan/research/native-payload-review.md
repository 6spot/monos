# Native Replan payload rejection review

Read-only diagnosis of the frozen native candidate. No product, database, Runner,
process, private workspace or scratch payload was changed by this reviewer.

## Evidence and confirmed cause

Inspected `/tmp/monos-replan-native-rejection-context/`:
`native-replan-source-rejection-context.json`, five recovered rejected envelopes,
structured tool attempts, and `probe2.json` through `probe4.json`.
Request `4b0d7d8c-6cda-4806-96db-5c77214e4381` used source
`336c5815-ae52-400f-9380-83fb5c5ead00` and Planner Attempt
`28553f66-b914-48ff-a03c-411f70761031`.

`probe2.json` made the supported changes from `refresh` to `replace` and from
same-Node target to a new target. Its additional, invalid difference was:

- Canonical `impact.workspaces[0].task_id`:
  `dd67088b-1886-4d2c-b402-62c242f9f07b`.
- Submitted value: `ddd67088b-1886-4d2c-b402-62c242f9f07b` (an extra `d`).

`probe3.json` omitted the mandatory historical workspace entirely; `probe4.json`
also changed the originating Node identity. Recovered rejected envelopes had
these same defects. Tool results included `version_conflict` with
“Exact Node, independent holds or workspace facts changed”, and invalid graph/
impact target combinations returned `invalid_input`.

`checkReplanImpact` intentionally recomputes expected impact using the submitted
new target and excludes the chosen disposition/target activation from the factual
comparison. Thus supported replacement itself is accepted. Original Node/source,
completion and all prior workspace facts must remain exact; changing them was
correctly rejected. The evidence does not establish a product contract defect.
Placeholder probe graphs must not be approved as the intended replacement Plan.

## Formal recovery

The verified existing path is:

1. Save the complete configuration of this dedicated test Project through
   `save_project`, changing only its context to clarify exact field copying and
   the real semantic goal; preserve resources, Role selection and other settings.
2. Read the current pending Replan request version and submit `retry_replan` with
   only its request ID and exact expected version. No issue exists, so `answer`
   and `issue_id` must be absent.
3. Retry atomically revokes the old generation, fences its Attempt and admits Stop.
   The same request remains pending. A new source retains the immutable predecessor
   link and reads the latest Project context only after actual old process/effect/
   lease release. No Task input or input deferral is required for this configuration
   clarification.

If the live Planner commits an outcome between configuration save and Retry, its
request version changes; read and assess that state before another exact command.
Do not silently substitute a CAS version or edit the running scratch/process.

Root reports the formal configuration save and Retry succeeded without a version
race, retained the same request, and passed retry replay and ready observers.
Observation continues on the exact successor source. This records recovery, not
successful proposal publication or completion; those remain separate native gates.

The frozen product source remains unchanged. No additional source tests were run
for this input typo diagnosis.
