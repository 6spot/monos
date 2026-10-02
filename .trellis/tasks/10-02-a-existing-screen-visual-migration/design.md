# Existing-screen migration design

## Behavior gap and owning modules

The accepted shell and Task workspace use neutral compact styles, while shared
legacy forms and existing interiors still impose large/green independent skins.
The gap lives in Web composition and CSS. Research:
[frontend-migration.md](research/frontend-migration.md).

## Shared presentation

Keep `styles.css` as the token authority. Consolidate superseded shell/reset rules
and replace remaining legacy colors/geometry with semantic variables. Preserve
current shell/mobile behavior, task-ui.css classes and `[hidden]` display semantics.
Reuse PageHeader with aligned16px gutters; settings interiors may use16–24px pads.
Keep normal rows flat, with visible selection. Policy/resources/exact proposals are
meaningful bounded groups; avoid repeated floating cards around every subsection.

Migrate `components/forms.tsx` internally to Input/Textarea/Label/NativeSelect while
preserving its public props, stable useId, callbacks and hints. Add an owned Base UI
Checkbox only where needed; ensure disabled fieldset behavior, controlled booleans,
labels and keyboard Space remain correct. No new dependency or form framework.
Login becomes a focused neutral form with the same password/busy/error lifecycle.

## Screen composition and state boundaries

Settings retain their list/editor structure, per-record drafts, version basis,
explicit save/reload and distinct Planner guidance form. All current app views stay
mounted through `hidden`; configuration/query refresh cannot reset drafts. Keep
secrets transient and clear the private-key field after successful save.

Todo retains its two-column desktop list/selection and mobile drill-in/back flow.
Flatten visual nesting into one selected workspace while preserving the always-
mounted Discussion controller, capture/composer/heading refs and stable row IDs.
Original Capture remains distinct from chat. No auto-selection/Planner invocation.
Use owned primitives for composers; long content wraps or scrolls in its own field.
Keep exact proposal content and all eligibility/recovery/creation exits readable.
No change to useDiscussion/useTaskPreviews/useCommand/useTaskCommands contracts.

## Ownership

One existing implement-role agent owns all product Web changes: shared CSS/forms,
Checkbox, Login/wrapper-only app edits, Projects/Roles/Execution/policy/GitHub and
Todo/Discussion/task-preview composition. It preserves accepted Board/Task behavior.
Root owns browser test additions, fixture-only changes only if needed for visual
flow, task artifacts/spec updates and image review. Existing check-role agent owns
independent review/mechanical fixes, coordinated with implementer before edits.
No worker starts services, commits, deploys or spawns further agents.

## Verification and compatibility

Use existing actual-build Fastify/PostgreSQL browser fixture on loopback18555 with
private environment wrapper and one unique schema. Capture representative states
using existing test interactions/explicit projections. Inspect desktop/mobile PNGs
and retain build hashes/route/fixture details. No real keys in images. Reuse accepted
Task fixtures for local REVIEW; do not claim CLI/provider execution from them.
Full browser regression is required because shared forms/styles affect all views.
Only new composition risks need new behavior assertions (checkbox fieldset/focus,
login error association, action reachability); do not test private CSS values.

Rollback is presentation-only source revert. No database migration or deployment
is needed. Further Task execution/native integration follows this accepted leaf.
