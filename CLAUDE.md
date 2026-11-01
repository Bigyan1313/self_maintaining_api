# CLAUDE.md — Self-Maintaining APIs (CS 4398, Group 13)

Before any work, read `prompts/00_master_context.md` and `docs/PROGRESS.md`. Follow the Working Rules in the master context.

## 7. Working rules for every increment (MANDATORY)

1. **ONE capability per increment.** Do not start the next increment until told to.
2. First, save the increment prompt **verbatim** to `prompts/NN_name.md`.
3. **Git:** create branch `feat/incNN-short-name` from `main`, make small meaningful commits, and when the increment is verified, merge into `main` with `git merge --no-ff` and push. (The course needs a real branch/commit "Network" graph.)
4. Write unit tests for every Model/Controller-level class or function you add. All tests, typecheck, and lint must pass before merging.
5. Add TSDoc comments to exported functions/classes (TypeDoc builds from them).
6. **Don't stop to ask questions about small choices.** Make a sensible choice that fits the SRS, and log it in `docs/DECISIONS.md` (date, increment, decision, why). Stop and ask ONLY if a choice would break an SRS rule or is costly to undo.
7. Never commit secrets. Credentials come from `.env` (gitignored); only `.env.example` is committed. Never log or export credentials (NFR-04).
8. Update `docs/PROGRESS.md` at the end of every increment.

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
