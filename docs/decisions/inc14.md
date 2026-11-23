# Increment 14 decisions — 2026-11-23

- Implement issue #11 from merged main including inc13 (`e658720`). Use an isolated
  worktree to preserve unrelated duplicate files in the user's original checkout.
- All normal requests use the shared API contract and real merged endpoints.
  `VITE_USE_MOCKS=true` mocks only `/api/results` pending inc16. Full API fixtures
  require a separate explicit E2E flag and are visibly labeled; production starts no mocks.
- Add optional server-computed evaluation summaries to ResultsSchema. Existing
  `{label, results}` responses still parse. The browser never computes evaluation metrics;
  missing summaries are displayed as not reported. Document this additive contract in the PR.
- Keep credentials server-side: forms accept an environment variable name only.
- Use semantic tables, shared enum labels, native keyboard-accessible dialog and
  React Router. Poll running runs; show stale/error states rather than hiding failures.
- Pin Playwright, React Router, and MSW versions. Save mock-mode screenshots for every
  page and mapping dialog, and provide a real-server browser smoke suite separately.
- Results also accepts an optional server-scored `failures` list. Inferring failure
  from a refusal in the UI would be wrong for the three intentional refusal cases.
- Export via validated fetch + Blob download: the UI can display HTTP/contract failures,
  and MSW can exercise exactly the same code path in browser tests.
- The real-server browser test waits for a terminal flagged run and asserts no attempts
  and no PR. It exercises real persistence/detection/location without external model cost.
