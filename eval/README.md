# Evaluation (Increment 16)

The runner executes B1 (do nothing), B2 (`single_shot`, one model call, unguarded scoring), and
B3 (the guarded orchestrator with delivery in dry-run mode). No evaluation publishes a PR.
All baselines share frozen inputs, model configuration and the pinned validator image.
Generated patches only run in Docker.

## Environment and setup

Use Node 22 LTS (`.nvmrc`); the validator image contains Node 22.23.4. Record the
exact host Node version from results.json. Use PostgreSQL 16 from `docker-compose.yml`,
oasdiff **1.35.0**, and the exact dependencies in `package-lock.json`. Follow the root README's
pinned oasdiff installation instructions. Docker must be running and must be able to pull:

```
node:22-bookworm-slim@sha256:4b150b48b4116e2a22f2c39cc27025fbf4f153e2078fd3b14d159fdb5c7279da
```

From the repository root:

```sh
npm ci
npm run consumer:install
npm run db:up
npm run db:migrate
npm run eval -- --label dry-1 --fake
npx tsx eval/check-dry.ts dry-1
npm run eval:report -- --label dry-1
```

The dry test uses the real detector, database, orchestrator and Docker validator. Only the
model is replaced by `FakeLlmAdapter`: one scripted rename pass, one suppression attempt,
and explicit refusals elsewhere. It tests infrastructure, **not model accuracy**. CI runs
all twenty scenarios and retains the results/report as an artifact. The twenty scenarios
are always hash-checked; admission verifies the frozen Git snapshot and runs the original
before/after tests in the sandbox. Detector mistakes are scored, not excluded at admission.

## Paid evaluation

Set `ANTHROPIC_API_KEY` and the exact `LLM_MODEL` in the ignored root `.env`. The current
repository pricing configuration lists `claude-sonnet-5-5`, at $2/M input and $10/M output
tokens; these are the declared study rates from `config/llm-pricing.json`, not a price quote.
The environment snapshot records those rates and the model id. Every call uses the existing
single provider adapter. Never put keys in commands, results, or review notes.

```sh
npm run eval -- --label live-1 --repeat 1 --max-cost 5
```

The script shows a cost estimate and requires typing `yes`. Noninteractive execution requires
an explicit `--yes`. With all twenty scenarios and B2/B3 selected, the estimate assumes at
most 100 calls, 8,000 input tokens and 4,096 output tokens per call: $0–$5.70 at the declared
rates (three repeats: $0–$17.09). Actual context lengths vary. `--max-cost 5` is the default
spending ceiling, not a promise that the complete study fits within $5.

Before each call, a conservative token/cost reservation must fit the remaining budget; the
reservation is saved **before** the provider is contacted. It uses UTF-8 input bytes plus an
8,192-token protocol allowance, and the maximum output tokens. An unanswered request retains
its reservation because billing is uncertain. No further model call starts when it would
exceed the budget. The run stays partial with its completed evidence intact.

```sh
npm run eval -- --label live-1 --resume --max-cost 10
npm run eval -- --label stability-1 --repeat 3 --max-cost 20
npm run eval -- --label selected-1 --baselines B1,B3 --scenarios rename-shop-flat --max-cost 1
```

Resume requires the original manifest, Git commit, Node version, detector version, image and
model. It preserves the selected matrix and completed trials; increasing the budget does
not imply approval until the live confirmation is answered. SIGINT/SIGTERM stop at the next
safe boundary. A hard kill leaves the durable snapshot marked partial; `--resume` reclaims
a dead local process lock and reruns unfinished trials. Do not share a result directory
between machines while a writer is active.

## Review and reporting

```sh
npm run eval:review -- --label live-1 --name 'Reviewer name'
npm run eval:report -- --label live-1
```

The review CLI shows the scenario, migration note and exact patch for each unreviewed B2/B3
validation pass, then records `correct`/`incorrect`, a required note, name and timestamp.
No-replacement patches are automatically incorrect, even when tests pass. Reports explicitly
show pending reviews and false confidence. SRS repair rates mean **passed validation**, not
semantic correctness. Cost/time-per-repair and attempt distributions use validation passes;
human-reviewed correctness is reported separately.

`eval/results/<label>/results.json` (schema version 1) is written atomically first, then mirrored
to `evaluation_studies` and the per-trial `evaluation_results` rows in PostgreSQL. Repetitions
are keyed separately. A failed mirror does not destroy the file; resume or review repairs it.
`report.md` is regenerated from that saved file plus `eval/limitations.md`; no table is entered
by hand. `GET /api/results` returns the latest persisted study and the same metrics;
`GET /api/results?label=<name>` selects one. The response includes the full `study` evidence
alongside the existing dashboard rows/summaries/failures contract.

Completed results can still contain exclusions or failures. Every exclusion has a reason,
partial executions carry a banner, selected subsets are explicitly labeled, and repeat
outcome changes are listed. Report null rates mean there is no denominator or review is
pending. Timing records distinguish model time from validation/container time (including
installation); admission checks are outside trial timing. Interrupted trial evidence stays
in the JSON, while aggregate rates use completed trials only.

## Validation

```sh
npm run typecheck
npm run lint
npm test
npm run eval -- --label acceptance-fake --fake
npx tsx eval/check-dry.ts acceptance-fake
```

Live results and named human semantic reviews require a separate operator decision. The
implementation's fake results are never presented as the final empirical study.
