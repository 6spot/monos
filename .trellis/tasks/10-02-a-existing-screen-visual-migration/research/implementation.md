# Existing-screen presentation implementation

## Change boundary

The accepted Task/Board shell was neutral and compact, while Login, Settings and
Todo interiors retained oversized headings, green field skins and nested cards.
This change belongs entirely to Web presentation. It preserves existing hooks,
API/schema, immutable command/version basis, pending recovery, mounted views,
per-record/Todo drafts, secret clearing, preview authority and formal lifecycle.

## Product files

- `styles.css`: one semantic token authority; consolidate duplicate shell/reset
  declarations, remove legacy green values and primitive overrides, retain accepted
  256px navigation and 48px chrome with 16px gutters. Settings use flat record
  selection and form interiors. Repositories/policies/previews stay bounded groups.
  Todo list/selection/Discussion share one workspace with separators. Mobile retains
  navigation sheet, list/detail back behavior, contained settings list scrolling,
  44px checkbox label targets and `[hidden]` precedence.
- `components/forms.tsx`: preserve Field/Select/PageHeading/EditorActions public
  behavior and stable IDs; delegate fields to existing owned primitives and heading
  to PageHeader. Add optional associated Field error and reusable CheckField.
- `components/ui/checkbox.tsx`: owned Base UI Checkbox with `nativeButton` and
  native `<button type="button">` renderer, controlled boolean state, indicator and
  shared token variants. Native button preserves fieldset-disabled behavior for
  the visible control; CheckField also forwards the screen's explicit disabled
  state. Label uses `htmlFor`/useId; Base UI owns keyboard and hidden input behavior.
- `app/app.tsx`: focused neutral Login, same submit/busy/password-clear behavior,
  password error association and labels; wrapper classes only in authenticated
  composition. All existing Settings/Todo sections remain mounted under `hidden`.
- `features/projects.tsx`, `roles.tsx`, `execution.tsx`, `github.tsx`: flat form
  composition, concise empty headings, native role/Project list buttons with
  `aria-pressed`, shared Checkbox fields and semantic help/status. Callbacks retain
  exact existing values, optional fields, draft basis and save/reload behavior.
  `policy-editor.tsx` needs no behavior/source changes: its existing Field/Select
  compositions receive the new owned controls and shared policy styles.
- `features/todos.tsx`, `discussion.tsx`: owned capture/composer Label/Textarea,
  with original refs/IDs/handlers intact; flatten wrappers without moving the
  always-mounted Discussion controller. Original Capture stays separate from chat.
- `features/task-preview.tsx`: created PLANNING state uses neutral status treatment;
  full proposal text and existing exact Project/confirm/create/recovery flow remain.

Native record/repository row buttons remain domain list compositions instead of
generic Buttons: their full-row names, selection and metadata need flat list layout.
They share hover/selection/focus tokens and preserve keyboard activation.

## Mechanical verification

- Root + Web TypeScript: PASS after first implementation.
- Affected product ESLint: PASS.
- `git diff --check`: PASS.
- Source search: scoped features have no raw input/textarea/select/checkbox skins,
  green palette or uppercase working-page eyebrows left. Surface white values remain
  only in the central semantic token definitions.

Root owns actual-build regression, checkbox Space/disabled checks, Login error/busy
screens, image capture/review and final gates. Those are pending at this checkpoint;
source checks do not establish visual acceptance. No service, deployment or commit
was started by this worker.
