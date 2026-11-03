# Decisions — Increment 06

## Critical checkpoint (before implementation, 2026-11-03)

Rollback point: `ba7fefa4e6abd2d3d0be5f54fcbc4271822793c6` (last merged main).

Failure signs: inferred confirmation without note/human authority; DELETE /orders/{id} receiving a mapping; dropped differences; confidence outside [0, 1]; a human confirmation accepting nonexistent targets or overwriting an existing confirmation.

Isolation check: classify the demo without a note; all five breaking differences must remain unconfirmed. Hand labels are written before classifier execution.

## Implementation choices

- Keep all nine differences, including the safe addition paired with a rename candidate. Only the removal is categorized as the rename; pairing is not confirmation.
- Reject duplicate mapping selectors and unsafe/ambiguous YAML. Notes are bounded to 256 KiB; errors contain field paths and generic messages, not uploaded values.
- Human confirmation validates the submitted mapping against immutable stored specs as well as the change's evidence/pointer. Full specs are necessary because a removed field's evidence cannot contain its replacement and a removed endpoint cannot contain a different endpoint.
- Lock the change row during human confirmation; only one concurrent confirmation can succeed. Existing classified rows remain immutable on repeat classification; uploading a later note does not silently rewrite old classifications.
- No database migration: retain existing change evidence columns and expose core classification reasons directly from the pure classifier. API outcomes use the established text-label contract.
