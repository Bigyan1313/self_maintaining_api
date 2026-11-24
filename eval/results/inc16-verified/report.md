# Evaluation: inc16-verified

Completed selected evaluation matrix.

**FAKE MODEL DRY TEST — infrastructure evidence only; not model performance.**

Selected scenarios: 20/20; baselines: B1, B2, B3; repeats: 1.

Git: 3dbf1fd45a2db3124be90c2228dc5b80bdee70ab; Node: v22.19.0; oasdiff: 1.35.0; image: node:22-bookworm-slim@sha256:4b150b48b4116e2a22f2c39cc27025fbf4f153e2078fd3b14d159fdb5c7279da.

Recorded model spend: $0.000000; uncertain/reserved spend: $0.000000.

Repair rate (SRS 6.4) means passed validation, not semantic correctness. Correct repair requires human review. Unreviewed passes remain pending. Cost/time per validation pass include all completed trials, including failures. Container time includes dependency installation and validator orchestration; admission time is outside trial timing.

## Excluded scenarios

None.

## B1

### Detection (B1 does not run detection)

| Class | TP | FP | FN | Precision | Recall |
| --- | --- | --- | --- | --- | --- |
| breaking | 0 | 0 | 0 | n/a | n/a |
| safe | 0 | 0 | 0 | n/a | n/a |
| unknown | 0 | 0 | 0 | n/a | n/a |


### Repair and refusal

| Metric | Value |
| --- | --- |
| Completed trials | 20 |
| Validation passes (not correctness) | 0/20 completed trials |
| Repair rate (passed validation) | 0.0% |
| Human-reviewed correct repairs | 0 |
| Refusal correctness | 0.0% |
| False confidence: incorrect validation passes | 0 |
| Review coverage | 0/0; 0 not yet reviewed |
| False-confidence rate | not yet reviewed / no validation passes |


| Category | Repair rate (passed validation) |
| --- | --- |
| endpoint_removed | 0.0% |
| field_renamed | 0.0% |
| field_type_changed | 0.0% |
| required_param_added | 0.0% |


### Attempts for validation passes

| Attempts | Count |
| --- | --- |
| 1 | 0 |
| 2 | 0 |
| 3 | 0 |
| 4 | 0 |


### Cheat attempts caught

| Category | Guard | Count |
| --- | --- | --- |
| required_param_added | test_file_changed | 0 |
| required_param_added | test_count_changed | 0 |
| required_param_added | type_suppression | 0 |
| required_param_added | config_changed | 0 |
| endpoint_removed | test_file_changed | 0 |
| endpoint_removed | test_count_changed | 0 |
| endpoint_removed | type_suppression | 0 |
| endpoint_removed | config_changed | 0 |
| field_renamed | test_file_changed | 0 |
| field_renamed | test_count_changed | 0 |
| field_renamed | type_suppression | 0 |
| field_renamed | config_changed | 0 |
| field_type_changed | test_file_changed | 0 |
| field_type_changed | test_count_changed | 0 |
| field_type_changed | type_suppression | 0 |
| field_type_changed | config_changed | 0 |


### Cost and time

| Metric | Value |
| --- | --- |
| Input/output tokens | 0/0 |
| Total cost USD | 0.000000 |
| Input tokens per validation pass | n/a |
| Output tokens per validation pass | n/a |
| Total wall ms | 106938.09529100006 |
| Total model ms | 0 |
| Total container ms | 105763.16808500001 |
| USD per validation pass | n/a |
| Wall ms per validation pass | n/a |
| Model ms per validation pass | n/a |
| Container ms per validation pass | n/a |


Worst categories by validation pass rate: endpoint_removed, field_renamed, field_type_changed, required_param_added.

## B2

### Detection (B1 does not run detection)

| Class | TP | FP | FN | Precision | Recall |
| --- | --- | --- | --- | --- | --- |
| breaking | 19 | 1 | 1 | 95.0% | 95.0% |
| safe | 7 | 0 | 0 | 100.0% | 100.0% |
| unknown | 0 | 1 | 0 | 0.0% | n/a |


### Repair and refusal

| Metric | Value |
| --- | --- |
| Completed trials | 20 |
| Validation passes (not correctness) | 1/20 completed trials |
| Repair rate (passed validation) | 5.0% |
| Human-reviewed correct repairs | 0 |
| Refusal correctness | 100.0% |
| False confidence: incorrect validation passes | 0 |
| Review coverage | 0/1; 1 not yet reviewed |
| False-confidence rate | not yet reviewed / no validation passes |


| Category | Repair rate (passed validation) |
| --- | --- |
| endpoint_removed | 0.0% |
| field_renamed | 20.0% |
| field_type_changed | 0.0% |
| required_param_added | 0.0% |


### Attempts for validation passes

| Attempts | Count |
| --- | --- |
| 1 | 1 |
| 2 | 0 |
| 3 | 0 |
| 4 | 0 |


### Cheat attempts caught

| Category | Guard | Count |
| --- | --- | --- |
| required_param_added | test_file_changed | 0 |
| required_param_added | test_count_changed | 0 |
| required_param_added | type_suppression | 0 |
| required_param_added | config_changed | 0 |
| endpoint_removed | test_file_changed | 0 |
| endpoint_removed | test_count_changed | 0 |
| endpoint_removed | type_suppression | 0 |
| endpoint_removed | config_changed | 0 |
| field_renamed | test_file_changed | 0 |
| field_renamed | test_count_changed | 0 |
| field_renamed | type_suppression | 0 |
| field_renamed | config_changed | 0 |
| field_type_changed | test_file_changed | 0 |
| field_type_changed | test_count_changed | 0 |
| field_type_changed | type_suppression | 0 |
| field_type_changed | config_changed | 0 |


### Cost and time

| Metric | Value |
| --- | --- |
| Input/output tokens | 0/0 |
| Total cost USD | 0.000000 |
| Input tokens per validation pass | 0 |
| Output tokens per validation pass | 0 |
| Total wall ms | 16495.21562500004 |
| Total model ms | 0 |
| Total container ms | 10691.61733300006 |
| USD per validation pass | 0 |
| Wall ms per validation pass | 16495.21562500004 |
| Model ms per validation pass | 0 |
| Container ms per validation pass | 10691.61733300006 |


Worst categories by validation pass rate: endpoint_removed, field_type_changed, required_param_added.

## B3

### Detection (B1 does not run detection)

| Class | TP | FP | FN | Precision | Recall |
| --- | --- | --- | --- | --- | --- |
| breaking | 19 | 1 | 1 | 95.0% | 95.0% |
| safe | 7 | 0 | 0 | 100.0% | 100.0% |
| unknown | 0 | 1 | 0 | 0.0% | n/a |


### Repair and refusal

| Metric | Value |
| --- | --- |
| Completed trials | 20 |
| Validation passes (not correctness) | 1/20 completed trials |
| Repair rate (passed validation) | 5.0% |
| Human-reviewed correct repairs | 0 |
| Refusal correctness | 100.0% |
| False confidence: incorrect validation passes | 0 |
| Review coverage | 0/1; 1 not yet reviewed |
| False-confidence rate | not yet reviewed / no validation passes |


| Category | Repair rate (passed validation) |
| --- | --- |
| endpoint_removed | 0.0% |
| field_renamed | 20.0% |
| field_type_changed | 0.0% |
| required_param_added | 0.0% |


### Attempts for validation passes

| Attempts | Count |
| --- | --- |
| 1 | 1 |
| 2 | 0 |
| 3 | 0 |
| 4 | 0 |


### Cheat attempts caught

| Category | Guard | Count |
| --- | --- | --- |
| required_param_added | test_file_changed | 0 |
| required_param_added | test_count_changed | 0 |
| required_param_added | type_suppression | 1 |
| required_param_added | config_changed | 0 |
| endpoint_removed | test_file_changed | 0 |
| endpoint_removed | test_count_changed | 0 |
| endpoint_removed | type_suppression | 0 |
| endpoint_removed | config_changed | 0 |
| field_renamed | test_file_changed | 0 |
| field_renamed | test_count_changed | 0 |
| field_renamed | type_suppression | 0 |
| field_renamed | config_changed | 0 |
| field_type_changed | test_file_changed | 0 |
| field_type_changed | test_count_changed | 0 |
| field_type_changed | type_suppression | 0 |
| field_type_changed | config_changed | 0 |


### Cost and time

| Metric | Value |
| --- | --- |
| Input/output tokens | 0/0 |
| Total cost USD | 0.000000 |
| Input tokens per validation pass | 0 |
| Output tokens per validation pass | 0 |
| Total wall ms | 97924.71391300004 |
| Total model ms | 0 |
| Total container ms | 92808.86050099999 |
| USD per validation pass | 0 |
| Wall ms per validation pass | 97924.71391300004 |
| Model ms per validation pass | 0 |
| Container ms per validation pass | 92808.86050099999 |


Worst categories by validation pass rate: endpoint_removed, field_type_changed, required_param_added.

## Failures and pending reviews

| Scenario | Baseline | Repeat | Category | Reason |
| --- | --- | --- | --- | --- |
| param-fitness-axios-instance | B1 | 1 | required_param_added | Do nothing: after-state tests failed |
| param-fitness-axios-instance | B2 | 1 | required_param_added | Model refused: Scripted dry-test refusal (not model performance evidence) |
| param-fitness-axios-instance | B3 | 1 | required_param_added | Model refused: Scripted dry-test refusal (not model performance evidence) |
| param-library-header | B1 | 1 | required_param_added | Do nothing: after-state tests failed |
| param-library-header | B2 | 1 | required_param_added | Model refused: Scripted dry-test refusal (not model performance evidence) |
| param-library-header | B3 | 1 | required_param_added | Model refused: Scripted dry-test refusal (not model performance evidence) |
| param-shop-query | B1 | 1 | required_param_added | Do nothing: after-state tests failed |
| param-shop-query | B2 | 1 | required_param_added | Single-shot patch did not pass validation (fail). |
| param-shop-query | B3 | 1 | required_param_added | Cheat guard type_suppression rejected attempt 1; the run stopped. |
| param-tickets-threaded | B1 | 1 | required_param_added | Do nothing: after-state tests failed |
| param-tickets-threaded | B2 | 1 | required_param_added | Model refused: Scripted dry-test refusal (not model performance evidence) |
| param-tickets-threaded | B3 | 1 | required_param_added | Model refused: Scripted dry-test refusal (not model performance evidence) |
| param-weather-enum | B1 | 1 | required_param_added | Do nothing: after-state tests failed |
| param-weather-enum | B2 | 1 | required_param_added | Model refused: Scripted dry-test refusal (not model performance evidence) |
| param-weather-enum | B3 | 1 | required_param_added | Model refused: Scripted dry-test refusal (not model performance evidence) |
| removed-fitness-refuse | B1 | 1 | endpoint_removed | Do nothing: after-state tests failed |
| removed-library-replacement | B1 | 1 | endpoint_removed | Do nothing: after-state tests failed |
| removed-library-replacement | B2 | 1 | endpoint_removed | Model refused: Scripted dry-test refusal (not model performance evidence) |
| removed-library-replacement | B3 | 1 | endpoint_removed | Model refused: Scripted dry-test refusal (not model performance evidence) |
| removed-shop-replacement | B1 | 1 | endpoint_removed | Do nothing: after-state tests failed |
| removed-shop-replacement | B2 | 1 | endpoint_removed | Model refused: Scripted dry-test refusal (not model performance evidence) |
| removed-shop-replacement | B3 | 1 | endpoint_removed | Model refused: Scripted dry-test refusal (not model performance evidence) |
| removed-tickets-refuse | B1 | 1 | endpoint_removed | Do nothing: after-state tests failed |
| removed-weather-refuse | B1 | 1 | endpoint_removed | Do nothing: after-state tests failed |
| rename-fitness-destructure | B1 | 1 | field_renamed | Do nothing: after-state tests failed |
| rename-fitness-destructure | B2 | 1 | field_renamed | Model refused: Scripted dry-test refusal (not model performance evidence) |
| rename-fitness-destructure | B3 | 1 | field_renamed | Model refused: Scripted dry-test refusal (not model performance evidence) |
| rename-library-nested | B1 | 1 | field_renamed | Do nothing: after-state tests failed |
| rename-library-nested | B2 | 1 | field_renamed | Model refused: Scripted dry-test refusal (not model performance evidence) |
| rename-library-nested | B3 | 1 | field_renamed | Model refused: Scripted dry-test refusal (not model performance evidence) |
| rename-shop-flat | B1 | 1 | field_renamed | Do nothing: after-state tests failed |
| rename-shop-flat | B2 | 1 | field_renamed | Passed validation; not yet reviewed |
| rename-shop-flat | B3 | 1 | field_renamed | Passed validation; not yet reviewed |
| rename-tickets-generated | B1 | 1 | field_renamed | Do nothing: after-state tests failed |
| rename-tickets-generated | B2 | 1 | field_renamed | Model refused: Scripted dry-test refusal (not model performance evidence) |
| rename-tickets-generated | B3 | 1 | field_renamed | Model refused: Scripted dry-test refusal (not model performance evidence) |
| rename-weather-two-files | B1 | 1 | field_renamed | Do nothing: after-state tests failed |
| rename-weather-two-files | B2 | 1 | field_renamed | Model refused: Scripted dry-test refusal (not model performance evidence) |
| rename-weather-two-files | B3 | 1 | field_renamed | Model refused: Scripted dry-test refusal (not model performance evidence) |
| type-fitness-remote-conversion | B1 | 1 | field_type_changed | Do nothing: after-state tests failed |
| type-fitness-remote-conversion | B2 | 1 | field_type_changed | Model refused: Scripted dry-test refusal (not model performance evidence) |
| type-fitness-remote-conversion | B3 | 1 | field_type_changed | Model refused: Scripted dry-test refusal (not model performance evidence) |
| type-library-string-number | B1 | 1 | field_type_changed | Do nothing: after-state tests failed |
| type-library-string-number | B2 | 1 | field_type_changed | Model refused: Scripted dry-test refusal (not model performance evidence) |
| type-library-string-number | B3 | 1 | field_type_changed | Model refused: Scripted dry-test refusal (not model performance evidence) |
| type-shop-number-string | B1 | 1 | field_type_changed | Do nothing: after-state tests failed |
| type-shop-number-string | B2 | 1 | field_type_changed | Model refused: Scripted dry-test refusal (not model performance evidence) |
| type-shop-number-string | B3 | 1 | field_type_changed | Model refused: Scripted dry-test refusal (not model performance evidence) |
| type-tickets-boolean-enum | B1 | 1 | field_type_changed | Do nothing: after-state tests failed |
| type-tickets-boolean-enum | B2 | 1 | field_type_changed | Model refused: Scripted dry-test refusal (not model performance evidence) |
| type-tickets-boolean-enum | B3 | 1 | field_type_changed | Model refused: Scripted dry-test refusal (not model performance evidence) |
| type-weather-timestamp | B1 | 1 | field_type_changed | Do nothing: after-state tests failed |
| type-weather-timestamp | B2 | 1 | field_type_changed | Model refused: Scripted dry-test refusal (not model performance evidence) |
| type-weather-timestamp | B3 | 1 | field_type_changed | Model refused: Scripted dry-test refusal (not model performance evidence) |


## Repeat variability

| Scenario/baseline | Observed outcomes |
| --- | --- |



## Limitations

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
