# PROMPT 03b: Team Workflow Setup (not a code increment)
Status: Standard
Dependencies: Increment 03 merged into `main`

### CRITICAL — READ FIRST ###
**MANDATORY:** Save this prompt verbatim to `prompts/03b_team_workflow.md`. Work on branch `chore/team-workflow`.
**CRITICAL:** From now on, **three people** (Bigyan, Bibek, Sishir) build increments **in parallel**, each with Claude Code on their own machine. Whoever is free takes whichever increment is ready. This prompt changes the rules so parallel work does not collide. **No application code in this prompt.**

---

## 1. Update the Working Rules (in `CLAUDE.md` AND Section 7 of `prompts/00_master_context.md`)

Do not touch any other part of the master context. Replace the git rule and add the new rules:

- **Start of every increment:** `git checkout main && git pull`, then `npm ci`, `npm run consumer:install`, and `npm run db:migrate`. Confirm that the increment's GitHub Issue is **assigned to the current user** (`gh issue view <n>`). If it is not, stop and say so.
- **Branch:** `feat/incNN-short-name` from the latest `main`.
- **End of every increment:** do NOT merge into `main` yourself. Push the branch and open a Pull Request with `gh pr create`. Title: `Increment NN: <name>`. Body: the INCREMENT REPORT, plus `Closes #<issue>`. A teammate merges it on GitHub with **"Create a merge commit"** (never squash or rebase, so the git Network graph keeps its branches).
- **Before opening the PR:** `git fetch && git merge origin/main` into the branch, fix any conflicts, and re-run typecheck, lint, and tests.
- **Decisions:** write them to `docs/decisions/incNN.md` (one file per increment) instead of one shared file, to avoid merge conflicts. Move the existing `docs/DECISIONS.md` entries into `docs/decisions/inc01.md`, `inc02.md`, and `inc03.md`, and leave `DECISIONS.md` as an index that links to them.
- **Progress:** the GitHub Issues board is the source of truth. `docs/PROGRESS.md` gets one line per increment, updated in that increment's own PR only.
- **Database schema changes:** if an increment needs a schema change, make it a NEW migration, created **after** merging the latest `main`. Never edit an existing migration. If two PRs both add migrations, the second one regenerates its migration after rebasing on `main`.
- **Chat logs:** at the end, the human runs `/export docs/chat-logs/incNN-<firstname>.txt`, and it is committed in the same PR.
- **Shared code:** only add to `packages/core` in a new file or with new exports. Do not rename or remove exports that other increments use without saying so in the PR.

## 2. Create GitHub labels and Issues (use `gh`)

Labels: `ready` (green), `blocked` (red), `critical` (orange), `increment`.

Create one Issue per remaining increment. Title: `Increment NN: <name>`. Body: the capability line, the SRS refs, and **"Depends on: #x, #y"** (issue numbers). Prompt file: `prompts/NN_*.md` (added when written). Use the `ready` label if all of its dependencies are merged, otherwise `blocked`. Add `critical` where marked.

| Inc | Name | Depends on | Critical |
|---|---|---|---|
| 04 | Ingest | 03 | |
| 05 | Detect (oasdiff runner + parser) | 03 | |
| 06 | Classify + migration note + mapping confirmation | 05 | yes |
| 07 | Locate (ts-morph call sites + coverage) | 03 | |
| 08 | Validator (Docker sandbox) | 03 | yes |
| 09 | Cheat guards | 08 | yes |
| 10 | LLM adapter + context assembly | 06, 07 | |
| 11 | Repair loop | 08, 09, 10 | yes |
| 12 | Delivery (branch + PR) | 03 | |
| 13 | Pipeline orchestrator + run records + export | 04, 05, 06, 07, 11, 12 | |
| 14 | Dashboard | 04 | |
| 15 | 20 frozen scenarios | 02 (failing-before check uses 08 when available) | yes |
| 16 | Evaluation script (B1/B2/B3) | 13, 15 | yes |
| 17 | Deliverables: diagrams, TypeDoc, acceptance records | 13 | |

Also add a short **GitHub Action** `.github/workflows/unblock.yml`: when an issue is closed, find open issues whose "Depends on" list is now all closed, swap their `blocked` label for `ready`, and comment "Now ready." (Use `actions/github-script`, pinned to a full commit SHA.)

## 3. Write `TEAM.md` (for teammates; plain, simple words)

1. **One-time setup on a Mac:** Homebrew; `brew install git node@22 oasdiff gh`; `brew install --cask docker` and open Docker; `npm install -g @anthropic-ai/claude-code`; `gh auth login`.
2. **Get the project:** `gh repo clone Bigyan1313/self_maintaining_api`, `cd` into it, `cp .env.example .env`, `npm ci`, `npm run consumer:install`, `npm run db:up`, `npm run db:migrate`, `npm test`.
3. **Taking a step:** open the Issues tab → pick a `ready` issue → **Assign yourself** → download its prompt file into `prompts/` (if it is not already there) → run `claude` → type `Read prompts/NN_name.md and follow it exactly.`
4. **Finishing:** Claude Code opens the PR → run `/export docs/chat-logs/incNN-<yourname>.txt` → ask a teammate to look at it → merge with **"Create a merge commit"**.
5. **Rules:** only work on an issue assigned to you. Never push straight to `main`. Never commit `.env`. If you get stuck, post in the group chat instead of letting Claude Code guess on big changes.

## 4. Protect `main`
Use `gh api` to turn on branch protection for `main`: require a PR, require the CI check to pass, and block force-pushes. If the repo plan doesn't allow it (private repo on a free plan), report that, and the team will follow the rule by hand.

## Acceptance checks
- [ ] `CLAUDE.md` and the master context Section 7 have the new rules; nothing else in the master context changed
- [ ] `docs/decisions/` exists with inc01–inc03; `DECISIONS.md` is an index
- [ ] 4 labels and 14 issues created with the correct dependencies; ready/blocked set correctly (04, 05, 07, 08, 12, 15 should be `ready`)
- [ ] `unblock.yml` added
- [ ] `TEAM.md` written
- [ ] Branch protection on, or the reason it isn't reported
- [ ] This change itself goes in through a **PR** (practice the new flow). Report the PR link.

### CRITICAL — REMINDER ###
**MANDATORY:** No application code. The new rules: pull first; issue must be assigned to you; open a PR instead of merging yourself; merge with a merge commit (no squash); one decisions file per increment; new migrations only. End with a short report: what changed, the issue numbers created, the PR link, and anything the human must do (for example, adding Bibek and Sishir as collaborators).
