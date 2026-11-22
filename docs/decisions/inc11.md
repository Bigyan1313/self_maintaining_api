# Decisions — Increment 11: Repair loop

## Critical checkpoint (written before any code)

**Rollback point:** `28780a8` (Merge pull request #23, increment 10), the last merged commit on `main`.

**Failure signs** (each one has a test that fails if it happens):

1. A 5th model call happens, or a 5th attempt row is written (FR-21, DR-03).
2. Attempt 2's context does not contain attempt 1's validator errors (failing test names) (FR-21).
3. A cheating verdict is followed by another attempt (FR-31).
4. A token-ceiling stop is recorded as `failed` instead of `aborted` (FR-24).
5. A file in the developer's repository changes (FR-20).
6. An unconfirmed / non-breaking / unlocated change reaches the model (FR-18, BR-04).

**Isolation order if a check fails:** FakeLlmAdapter + mocked validator → FakeLlmAdapter + real
Docker validator → live model.

## Decisions

| Date       | Decision | Why |
| ---------- | -------- | --- |
| 2026-11-17 | "Passing validation" means the validator's `pass`: 0 compile errors and the **whole** test suite passes. A patch that fixes its own change while other tests still fail is a `fail` attempt. | FR-22 says "passing validation"; anything looser could report a false success. The evaluation scenarios (inc15) each contain one breaking change, so this is reachable there. |
| 2026-11-17 | The prompt's "12/12 on `demo/consumer` with `API_VERSION=v2`" cannot happen for one change: v2 also removes `DELETE /orders/{id}` with no confirmed mapping (BR-04), so `admin.test.ts` must keep failing. The Docker acceptance tests therefore use a **rename-only** copy of `demo/consumer`, built in a temp dir at test time: v1 response fixtures plus the v2 `GET /customers/*` fixtures. Its baseline is 10/12; the correct rename patch reaches 12/12. A separate Docker test shows that on the real five-change v2 the same correct patch is only 6/12, so the loop does **not** report it as repaired. | Keeps the acceptance check honest without touching `demo/consumer` (it is the developer's repo stand-in) and without a second sandbox-env allow-list value. |
| 2026-11-17 | `repair()` takes `db` as an extra input, and the change as the `RepairContextInput['change']` shape plus its before/after spec sections and the migration-note entry. The orchestrator (inc13) maps DB rows to that shape. | The signature in the prompt has no place to record attempts; the context builder already defines the change shape. |
| 2026-11-17 | `repair()` does **not** finish the run. It writes attempts, the `validate` (baseline) and `repair` stage rows, and run progress (attempt count, tokens, cost, model, `stage_reached`, `flagged_reason` / `failure_stage` / `failure_detail`). It returns the status; the orchestrator finishes the run (or continues to delivery after `repaired`). | A finished run is frozen by the DB (FR-39), and a `repaired` run still has to reach delivery (inc12). |
| 2026-11-17 | The token-ceiling check for attempt 1 runs **before** the pre-patch baseline. The baseline still runs before any model call. | Same outcome as checking after the baseline, but a run that can never afford one call does not spend up to 10 minutes in Docker first. |
| 2026-11-17 | Tokens counted against the ceiling = sum of recorded `tokens_in + tokens_out`. Check: `used + ctx.approxTokens + maxOutputTokens > ceiling` → `aborted`. | Exactly the rule in the prompt; the approximate input estimate comes from inc10. |
| 2026-11-17 | Additive change to the inc10 adapter types: an `invalid_output` error may carry `usage` (tokens, cost, model) when the provider did answer. The repair loop records and counts that usage. | Without it, tokens spent on an unparseable answer would be invisible to the ceiling and to cost reporting (FR-23, FR-24, NFR-07). Existing callers are unaffected. |
| 2026-11-17 | Attempt rows for a model error/timeout (no usage) store `patch = ''`, zero tokens and cost, and `model_id = 'unavailable'`. | `patch` and `model_id` are NOT NULL; the row still has to exist so the run record shows what happened (FR-23). |
| 2026-11-17 | Mapping of failures: model `timeout` → attempt `timeout`; `api_error`/`missing_key` → attempt `error`; both end the run as `stage_failure` (stage `repair`). A patch that does not apply (`patch_invalid`) → attempt `fail`, reason fed back. A validator result with status `error`/`timeout` (the checks ran but the runner crashed or hit the wall clock; possibly caused by the patch) → attempt `error`/`timeout`, output fed back, and the loop continues. A typed validator failure with no result (Docker down, copy or install failed) → `stage_failure` (stage `validate`). | UC-04 / NFR-02 name the failed stage; NFR-06 forbids a retry *inside* an attempt, but the next attempt is a new patch. Infrastructure failures are not the model's fault and are not retried. |
| 2026-11-17 | A pre-patch baseline that does not complete (typed error, or status `error`/`timeout`) → `stage_failure` (stage `validate`), before any model call. | The count guard (FR-28) cannot run without a baseline. |
| 2026-11-17 | Error feedback: for each failed attempt the loop builds a short summary (status, compile/test counts, failing test names prefixed `FAIL`, `error TS` lines, assertion lines). All earlier attempts are passed to the context, **newest first**, so the 4,000-character cap in the context builder keeps the most recent. | FR-19 / FR-21; failing test names must reach the next attempt. |
| 2026-11-17 | FR-18 precondition: breaking + `confirmed` mapping from `migration_note`/`human` + at least one call site in the locate result. If the context builder still finds no eligible source file (for example only test files were located), the run is `flagged` without a model call. | FR-18; the context builder rejects such input anyway. |
| 2026-11-17 | `single_shot` mode (B2): one model call, no baseline, no guards, no retries, no feedback. The patch is validated only to score it: `pass` → `repaired`, otherwise `failed`. The token ceiling still applies. `run_stage_results` for `repair` has `result.mode = 'single_shot'`. | Prompt Part A.6; B2 measures an unguarded single call, so it must not get the guard benefits. |
| 2026-11-17 | Default model limits per call: `maxOutputTokens = 4096`, `timeoutMs = 120000`; both can be overridden by the caller. | NFR-06 caps the request at 120 s; 4,096 output tokens fits a multi-hunk diff for the in-scope repos. |
| 2026-11-17 | A run that already has attempts or a `repair` stage row is rejected (`repair()` throws). | Re-running must be a new run (FR-39); the DB would reject duplicate attempt numbers anyway. |
