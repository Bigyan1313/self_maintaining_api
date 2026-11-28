# Increment 17 decisions — 2026-11-23

- Start from merged main e7b16bb, after inc13/14/15. Issue #14 is assigned to Sishir.
- Refresh stale inc17a diagrams and architecture from actual code, including retry delivery
  as a new run rather than an edit to terminal history.
- Acceptance output must come from executions. Controlled external adapters are identified
  as such; they do not establish live-model quality or live GitHub delivery.
- All twelve AT records are generated. Unavailable evaluation/manual evidence is recorded
  explicitly rather than counted as a pass.
- Evaluation is owned by Bigyan in PR #33. Do not duplicate or merge that work. The final
  report imports a selected generated evaluation report verbatim only when present locally.
  Missing evaluation evidence prevents a final submission; an explicit draft may list gaps.
- The Network screenshot and finished presentation remain named human tasks. The packaging
  command must distinguish a review draft from a final submission and scan archived bytes.

- The archive's final mode uses fetched `origin/main`; explicit draft mode uses the branch HEAD and labels the manifest and filename DRAFT. This lets reviewers inspect unmerged deliverables without claiming they are the submitted main build.
- Credential-shaped security-test fixtures are assembled from string pieces, preserving their runtime values while allowing a strict byte scan of source archives. The scanner requires a token boundary to avoid mistaking an embedded cache-path substring for a key. No credential scan exceptions are made for source/test directories.
- All twelve acceptance checks produce records. Controlled regression suites are supplementary evidence; missing live/provider and reviewed-study portions remain PARTIAL, never silently PASS.

- 2026-11-24: merged latest main, including Increment 16. Import its committed `inc16-verified` report verbatim with its FAKE MODEL warning intact; this is not a reviewed model study. CI imports its freshly generated `ci-fake` report.
- Chromium rendering on the ephemeral GitHub runner needs `--no-sandbox` because its Linux image blocks Chromium user namespaces. This applies only to diagram/transcript rendering in CI, not the Docker validation sandbox or local browser defaults.
- The original checkout reported truncated Git packfiles. Continue in a fresh clone under `/private/tmp/sma-inc17-clean`, preserving the original checkout and copying only this task's uncommitted documentation changes.

- 2026-11-28 (Bigyan, completing Sishir's branch): merged `origin/main` at dcca17c (PR #34) with a merge commit. No conflicts; main's rename `inc16-bibek.txt` → `inc16-bigyan.txt` was kept and nothing on this branch referenced the old name.
- 2026-11-28: **AT-12 checks the real study instead of an always-skipped item.** `scripts/acceptance/study-evidence.ts` reads `eval/results/$SMA_EVAL_LABEL/results.json`, validates it against `EvaluationStudySchema`, and records four conditions: live (not `fake`), complete (`status: complete`, all scenarios and B1/B2/B3, no unfinished or in-flight trial), 3 repeats (configured and present), and a named human review on every completed B2/B3 validation pass. Each condition that holds is a passed assertion; each that does not is a NOT RUN item stating exactly what is missing, so AT-12 is PARTIAL — not FAIL, and never PASS — until the reviewed live study exists. An unset/invalid label or a missing/malformed file marks all four as missing. **Why:** the previous fixed skip made PASS impossible even with complete evidence; a passing record must come from inspecting the actual results file (SRS Appendix A). AT-06/08/10 keep their stated limitation because their missing parts (live model, live PR, live provider) are not established by any committed artifact.
- 2026-11-28: **The final submission allows PARTIAL acceptance records but lists them.** `acceptance_gate` in `scripts/deliverables/submission.py` blocks a final archive on a missing summary, any FAIL or unknown verdict, a missing/extra/duplicate AT record, evidence whose commit is not `origin/main`, or a PARTIAL that `docs/final-report.md` does not list with its reason. PARTIAL checks are written, verdict unchanged, to `MANIFEST.json` (`partialAcceptance`: id, title, verdict, reason); `npm run report:final` writes the same list from `summary.json` into a "Acceptance checks recorded PARTIAL" section. **Why:** requiring 12 PASS made `npm run submission` impossible because some Appendix A portions (live provider, live PR) cannot be executed in this environment; the honest alternative to faking them is to submit with each gap named in both places a grader reads. The `meta.dirty` flag is not gated on, because it only excludes `docs/acceptance` and regenerated diagrams/unit-test docs would set it; the packager already requires HEAD = `origin/main` and a clean source tree.
