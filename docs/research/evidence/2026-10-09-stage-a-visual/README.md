# Installed terminal delivery views

Captured and inspected on 2026-10-09. These are read-only observations of the
existing completed Task A and cancelled Task B; no acceptance, cancellation,
message, model call or remote Git action was submitted.

## Build and state binding

[build.json](build.json) verifies the still-running installed server against its
installation receipt: source `acff7663209949929c11d7543eb6453e19cee6ea`, image
`sha256:17b4a92c74067892685fe2b126578a0132335d1610bf7c1f87ad66409e84b92c`.
The JavaScript/CSS fetched by the browser have the same SHA-256 values as files
inside that container. `git diff acff766 HEAD -- apps/web packages/protocol` was
empty at local commit `afd33bc`; the subsequent free-model work is Runner-only.

Both [header capture](capture.json) and
[settled delivery capture](settled-delivery-v2/capture.json) bind image digests,
route, actual Task response, viewport and rendered text. Task A remains
`COMPLETED`, control 14; Task B remains `CANCELLED`, control 6. Each has zero held
Attempts, queued Attempts and open operations in the captured Owner read.
Every successful capture session logged out; temporary forwarding was closed.

[inspection.json](inspection.json) records the local reinspection of the eight
selected images and binds the original capture manifests by SHA-256. Their
`captured_pending_visual_inspection` outcomes describe the capture phase and are
preserved; the separate inspection record supplies the subsequent review result.

## Inspected images

| State | Desktop 1440×1000 | Mobile 390×844 |
| --- | --- | --- |
| Completed Task header/Specification | [desktop](completed-desktop.png) | [mobile](completed-mobile.png) |
| Cancelled Task header/Specification | [desktop](cancelled-desktop.png) | [mobile](cancelled-mobile.png) |
| Completed accepted batch | [desktop](settled-delivery-v2/completed-desktop.png) | [mobile](settled-delivery-v2/completed-mobile.png) |
| Cancelled retained publication | [desktop](settled-delivery-v2/cancelled-desktop.png) | [mobile](settled-delivery-v2/cancelled-mobile.png) |

The inspected surfaces preserve the shared sidebar/mobile header, Task tabs,
gutters and section/card hierarchy established by the accepted
[visual migration](../../../../.trellis/tasks/archive/2026-10/10-02-a-existing-screen-visual-migration/verification.md).
The comparison uses the recorded Multica reference at
`44ea3b40c8b4f54f4c76d1dd3e3c92e0c0cabd19` through the repository's
[visual contract](../../../../.trellis/spec/frontend/visual-design.md).
monos retains its own navigation and formal delivery wording; long Task titles
and Specification content grow vertically, and exact result hashes wrap on
mobile. These are intentional differences from the reference workspace chrome.
Long titles, hashes and repository paths wrap without horizontal overflow.
Task A clearly shows one finalized item, the accepted head and verified final
commit, with further work directed to an independent Task. Task B keeps
acceptance disabled and shows recorded cancellation cleanup, retained branch
and closed PR. Historical remote observations remain labelled as historical.
No page errors or business-method mutations occurred during the captures.

The first delivery-section capture in [delivery/](delivery/capture.json) caught
an asynchronous layout shift in cancelled desktop and is not the accepted
section image. A later attempt in [settled-delivery/](settled-delivery/capture.json)
failed before login because its temporary forwarding had expired; it produced
no screenshots. The final capture explicitly awaited the rendered terminal
delivery fact before scrolling, and retained separate files. An earlier local
missing-parent-directory error occurred before browser startup or login.

These images close retention/provenance for the current terminal views. Earlier
accepted migration/execution/review images retain their own revisions and state
coverage. This does not recreate historical transient waiting/recovery views,
prove the open live-Node browser scenario, or declare complete Stage A acceptance.
The local reinspection checks saved pixels and metadata; it does not repeat
browser navigation, keyboard/focus, accessibility or live server checks.
