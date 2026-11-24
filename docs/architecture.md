# Architecture — Self-Maintaining APIs

This describes the merged core, server, dashboard and frozen scenarios through Increment 15.
The evaluation implementation remains tracked in PR #33 until merged. Each link goes to a real file. `npm run docs:check` checks every link in this
file.

- Class diagram: [diagrams/class-diagram.md](diagrams/class-diagram.md)
- Statecharts: [diagrams/statecharts.md](diagrams/statecharts.md)
- Requirements: [SRS.md](SRS.md)

---

## 1. Package structure and the MVC mapping

The repository is one npm-workspaces monorepo ([package.json](../package.json)), written in
TypeScript (strict), on Node 22.

| Folder                                                       | What it holds                                                                                                     | MVC role                               |
| ------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------- | -------------------------------------- |
| [packages/core](../packages/core/src)                        | Pure domain logic: parse, normalize, classify, locate, guards, prompt building                                    | **Model**                              |
| [apps/server/src/infra/db](../apps/server/src/infra/db)      | Drizzle schema, the SQL migrations, one small repository module per table                                         | **Model** (persistence)                |
| [apps/server/src/http](../apps/server/src/http)              | Fastify routes: parse the request, call a pipeline stage, label the reply                                         | **Controller**                         |
| [apps/server/src/pipeline](../apps/server/src/pipeline)      | One module per pipeline stage. Each joins core logic, adapters and the database                                   | **Controller**                         |
| [apps/server/src/infra](../apps/server/src/infra) (not `db`) | Adapters for the outside world: oasdiff, file system, URL retrieval, Docker, git working copies, the LLM provider | Infrastructure, used by the Controller |
| [apps/web](../apps/web/src)                                  | React + Vite dashboard. Today it shows only the server health. The 5 views come in inc 14                         | **View**                               |
| [demo/api](../demo/api)                                      | The demo REST API at v1 and v2, its OpenAPI specs and the migration note                                          | Test material                          |
| [demo/consumer](../demo/consumer)                            | A small TypeScript repo that calls the demo API. Its tests pass on v1 and fail on v2                              | Test material                          |

The wire contract (request and response shapes, with zod) lives in core,
[packages/core/src/api/contract.ts](../packages/core/src/api/contract.ts), so the server and the
dashboard share one definition. The shared enums and their text labels live in
[packages/core/src/domain/enums.ts](../packages/core/src/domain/enums.ts). The database enums are
built from the same arrays ([schema.ts](../apps/server/src/infra/db/schema.ts)), so a stored value
can't drift from the code.

### C-05: keeping domain logic, HTTP and presentation apart

- `packages/core` never imports from `apps/*`, and it never touches the network, Docker, child
  processes, the file system or the LLM. The test
  [packages/core/src/boundaries.test.ts](../packages/core/src/boundaries.test.ts) enforces this.
  It scans every non-test source file in core and fails on any import of `child_process`, `net`,
  `http(s)`, `fs`, `@sma/server`, `@sma/web`, `apps/`, `axios`, `@octokit/*` or
  `@anthropic-ai/*`, and on any `fetch(` call.
- When core needs outside data, the caller passes it in. `locateCallSites` reads files through a
  `RepoReader` interface ([limits.ts](../packages/core/src/repo/limits.ts)). The real reader is in
  infra ([reader.ts](../apps/server/src/infra/repo/reader.ts)). The oasdiff JSON is produced by an
  infra runner and then parsed by pure code in core.
- **C-06:** only [apps/server/src/infra/llm/adapter.ts](../apps/server/src/infra/llm/adapter.ts)
  may import `@anthropic-ai/sdk`. An ESLint rule in [eslint.config.mjs](../eslint.config.mjs)
  blocks every other import, re-export, dynamic import and `require`. The test
  [llm-boundary.test.ts](../apps/server/test/llm-boundary.test.ts) checks that the rule fires.
- The HTTP routes contain no domain decisions. They validate the input with the zod contract,
  call a pipeline function, and add text labels to the stored enum values (FR-42).

---

## 2. The 7-stage pipeline

Each stage writes its result to the database before the next one starts (FR-38). Run records are
append-only (FR-39).

| #   | Stage    | Code                                                                                                                                                                                                                          | Status             |
| --- | -------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------ |
| 1   | Ingest   | [pipeline/ingest.ts](../apps/server/src/pipeline/ingest.ts), [core ingest/spec.ts](../packages/core/src/ingest/spec.ts)                                                                                                       | Built (inc 04)     |
| 2   | Detect   | [pipeline/detect.ts](../apps/server/src/pipeline/detect.ts), [infra/oasdiff/runner.ts](../apps/server/src/infra/oasdiff/runner.ts), [core detect/parse.ts](../packages/core/src/detect/parse.ts)                              | Built (inc 05)     |
| 3   | Classify | [pipeline/classify.ts](../apps/server/src/pipeline/classify.ts), [core classify/classify.ts](../packages/core/src/classify/classify.ts)                                                                                       | Built (inc 06)     |
| 4   | Locate   | [pipeline/locate.ts](../apps/server/src/pipeline/locate.ts), [core locate/analyze.ts](../packages/core/src/locate/analyze.ts)                                                                                                 | Built (inc 07)     |
| 5   | Repair   | [pipeline/repair.ts](../apps/server/src/pipeline/repair.ts), adapter and bounded context                                                                                                                                      | Built (inc 11)     |
| 6   | Validate | [pipeline/validate.ts](../apps/server/src/pipeline/validate.ts), [pipeline/guarded-validate.ts](../apps/server/src/pipeline/guarded-validate.ts), [infra/validator/sandbox.ts](../apps/server/src/infra/validator/sandbox.ts) | Built (inc 08, 09) |
| 7   | Deliver  | [pipeline/deliver.ts](../apps/server/src/pipeline/deliver.ts), GitHub port and PR body                                                                                                                                        | Built (inc 12)     |

The [orchestrator](../apps/server/src/pipeline/orchestrator.ts) coordinates the stages,
records their results before proceeding, serializes active work, and preserves terminal runs.
The dashboard calls HTTP routes; direct stage functions also support isolated acceptance checks.

**The rule that is never broken (BR-04, C-04):** Repair runs only for a change whose old→new
mapping is confirmed by a migration note or a human. Today this is enforced in two places:
`buildRepairContext` refuses to build a prompt for a change that is not breaking or not
confirmed, and the database requires a confirmed change to name its source
(`changes_confirmed_iff_source`).

---

## 3. Database tables and the rules the database enforces

PostgreSQL 16 in Docker ([docker-compose.yml](../docker-compose.yml), image pinned by digest).
Schema: [apps/server/src/infra/db/schema.ts](../apps/server/src/infra/db/schema.ts). Migrations:
[0000_init_schema.sql](../apps/server/drizzle/0000_init_schema.sql) and
[0001_append_only_triggers.sql](../apps/server/drizzle/0001_append_only_triggers.sql).

| Table                | Holds                                             | Rules the database enforces                                                                                                                                                                                                         |
| -------------------- | ------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `repositories`       | Consumer repos                                    | Unique (owner, name). `credential_ref` must look like an env var NAME (`^[A-Z_][A-Z0-9_]*$`), never a secret (NFR-04)                                                                                                               |
| `apis`               | Monitored APIs and their current baseline version | Unique name. Poll interval NULL or ≥ 60 s (FR-12)                                                                                                                                                                                   |
| `spec_versions`      | Each distinct normalized spec                     | Unique (api, sha256) (FR-05). Hash is 64 hex chars. **Append-only**                                                                                                                                                                 |
| `spec_checks`        | Every check, including failed ones                | A `failed` check must have `error_detail` (FR-11)                                                                                                                                                                                   |
| `migration_notes`    | Raw YAML + parsed note for a version pair         | Foreign keys to both versions                                                                                                                                                                                                       |
| `changes`            | One classified difference with its evidence       | Confidence in [0, 1] (FR-07). `confirmed` ⇔ a mapping source is set (FR-10). A `human` source needs `confirmed_by` and `confirmed_at`. From ≠ to version. No delete. An update may change **only** the mapping-confirmation columns |
| `runs`               | One analysis of one change on one commit          | `running` ⇔ `finished_at` IS NULL. `stage_failure` needs `failure_stage`. 0–4 attempts (DR-03). Commit SHA format. No delete. **A finished run cannot be updated**: a reanalysis is a new run with `parent_run_id` (FR-39)          |
| `run_stage_results`  | The result each stage wrote (FR-38)               | One row per (run, stage). **Append-only**                                                                                                                                                                                           |
| `call_sites`         | Located calls (FR-14)                             | Line and column ≥ 1. **Append-only**                                                                                                                                                                                                |
| `coverage_entries`   | Files inspected or skipped (FR-15)                | A skipped file must have a reason. **Append-only**                                                                                                                                                                                  |
| `attempts`           | Repair attempts                                   | Attempt number 1–4 and unique per run (DR-03). `cheating` ⇔ a guard name is set (DR-04). Passed ≤ total. **Append-only**                                                                                                            |
| `evaluation_results` | Evaluation rows per scenario and baseline         | Unique (label, scenario, baseline). Excluded rows need a reason. 0–4 attempts                                                                                                                                                       |

"Append-only" is enforced by triggers that raise `append-only: …` (SQLSTATE `P0001`) on UPDATE,
DELETE or TRUNCATE. The tests in
[db-append-only.test.ts](../apps/server/test/db-append-only.test.ts) and
[db-constraints.test.ts](../apps/server/test/db-constraints.test.ts) prove each rule against a
real database.

---

## 4. Key algorithms

### 4.1 Spec normalization and hashing

[packages/core/src/ingest/spec.ts](../packages/core/src/ingest/spec.ts)

1. `parseSpec` rejects documents over 5 MiB, then parses JSON or YAML with YAML 1.2, unique
   keys, and at most 100 aliases (this stops "billion laughs" input). It accepts only OpenAPI
   3.0.x or 3.1.x and validates the document against the OpenAPI schema without resolving
   external references.
2. `normalizeSpec` writes canonical JSON: object keys sorted at every level, array order kept,
   no whitespace. It rejects cycles and non-finite numbers.
3. `hashSpec` is the lowercase SHA-256 of that canonical text.
4. `decideCheckOutcome`: no baseline → `baseline_established`. The hash equals the baseline or
   **any** stored version → `no_change`. Otherwise → `changed`.

**Why:** the same API saved as YAML or as JSON, or with its keys in another order, gets the same
hash. So re-uploading a spec never creates a second version (FR-05), and only a real change in
content counts as a change. Before parsing and after normalizing, `ingest` also refuses a spec
that contains something that looks like a credential
([security.ts](../apps/server/src/infra/spec-source/security.ts)). A failed check never moves the
baseline.

### 4.2 oasdiff parsing with JSON pointers

Runner: [apps/server/src/infra/oasdiff/runner.ts](../apps/server/src/infra/oasdiff/runner.ts).
Parser: [packages/core/src/detect/parse.ts](../packages/core/src/detect/parse.ts) and
[pointer.ts](../packages/core/src/detect/pointer.ts).

1. The runner first checks `oasdiff --version` against the pinned version
   ([version.ts](../apps/server/src/infra/oasdiff/version.ts)). It writes both normalized specs to
   a fresh temp folder and runs `oasdiff changelog base.json revision.json --format json
--allow-external-refs=false` with `execFile` (no shell), a timeout and a small environment.
   Errors are typed (`binary_missing`, `version_mismatch`, `timeout`, `bad_output`). stderr is
   never returned, because it can contain spec text.
2. `parseOasdiffChangelog` turns each entry into a `SpecDifference`. From the rule id and the
   message text it builds an **anchor** (operation, parameter, response property, …).
   `resolveAnchor` then follows local `$ref`s in the BEFORE and AFTER documents to find the exact
   place, and `buildJsonPointer` writes it as an RFC 6901 pointer (`~1` for `/`, `~0` for `~`).
3. `extractEvidence` copies the value at that pointer from each document: the before and after
   evidence (FR-08). Unknown rule ids and unknown severity levels are **kept** and marked, never
   dropped. Each difference gets a stable id (SHA-256 of rule, method, path and pointer).

**Why:** a pointer plus the before and after values lets a reviewer check every classification
against the spec text that produced it (FR-08, AT-03). Parsing in pure core code means the parser
is tested on saved oasdiff output, without the binary (NFR-08).

### 4.3 Classification rule table and mapping confirmation (BR-04)

[packages/core/src/classify/rules.ts](../packages/core/src/classify/rules.ts),
[classify.ts](../packages/core/src/classify/classify.ts),
[migration-note/parse.ts](../packages/core/src/migration-note/parse.ts),
[migration-note/validate.ts](../packages/core/src/migration-note/validate.ts). The full table is in
[classification-rules.md](classification-rules.md).

1. `CLASSIFICATION_RULES` maps an oasdiff rule id to (category, breaking/safe, confidence). A
   rule id that is not in the table, an unattributed difference, or an unknown level becomes
   `other` / **unknown** / 0.5. oasdiff's own severity is never used as the verdict.
2. A removed response property that has a sibling **added** property on the same path, method,
   status and media type becomes a `field_renamed` **candidate** with confidence 0.6. It is still
   unconfirmed. Similar names never confirm anything.
3. **Confirmation by migration note:** `findMapping` looks for an entry in the note with the same
   kind, method and path (and the same field or parameter). For a rename, the new name must be one
   of the sibling additions. For an endpoint removal, the entry must name a replacement that is a
   different operation. If any of this fails, there is no mapping.
4. **Confirmation by a human:** `POST /api/changes/:id/confirm-mapping` accepts the mapping only if
   `mappingMatchesEvidence` finds it in the stored BEFORE and AFTER specs (for example, the new
   field really exists in the after spec). It needs a non-empty `confirmedBy`, and only works on
   an unconfirmed change, inside a row lock.
5. An endpoint removed with no documented replacement gets the reason `NO_REPLACEMENT_REASON` and
   stays unconfirmed. Refusing to repair it is the correct answer (BR-05).

**Why:** a spec difference is not proof that two fields mean the same thing (BR-04). Only an
explicit statement (note or human) can unlock repair, and the database repeats the rule
(`changes_confirmed_iff_source`), so a bug in app code can't confirm a mapping by itself.

### 4.4 ts-morph route matching in Locate

[packages/core/src/locate/analyze.ts](../packages/core/src/locate/analyze.ts),
[locate.ts](../packages/core/src/locate/locate.ts), [repo/limits.ts](../packages/core/src/repo/limits.ts).

1. **Select files.** `countRepoSize` walks the repository through `RepoReader`. It skips
   `node_modules`, `.git`, `dist`, `build`, `coverage`, credential and environment files (such as
   `.env`, keys, `.ssh`, `.aws`), declaration files, `*.config.ts` files, files that are not
   TypeScript, and symbolic links (never followed). Each skip is recorded with a reason. Over 200 TypeScript files
   or 20,000 lines → `limitsExceeded`, and no file counts as inspected.
2. **Parse in memory.** All selected files go into an in-memory ts-morph `Project` with
   `noLib`, no tsconfig, and no module resolution from disk. Target code is never run or
   type-checked with its own config.
3. **Find the client.** For each call expression, `client()` follows the symbol's declarations:
   global `fetch`, a default import from `axios` (`axios_static`), a variable made by
   `axios.create(...)` (`axios_instance`, also when imported from another file), or an import of
   the target `operationId` from a path with a `generated` folder (`generated_client`).
   Re-exports, renamed or destructured clients are `reexported_alias`.
4. **Read the URL and method.** The URL must be a string literal or a template. In a template,
   a leading configured base (`${apiBaseUrl()}/…`) is dropped, and each `${…}` after the path has
   started becomes `{}`. It must be a function parameter, or a local constant that is itself a
   plain segment. The method comes from `{ method: 'X' }` (default GET) or the axios method name.
   If the options object has spreads or computed keys, the method is unknown and nothing is
   matched.
5. **Match.** Both paths are normalized (origin, query and fragment removed, `{name}` → `{}`).
   They match when they have the same number of segments and every literal segment is equal.
6. **Verdict.** Any match → `affected`. No match, complete coverage, and no unsupported usage →
   `not_affected` ("Not affected within supported scope", FR-16). Anything else (a URL built at
   runtime, a wrapper that takes the path as a parameter, an alias, an unreadable or unparsable
   file, a symlink) → `needs_review` (FR-17).

**Why:** text search can't tell a real call from a comment, or an axios instance from some other
object, and it can't prove that code it didn't read is safe. Following real symbols gives exact
file, line and column (FR-14). Anything the analysis can't resolve is reported as a coverage limit
and never treated as "not affected" (BR-02). `locate()` in
[pipeline/locate.ts](../apps/server/src/pipeline/locate.ts) also requires a clean git tree, checks
that HEAD did not move during the analysis, and stores the commit, call sites, coverage and stage
result in one transaction.

### 4.5 Sandbox isolation

[apps/server/src/pipeline/validate.ts](../apps/server/src/pipeline/validate.ts),
[infra/validator/sandbox.ts](../apps/server/src/infra/validator/sandbox.ts),
[infra/validator/image.ts](../apps/server/src/infra/validator/image.ts),
[infra/workcopy/index.ts](../apps/server/src/infra/workcopy/index.ts).

1. **Working copy.** `createWorkingCopy` makes a copy under `.work/`: a `git clone` at the given
   commit when the path is a git root, or else a plain copy plus a baseline commit. Host git runs
   without user config and with hooks off. The developer's checkout is only read (FR-20).
2. **Install phase.** `npm ci --ignore-scripts` runs inside the container **before** any patch is
   applied. Network is on (to download packages) but lifecycle scripts are off.
3. **Apply.** `inspectPatch` ([patch.ts](../packages/core/src/validate/patch.ts)) rejects
   absolute paths, `..`, paths inside `.git`, control characters, binary content, symbolic links
   and submodule changes. Then `git apply` runs on the host, which only edits files.
4. **Validate phase.** The repository's own `npm run typecheck` and `npm test` (Vitest, with a
   JSON report) run, unchanged, in a container started
   by `buildRunArgs` with: `--network none`, `--user` non-root (never uid 0), `--memory` with
   `--memory-swap` the same, `--cpus`, `--pids-limit`, `--cap-drop ALL`,
   `--security-opt no-new-privileges`, `--read-only` root file system, a small tmpfs `/tmp`, only
   the working copy mounted at `/work`, and only allow-listed env vars (`API_VERSION`,
   `NODE_ENV`, `TZ`). The image is pinned by digest. A 10-minute wall clock kills the container.
5. **Read results.** The Vitest JSON report is read only if it is a regular file inside the copy
   and is not too large. `buildValidationResult` combines it with the `tsc` output into
   pass/fail/error/timeout plus counts, and keeps the raw output (FR-26).

**Why:** generated code is untrusted. It must never run on the host (C-03, FR-32) and it must not
reach the network, the host's credentials, or the developer's files (NFR-03).

### 4.6 The four cheat guards and their order

[packages/core/src/guards/verdict.ts](../packages/core/src/guards/verdict.ts),
[static.ts](../packages/core/src/guards/static.ts), [count.ts](../packages/core/src/guards/count.ts),
[paths.ts](../packages/core/src/guards/paths.ts),
[pipeline/guarded-validate.ts](../apps/server/src/pipeline/guarded-validate.ts).

`GUARD_ORDER` = **test_file_changed → config_changed → type_suppression → test_count_changed**.

1. `test_file_changed` (FR-27): the patch adds, edits, deletes, renames or copies a test file
   (by path), or adds a skip marker such as `.skip`, `.only`, `.todo`, `skipIf(` or `xit(`.
2. `config_changed` (FR-30): the patch touches tsconfig, Vite/Vitest/Jest config,
   `package.json`, lockfiles, `.npmrc`, lint or format config, Babel config, or `.github/`.
3. `type_suppression` (FR-29): in the **added lines only**, `@ts-ignore`, `@ts-expect-error`,
   `@ts-nocheck`, `eslint-disable`, any `any` type, an `as unknown as` cast, or an empty `catch`
   that touches a changed line. These checks use the ts-morph syntax tree of the post-patch file,
   so the word "any" in a string is not a hit. If the post-patch text is missing, a regex over the
   added lines is used, so missing text never means "clean".
4. `test_count_changed` (FR-28): after validation, compared with the pre-patch baseline: the total
   changed, fewer tests pass, or a test that existed before is missing (by file and name).

`guardedValidate` runs path safety and the three **static** guards first. A static hit returns
`cheating` and **the container never runs**. Then it validates the patch and runs the count guard.
`verdictFromHits` reports all hits, but records the **first** failing guard in `GUARD_ORDER`, and
the database requires a cheating attempt to name exactly one guard (DR-04). `cheatingEndsRun`
says a cheating outcome ends the run with no retry (FR-31).

**Why this order:** the cheap checks that need no container go first, so a cheating patch costs
no sandbox time. Test changes come first because they are the most direct way to cheat. The count
guard needs real test results, so it can only come last.

### 4.7 LLM context assembly

[packages/core/src/repair/context.ts](../packages/core/src/repair/context.ts),
[repair/output.ts](../packages/core/src/repair/output.ts),
[infra/llm/adapter.ts](../apps/server/src/infra/llm/adapter.ts),
[infra/llm/fake.ts](../apps/server/src/infra/llm/fake.ts).

1. `buildRepairContext` refuses any change that is not `breaking` + `confirmed` with a source of
   `migration_note` or `human`, and a note entry that differs from the confirmed mapping.
2. The user message holds only (FR-19): the BEFORE and AFTER spec sections, the mapping, the
   located call-site files, and the earlier validator errors from the same run. Each part is put
   in an `untrusted_*` block as JSON, with `<`, `>`, `&` escaped, so the content can't close the
   block. The system prompt says that everything in those blocks is data, not instructions.
3. Files are kept only if `isRepairSourcePath` says they are ordinary source files (not tests,
   config, `.env`, keys). Credentials are redacted from all text and keys (`redactRepairSecrets`).
   Earlier errors are cut down to the useful lines (TS errors, failing assertions) and to at most
   4,000 characters.
4. The adapter makes one request with no retries, tools or caching, and a hard 120-second
   deadline (NFR-06). It computes the cost from [config/llm-pricing.json](../config/llm-pricing.json).
   `parseRepairOutput` accepts only `REFUSE: reason` or a unified diff that edits only the listed
   files. A patch with credential-like text is rejected. Provider errors are replaced with a safe
   message, because they can echo the prompt or the key.
5. `FakeLlmAdapter` returns scripted results and records each context, so tests and the
   evaluation can run without a network or a model (NFR-08).

**Why:** the model sees only what it needs, nothing secret, and nothing it could mistake for an
instruction (NFR-04, AT-10). One adapter file means the provider can be swapped by editing one
file (C-06).

---

## 5. Repair, orchestration, delivery, and the dashboard

The [repair loop](../apps/server/src/pipeline/repair.ts) checks confirmed mapping and token
headroom before calling the model. In full mode it establishes a baseline, then applies each
candidate to a fresh copy, evaluates guards and validation, records the attempt, and feeds
bounded newest-first validation errors into the next call. Four attempts is the hard maximum.
Cheating stops immediately. Provider/container failures remain explicit stage failures; an LLM
refusal is a flagged finding. Single-shot mode is explicitly unguarded evaluation behavior.

The [orchestrator](../apps/server/src/pipeline/orchestrator.ts) serializes active runs, records
stage results before advancing, and recovers interrupted running records as stage failures.
Spec checks classify the new pair before advancing the baseline. Reanalysis and delivery retry
create child runs rather than overwriting terminal history. [Run routes](../apps/server/src/http/run-routes.ts)
return 202 for background execution and expose the stored evidence. [Exports](../apps/server/src/pipeline/export.ts)
produce JSON and HTML from the same redacted record; HTML escapes untrusted evidence.

[Delivery](../apps/server/src/pipeline/deliver.ts) uses a GitHub port to publish a new branch
and a labeled review PR after validation. It never merges. The target default branch remains
unchanged. Missing mapping, failed validation, and delivery failure retain a specific reason.

The [dashboard](../apps/web/src/App.tsx) renders five routed views from the shared contract.
It never authorizes a mapping by similarity or computes evaluation scores. Its
[client](../apps/web/src/api.ts) validates responses and keeps failed requests visible.
Only the unimplemented results endpoint is mocked in normal opt-in development; full fixtures
require a separate flag and a visible demonstration banner. Production starts no mock worker.

The [scenario set](../scenarios/README.md) contains twenty source snapshots with independently
committed labels, five per category and three deliberate refusals. Whole-folder hashes and
reproducible Git commits pin the inputs. [Admission verification](../scenarios/verify.ts) checks
old-API passes and new-API assertion failures in the pinned Docker sandbox. It is not an
estimate of model accuracy.

## 6. Evaluation and submission limits

Increment 16 is tracked separately. A generated report may be imported only with its label,
provenance and limitations intact. Fixture trials establish infrastructure behavior, not paid
model quality or human-reviewed correctness. The submission builder refuses to call an archive
final while evaluation or human presentation evidence is absent.
