# INCREMENT 16: Evaluation Script (B1 / B2 / B3)
Status: **CRITICAL**
Dependencies: Increments 13 (orchestrator) and 15 (scenarios) merged

### CRITICAL — READ FIRST ###
**MANDATORY:** Follow the Working Rules in `CLAUDE.md`. Save this prompt verbatim to `prompts/16_evaluation.md`. Branch: `feat/inc16-evaluation`. Requirement IDs → `docs/SRS.md` (Section 6).
**CRITICAL (EV-08):** The evaluation is a **repeatable script** that writes a **machine-readable results file**. Every table is **generated from that file**. Nothing is typed by hand.
**CRITICAL (6.6 honesty rules):** Exclusions are listed with reasons. A passing patch is "passed validation", NOT "correct", until a human reviews it (EV-07). Partial runs are labeled **partial**. Failures are reported, not hidden (EV-09).
**CRITICAL:** Real model calls cost money. Show a **cost estimate and ask for confirmation** before a live run, and support `--max-cost`.
Write the failure signs + rollback point in `docs/decisions/inc16.md` first.

---

## Context for whoever picks this up
`scenarios/` has 20 frozen scenarios with `labels.yaml` and `verify.ts` (inc15). The orchestrator (inc13) runs the full pipeline; `repair(..., mode: 'single_shot')` (inc11) gives B2. The `evaluation_results` table is from inc03. The contract has `GET /api/results` `@implementedIn inc16`.

## Capability
Run B1, B2, and B3 over the identical scenario set with the same model + container image; record outcomes, attempts, guard rejections, cost, and time; and generate the Section 6.4 tables and the failure list (EV-01–09, NFR-01, NFR-05, NFR-09).

## Part A — `eval/run.ts` (`npm run eval -- --label <name> [--baselines B1,B2,B3] [--scenarios all|id,…] [--repeat 1|3] [--max-cost 5] [--yes]`)
1. Load the manifest; check every scenario hash; run the EV-02 failing-before check (inc15 verify, in the container). Not admissible → **excluded**, with the reason recorded.
2. Record the environment: git commit, model id, container image digest, oasdiff version, Node version, machine info (CPU cores, RAM).
3. For each admissible scenario × baseline (same model, same image):
   - **B1 Do nothing:** run the after-state tests (expected to fail). Records the floor.
   - **B2 Single shot:** detect → classify → locate → **one** model call (`mode: 'single_shot'`), no guards, no retries; validate only to score.
   - **B3 Full pipeline:** the orchestrator with delivery in **dry-run mode** (no real PRs; record "would open PR").
   - Record: outcome, attempts used, guard fired (if any), tokens, cost, total time, **model time vs container time separately** (NFR-05).
   - Detection: compare the system's differences/classifications with `labels.yaml` → TP/FP/FN per scenario.
4. A model or container outage → stop, mark the run **partial**, and keep what's done (6.6). `--resume` continues.
5. Write `eval/results/<label>/results.json` (+ a copy in `evaluation_results`). Use a schema version field.
6. `--repeat 3` runs everything 3 times (NFR-01) and reports any outcome that differed between repeats.

## Part B — `eval/review.ts` (EV-07)
An interactive CLI: for each B2/B3 patch that **passed validation**, show the scenario, migration note, and diff → a team member records **correct / incorrect** + a note + their name → saved into results.json and the DB. **For the endpoint-removed no-replacement scenarios**, any patch is automatically "incorrect (should have refused)".

## Part C — `eval/report.ts` → `eval/results/<label>/report.md` (+ `/api/results` returns the same data)
Generated tables, per baseline:
- Detection precision & recall (breaking/safe/unknown) vs hand labels
- Repair rate: overall + **per category**
- Refusal correctness (the 3 no-replacement scenarios)
- Attempts distribution for successful repairs (counts for 1/2/3/4, not just the mean)
- Cheat attempts caught: count + guard, per category
- **False confidence:** passed validation but judged incorrect (the most important number; "not yet reviewed" shown if review is missing)
- Cost and time per repair (tokens, $, wall time; model vs container)
- **Failures section (EV-09):** every scenario the system failed, the worst categories, and a limitations paragraph (generated from the data + a hand-written `eval/limitations.md` that gets included)
- Banners: "PARTIAL RESULTS" and an "Excluded scenarios: … (reasons)" list when they apply
- Implement `GET /api/results` (latest label, or `?label=`).

## Part D — Reproducibility (NFR-09)
`eval/README.md`: the exact commands to reproduce on the declared environment (pinned versions, image digest, model id, how to set the key, expected cost range).

## Acceptance checks (AT-12)
- [ ] **Dry test with `FakeLlmAdapter`** over all 20 scenarios: runs end to end, writes results.json, and the report generates. Tables match a hand-computed small example (unit test for each metric function)
- [ ] B1 shows every admissible scenario failing (proves they really break)
- [ ] A modified scenario → refused (hash); a non-admissible one → excluded with its reason in the report
- [ ] Killing the run midway → results marked partial; `--resume` finishes it
- [ ] The cost estimate is shown and confirmation is required before live calls; `--max-cost` stops at the limit (marked partial)
- [ ] Review CLI records verdicts; false confidence updates in the report
- [ ] **Live run (the human decides when, since it costs money):** `npm run eval -- --label live-1 --repeat 1` over all 20 with the real model; report the headline numbers and cost in the INCREMENT REPORT
- [ ] Typecheck, lint, tests pass; CI runs the FakeLlm dry test; PR opened (`Closes #<issue>`)

### CRITICAL — REMINDER ###
**MANDATORY:** Same scenarios, model, and image for B1/B2/B3. Results file first, tables generated from it. Exclusions, partial runs, and failures always shown. "Passed validation" ≠ "correct" until reviewed. Cost estimate + confirmation before live runs. Decisions → `docs/decisions/inc16.md`. End with the **INCREMENT 16 REPORT** and open the PR.
