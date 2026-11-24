# Prompt and conversation provenance

The numbered prompts in `prompts/` define the increments and their acceptance criteria; the shared master context defines architecture and collaboration rules. Existing prompts are retained verbatim. Implementation decisions are recorded per increment under `docs/decisions/`.

Recorded conversations are under `docs/chat-logs/`. Codex exports use actual user and visible assistant messages from the recorded session, with the source path, snapshot checksum, scope and cutoff stated in each export. Private reasoning, system/developer messages and runtime metadata are excluded. Credential values are redacted before committing. A prose summary is not substituted for a conversation export.

For Increment 17, the user asked to check current issues and implement another useful task, then commit and push for teammate review. Issue #14 is assigned to Sishir. Evaluation remains owned by the Increment 16 contributor; its generated report is imported after review instead of inventing results.
