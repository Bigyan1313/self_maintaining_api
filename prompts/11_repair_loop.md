# INCREMENT 11: Repair Loop
Status: **CRITICAL**
Dependencies: Increments 08 (validator), 09 (guards), 10 (LLM adapter) merged

### CRITICAL — READ FIRST ###
**MANDATORY:** Follow the Working Rules in `CLAUDE.md`. Save this prompt verbatim to `prompts/11_repair_loop.md`. Branch: `feat/inc11-repair-loop`. Requirement IDs → `docs/SRS.md`.
**CRITICAL (FR-18):** Repair runs ONLY for a change that is **breaking + confirmed mapping + ≥ 1 call site**. Anything else → a **flagged finding** with a reason, and no model call.
**CRITICAL (FR-21, FR-22, DR-03):** **At most 4 attempts.** Validator errors from attempt N go into attempt N+1. After 4 failures → `failed` + flagged for a human. **Cheating → stop immediately** (FR-31).
**CRITICAL (FR-24):** Over the run's token ceiling → `aborted` (not `failed`).
Write the failure signs + rollback point in `docs/decisions/inc11.md` first.

---

## Context for whoever picks this up
Inc08: `createWorkingCopy`, `applyPatch`, `validate` (+ pre-patch baseline). Inc09: `guardedValidate` (static guards → validate → count guard). Inc10: `buildRepairContext`, `LlmAdapter`, `FakeLlmAdapter`. Inc03: the `runs` and `attempts` tables (attempt_number 1–4, unique; cheating ⇔ guard).

## Capability
For one run, generate → apply in an isolated copy → guard → validate → feed errors back, up to 4 times, recording every attempt (patch, tokens, cost, model, duration, outcome, guard) (FR-18, FR-20–24, NFR-07).

## Part A — `apps/server/src/pipeline/repair.ts`
```ts
repair({ runId, change, locateResult, repo: { path, commit }, env, adapter, tokenCeiling, mode: 'full' | 'single_shot' })
  → { status: 'repaired'|'failed'|'aborted'|'cheating_rejected'|'flagged'|'stage_failure';
      finalPatch?: string; finalResult?: ValidationResult; attempts: number; reason: string }
```
1. **Preconditions (FR-18):** not breaking, not confirmed, or 0 call sites → `flagged` with a plain reason (e.g. "No confirmed mapping: reported, not repaired."). No model call.
2. **Pre-patch baseline:** validate the unpatched copy once (needed by the count guard); store it in `run_stage_results` (stage `validate`, result `{ baseline: … }`).
3. **Loop, attempt = 1..4:**
   - Before calling: if `tokensUsedSoFar + ctx.approxTokens + maxOutputTokens > tokenCeiling` → stop, `aborted` (FR-24).
   - Build the context with `previousErrors` from earlier attempts → call the adapter.
   - `refusal` → record the attempt (outcome `fail`, refusal reason in validation_output) → `flagged` ("Model refused: …"). Stop.
   - `error` (timeout / api_error / missing_key) → record the attempt (outcome `error`/`timeout`) → `stage_failure` with failure_stage `repair` (UC-04: model unavailable). Stop.
   - `invalid_output` or a patch that doesn't apply → record as `fail` with the reason, and feed that reason back as the error for the next attempt.
   - Fresh working copy for EVERY attempt (never stack patches) → `guardedValidate`.
   - `cheating` → record the attempt with the guard → `cheating_rejected`. **Stop immediately.**
   - `pass` → record → `repaired`. Stop.
   - `fail` → record; extract errors (TS errors + failing test names + messages) → next attempt.
4. After attempt 4 fails → `failed`, reason "4 attempts used without passing validation; flagged for a human." **There is no 5th call** (the DB would reject it anyway, DR-03).
5. Every attempt row: patch, validation_output (raw), compile_errors, tests_passed/total, outcome, guard_name, tokens_in/out, cost_usd, model_id, duration_ms (FR-23). The run row is updated with totals (attempt_count, tokens, cost, model_id).
6. **`mode: 'single_shot'`** (used for evaluation baseline B2 in inc16): exactly 1 model call, **no guards, no retries, no error feedback**. Validation runs only to *score* the result. Record it as such (`run_stage_results.result.mode = 'single_shot'`).

## Critical checkpoint
- **Failure signs:** a 5th model call happens; attempt 2's context lacks attempt 1's errors; a cheat leads to another attempt; a token-ceiling stop is recorded as `failed`; any file in the developer's repo changes.
- **Isolation:** run each scenario below with `FakeLlmAdapter` + a mocked validator first, then with the real Docker validator.
- **Rollback:** the last merged `main` commit.

## Acceptance checks (AT-06, and AT-07 for the token ceiling)
With `FakeLlmAdapter` (scripted) + the real Docker validator on `demo/consumer` with `API_VERSION=v2`:
- [ ] Correct patch on attempt 1 → `repaired`, 1 attempt, tests 12/12
- [ ] Wrong patch, then correct → `repaired`, 2 attempts, and **attempt 2's context contains attempt 1's failing test names** (assert on the captured context)
- [ ] 4 wrong patches → `failed`, exactly 4 adapter calls, 4 attempt rows
- [ ] Cheating patch on attempt 2 → `cheating_rejected`, guard named, **no attempt 3**
- [ ] Token ceiling set very low → `aborted` before the first call; a ceiling hit mid-run → `aborted`
- [ ] Unconfirmed change (DELETE /orders/{id}) → `flagged`, **0 adapter calls**
- [ ] Adapter timeout → `stage_failure` (repair); refusal → `flagged`
- [ ] `single_shot` → 1 call, no guards (a cheating patch is NOT rejected in this mode; it's only scored)
- [ ] `demo/consumer` has no changes after all tests (`git status` clean)
- [ ] **Live run (skipped without `ANTHROPIC_API_KEY`):** the real model repairs the demo `field_renamed` change end to end. Report attempts, tokens, cost, and time (AT-06)
- [ ] Typecheck, lint, tests pass; CI green; PR opened (`Closes #<issue>`)

### CRITICAL — REMINDER ###
**MANDATORY:** Repair only breaking + confirmed + located. Max 4 attempts with error feedback, a fresh copy every time. Cheating stops the run. Ceiling → aborted. Every attempt is fully recorded. `single_shot` mode exists for B2. Decisions → `docs/decisions/inc11.md`. End with the **INCREMENT 11 REPORT** and open the PR.
