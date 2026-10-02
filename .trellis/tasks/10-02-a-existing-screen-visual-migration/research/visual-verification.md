# Existing-screen visual inspection

## Reference and build

Reference is the Multica application workspace, recorded HEAD
`44ea3b40c8b4f54f4c76d1dd3e3c92e0c0cabd19`; inspected source/image paths are
recorded in the predecessor's frontend research and the local visual-design spec.
The neutral surface hierarchy, compact navigation,48px chrome,16px gutters and
restrained control/list treatment guide comparison. No team/organization semantics
or reference runtime dependency was imported.

Current build: JS `index-DVkmoQ-z.js`, CSS `index-CIqFVtS4.css`, from predecessor
`333c9e3` plus this leaf's product changes. Tests serve that actual built SPA from
the isolated Fastify/PostgreSQL browser fixture. No Vite dev server or deployed
native Task is involved. Final source/asset hashes and retained images are in
[screenshots/manifest.json](screenshots/manifest.json). Every helper capture checks page-wide overflow at both
1440×1000 and390×844; full-page variants preserve width and show vertical content.

## Reproducible state matrix

| Prefix | Route / data state |
| --- | --- |
| login-empty/error/busy | Unauthenticated `#projects`; empty, real invalid credentials, delayed real login |
| projects-empty/populated | `#projects`; fresh empty configuration, real saved Project/repository/Role selection |
| roles-empty/populated/long-draft | `#roles`; fresh empty list, saved Role, long retained instructions |
| settings-version-conflict | `#projects`; second tab original draft after another tab's real save |
| settings-save-uncertain | `#roles`; real saved command whose response is aborted, locked fields and recovery |
| execution-empty/policy | `#execution`; no Runner, saved manual policy and Planner guidance |
| github-empty/access-error/configured | `#github`; no App, saved test App + injected unavailable/access result; key field blank after save |
| discussion-queued/unavailable/uncertain | `#todos?todo_id=<fixture>`; real saved queue, explicit reason projection, real write with lost response |
| discussion-read-error/populated | Same selected Todo; failed read then retained attributed reply/proposal projection |
| todos-no-selection/empty-scope | `#todos`; no selected Todo, then true empty Archived scope |
| todos-archived-loading | `#todos?scope=archived`; actual intermediate list loading |
| todos-selected-empty-discussion | `#todos`; captured/opened original text with no Planner invocation |
| todo-long-content | `#todos`; long Original Capture/title and unsent scoped draft; mobile back/return |
| preview-project-required/exact-eligible/created | `#todos?todo_id=<source>`; exact real proposal, Project choice, confirmed one-Task association |
| preview-task-overview | `#task?task_id=<created>&section=overview`; same created Task and exact Specification |
| preview-long-content | `#todos?todo_id=<source>`; full long proposal, missing Project reason, unsent draft |
| integrated-todo-created/local-review | Source Todo→same fixture Task's `section=overview`; actual canonical REVIEW records with synthetic execution acknowledgements |
| execution-runner-observed/read-error | `#execution`; one explicitly filtered synthetic Runner observation, then injected read error |

The normal exact preview→Task path and the source Todo→same native-shaped REVIEW
record path use separate isolated fixture Tasks. Together they establish visual
coherence and real browser/HTTP navigation, not a claim that a real coding Runtime
executed this UI trial. The next integration leaf owns one actual native chain.
Task/Board regression screenshots from the full suite provide comparison to the
accepted predecessor; scope and inspected subset will be listed in the manifest.

## Completed inspection

Root inspected all41 retained full-page desktop/mobile pairs, including33 scoped
migration states, one honestly labelled Archived loading state and seven downstream
Board/Task comparisons. Corresponding fixed-viewport companions are retained:
164 PNGs total. Independent reviewer sampled states and verified every retained
asset/source/image hash and dimension.

Login default/error/busy and all Settings empty/saved/long/error/uncertain/conflict
states preserve readable labels and explicit save/recovery. Todo no-selection,
true empty Archived scope, selected empty Discussion and long Original Capture
retain hierarchy and mobile back/composer reachability. Long exact proposal text,
Project-required explanation and Create/Cancel/Continue actions remain in normal
vertical flow. Captures assert no document-wide horizontal overflow.

Downstream comparisons cover populated/empty Board, Task Conversation exact
requirements and uncertain send, Overview local REVIEW, Timeline and blocked
Execution Details. Shared CSS preserves the accepted Task hierarchy and recovery.

The initial empty-scope capture occurred during its read; it is retained as
`todos-archived-loading`. Final empty-scope capture waits for `No archived Todos.`
and passed its focused test. Some read projections settle between desktop and
mobile captures (for example, uncertain Discussion message list or ready Task
result emptiness); these images do not claim an identical instant of data.

## Intentional monos differences

Login uses one focused400px form with24px internal padding,16px mobile outer gutter
and no authenticated shell. Settings maintain a compact record list plus form;
mobile record choices scroll inside their own list. Long instruction textareas
retain their existing row counts instead of compressing editable text. Todo has
one list/selected surface inside global navigation, with an explicit mobile back
button; normal page scrolling keeps long content accessible. Task content retains
its accepted1100px readable maximum. Success/error/warning color denotes actual
status only; the working surfaces are neutral. No motion dependency was added.

## Final provenance and limits

All50 distinct browser cases have passing results: full run41pass/3test failures/
6not run, corrected focused9/9, then final empty-state1/1. Product/build stayed
unchanged. See [verification](../verification.md) for corrections and check results.
Final browser schema count is zero; no permanent service was added or restarted.

The manifest includes2 asset and55 source/dependency hashes, dimensions, test names,
run origin and routes. Exact persisted route JSON is available for final focused
captures. Earlier full-run helper attachment bodies were ephemeral: their entries
explicitly record route patterns from test source/state instead of invented UUIDs.

The reference comparison applies neutral surface/typography/navigation/control
hierarchy, not pixel identity. Multica remains an external design reference, with
no dependency or organizational model copied. Native execution, private GitHub App
access, PR creation and delivery remain outside this visual acceptance.
