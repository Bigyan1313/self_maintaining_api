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
