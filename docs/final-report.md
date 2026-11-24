# Final report — Self-Maintaining APIs

The system detects breaking OpenAPI changes, locates affected TypeScript call sites, attempts bounded repairs, validates patches in an isolated container, and opens a PR for human review.

The [architecture](architecture.md) separates pure core algorithms, server orchestration and adapters, and the five-view dashboard. Confirmed mappings gate repair; four cheat guards and a token ceiling constrain attempts. Delivery never merges a PR.

## Evaluation evidence

No evaluation report selected. Re-run `npm run report:final -- eval/results/<label>/report.md` after the reviewed study is available.

<!-- BEGIN GENERATED EVALUATION REPORT -->
PENDING: Increment 16 evaluation and named human semantic reviews have not been included. No model repair rate or cost conclusion is claimed.
<!-- END GENERATED EVALUATION REPORT -->

## Failures, limitations and deferred work

The acceptance records distinguish observed passes, failures and unexecuted checks. Scripted model answers test plumbing, not model quality. A validation pass is not semantic correctness; named human review is required to measure false confidence.

Static location supports documented fetch/Axios patterns; dynamic URLs and unsupported patterns remain coverage limits. Repair requires a confirmed mapping and cannot safely infer undocumented semantics. Validation is limited to the consumer tests and compile checks.

See [SRS §7.4](SRS.md) for deferred scope, [acceptance records](acceptance/README.md) and [unit-test evidence](unit-tests.md). Final submission still requires review of the evidence, a GitHub Network screenshot and a team-created presentation.
