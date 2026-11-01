# INCREMENT 17: Course Deliverables (diagrams, docs, acceptance records, submission archive)
Status: Standard
Dependencies: Increment 13 merged. (Finish after 14 and 16 for screenshots and results; parts can start earlier.)

### CRITICAL — READ FIRST ###
**MANDATORY:** Follow the Working Rules in `CLAUDE.md`. Save this prompt verbatim to `prompts/17_deliverables.md`. Branch: `feat/inc17-deliverables`. Requirement IDs → `docs/SRS.md` (Section 7.1, Appendix A).
**CRITICAL:** Every diagram and document must **match the delivered code**. Generate from the code where possible; check by hand where not. Do not invent classes, states, or results.
**CRITICAL:** Acceptance records show **real executions** (build, environment, inputs, actual output, pass/fail). "A requirement is not marked passed merely because an interface or a model response exists" (SRS Appendix A).

---

## Context for whoever picks this up
The course's final archive must contain (from `MoTtutorial/projectDescription.txt` on Canvas): 1. prompts; 2. acceptance test cases with screenshots of all windows and pop-ups; 3. a UML class diagram; 4. statechart diagrams; 5. a text description of the structure + key algorithms; 6. source code; 7. API docs (TypeDoc here, in place of javadoc); 8. unit tests for the Model/Controller-level classes; 10. a presentation (purpose, class diagram, statecharts, acceptance tests, **a screenshot of the git repo "Network" graph**).

## Part A — Diagrams `docs/diagrams/`
- **UML class diagram** (`class-diagram.md` with Mermaid `classDiagram`, plus an exported `.svg`/`.png`): the main types and services of core + server (stage services, adapter interfaces, guards, validator, orchestrator, repositories) with their relationships. Also generate a reverse-engineered one from the code (e.g. `tplant` → PlantUML → PNG) and note any differences.
- **Statecharts** (`statecharts.md`, Mermaid `stateDiagram-v2`, exported images):
  1. **Run lifecycle:** running → (locate) not_affected / needs_review / (repair loop: attempt 1..4 → pass / fail / cheating) → repaired → delivered / delivery failed → retry; flagged; aborted; stage_failure — exactly matching `RunStatus` and the orchestrator code
  2. **Spec check:** baseline_established / no_change / changed → classified → baseline advanced / failed
  3. **Repair attempt loop** (detailed, with the guard order)
- Script `npm run diagrams` renders the Mermaid sources to images (mmdc, pinned).

## Part B — Text description `docs/architecture.md`
The structure (packages, layers, C-05 separation), the 7-stage pipeline, the data model, and the **critical algorithms** written from scratch: URL template matching in locate, the classification rule table + mapping confirmation, the 4 cheat guards, the repair loop with error feedback, and sandbox isolation. Each with a short "why" and a file link.

## Part C — API docs + unit tests summary
- `npm run docs` → TypeDoc HTML for core + server (exported into the archive).
- `docs/unit-tests.md`: generated list of test files and counts per package, and coverage % (vitest `--coverage`), highlighting the "model/controller" equivalents: stage services, guards, classifier, locator, orchestrator.

## Part D — Acceptance records `docs/acceptance/AT-01.md … AT-12.md`
For each check in SRS Appendix A: build (git commit), environment, inputs, the steps actually run, the **actual output** (pasted/linked), screenshots (from inc14's Playwright run: every window + pop-up along the test case), and **PASS / FAIL** honestly. A script `npm run acceptance` re-runs the automated parts and refreshes the outputs. `docs/acceptance/README.md` has a summary table (AT id → requirements → result).

## Part E — Final report + presentation material
- `docs/final-report.md`: purpose, architecture summary, the evaluation results **included from `eval/results/<label>/report.md`** (not retyped), the failures and limitations (EV-09), and the deferred work (SRS 7.4).
- `docs/presentation-outline.md`: slide-by-slide outline: purpose → problem → pipeline → class diagram → statecharts → demo flow (with screenshots) → acceptance test summary → evaluation headline + failures → **git Network graph** (human task: screenshot GitHub → Insights → Network and save it as `docs/presentation/git-network.png`) → lessons learned. (The team builds the .pptx from this.)

## Part F — Submission archive `scripts/make-submission.sh`
Creates `submission/Group13_SelfMaintainingAPIs.zip` with folders numbered like the course list: `1_prompts/` (prompts + chat logs + `docs/prompt-generation.md`), `2_acceptance_tests/`, `3_class_diagram/`, `4_statecharts/`, `5_description/`, `6_source_code/` (a `git archive` of main), `7_api_docs/`, `8_unit_tests/` (test files + summary), `10_presentation/`. It excludes `.env`, `node_modules`, `.work`, and exports, and fails if any file contains a token-looking string.

## Acceptance checks
- [ ] Diagrams render; every class/state in them exists in the code (spot-check the list in the report)
- [ ] `architecture.md` links resolve to real files
- [ ] AT-01…AT-12 records exist, each with real output and an honest PASS/FAIL
- [ ] `npm run acceptance` re-runs the automated checks
- [ ] The final report includes the generated eval report (not retyped)
- [ ] `make-submission.sh` builds the zip; the secret scan passes; the folder list matches the course list
- [ ] Typecheck, lint, tests pass; CI green; PR opened (`Closes #<issue>`)
- [ ] Report lists the human tasks: git Network screenshot, build the .pptx, review the AT records, upload the zip to Canvas

### CRITICAL — REMINDER ###
**MANDATORY:** Docs match the code. Acceptance records show real runs and honest results. The final report includes the generated results, failures, and limitations. The archive follows the course's numbered list and contains no secrets. Decisions → `docs/decisions/inc17.md`. End with the **INCREMENT 17 REPORT** and open the PR.
