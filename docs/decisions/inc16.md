# Increment 16 decisions

Date: 2026-11-23

- Rollback point: latest merged main `e7b16bb` (Increment 14). Work is isolated on
  `feat/inc16-evaluation`; reverting this increment restores that baseline.
- Failure signs: changed frozen hashes; different cohorts/model/image across baselines;
  missing exclusions or interrupted results; unreviewed validation passes called correct;
  hidden failed scenarios; model/container outages treated as ordinary results; spending
  beyond the configured budget; evaluation delivery contacting GitHub.
- Diagnose failures by isolating the component, testing a small input, inspecting intermediate
  evidence, fixing it, and rerunning required checks.
- Use the real orchestrator for B2 (`single_shot`) and B3, with an explicit delivery dry-run
  option for B3. Both use Docker validation; fake mode replaces only the model.
- No paid model run is authorized by the implementation request. Implement and test the
  estimate/confirmation/budget controls; leave live evaluation for a separate decision.
- SRS 6.4 repair rate means validation passes divided by all completed, admitted trials,
  including the refusal cases in the category/overall denominator. Reports say "passed
  validation" and separately count human-reviewed correctness and pending reviews. Attempts
  and cost/time-per-repair use validation passes; no denominator yields null.
- Admission uses inc15's hash/snapshot/EV-02 checks but does not filter on detector success.
  Otherwise detection failures would be excluded before precision/recall could measure them.
- New migration adds the repeat key to evaluation_results and a full evaluation_studies JSON
  snapshot. Results are file-first and DB-second; resuming repairs a failed mirror. Existing
  migrations and frozen scenario files remain unchanged.
- Interrupted provider requests retain a conservative budget reservation because their billed
  usage is uncertain. Runtime failures leave partial results and rerun only unfinished trials.
- Full-suite validation exposed PostgreSQL deadlock 40P01 in the existing TRUNCATE trigger
  test while other files inserted pipeline rows. That file now uses its own `_test` database
  via the existing guarded reset/migration helper. It still requires the exact append-only
  trigger error; no assertion was weakened or retried away.

## Review fixes (2026-11-24, follow-up PR to #33, branch `feat/inc16-review-fixes`)

PR #33 was already merged when the review arrived, so these fixes are a follow-up PR from the
latest `main` (decided with the user), not new commits on the merged PR.

| Date       | Decision                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             | Why                                                                                                                                   |
| ---------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| 2026-11-24 | **Supersedes the earlier repair-rate entry above.** Repair rate and repair rate by category are computed only over trials whose scenario expects `repair` (17 of 20). A trial counts only if it is `repaired` AND expected to be repaired. Denominators are stored (`repairCounts`, per-category `repaired`/`eligible`) and shown as e.g. "70.6% (12/17)" in the report and dashboard.                                                                                                                                                               | SRS 6.4: refusing is the correct answer for the three no-replacement scenarios, so they cannot be in the repair denominator.          |
| 2026-11-24 | A `repaired` outcome on a refusal scenario is a **wrong action**: it never raises the repair rate, fails refusal correctness, is counted in `wrongActions`, and is listed in the failures as "Wrong action: repaired a refusal scenario".                                                                                                                                                                                                                                                                                                            | It proposes an undocumented migration (BR-04, BR-05).                                                                                 |
| 2026-11-24 | Cost and time per repair divide by counted repairs (not all validation passes). False confidence still uses all validation passes.                                                                                                                                                                                                                                                                                                                                                                                                                   | A wrong action is not a repair; false confidence is about any pass that is wrong.                                                     |
| 2026-11-24 | B1 refusal correctness is `null` with `refusalCounts: null`, shown as "n/a (B1 makes no decision)".                                                                                                                                                                                                                                                                                                                                                                                                                                                  | B1 does nothing, so it neither refuses nor repairs. 0% would claim a wrong decision.                                                  |
| 2026-11-24 | Cheat rejections are reported per guard and per change category × guard (`cheatRejectionsByCategory` in core), in the report and the dashboard.                                                                                                                                                                                                                                                                                                                                                                                                      | SRS 6.4. The report previously computed the category table itself; core now owns it.                                                  |
| 2026-11-24 | `GET /api/results` without a label returns the latest **non-fake** study (`snapshot->>'fake' IS NOT TRUE`); a fake study is returned only for its explicit label. The response has `fake`, and the Results page shows "FAKE MODEL DRY TEST — not model performance" whenever it is true.                                                                                                                                                                                                                                                             | SRS 6.6 honesty: a dry test must never look like model performance.                                                                   |
| 2026-11-24 | Evaluation `maxOutputTokens` = **16000** (largest safe value for a non-streaming request). The adapter sends `output_config: { effort: "high" }` explicitly and no `temperature`/`top_p`/`top_k`/`thinking` (non-default sampling and `thinking: disabled` return 400 on claude-sonnet-5-5). The 120 s timeout (NFR-06) is unchanged. Effort and maxOutputTokens are in the study environment and the report.                                                                                                                                        | The earlier 4096 limit risked truncated diffs; an explicit effort means a provider default change cannot silently change the study.   |
| 2026-11-24 | Every model call's `stop_reason` is recorded: per trial (`stopReasons`, and `calls` with stop reason, tokens, cost and model ms) and per study (`modelCalls.total`, `maxTokensStops`, counts by reason). A `max_tokens` stop is an `invalid_output` attempt with its billed usage and the message "Answer truncated at max_tokens (N output tokens)". `no_response` = nothing arrived (timeout); `not_reported` = scripted fake. Artifacts written before this have `modelCalls: null` and the report says "not recorded" (never a fabricated zero). | Truncation must be visible on its own, not hidden inside "invalid output".                                                            |
| 2026-11-24 | The cost estimate line uses the study's configured `maxOutputTokens` (and says the effort). Default `--max-cost` is **$50**.                                                                                                                                                                                                                                                                                                                                                                                                                         | The user set a $50 budget; with 16000 output tokens the full 100-call study's worst case is about $17.60 at claude-sonnet-5-5 prices. |
| 2026-11-24 | **Adapter fix found by the live pilot:** answers may contain `thinking` / `redacted_thinking` blocks (adaptive thinking is on by default on claude-sonnet-5-5). They are skipped and only `text` blocks are read; any other block type is still rejected.                                                                                                                                                                                                                                                                                            | In pilot 1, 6 of 11 calls were valid answers rejected as "incomplete or unsupported response".                                        |
| 2026-11-24 | `docs/chat-logs/inc16-bibek.txt` → `inc16-bigyan.txt` (Bigyan ran that Codex session). The transcript text is unchanged; one attribution line was added under its title. AGENTS.md keeps Bibek's workflow but the export path is `incNN-<firstname of the person running the session>.txt`.                                                                                                                                                                                                                                                          | Correct attribution for the course deliverable.                                                                                       |
| 2026-11-24 | The committed `eval/results/inc16-verified/report.md` was regenerated from its unchanged `results.json` with the corrected formulas (EV-08: reports are generated, never typed).                                                                                                                                                                                                                                                                                                                                                                     | Its old repair rates (5.0%) used the superseded denominator; corrected: 5.9% (1/17).                                                  |

### Live pilot (claude-sonnet-5-5, B3, 3 scenarios, maxOutputTokens 16000, effort high)

`npm run eval -- --label pilot-live[-2] --baselines B3 --scenarios rename-shop-flat,type-shop-number-string,param-shop-query --max-cost 5 --yes`
(result folders not committed).

**Pilot 1** (commit `f71c447`, before the thinking-block fix): 11 calls, **11 × `end_turn`, 0 × `max_tokens`**, $0.049952.
param-shop-query failed (4 attempts), rename-shop-flat failed (4), type-shop-number-string repaired (3). Every failed attempt was
`invalid_output`: 6 × "incomplete or unsupported response" (thinking blocks, fixed above) and 5 × strict diff parser.

| Scenario                | Call | stop_reason | In  | Out | Model ms | USD      |
| ----------------------- | ---- | ----------- | --- | --- | -------- | -------- |
| param-shop-query        | 1    | end_turn    | 600 | 190 | 1644     | 0.003100 |
| param-shop-query        | 2    | end_turn    | 676 | 452 | 2931     | 0.005872 |
| param-shop-query        | 3    | end_turn    | 713 | 497 | 3452     | 0.006396 |
| param-shop-query        | 4    | end_turn    | 750 | 174 | 1357     | 0.003240 |
| rename-shop-flat        | 1    | end_turn    | 575 | 253 | 2933     | 0.003680 |
| rename-shop-flat        | 2    | end_turn    | 651 | 427 | 2865     | 0.005572 |
| rename-shop-flat        | 3    | end_turn    | 688 | 390 | 3534     | 0.005276 |
| rename-shop-flat        | 4    | end_turn    | 725 | 429 | 3281     | 0.005740 |
| type-shop-number-string | 1    | end_turn    | 594 | 262 | 2761     | 0.003808 |
| type-shop-number-string | 2    | end_turn    | 670 | 251 | 2114     | 0.003850 |
| type-shop-number-string | 3    | end_turn    | 719 | 198 | 1898     | 0.003418 |

**Pilot 2** (commit `05a98d2`, with the fix): 6 calls, **6 × `end_turn`, 0 × `max_tokens`**, $0.027312.
All three scenarios **repaired in 2 attempts** (tests 2/2 each).

| Scenario                | Call | stop_reason | In  | Out | Model ms | USD      |
| ----------------------- | ---- | ----------- | --- | --- | -------- | -------- |
| param-shop-query        | 1    | end_turn    | 600 | 227 | 1911     | 0.003470 |
| param-shop-query        | 2    | end_turn    | 676 | 405 | 2766     | 0.005402 |
| rename-shop-flat        | 1    | end_turn    | 575 | 266 | 2556     | 0.003810 |
| rename-shop-flat        | 2    | end_turn    | 651 | 407 | 2799     | 0.005372 |
| type-shop-number-string | 1    | end_turn    | 594 | 260 | 2689     | 0.003788 |
| type-shop-number-string | 2    | end_turn    | 670 | 413 | 2883     | 0.005470 |

No call stopped at `max_tokens` (largest answer: 497 output tokens), so the switch to streaming
with 64000 tokens was **not** needed. Open issue (not changed here): attempt 1 of every pilot-2
trial was rejected by the strict diff parser ("Expected a complete unified diff…"), and attempt 2
passed. The adapter does not keep rejected raw text (by design), so the exact format problem is
not visible yet; it costs one attempt per trial and should be diagnosed before the paid study.
