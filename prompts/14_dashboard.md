# INCREMENT 14: Dashboard
Status: Standard
Dependencies: Increment 04 merged (Configuration view). Run views use inc13 endpoints, and the Results view uses inc16's `/api/results`; if those aren't merged yet, build against the contract with mocks (see below).

### CRITICAL — READ FIRST ###
**MANDATORY:** Follow the Working Rules in `CLAUDE.md`. Save this prompt verbatim to `prompts/14_dashboard.md`. Branch: `feat/inc14-dashboard`. Requirement IDs → `docs/SRS.md`.
**CRITICAL (FR-42, UI-02):** Every outcome state is shown with a **text label**, never by color alone. Use the label maps in `packages/core/src/domain/enums.ts`.
**CRITICAL:** The dashboard only talks to our server through `packages/core/src/api/contract.ts`. No business logic in the browser.

---

## Context for whoever picks this up
`apps/web` is a React + Vite app (inc01). The API contract (inc04) lists every endpoint and which increment implements it. **If an endpoint isn't on `main` yet**, use an msw mock that returns contract-shaped data, behind `VITE_USE_MOCKS=true`, and list the endpoint under "waiting on incNN" in your report. Don't change the contract without saying so in the PR.

## Capability
A dashboard with the 5 views and the actions from UI-01, showing all the evidence from UI-03 and the evaluation tables from UI-04 (FR-40).

## Views (React Router)
1. **Configuration** — register a repository (owner, name, default branch, credential *env var name*, local path) and an API (name, spec URL or file upload), attach a migration note. Show **field-level errors** from the server next to each field (UC-01). Actions: **Upload spec**, **Check for changes**. Show the check result as a text label ("Baseline established", "No change", "Changes found", "Check failed: …").
2. **Changes** — table per API: category, classification, confidence, method + path, mapping status + source, all with labels. Click → the before/after evidence side by side. For an **unconfirmed** change: a **"Confirm mapping"** form (human confirmation, FR-10) asking for the mapping and "confirmed by", with a warning that this lets the system attempt a repair. Action: **Start run** (pick a repository).
3. **Runs** — list: id, change, repo, status label, stage reached, attempts, cost, started/finished, FIXTURE tag (BR-06).
4. **Run Detail (UI-03)** — spec evidence; migration-note citation or human confirmation; call sites (file:line + excerpt) and coverage (inspected/skipped + reasons); an attempts table (number, outcome label, guard, tests passed/total, tokens, cost, time); the patch as a readable diff; validation output (collapsible); the **PR link or the reason no PR exists**. Actions: **Reanalyze**, **Retry delivery** (only when delivery failed), **Export JSON / HTML**.
5. **Results (UI-04)** — from `/api/results`: per baseline (B1/B2/B3) → detection precision/recall, repair rate overall and **per change category**, refusal correctness, the attempts distribution, cheat rejections by guard, **false confidence**, cost/time per repair; plus a **list of failed scenarios**, with "Partial results" / "Excluded: reason" labels where relevant. Empty state: "No evaluation results yet."

## Labels and accessibility
All 11 UI-02 states: baseline established, no change, breaking, safe, unknown, not affected, needs review, repaired, failed, cheating rejected, stage failure (plus aborted/flagged). A color can be added, but **the text is always there**. Semantic tables, keyboard-usable buttons, form labels.

## Screenshots for the course (deliverable #2)
Add **Playwright** end-to-end tests (Chromium; pinned version) that walk through: configure → upload v1 → upload v2 → view changes → confirm-mapping dialog → start run → run detail → export → results. **Save a screenshot of every page and every pop-up/dialog** to `docs/acceptance/screenshots/<step>.png`. They run against mocks in CI and against the real server locally (`npm run e2e:real`).

## Acceptance checks (AT-01, AT-08 UI part)
- [ ] All 5 views render with mock data and with the real server (for whatever endpoints are merged)
- [ ] Field-level errors show next to the right fields
- [ ] Unit test: every enum value shown in the UI renders its text label (no color-only state)
- [ ] Run Detail shows every UI-03 item; "Retry delivery" only appears after a delivery failure
- [ ] Results view shows the per-category breakdown and the failed scenarios list
- [ ] Playwright suite passes and saves screenshots for every view and dialog
- [ ] Typecheck, lint, tests pass; CI green; PR opened (`Closes #<issue>`)

### CRITICAL — REMINDER ###
**MANDATORY:** Text labels for every state. Only the contract API. Mocks only for endpoints not yet merged (list them). Screenshots of every view and dialog. Decisions → `docs/decisions/inc14.md`. End with the **INCREMENT 14 REPORT** and open the PR.
