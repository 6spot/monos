# Exact Task preview and creation

## Goal

Let the Owner reread a committed Discussion proposal and explicitly create one
independent ready-to-start Task with its exact Specification and chosen Project.

## Background

Ordered Todo Discussion is complete (`d623444`). Its assistant messages already
carry optional structured title, Markdown specification and Project proposal
content, but the current card cannot confirm or create a Task. Existing Task
confirmation primitives require an already-existing Task and cannot own creation.

The Owner's standing authorization covers sequential planning, implementation,
verification, deployment and commits without further permission requests.

## Requirements

1. Reconstruct the preview from immutable structured content on a committed
   Discussion reply. Show exact title and Markdown specification; provide an
   active Project selector, Cancel, Continue discussing and Create Task. Do not
   introduce a Draft Task domain object or infer creation from natural language.
2. Project selection may choose any active Project and does not reassign the Todo.
   Capture/Discussion remain usable without a Project; creation requires one.
   A Project without selected Roles may hold a ready-to-start Task.
3. Explicit Owner confirmation binds the exact proposal, source input, title,
   specification, selected Project and Todo Project basis. The Owner command
   `create_execution_task` consumes that confirmation. Planner has no creation tool.
4. One proposal creates at most one Task across repeated requests, concurrency,
   different devices and reconnect. Different content or Project cannot reuse
   approval. A new independent Task requires a new committed proposal.
5. Later Discussion input, cancellation or changed Todo Project basis invalidates
   an unconsumed proposal/confirmation. Missing or archived Project rejects new
   creation. Existing committed receipts and created Task associations survive
   subsequent Todo changes. Cancelling a preview never cancels an existing Task.
6. Atomically create stable Task identity/association and immutable initial
   Specification in PLANNING, with no Plan, Node, Attempt, Start or execution-side
   Planner. Only the confirmed Specification and Project cross the semantic
   boundary; Todo session, messages and requirement cache are not Task context.
7. Reconnect restores the canonical preview or created Task card. Uncertain writes
   retain exact request identities; Todo switches preserve drafts and recovery.
   View Task opens a minimal read-only detail with title, Project, Ready to start
   state and confirmed Specification. Continue discussing preserves/focuses the
   existing draft without submitting a message.

## Acceptance criteria

- [x] One exact proposal yields one Task across same/new request IDs, two clients,
  concurrent confirmation/creation and reload.
- [x] Stale/cancelled/changed proposals and unavailable Project fail without
  partial Task, Specification or consumed authorization.
- [x] Creation is PLANNING with an immutable initial Specification, stable Project
  and source association, and no Plan/Node/Attempt/Start or Todo context inheritance.
- [x] Real backend/browser tests verify exact content, Project choice, cancellation,
  uncertain responses, reconstructed cards/links and read-only Task navigation.
- [x] Existing protocol, migration, Runtime/Discussion and browser regressions pass;
  authenticated live-host preview/creation evidence uses the existing installation.

## Scope

No Start, initial execution planning, execution board, Task conversation, delivery
or repository materialization. Those remain with Task execution and later leaves.
