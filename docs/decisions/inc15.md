# Increment 15 decisions — 2026-11-23

## Critical checkpoint (recorded before implementation or scenario runs)

Failure signs: tests pass after the change; labels are created after system runs;
a frozen folder's hash changes; fewer than five cases exist in a category; an
endpoint without a replacement is treated as repairable.

Rollback point: merged main `149c7cc18647420f7448de12ad9103fe42704f85`.
Rollback by reverting this increment's commits; preserve teammates' later work.

## Design

- Commit all twenty independently authored semantic labels before running detection,
  classification, location, or validation. The builder never writes labels.
- Use standalone trusted TypeScript consumers and MSW fixtures derived from OpenAPI
  examples. Freeze all source bytes, including labels, tests, and lockfiles.
- Verify copies, never the frozen source directories. Default to the existing inc08
  Docker sandbox; explicit host mode is only for authoring these trusted consumers.
- Export integrity checks for inc16 to use before every baseline. A hash mismatch
  excludes the scenario and fails the verifier; rebuilding is an explicit re-freeze.
- Local Docker/PostgreSQL are unavailable; use GitHub CI for those checks, as requested.
