# INCREMENT 05: Detect (oasdiff runner + parser + evidence)
Status: Standard
Dependencies: Increment 03 merged (can run in parallel with 04, 07, 08, 12, 15)

### CRITICAL — READ FIRST ###
**MANDATORY:** Follow the Working Rules in `CLAUDE.md`. Save this prompt verbatim to `prompts/05_detect.md`. Branch: `feat/inc05-detect`. Requirement IDs → `docs/SRS.md`.
**CRITICAL:** The **runner** (which calls the oasdiff binary) lives in `apps/server/src/infra/oasdiff/`. The **parser** lives in `packages/core/src/detect/` and takes oasdiff JSON as input, so it is testable **without** the binary, network, container, or model (NFR-08, C-05).
**CRITICAL:** Detection only reports *what is different*. It does NOT decide breaking/safe (that is Increment 06) and does NOT claim any code is broken (BR-01).

---

## Context for whoever picks this up
`demo/api/specs/v1.yaml` → `v2.yaml` contains exactly 5 breaking changes + 1 safe change (`phone` added) (see `prompts/02_*.md`). oasdiff is installed locally (`oasdiff --version`); inc02 confirmed `oasdiff breaking` finds all 5. The `changes` table and enums are in inc03's schema.

## Capability
Given two stored spec versions, produce a structured, stored list of differences, each with path, HTTP method, JSON pointer, oasdiff rule id, level, and before/after evidence (FR-06, FR-08).

## Part A — Runner `apps/server/src/infra/oasdiff/runner.ts`
- Write both normalized specs to a temp dir, run `oasdiff changelog <base> <revision> --format json` (changelog gives error/warning/info levels, so safe changes show up too). Use `execFile`, never a shell string. 30 s timeout.
- **Pin the version:** read `oasdiff --version` and fail with a clear message if it doesn't match the pinned version in `apps/server/src/infra/oasdiff/version.ts`. Document the install command in the README.
- **CI:** install the same pinned oasdiff release in GitHub Actions (download the release tarball by exact version and verify its checksum).
- Typed failures: `binary_missing`, `version_mismatch`, `timeout`, `bad_output`.

## Part B — Parser + evidence `packages/core/src/detect/`
Types (`types.ts`, exported for inc06/07/10):
```ts
export interface SpecDifference {
  id: string;              // stable: sha256(ruleId|method|path|jsonPointer), first 16 hex chars
  ruleId: string;          // oasdiff rule id, e.g. "response-property-type-changed"
  level: 'error' | 'warning' | 'info';
  path: string;            // e.g. "/orders/{id}"
  method: 'GET'|'POST'|'PUT'|'PATCH'|'DELETE'|'HEAD'|'OPTIONS' | null;
  jsonPointer: string;     // RFC 6901 pointer into the spec document for the changed item
  description: string;     // oasdiff's text
  details: Record<string, unknown>; // rule-specific extras parsed from the text (e.g. property name, old/new type, param name)
  evidenceBefore: unknown | null;   // the JSON at jsonPointer in the BEFORE spec (null if absent)
  evidenceAfter: unknown | null;    // same in the AFTER spec
}
```
- `parseOasdiffChangelog(json)` → `SpecDifference[]`. Unknown rule ids are **kept** (level preserved) and never dropped.
- `buildJsonPointer(...)` + `extractEvidence(spec, pointer)` — pure helpers.
- For property-level rules, extract the property name(s) and old/new types into `details` (needed by inc06: rename candidates, type changes).
- Any difference that can't be tied to a specific path/operation gets `jsonPointer: ""` and a `details.unattributed = true` flag (inc06 will classify it `unknown`).

## Part C — Store
`apps/server/src/pipeline/detect.ts`: `detectChanges(apiId, fromVersionId, toVersionId)` → runs the runner, parses, and returns `SpecDifference[]`, plus a persistence helper that inc06 calls after classification (keep detection pure: **don't** write `changes` rows with fake classifications).

## Acceptance checks (AT-03)
- [ ] Recorded fixture: save the real oasdiff JSON for demo v1→v2 to `packages/core/test/fixtures/oasdiff-demo-v1-v2.json`; parser unit tests use it (no binary needed)
- [ ] Parser finds all **5 breaking** differences + the safe `phone` addition, each with the correct path, method, and a JSON pointer that resolves in the right spec; evidenceBefore/After are correct (e.g. `total` schema `{type: number}` → `{type: string, ...}`)
- [ ] Removed endpoints: evidenceAfter = null; added property: evidenceBefore = null
- [ ] Stable ids: running the parser twice gives the same ids
- [ ] Unknown rule id in a hand-edited fixture is kept, not dropped
- [ ] Runner integration test (skipped with a clear message if oasdiff is missing locally; **runs in CI**): v1→v2 real run matches the fixture's differences
- [ ] Runner: wrong version / missing binary → typed error, not a crash
- [ ] `packages/core` has no imports of child_process, fs-network, or apps/*
- [ ] Typecheck, lint, tests pass; CI green; PR opened (`Closes #<issue>`)

### CRITICAL — REMINDER ###
**MANDATORY:** The parser is pure and fixture-tested; the runner is pinned and wrapped. Detection never labels anything breaking, and never drops unknown differences. Evidence is kept for every difference (FR-08). Decisions → `docs/decisions/inc05.md`. End with the **INCREMENT 05 REPORT** and open the PR.
