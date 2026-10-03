# Main visual integration inspection

Final candidate set: `screenshots/612e2e1d2fb0-709c322e2807-20261003082748662/`.
The source/build-bound manifest records source SHA256
`612e2e1d2fb0da9662e884ad57110884ff46df8e52a998da8b5c3305504e1441`
and bundle aggregate
`709c322e2807a6c183d948c430057636f72d95b49d72a8e19396ad1106a4bb4c`.
Main independently checked all manifest source/artifact/asset hashes against the
current files; no mismatch. The original work checkpoint does not contain this
dirty candidate. Committing these unchanged source inputs preserves the evidence.

Main opened these actual PNGs with view_image after the applicability and protocol
fixes, rather than inferring visual acceptance from code or test assertions:

- result-populated-literal-desktop.png
- result-populated-literal-mobile.png
- result-historical-mobile.png
- result-long-path-mobile.png
- result-populated-literal-desktop-full.png
- result-offline-mobile.png
- result-unavailable-desktop.png
- result-deleted-side-mobile.png

Desktop 1440×1000 uses the established neutral monos shell and two-column file
selection/content layout. Full-page capture confirms the existing Task Overview
navigation, exact completion metadata, Specification/Node context and separate
formal Artifacts remain reachable. Seventy changes are explicitly accounted for.
Script-looking content and whitespace appear as literal code; horizontal overflow
stays inside the code viewport. Long paths wrap within the selection pane.

Mobile 390×844 stacks file selection/content, keeps the Task header and 44px
controls usable, wraps hashes/long paths and contains code overflow. The historical
capture retains the same selected literal file and displays Historical; its page
shows 64 of 70 because the second-page read caused the fresh applicability update.
Offline and unavailable states retain recorded result metadata and provide Retry;
deletion on result side explicitly displays absence. No new visual blocker was
observed in these eight inspected captures.

The frontend owner separately records its broader state-by-state inspections in
frontend-verification.md and the manifest. Main does not claim to have opened all
44 PNGs. Earlier folders are intermediate/failed evidence, not final acceptance.
The built-SPA fixture uses authenticated synthetic result-read replies and isolated
PG; these captures do not prove actual installed Linux Git/storage execution.
