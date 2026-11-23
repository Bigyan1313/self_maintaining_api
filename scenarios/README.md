# Frozen evaluation scenarios (Increment 15)

This is the shared input set for Increment 16's B1/B2/B3 evaluation. It contains
exactly **20 cases: five per category, seventeen expected repairs and three
required refusals**. These are small, trusted, hand-authored TypeScript consumers;
no LLM or external API is called while building or checking the set.

| Category                 | Difficulty | Cases                                                                                                                                 |
| ------------------------ | ---------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| Field renamed            | Low        | Flat shop field; nested library field; weather field read in two modules; ticket generated client; fitness destructuring              |
| Field type changed       | Moderate   | Shop number→string; library string→number; weather Unix seconds→ISO string; ticket boolean→enum; fitness formatting in another module |
| Required parameter added | Moderate   | Shop query; library header; weather enum query beside a path parameter; ticket caller-supplied region; fitness axios instance         |
| Endpoint removed         | High       | Shop/library replacements; weather/tickets/fitness **without replacement**                                                            |

Each consumer has a contract assertion and an unrelated health check. Weather's
two-module rename tests both readers. The ticket parameter case also tests a
non-default caller region, so hard-coding the documented default is insufficient.
The type-change cases preserve caller-visible values across versions; they require
conversion, rather than changing expected test output.

Primary consumer call families: **10 fetch, 7 axios, 3 generated client**.
Axios comprises five static and two instance cases. Generated client implementations
also contain fetch calls, so locator coverage includes fetch in **13** scenarios.
Difficulty totals: 5 low, 10 moderate, 5 high.

## Ground truth and freezing

All twenty `labels.yaml` files were independently authored and committed in
`762bf40` **before detection, classification, location, or consumer execution**.
The builder never creates, reads for generation, or rewrites their contents.
They describe semantic differences (method/path/field or parameter), classification,
mapping status, and expected outcome, independently of oasdiff rule IDs.
Added fields and replacement endpoints have separate safe labels. Multiple detector
rules describing one semantic field change (for example type change plus enum
restriction) should be matched to that semantic label, not counted as separate
independent ground-truth changes. HTTP header identities are case-insensitive;
`X-Library` in the authored label denotes `x-library` in the canonical spec/note.

`definitions/*.ts` hold source, spec examples, mappings, and intended behavior.
`build.ts` emits before/after OpenAPI, scenario metadata, a standalone consumer,
and MSW response fixtures **exclusively from the emitted spec examples**. The
caller-dependent case uses named OpenAPI examples with an `x-request` extension
for request path/parameter constraints. Dependency versions and lockfiles are pinned;
consumer tooling is a frozen copy in `templates/`, independent of future demo edits.

`manifest.json` records each folder's SHA-256 and standalone `repoCommit`. Hashing
includes **every** regular file, including labels, tests, fixtures and lockfiles:
sorted POSIX relative paths, then UTF-8 byte-length-prefixed path and byte-length-prefixed
content, streamed to SHA-256. Symlinks are rejected. No generated reports or installed
dependencies belong inside the frozen folders.

The standalone commit is reproducible with `snapshotCommit(repoPath)` from
`snapshot.ts`: copy `repo/`, initialize SHA-1 Git, commit all files using the fixed
identity, timestamp, and message defined there. It is independent of the parent
repository commit (avoiding a circular manifest reference). The verifier reconstructs
and checks it before executing code. Consumers need no nested checked-in `.git` directory.

**Inc16 integration:** call `readManifest(scenariosRoot)` and
`assertFrozen(scenariosRoot, entry)` from `integrity.ts` before **each** baseline;
copy the verified `repo/` to a working directory. Never run repairs on frozen source.
Use the same manifest for all baselines, the before/after `validationEnv`, migration
note if present, and `expected.outcome`. A proposed repair for any of the three
`refuse` cases is an evaluation failure **even if its tests pass**. Admission alone
does not measure repair quality; human review and B1/B2/B3 metrics belong to inc16.

## Reproduce

Use Node 22, Git, the project's pinned oasdiff 1.35.0, and Docker. Install oasdiff as
shown in the root README/CI, or set `OASDIFF_BIN` to that verified binary.

```sh
npm ci
npm run scenarios:build
npm run scenarios:build
git diff --exit-code -- scenarios
npm run test:scenarios
npm run scenarios:verify -- --container
```

The default verification mode is `--container`. It reuses inc08's pinned image,
non-root user, resource/time limits, network-disabled typecheck/tests, and network-enabled
`npm ci --ignore-scripts` install. Source is copied, dependencies are installed once,
and both environments run with the same source and test set. Copies and containers
are disposed even after failure. No database or provider credential is needed.

For **authoring these trusted consumers only**, `npm run scenarios:verify -- --host`
uses disposable copies and the same report parser. It is not a substitute for Docker
validation and must never be used for model-generated patches. The checked-in
`verification.json` identifies its mode; CI uploads fresh container evidence as the
`scenario-verification` artifact.

The verifier checks real oasdiff detection, mapping confirmation/refusal and all
advertised locator patterns, then successful compilation, all tests passing before,
and at least one **actual failed assertion** after. Runner errors, timeouts, skipped
cases, changed test identities, or compile failures do not qualify. Every case has
an explicit admission result/reason; any exclusion makes the command exit nonzero.
The report includes the exact manifest, mode, test counts, and detected/located counts.

`npm run test:scenarios` includes a mutation test: it copies a case, changes one source
file, verifies `modified after freezing`, and asserts that neither the detector nor
the consumer was invoked. It also tests runner-error rejection, cohort shape,
spec-derived fixtures and reproducible Git commits.

## Changing the set

A rebuild explicitly **re-freezes** the set; verification never silently updates hashes.
Do not rebuild merely to make an integrity failure disappear. Author the semantic
labels and commit them before running a new case through the system, author its
definition, then build and verify. Keep five per category and three refusal cases.
After evaluation begins, retain the published manifest unchanged and publish any
replacement set as a new evaluation version rather than mixing cohorts.
