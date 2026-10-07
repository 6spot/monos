# Cross-Language Protocol

Status: implemented boundary-probe schemas, generated TypeScript/Go types, OpenAPI and shared fixtures are in `packages/protocol`. Full-product commands remain architecture contracts until implemented.

## Pre-Development Checklist

Read [command contracts](commands.md), [schema generation](schema-generation.md), [Tool Protocol](../../../docs/05-tool-protocol.md) and [technology](../../../docs/11-technology-and-deployment.md). Changes to delivery/input also require [acceptance contracts](../backend/delivery-contracts.md).

## Quality Check

Canonical Node/Artifact commands and strict completion settlement pairs follow
[Node execution](../backend/node-execution.md). Generate the operation identity
and omitted/empty Artifact-selection fixtures for both TS and Go.

One versioned JSON Schema authority generates TS/Go transport types. Authenticate scopes server-side. Keep request replay, operation admission and result completion distinct. Run `pnpm protocol:check`, `pnpm test`, and the Runner's shared-fixture tests after a wire change. Add no new transport/validation framework without a concrete need.

Canonical Task conversation adds its own source epoch and exact input watermark;
execution action basis remains separate. Read [Task Conversation](../backend/task-conversation.md)
before changing source scopes, reply routing or handled-guidance manifest fields.

Exact prepare/apply payloads, Owner confirmation and settled requirement publication
follow [Specification revisions](../backend/task-specification.md). Preparation and
application are nonterminal; preserve the separate canonical reply contract.

Dedicated [Replan](../backend/task-replan.md) uses terminal prepare/issue and a
mutually exclusive source. Its transport watermark is0 while immutable context
retains the actual input cutoff. Workspace transfer is a system-authored descriptor;
Agent payloads cannot supply it. Compile all Go consumers after final generation.

Dedicated [review correction](../backend/review-correction.md) adds exact Owner
receipts, two exclusive review-source purposes and source-bound terminal tools.
Review result basis and operation capability are distinct; unknown receipts
carry no committed identities.
