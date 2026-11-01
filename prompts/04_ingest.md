# INCREMENT 04: Ingest (register, retrieve, normalize, hash, baseline)
Status: Standard
Dependencies: Increment 03 (database schema) merged

### CRITICAL — READ FIRST ###
**MANDATORY:** Follow the Working Rules in `CLAUDE.md` (team PR flow). Save this prompt verbatim to `prompts/04_ingest.md` first. Branch: `feat/inc04-ingest`. Requirement IDs refer to `docs/SRS.md`.
**CRITICAL:** A failed retrieval/parse is **NOT** "no change". It is a **failed check**, the baseline stays untouched, and it can be retried (FR-11). Never store a credential, only the **name** of the env var that holds it.
**CRITICAL:** This increment covers stage 1 (Ingest) and configuration. Do NOT diff, classify, or locate.

---

## Context for whoever picks this up
Already on `main`: monorepo + tooling (01), demo API with `demo/api/specs/v1.yaml` and `v2.yaml` (02), and the DB schema with `repositories`, `apis`, `spec_versions`, `spec_checks` and enums in `packages/core/src/domain/enums.ts` (03). Read those files before starting.

## Capability
A developer can register a repository and an API (FR-01) with validation (FR-02), then upload or retrieve an OpenAPI spec that gets normalized, hashed, stored, and compared by hash to set or keep the baseline (FR-03–05, FR-11, FR-12).

## Part A — Shared HTTP API contract (types only) — `packages/core/src/api/contract.ts`
**Every later increment and the dashboard code against this file.** Write request/response types (zod schemas + inferred types) for ALL of these, even ones implemented later. Mark each with a TSDoc `@implementedIn incNN` tag:
| Method | Path | Implemented in |
|---|---|---|
| GET/POST | `/api/repositories` | 04 |
| GET/POST | `/api/apis` | 04 |
| POST | `/api/apis/:id/specs` (upload file body) | 04 |
| POST | `/api/apis/:id/check` (retrieve from URL) | 04 |
| GET | `/api/apis/:id/checks` | 04 |
| POST | `/api/apis/:id/migration-notes` | 06 |
| GET | `/api/changes?apiId=` | 06 |
| POST | `/api/changes/:id/confirm-mapping` | 06 |
| POST | `/api/runs` `{ changeId, repositoryId }` | 13 |
| GET | `/api/runs`, `/api/runs/:id` (RunDetail: run, stage results, call sites, coverage, attempts, PR link or reason) | 13 |
| POST | `/api/runs/:id/reanalyze`, `/api/runs/:id/retry-delivery` | 13 |
| GET | `/api/runs/:id/export?format=json\|html` | 13 |
| GET | `/api/results` (latest evaluation results) | 16 |
Every outcome field in a response includes both the enum value and its **text label** (from the label maps in core).

## Part B — Pure logic in `packages/core/src/ingest/`
- `parseSpec(text, filenameHint)` → accepts **JSON or YAML**; rejects >5 MiB; validates as **OpenAPI 3.0 or 3.1** (reuse the validator library from inc02); returns a typed error with the parser message on failure.
- `normalizeSpec(doc)` → canonical JSON (recursively sorted keys, no whitespace differences) so the same spec in YAML and JSON hashes the same.
- `hashSpec(canonical)` → SHA-256, lowercase hex.
- `decideCheckOutcome({ baselineHash | null, newHash, existingHashes })` → `baseline_established` | `no_change` | `changed`. Pure and fully unit-tested.
- `countRepoSize(repoPath)` → number of selected `.ts`/`.tsx` files and lines, with the exclusions from SRS 5.2 (node_modules, .git, dist/build output, `.env*`, credential files, symlinks NOT followed). Put it in `packages/core/src/repo/limits.ts` so Increment 07 reuses it. Limits: **≤ 200 files, ≤ 20,000 lines.**

## Part C — Server (`apps/server`)
- **Spec retrieval** `src/infra/spec-source/`: HTTPS GET (also allow `http://localhost` / `127.0.0.1` for the demo API); 15 s timeout; 5 MiB cap; treat the body as text only — **never execute anything in it**; return typed failures (`unreachable`, `timeout`, `too_large`, `parse_error`, `invalid_openapi`).
- **Ingest service** `src/pipeline/ingest.ts`: given an API and either uploaded text or the API's URL:
  1. parse → normalize → hash
  2. no baseline → store version, set `apis.baseline_version_id`, record spec_check `baseline_established`, report **"Baseline established"** with no changes (FR-04)
  3. hash already stored for this API → record `no_change`, **no new version** (FR-05)
  4. new hash → store version, record `changed` (with the new version id). **Do NOT move the baseline here.** Expose `advanceBaseline(apiId, versionId)` for the orchestrator (inc 13) to call after classification (UC-02 step 6).
  5. any failure → record spec_check `failed` with error_detail; baseline unchanged; no version stored (FR-11, NFR-02)
  - `source_mode`: `uploaded`, `retrieved`, or `fixture` (a demo spec loaded from `demo/api/specs/` → `fixture`, BR-06).
- **Configuration validation (FR-02)** `src/pipeline/config-validate.ts`: field-level errors for missing/invalid fields; repository reachable (local_path exists, is a git repo, default branch exists; if `credential_ref` names an env var that is set, also check `GET /repos/{owner}/{name}` with Octokit and report `unreachable` on failure); repo within size limits (Part B); spec URL parseable or uploaded file valid. Return **all** field errors at once. **No run starts while there are errors.**
- **Routes** (Fastify + zod from the contract): repositories, apis, specs upload, check, list checks. Errors come back as `{ field, message }[]`.
- **Optional poller (FR-12):** off by default; when `pollIntervalSeconds ≥ 60` is set on an API, run checks **one at a time** (simple in-process queue). Unit-test the "≥ 60 s" and "one at a time" rules.

## Acceptance checks (AT-01, AT-02)
- [ ] Unit (core): YAML and JSON forms of `v1.yaml` give the **same hash**; v1 vs v2 hashes differ; >5 MiB rejected; Swagger 2.0 / garbage rejected with a parser message; `decideCheckOutcome` covers all 3 outcomes; `countRepoSize` respects exclusions and does not follow symlinks
- [ ] Integration (sma_test DB, `app.inject()`):
  - upload v1 → "Baseline established", 1 version, baseline set
  - upload v1 again (as JSON) → `no_change`, still 1 version
  - upload v2 → `changed`, 2 versions, **baseline still v1**
  - URL check against an unreachable host → spec_check `failed`, baseline unchanged, then a retry against the running demo API succeeds
- [ ] Registration with missing fields, unreachable repo path, bad spec, or an oversized repo → each returns field-level errors and **no** run/check row is created
- [ ] No column, log line, or response contains a token value (test with a fake `GITHUB_TOKEN=ghp_FAKE123` set: grep the logs and responses)
- [ ] Root typecheck, lint, and tests pass; CI green
- [ ] PR opened per the Working Rules (`Closes #<issue>`)

### CRITICAL — REMINDER ###
**MANDATORY:** Failed check ≠ no change; baseline never changes on failure; identical hash = no new version; the baseline is NOT advanced in this increment. The contract file covers ALL endpoints. Only env var *names* are stored. Decisions go in `docs/decisions/inc04.md`. End with the **INCREMENT 04 REPORT** and open the PR.
