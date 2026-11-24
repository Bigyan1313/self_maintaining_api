The frozen cohort contains twenty authored TypeScript consumers, five per category, including
three endpoint removals without replacements. It is not a random sample of production API
changes. Detection labels are matched one-to-one by operation, category, classification, and
field/parameter identity; mapping confirmation is enforced independently by the pipeline.
B1 has no detector and its precision/recall are unavailable. B2 and B3 share the same detector.
A scenario with zero or multiple breaking detections is reported as needing review rather
than choosing a ground-truth change to make the result look better.

Passing tests do not establish semantic correctness. Every passing B2/B3 patch requires a
named human review. Until then, repair rates mean only passed validation, false-confidence rates
are unavailable, and unreviewed patches appear explicitly. Fixture-mode results exercise
infrastructure with scripted successes, rejections and refusals; they measure no model ability.

Model behavior can vary between repeats. Container timings include installation and validator
setup and depend on caches and host resources; admission checks are outside trial timings.
Interrupted provider requests may have been billed; their conservative cost reservations stay
in the budget on resume. Excluded cases and interrupted trials are never counted as successes.
Trials retried after an interruption retain their earlier evidence and cost in the study ledger;
summary rates use completed trials only. No evaluation run publishes a real pull request.
