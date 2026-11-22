# INCREMENT 17a: Early deliverables (diagrams, architecture, TypeDoc fix, early acceptance records)
Status: Standard
Dependencies: Increments 01–10 merged. Does NOT need 11–16; anything that does is marked PARTIAL.

### CRITICAL — READ FIRST ###
**MANDATORY:** Follow the Working Rules in `CLAUDE.md`. Save this prompt verbatim to `prompts/17a_early_deliverables.md`. Branch: `feat/inc17a-early-deliverables`. Requirement IDs → `docs/SRS.md` (Section 7.1, Appendix A). This is the early part of `prompts/17_deliverables.md` (Parts A, B, C-docs, D).
**CRITICAL:** Every diagram and document must match the delivered code. Do not invent classes, states, or results. Mark anything that depends on unbuilt increments (11–16) as "planned" or PARTIAL.
**CRITICAL:** Acceptance records show real executions with actual output. Never mark PASS without real output.

---

## Part 1 — Diagrams `docs/diagrams/`
- `class-diagram.md`: Mermaid `classDiagram` of core + server + web. Show TypeScript modules as classes with `<<module>>` stereotypes and interfaces as `<<interface>>`. Group by MVC layer: Model = `packages/core` + `apps/server/src/infra/db`; Controller = `apps/server/src/http` + `apps/server/src/pipeline`; View = `apps/web`. Include infra adapters (oasdiff runner, repo reader, validator/sandbox, workcopy, LLM adapter + fake).
- `statecharts.md`: Mermaid `stateDiagram-v2` for (1) run lifecycle using exactly `RUN_STATUSES` from `packages/core/src/domain/enums.ts`, (2) spec check using `SPEC_CHECK_OUTCOMES`, (3) repair attempt loop using `ATTEMPT_OUTCOMES` with the guard order test_file_changed → config_changed → type_suppression → test_count_changed. Transitions that need the orchestrator (inc 13) or repair loop (inc 11) are labeled "planned".
- Under each diagram, list every class/state and the file it lives in (grep to verify).
- Export PNGs to `docs/diagrams/png/` using `@mermaid-js/mermaid-cli` pinned to an exact version (C-07); add `npm run diagrams`.

## Part 2 — `docs/architecture.md`
Package structure and MVC mapping; C-05 separation (and the boundaries test that enforces it); the 7-stage pipeline (mark Repair/Deliver/orchestrator as not yet built); database tables and the rules the DB enforces; and these algorithms, each with a short "why" and a file link: spec normalization + hashing, oasdiff parsing with JSON pointers, the classification rule table + mapping confirmation (BR-04), ts-morph route matching in Locate, sandbox isolation, the 4 cheat guards and their order, LLM context assembly. Every link must resolve to a real file.

## Part 3 — TypeDoc fix
`npm run docs` fails on a fresh clone because `@sma/core` is not built. Change the root script to `"docs": "npm run build -w @sma/core && typedoc"`. Verify on a fresh clone (`git clone` → `npm ci` → `npm run docs`). Add a `npm run docs` step to CI.

## Part 4 — Early acceptance records `docs/acceptance/`
`README.md` with a summary table (AT id → requirements → result). Records for AT-01, AT-02, AT-03, AT-04, AT-05, AT-07 (guards half), AT-09, AT-11, each with: build (commit), environment (OS, Node, Docker, Postgres versions), inputs, steps actually run, actual output, screenshots (terminal for now; dashboard screenshots added later), and PASS / PARTIAL / FAIL with the reason. Write `scripts/acceptance/run.ts` (+ `npm run acceptance`) that starts from a clean DB, drives the real HTTP routes and pipeline functions (call `detectAndClassify` directly, since there is no HTTP route until inc 13), and saves each check's output under `docs/acceptance/output/`.

## Acceptance checks
- [ ] Diagrams render on GitHub; every class/state exists in the code (list included)
- [ ] `architecture.md` links all resolve
- [ ] `npm run docs` works on a fresh clone
- [ ] The 8 AT records exist with real output and honest results; `npm run acceptance` re-runs them
- [ ] Typecheck, lint, tests pass; CI green; PR opened (`Closes #<issue>`)

### CRITICAL — REMINDER ###
**MANDATORY:** Docs match the code. Real outputs only. Decisions → `docs/decisions/inc17a.md`. End with the **INCREMENT 17a REPORT** and open the PR.
