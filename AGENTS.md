# Repository workflow

Read `CLAUDE.md`, `prompts/00_master_context.md`, and `docs/PROGRESS.md` before work.

## Bibek's required increment sequence

1. Check current repository state, open PRs, reviews, CI, and recent merges.
2. Identify and explain the recommended next increment, including dependencies.
3. Wait for Bibek's explicit decision before implementing that increment. A status or “what next?” question is not authorization to start it.
4. Once authorized, implement the increment and complete its required validation. Continue routine implementation autonomously.
5. Before opening its PR, export the actual recorded increment conversation to `docs/chat-logs/incNN-bibek.txt`, inspect it for credentials, and commit it on the increment branch. Do not substitute a summary for a transcript. When extracting a Codex session record, include source session/file, snapshot checksum, scope, and cutoff; omit private reasoning, system/developer messages, and runtime metadata. Redact credentials. If no transcript source is accessible, explain the specific blocker instead of claiming an export exists.
6. Push and open the PR with the increment report and closing issue reference, then check CI and report the link. Leave it open for teammate review; merge only when Bibek explicitly requests that PR's merge.
7. Return to checking PRs and recommending the next increment; wait for the next decision.

This sequence is an explicit user preference recorded on 2026-11-03. Do not require repeated reminders to export the chat before opening a PR. The agent-performed recorded export above fulfills the chat-log step for Codex sessions; the Claude Code `/export` command remains an alternative when available.
