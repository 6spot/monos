# Design: documentation ownership and task alignment

## Ownership

`docs/07-owner-review-and-ui.md` owns the product visual direction and monos information architecture. `docs/11-technology-and-deployment.md` owns the selected stack and clarifies native form semantics versus shared presentation. `.trellis/spec/frontend/visual-design.md` will own concrete engineering conventions; frontend index, component, directory and quality guidance reference it instead of duplicating token tables.

## Visual contract

Translate the inspected Multica application source into monos conventions: neutral shell/canvas/surface/overlay tiers, semantic status colors, compact 48px header/toolbar with shared 16px horizontal gutter, caption 12/16, label 13/18 and body 14/20 typography, restrained borders and shadows. Use a roughly 256px desktop navigation baseline and accessible compact navigation on small screens; resizable navigation is not required. Preserve readable content widths and touch targets; compact density must not cause clipping or inaccessible controls.

Specify Todo list/Discussion workspace, Execution Board, Task Conversation/Overview/Timeline/diagnostics, and Settings composition using monos domain definitions. Component rules prefer owned shadcn primitives on demand, retain native semantic elements where appropriate, and prohibit ad hoc page palettes/global primitive sizing overrides. Document examples of correct composition and current legacy divergence without claiming migration is complete.

## Task propagation

Apply the audit map to execution UI, task-execution parent/acceptance, review-delivery, Stage A acceptance, installation/settings and release acceptance. Preserve all existing functional acceptance and task statuses. Add frontend spec entries to execution UI manifests; these additions do not make its remaining design/planning complete. Higher-level packages refer to the shared contract and require future frontend leaves to load it.

Record a migration handoff in this task and link from the owning acceptance/parent records. The future migration deliverable owns existing shell/Login/Settings/Todo/Discussion/preview/minimal Task presentation; execution UI owns new Board and Task control surfaces. Integrated visual acceptance requires both. Creating, planning and implementing the migration task happens separately.

## Validation and compatibility

Document-only checks cover relative links, JSONL resolution, whitespace and manual consistency review. No browser run is required for these documentation edits; future UI work must provide inspected desktop/mobile screenshots tied to actual builds, alongside functional/accessibility evidence. Retain archived task history and all existing business invariants. No API, persistence or runtime migration occurs.

## Risks and rollback

The working tree already contains unrelated changes. Edit only scoped document sections and never reset whole files to an older revision. Preserve concurrent task edits when applying updates. The main risk is conflating a new target with implemented behavior; mark existing-screen migration as outstanding until real evidence exists. Rollback consists only of removing this task's document additions while preserving unrelated edits.
