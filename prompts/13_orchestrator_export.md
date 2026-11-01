# INCREMENT 13: Pipeline Orchestrator + Run Records + Export
Status: Standard
Dependencies: Increments 04, 05, 06, 07, 11, 12 merged

### CRITICAL — READ FIRST ###
**MANDATORY:** Follow the Working Rules in `CLAUDE.md`. Save this prompt verbatim to `prompts/13_orchestrator_export.md`. Branch: `feat/inc13-orchestrator`. Requirement IDs → `docs/SRS.md`.
**CRITICAL (FR-38):** Every stage writes its result to the DB **before** the next stage begins, so any run can be replayed and any failure blamed on the stage that caused it.
**CRITICAL (FR-39):** Runs are append-only. Reanalysis creates a **new** run linked by `parent_run_id`. It never overwrites.
**CRITICAL (NFR-02):** Every failure (spec source, model, container, delivery) is reported as **its own stage failure**. No false success, and the baseline is never corrupted.

---

## Context for whoever picks this up
All stage functions exist: ingest + `advanceBaseline` (04), detect (05), `detectAndClassify` (06), `locate` (07), `validate` (08), `guardedValidate` (09), the adapter (10), `repair` (11), `deliver`/`retryDelivery`/`recordFlaggedFinding` (12). The API contract is `packages/core/src/api/contract.ts` (04): this increment implements the `@implementedIn inc13` endpoints.

## Capability
Run the full pipeline end to end with dependency injection, record every stage, expose run endpoints, and export any run as JSON and a readable HTML report (FR-38, FR-39, FR-41, DR-01, DR-02, DR-05, NFR-01, NFR-02, BR-06).

## Part A — Orchestrator `apps/server/src/pipeline/orchestrator.ts`
- **Ports (dependency injection):** `{ db, specSource, oasdiff, llm: LlmAdapter, validator, github, clock }`. Tests swap in fakes; production uses the real ones.
- **Spec-check flow** (per API): ingest → if `changed`: detect + classify → **then** `advanceBaseline` (UC-02 step 6). If detect/classify fails → stage failure, the baseline is NOT advanced.
- **Run flow** (per change × repository), `startRun({ changeId, repositoryId, mode? })`:
  1. create the `runs` row (status `running`, commit sha, `is_fixture` = true if the change's spec version is `fixture`, BR-06)
  2. locate → write the stage result → `not_affected` / `needs_review` ends the run with that status
  3. repair (+ validate inside) → write stage results
  4. `repaired` → deliver; otherwise → `recordFlaggedFinding`
  5. set `finished_at` (after this the row is frozen by the DB trigger)
- Each stage call is wrapped: a thrown/typed failure → `run_stage_results` `failed` + `runs.status = 'stage_failure'` + `failure_stage` + `failure_detail` (scrubbed of secrets).
- **One run at a time** (a simple mutex/queue; SRS 2.3). A second request waits or gets 409 (pick one; log it).
- `reanalyze(runId)` → a new run with `parent_run_id`, same change/repo, the current commit.

## Part B — Endpoints (from the contract)
`POST /api/runs`, `GET /api/runs`, `GET /api/runs/:id` (RunDetail: run + stage results + call sites + coverage + attempts + PR link or flagged reason, all with text labels), `POST /api/runs/:id/reanalyze`, `POST /api/runs/:id/retry-delivery`, `GET /api/runs/:id/export?format=json|html`.

## Part C — Export (FR-41, DR-05) `apps/server/src/pipeline/export.ts`
- **JSON:** the whole run record (run, change + evidence, note citation, call sites, coverage, every attempt with patch + validation output, outcome, PR URL or reason). Stable key order.
- **HTML:** one self-contained page (inline CSS, no external requests, no scripts). Every value HTML-escaped. Sections: summary with a text-labeled outcome, spec evidence, mapping source, call sites, coverage, an attempts table, the patch diff, validation output, PR link or reason. "FIXTURE / DEMO RUN" banner when `is_fixture` (BR-06).
- Credentials are never included (scrub + test).
- `POST /api/runs/:id/export` writes both files into `exports/` (gitignored). **If writing fails → error, and the report is NOT marked saved** (DR-05).

## Acceptance checks (AT-07, AT-08; NFR-01, NFR-02)
- [ ] **End to end with fakes** (FakeLlm returns the correct patch, real DB, mocked GitHub, real Docker validator): demo spec v1 → v2 upload → changes classified → baseline advanced → run on `field_renamed` → `repaired` → PR created (mocked); every stage has a result row **in order**
- [ ] Runs on DELETE /orders/{id} → `flagged` (no confirmed mapping), no PR; a target with no call sites in a clean repo → `not_affected`
- [ ] **Failure injection**, each giving the right status + failure_stage and **no success**: spec source down (`ingest`), oasdiff missing (`detect`), model timeout (`repair`), Docker down (`validate`), GitHub 500 (`deliver`, patch kept, retry works), token ceiling (`aborted`)
- [ ] The baseline is unchanged after a failed detect/classify
- [ ] Reanalysis → a new run with `parent_run_id`; the old run is unchanged (and the DB rejects an UPDATE to it)
- [ ] Export JSON matches the DB (deep compare); the HTML has escaped content, no `<script>`, the FIXTURE banner; a write to a read-only dir → error and not marked saved
- [ ] **NFR-01:** the same demo scenario run **3 times in a row** with no unhandled error, each run keeping full evidence
- [ ] Data survives a server + DB restart (DR-01)
- [ ] Typecheck, lint, tests pass; CI green; PR opened (`Closes #<issue>`)

### CRITICAL — REMINDER ###
**MANDATORY:** Write each stage result before the next stage. Append-only runs; reanalysis = new run. Each failure is its own stage, never a false success, and the baseline is safe. Exports are complete, escaped, and secret-free; a failed write is never marked saved. One run at a time. Decisions → `docs/decisions/inc13.md`. End with the **INCREMENT 13 REPORT** and open the PR.
