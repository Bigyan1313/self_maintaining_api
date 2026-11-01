# INCREMENT 03: Database Schema and Migrations
Status: Standard
Dependencies: Increments 01, 02 (merged)

### CRITICAL — READ FIRST ###
**MANDATORY:** Follow the Working Rules in `prompts/00_master_context.md` Section 7. Save this prompt verbatim to `prompts/03_database_schema.md` first. Work on branch `feat/inc03-database-schema`.
**CRITICAL:** The SRS rules about data must be enforced **by the database itself** (constraints, unique indexes, triggers), not only by application code. In particular: **a 5th attempt can never be stored (DR-03)**, **a cheating outcome must name its guard and no other outcome may (DR-04)**, and **finished runs are append-only (FR-39)**.
**CRITICAL:** Schema, migrations, a thin data-access layer, and tests ONLY. No pipeline logic.

---

## Capability
A PostgreSQL schema (Drizzle ORM + drizzle-kit migrations) that stores everything in SRS 3.9 and 2.4, survives restarts (DR-01), links every record to its evidence (DR-02), and rejects invalid data at the database level.

## Part A — Shared domain types in `packages/core`

Add `packages/core/src/domain/enums.ts` with `as const` arrays + derived types (so the DB and pipeline share one source of truth). Core must still import nothing from `apps/*`.
- `ChangeCategory`: `field_renamed`, `field_type_changed`, `required_param_added`, `endpoint_removed`, `other`
- `Classification`: `breaking`, `safe`, `unknown`
- `MappingStatus`: `confirmed`, `unconfirmed`; `MappingSource`: `migration_note`, `human`
- `SourceMode`: `retrieved`, `uploaded`, `fixture`
- `Stage`: `ingest`, `detect`, `classify`, `locate`, `repair`, `validate`, `deliver`
- `RunStatus`: `running`, `not_affected`, `needs_review`, `flagged`, `repaired`, `failed`, `aborted`, `cheating_rejected`, `stage_failure`
- `AttemptOutcome`: `pass`, `fail`, `cheating`, `error`, `timeout`
- `GuardName`: `test_file_changed`, `test_count_changed`, `type_suppression`, `config_changed`
- `CallPattern`: `fetch`, `axios_instance`, `axios_static`, `generated_client`
- `SpecCheckOutcome`: `baseline_established`, `no_change`, `changed`, `failed`
- `Baseline`: `B1`, `B2`, `B3`; `ReviewVerdict`: `correct`, `incorrect`, `not_reviewed`

Each enum needs a matching **human-readable text label** map (for FR-42 / UI-02 later), e.g. `cheating_rejected → "Cheating rejected"`.

## Part B — Tables (`apps/server/src/infra/db/schema.ts`)

Use pgEnums built from the core arrays. Use `timestamptz` for all timestamps. Use `numeric` for money. Add foreign keys with indexes.

| Table | Key columns and rules |
|---|---|
| `repositories` | owner, name, default_branch, `credential_ref` (**name of an env var only, never the secret**), local_path. Unique (owner, name). |
| `apis` | name (unique), spec_source_url (nullable), poll_interval_seconds (nullable, **CHECK ≥ 60**, FR-12), baseline_version_id (nullable FK → spec_versions). |
| `spec_versions` | api_id, retrieved_at, source_mode, source_identifier, `content_sha256` (CHECK 64 lowercase hex), normalized (jsonb). **UNIQUE (api_id, content_sha256)** (FR-05). |
| `spec_checks` | api_id, started_at, finished_at, outcome (SpecCheckOutcome), spec_version_id (nullable), error_detail (nullable). A `failed` outcome must have error_detail (CHECK). This is how FR-11 "failed check ≠ no change" is stored. |
| `migration_notes` | api_id, from_version_id, to_version_id, raw_yaml (text), parsed (jsonb), uploaded_at. |
| `changes` | api_id, from_version_id, to_version_id, category, oasdiff_rule_id, classification, `confidence` (**CHECK 0 ≤ x ≤ 1**), path, method (nullable), json_pointer, evidence_before (jsonb), evidence_after (jsonb), mapping_status, mapping_source (nullable), mapping (jsonb, nullable), migration_note_id (nullable FK), confirmed_by (nullable), confirmed_at (nullable). **CHECK: mapping_status = 'confirmed' ⇔ mapping_source IS NOT NULL** (FR-10, BR-04). **CHECK: mapping_source = 'human' ⇒ confirmed_by and confirmed_at are NOT NULL.** |
| `runs` | change_id, repository_id, `commit_sha`, parent_run_id (nullable self-FK, for reanalysis), stage_reached (Stage), status (RunStatus), failure_stage (nullable), failure_detail, flagged_reason, `attempt_count` (**CHECK 0–4**), tokens_in, tokens_out, cost_usd, model_id, `is_fixture` (bool, BR-06), pr_url (nullable), started_at, finished_at (nullable). **CHECK: status = 'stage_failure' ⇒ failure_stage IS NOT NULL.** |
| `run_stage_results` | run_id, stage, status (`ok`/`failed`/`skipped`), result (jsonb), started_at, finished_at. **UNIQUE (run_id, stage)** (FR-38). |
| `call_sites` | run_id, file_path, line, column, pattern (CallPattern), excerpt. |
| `coverage_entries` | run_id, file_path, inspected (bool), skip_reason (nullable). **CHECK: inspected = false ⇒ skip_reason IS NOT NULL** (FR-15). |
| `attempts` | run_id, `attempt_number` (**CHECK BETWEEN 1 AND 4**), **UNIQUE (run_id, attempt_number)**, patch (text), validation_output (text), compile_errors, tests_passed, tests_total, outcome (AttemptOutcome), guard_name (nullable GuardName), tokens_in, tokens_out, cost_usd, model_id, duration_ms, created_at. **CHECK: (outcome = 'cheating') = (guard_name IS NOT NULL)** (DR-04). |
| `evaluation_results` | eval_label, scenario_id, baseline, outcome, attempts_used, cost_usd, duration_ms, model_ms, container_ms, review_verdict (default `not_reviewed`), excluded (bool), exclusion_reason, is_partial (bool). **CHECK: excluded ⇒ exclusion_reason IS NOT NULL.** UNIQUE (eval_label, scenario_id, baseline). |

## Part C — Append-only protection (FR-39) via triggers in a migration
- `attempts`, `run_stage_results`, `call_sites`, `coverage_entries`, `spec_versions`: **block UPDATE and DELETE** (raise an exception).
- `runs`: block DELETE always; block UPDATE when the **old** row has `finished_at IS NOT NULL` (a finished run is frozen; reanalysis = a new run with `parent_run_id`).
- `changes`: block DELETE. Allow UPDATE only of mapping_status / mapping_source / mapping / confirmed_by / confirmed_at (human confirmation); block changes to any other column.

## Part D — Data-access layer
`apps/server/src/infra/db/`: `client.ts` (pool from `DATABASE_URL`), `schema.ts`, and small typed repository modules (e.g. `runsRepo.ts`, `attemptsRepo.ts`) with only the insert/select functions the next increments will need. **No business logic.** Add TSDoc to exported functions.

## Part E — Migrations and test database
- drizzle-kit generates the SQL migrations into `apps/server/drizzle/`; triggers and CHECKs go in a hand-written migration if drizzle-kit can't express them. Commit the migrations.
- Root scripts: `db:generate`, `db:migrate`, `db:reset:test`.
- Tests use a **separate database `sma_test`** (created automatically if missing), migrated fresh before the suite runs. Never touch the dev DB in tests.
- CI: add a `postgres:16` **service container** (same digest as docker-compose) so DB tests run in GitHub Actions.

## Acceptance checks (all must pass before merge)
Integration tests against `sma_test` that prove the **database** rejects:
- [ ] a 5th attempt (attempt_number = 5), and a duplicate attempt_number for the same run
- [ ] outcome `cheating` without guard_name; and `pass`/`fail` **with** a guard_name
- [ ] a second spec_version with the same (api_id, content_sha256)
- [ ] confidence = 1.5 or -0.1
- [ ] mapping_status `confirmed` with no mapping_source; `human` source without confirmed_by
- [ ] poll_interval_seconds = 30
- [ ] UPDATE or DELETE on an attempt; UPDATE on a finished run; DELETE on any run
- [ ] coverage entry with inspected = false and no skip_reason; spec_check `failed` with no error_detail

And proves it **accepts**: a full happy-path chain (repository → api → 2 spec_versions → change → run → 4 stage results → call_site → coverage entry → attempts 1–4 → evaluation_result), and a reanalysis run linked by parent_run_id.
- [ ] Data persists across `npm run db:down && npm run db:up` (manual check; report it)
- [ ] `packages/core` enum tests: every enum value has a text label
- [ ] Root typecheck, lint, and test pass; CI green (with the Postgres service)
- [ ] Commits on the branch, `git merge --no-ff` into `main`, push

### CRITICAL — REMINDER ###
**MANDATORY:** The rules are enforced **in the database** (CHECK / UNIQUE / triggers), and every rejection has a test. No secrets in any column; `credential_ref` holds an env var name only. Tests use `sma_test`, never the dev DB. No pipeline logic. Log decisions, update `docs/PROGRESS.md`, and end with the **INCREMENT 03 REPORT** in the exact format. Do not start Increment 04.
