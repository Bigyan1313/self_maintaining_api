# CLAUDE.md — Self-Maintaining APIs (CS 4398, Group 13)

Before any work, read `AGENTS.md`, `prompts/00_master_context.md` and `docs/PROGRESS.md`. Follow the Working Rules in the master context.

## 7. Working rules for every increment (MANDATORY)

Three people (Bigyan, Bibek, Sishir) build increments **in parallel**, each with Claude Code on their own machine. These rules keep parallel work from colliding.

1. **ONE capability per increment.** Do not start the next increment until told to.
2. **Start of every increment:** `git checkout main && git pull`, then `npm ci`, `npm run consumer:install`, and `npm run db:migrate`. Confirm that the increment's GitHub Issue is **assigned to the current user** (`gh issue view <n>`). If it is not, stop and say so.
3. Save the increment prompt **verbatim** to `prompts/NN_name.md` (if it is not already there).
4. **Branch:** `feat/incNN-short-name` from the latest `main`. Make small, meaningful commits.
5. Write unit tests for every Model/Controller-level class or function you add. All tests, typecheck, and lint must pass before the PR is opened.
6. Add TSDoc comments to exported functions/classes (TypeDoc builds from them).
7. **Don't stop to ask questions about small choices.** Make a sensible choice that fits the SRS, and log it in `docs/decisions/incNN.md` (one file per increment: date, decision, why). Stop and ask ONLY if a choice would break an SRS rule or is costly to undo.
8. Never commit secrets. Credentials come from `.env` (gitignored); only `.env.example` is committed. Never log or export credentials (NFR-04).
9. **Database schema changes:** make a NEW migration, created **after** merging the latest `main`. Never edit an existing migration. If two PRs both add migrations, the second one regenerates its migration after updating from `main`.
10. **Shared code:** only add to `packages/core` in a new file or with new exports. Do not rename or remove exports that other increments use without saying so in the PR.
11. **Progress:** the GitHub Issues board is the source of truth. Update this increment's one line in `docs/PROGRESS.md` in the increment's own PR only.
12. **Before opening the PR:** `git fetch && git merge origin/main` into the branch, fix any conflicts, and re-run typecheck, lint, and tests.
13. **End of every increment:** do NOT merge into `main` yourself. Push the branch and open a Pull Request with `gh pr create`. Title: `Increment NN: <name>`. Body: the INCREMENT REPORT, plus `Closes #<issue>`. A teammate merges it on GitHub with **"Create a merge commit"** (never squash or rebase, so the git Network graph keeps its branches).
14. **Chat logs:** at the end, the human runs `/export docs/chat-logs/incNN-<firstname>.txt`, and it is committed in the same PR.

## 8. End-of-increment report (MANDATORY format)

End every increment with exactly this:
```
INCREMENT NN REPORT
Status: DONE | PARTIAL | BLOCKED
Built: <bullets>
Tests: <passed>/<total>, typecheck: ok/fail, lint: ok/fail
Commands to verify: <bullets>
Decisions logged: <bullets>
SRS requirements covered: <IDs>
Problems / things the human must do: <bullets or "none">
```
