# monos Thinking Guides

These are short review prompts, not another source of domain contracts. Start from the [spec index](../index.md) and owning architecture module.

| Guide | Use when |
| --- | --- |
| [Verification scope](verification-scope.md) | Smallest sufficient checks, evidence reuse, final integration and stopping |
| [Cross-layer changes](cross-layer-thinking-guide.md) | Commands, schema, persistence, Runner effects, delivery or UI |
| [Reuse and dependencies](code-reuse-thinking-guide.md) | New packages, components, adapters, shared code or configuration |

Before a nontrivial edit, identify the behavior gap, owning module, affected files and verification. Search existing definitions before changing shared concepts. Put executable contracts in layer specs rather than repeating them in this directory.
