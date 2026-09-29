# Cross-Language Protocol

Status: implemented boundary-probe schemas, generated TypeScript/Go types, OpenAPI and shared fixtures are in `packages/protocol`. Full-product commands remain architecture contracts until implemented.

## Pre-Development Checklist

Read [command contracts](commands.md), [schema generation](schema-generation.md), [Tool Protocol](../../../docs/05-tool-protocol.md) and [technology](../../../docs/11-technology-and-deployment.md). Changes to delivery/input also require [acceptance contracts](../backend/delivery-contracts.md).

## Quality Check

Canonical Node/Artifact commands and strict completion settlement pairs follow
[Node execution](../backend/node-execution.md). Generate the operation identity
and omitted/empty Artifact-selection fixtures for both TS and Go.

One versioned JSON Schema authority generates TS/Go transport types. Authenticate scopes server-side. Keep request replay, operation admission and result completion distinct. Run `pnpm protocol:check`, `pnpm test`, and the Runner's shared-fixture tests after a wire change. Add no new transport/validation framework without a concrete need.
