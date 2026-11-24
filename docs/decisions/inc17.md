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
