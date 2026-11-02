# PROMPT 00 — MASTER CONTEXT: Self-Maintaining APIs (CS 4398, Group 13)

### CRITICAL — READ FIRST ###
**MANDATORY:** This is the master context for the whole project. It is built with the **Module of Thought (MoT)** method: one master context plus one prompt per capability ("increment").
**MANDATORY:** Do the following now, and nothing else:
1. Save this entire prompt **verbatim** to `prompts/00_master_context.md`.
2. Create `CLAUDE.md` in the repo root. It must say: "Before any work, read `prompts/00_master_context.md` and `docs/PROGRESS.md`. Follow the Working Rules in the master context." Copy Sections 7 and 8 of this prompt into it as well.
3. Create `docs/PROGRESS.md` with the increment table from Section 9 (all rows "Not started").
4. Create `docs/DECISIONS.md` (empty log, with a heading).
5. **Do NOT write any application code yet.** Increment 01 comes in the next prompt.
6. Reply with a short confirmation and the file list.

---

## 1. Domain background

Applications call external REST APIs. Providers change their **OpenAPI** specs: endpoints get removed, fields get renamed, types change, and new required parameters are added. Today a developer has to notice the change, find the affected code, fix it, and prove the fix works. Existing tools cover only one piece of that:
- Dependabot/Renovate bump versions but don't change code.
- OpenRewrite/ast-grep need a hand-written rule.
- Spec-diff tools report changes but don't fix consumer code.

**Our system joins the whole path** (spec history → validated fix in the consumer's code → pull request) **and measures** how often an LLM agent repairs a breaking change correctly, and where it fails.

The full requirements are in `docs/SRS.docx` (Group 13 SRS v1.0). **Requirement IDs (FR-xx, NFR-xx, DR-xx, BR-xx, C-xx, EV-xx, AT-xx) refer to that document.** When a prompt cites an ID, read that part of the SRS.

## 2. System architecture — 7-stage pipeline

Each stage **writes its result to the database before the next stage begins** (FR-38). Runs are **append-only** (FR-39).

| # | Stage | Input | Output recorded |
|---|-------|-------|-----------------|
| 1 | Ingest | Spec URL or uploaded file | Spec version, normalized JSON, SHA-256 hash |
| 2 | Detect | Two spec versions | Structured diff list (path, method, JSON pointer, before/after evidence) |
| 3 | Classify | One difference | breaking / safe / unknown, confidence 0–1, mapping status |
| 4 | Locate | Change + repo | Call sites (file, line, column, pattern, excerpt) + coverage report |
| 5 | Repair | Change, sites, migration note, prior errors | Patch (unified diff), tokens, cost, model, attempt # |
| 6 | Validate | Patch + isolated working copy | pass / fail / cheating (+ guard name) |
| 7 | Deliver | Validated patch | PR URL, or flagged finding + reason |

**THE RULE THAT IS NEVER BROKEN (BR-04, C-04):** A spec difference is NOT proof that two fields mean the same thing. Stage 5 (Repair) runs **only** when the old→new mapping is **confirmed by a migration note or a human**. Everything else stops at stage 4 and is reported.

## 3. Component specifications

- **Scope (C-01):** TypeScript consumer repos only. 4 change categories: `endpoint_removed`, `field_renamed`, `field_type_changed`, `required_param_added`. 3 call patterns: `fetch` with a literal/template URL, `axios` via static import or a configured instance, generated-client function calls. Dynamic URLs, wrappers, and re-exported aliases → reported as **coverage limits / "Needs review"**, never treated as "not affected".
- **Detection:** uses **oasdiff** (Go binary, installed locally, version pinned). The oasdiff *runner* lives in infra. The *parser/classifier* lives in `packages/core` and takes oasdiff JSON as input, so it is unit-testable with fixtures and needs no network, container, or model (NFR-08).
- **Migration note:** a structured YAML file (format defined in the Classify increment), e.g. `mappings: [{kind: field_renamed, method: GET, path: /orders/{id}, old: customer_name, new: full_name}]`.
- **Location:** **ts-morph** syntax-tree analysis. Never plain text search.
- **Repair:** the LLM gets ONLY: the changed spec section, the migration note, the files containing call sites, and validator errors from earlier attempts (FR-19). **Max 4 attempts** per run (FR-21, DR-03). Token ceiling per run → over the limit = `aborted` (FR-24).
- **LLM adapter (C-06):** ALL model calls go through ONE file, `apps/server/src/infra/llm/adapter.ts`. The provider is swappable by editing only that file.
- **Validation (FR-25, NFR-03):** Docker container, `--network none`, non-root user, memory/CPU limits, 10-minute wall clock, image **pinned by digest**. Runs the repo's own typecheck + tests (Vitest), unchanged. Generated code **never** runs on the host (C-03).
- **Cheat guards (FR-27–31):** reject a patch that (a) adds/edits/deletes/skips any test file, (b) lowers the passing-test count or changes the total-test count, (c) adds `@ts-ignore`/`@ts-expect-error`/`@ts-nocheck`, an unchecked `any`, or an empty `catch` in its changed lines, (d) edits tsconfig/vitest/package config instead of source. Record which guard fired. A cheating result **ends the run immediately**.
- **Delivery (FR-33–37, C-02):** Octokit: push a branch + open a PR labeled machine-generated / awaiting review. **NEVER merge, never enable auto-merge, never push to the default branch.**
- **Dashboard (UI-01–04):** Configuration, Changes, Runs, Run Detail, Results views. **Every outcome state has a text label, not just a color** (FR-42).
- **Evaluation (Section 6 of the SRS — as important as the code):** 20 frozen scenarios (5 per category; 3 endpoint-removals with no replacement, where refusing is the correct answer). Baselines: B1 do nothing, B2 one LLM call with no validation/retries/guards, B3 full pipeline. The script writes a machine-readable results file; tables are generated from it, never typed by hand (EV-08).

## 4. Tech stack (pin EXACT versions — no `^` or `~`, C-07)

- Node 22 LTS, TypeScript (strict), **npm workspaces**
- Server: Fastify + zod. DB: PostgreSQL 16 (docker-compose) + Drizzle ORM + drizzle-kit migrations
- Web: React + Vite
- Tests: Vitest. Lint: ESLint + Prettier. API docs: **TypeDoc** (stands in for javadoc in the course deliverables)
- ts-morph, oasdiff (binary), `yaml`, Octokit, `@anthropic-ai/sdk` (behind the adapter only)
- Docker for validation. GitHub Actions CI.

## 5. Repository layout

```
self-maintaining-apis/
  CLAUDE.md
  prompts/                 # every MoT prompt, saved verbatim (course deliverable #1)
  docs/
    SRS.docx  PROGRESS.md  DECISIONS.md
    diagrams/              # class diagram + pipeline statechart (Mermaid/PlantUML)
    acceptance/            # AT-01..AT-12 execution records + screenshots
  packages/core/           # PURE domain logic: ingest, detect-parse, classify, locate, guards, types
  apps/server/             # Fastify HTTP + pipeline orchestrator
    src/infra/             # db, llm adapter, docker validator, github, oasdiff runner
  apps/web/                # React dashboard
  demo/api/                # demo REST API served at v1 and v2 + openapi specs + migration notes
  demo/consumer/           # sample TypeScript repo that calls the demo API
  scenarios/               # 20 frozen evaluation scenarios
  eval/                    # evaluation script + results
```
**C-05:** domain logic, HTTP handling, and presentation stay separate. `packages/core` must NOT import from `apps/*`, and must NOT touch the network, Docker, or the LLM.

## 6. Performance thresholds (quantitative tracking)

| Metric | Green | Yellow | Red |
|---|---|---|---|
| Detect+classify+locate time (≤200 files / 20k lines, NFR-05) | < 30 s | 30–60 s | > 60 s |
| Unit tests passing | 100% | — | < 100% |
| Model request | < 60 s | 60–120 s | timeout at 120 s (NFR-06) |
| Container validation | < 5 min | 5–10 min | timeout at 10 min |
| Attempts per successful repair | 1–2 | 3–4 | > 4 (impossible by DR-03) |

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

## 9. Increment plan (simple → complex)

| Inc | Capability | SRS refs | Status |
|---|---|---|---|
| 01 | Project setup: workspaces, TS, Vitest, lint, Postgres, CI, TypeDoc | C-05, C-07 | Standard |
| 02 | Demo API v1/v2 + specs + migration notes + sample consumer repo (tests pass on v1, fail on v2) | 2.2, 5.2 | Standard |
| 03 | Database schema + migrations (incl. 4-attempt limit + guard-name constraints) | DR-01–05 | Standard |
| 04 | Ingest: upload/URL, normalize, hash, baseline, dedupe, failure handling | FR-01–05, FR-11, FR-12 | Standard |
| 05 | Detect: oasdiff runner + parser + evidence | FR-06, FR-08 | Standard |
| 06 | Classify + migration-note parsing + mapping confirmation | FR-07, FR-09, FR-10, BR-01, BR-04, BR-05 | **CRITICAL** |
| 07 | Locate: ts-morph call sites + coverage report | FR-13–17, BR-02 | Standard |
| 08 | Validator: Docker sandbox + output parsing | FR-25, FR-26, FR-32, NFR-03 | **CRITICAL (checkpoint)** |
| 09 | Cheat guards | FR-27–31, DR-04 | **CRITICAL** |
| 10 | LLM adapter + context assembly | FR-19, C-06, NFR-04, NFR-08 | Standard |
| 11 | Repair loop (retries, error feedback, token ceiling, cost) | FR-18, FR-20–24 | **CRITICAL** |
| 12 | Delivery: branch + PR, flagged findings | FR-33–37, C-02 | Standard |
| 13 | Pipeline orchestrator + run records + JSON/HTML export | FR-38, FR-39, FR-41 | Standard |
| 14 | Dashboard (5 views, text labels) | UI-01–04, FR-40, FR-42 | Standard |
| 15 | 20 frozen scenarios + failing-before check | EV-01, EV-02 | **CRITICAL** |
| 16 | Evaluation script: B1/B2/B3, results file, generated tables | EV-03–09 | **CRITICAL** |
| 17 | Deliverables: class diagram, statechart, TypeDoc, acceptance records AT-01–12 | 7.1 | Standard |

**CRITICAL increments:** before writing code, list the failure signs and the rollback point (last merged commit on `main`). If a check fails, use this order: isolate the component → test it alone with a simple input → check intermediate outputs → fix → re-run all tests.

### CRITICAL — REMINDER ###
**MANDATORY:** Right now, only save this file, create `CLAUDE.md`, `docs/PROGRESS.md`, and `docs/DECISIONS.md`, then confirm. **No application code yet.** Never merge PRs on target repos, never run generated code on the host, and never repair an unconfirmed mapping.
