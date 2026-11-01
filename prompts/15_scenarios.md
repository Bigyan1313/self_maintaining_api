# INCREMENT 15: Twenty Frozen Evaluation Scenarios
Status: **CRITICAL**
Dependencies: Increment 02 merged. (The container-based failing-before check uses inc08's validator; if inc08 isn't merged yet, build everything else and add the container check when it lands. Say so in the report.)

### CRITICAL — READ FIRST ###
**MANDATORY:** Follow the Working Rules in `CLAUDE.md`. Save this prompt verbatim to `prompts/15_scenarios.md`. Branch: `feat/inc15-scenarios`. Requirement IDs → `docs/SRS.md` (Section 6).
**CRITICAL (EV-01):** Exactly **20 scenarios, 5 per change category**. Each is **frozen**: a fixed repo snapshot, a fixed before/after spec pair, an optional migration note, and tests that **pass before** the change and **fail after** it.
**CRITICAL (EV-02):** The failing-before condition is **verified automatically**, never assumed. A scenario failing the check is **excluded and reported with its reason**, never silently.
**CRITICAL (EV-04):** The **hand-written labels** for each scenario are written and committed **before** any system run touches them.
Write the failure signs + rollback point in `docs/decisions/inc15.md` first.

---

## Context for whoever picks this up
`demo/` shows the pattern: an OpenAPI pair + migration note + a standalone TS consumer whose msw-based tests read recorded fixtures by `API_VERSION` (see `prompts/02_*.md`). Supported call patterns: fetch (literal/template URL), axios (instance or static import), generated client. Supported categories: `field_renamed`, `field_type_changed`, `required_param_added`, `endpoint_removed`.

## Capability
A reproducible scenario set the evaluation (inc16) runs every baseline over.

## Part A — Layout
```
scenarios/
  README.md                 # what a scenario is, how to add/verify one
  build.ts                  # generates scenarios from definitions (deterministic)
  verify.ts                 # EV-02 check → scenarios/verification.json
  manifest.json             # list of 20 ids + sha256 of each frozen folder
  definitions/<id>.ts       # small spec of each scenario
  <id>/
    scenario.yaml           # id, category, difficulty, description, call pattern(s), validationEnv {before:{API_VERSION:v1}, after:{API_VERSION:v2}}, expected: {outcome: repair|refuse}
    labels.yaml             # HAND-WRITTEN expected differences + classification + mapping status (EV-04)
    specs/before.yaml  specs/after.yaml
    migration-note.yaml     # present where the category calls for it
    repo/                   # standalone TS consumer (own package.json + lockfile, tsconfig, vitest, msw), with fixtures under test/fixtures/{v1,v2}
```
- Fixtures are produced from the spec **examples** by `build.ts` (deterministic), not typed by hand. Small variations are fine, but they come from the definitions.
- **Freezing:** `manifest.json` stores a sha256 of each scenario folder (sorted file list + contents). `verify.ts` and the inc16 eval refuse to run a scenario whose hash doesn't match ("modified after freezing").

## Part B — The 20 scenarios (vary the domain: e.g. shop, library, weather, tickets, fitness)
| Category | Count | Migration note | Variations to include |
|---|---|---|---|
| `field_renamed` | 5 | present, confirms the mapping | flat field; nested field; field used in 2 files; rename via the generated client; rename read through destructuring |
| `field_type_changed` | 5 | present | number→string; string→number; integer timestamp → ISO string; boolean → enum string; the conversion site is far from the call (another module) |
| `required_param_added` | 5 | present (with default/derivation) | query param; header; path-adjacent query with an enum; a value threaded from the caller; a param on an axios-instance call |
| `endpoint_removed` | 5 | **2 with a replacement, 3 WITHOUT** | the 3 without a replacement have `expected.outcome: refuse` (a confident patch = scenario **failed**, even if tests pass) |
- Cover **all 3 call patterns** across the set (document the counts in the README).
- Every scenario's spec pair must be detected by oasdiff and located by the supported patterns (no unsupported-only scenarios).

## Part C — Verification `scenarios/verify.ts` (EV-02)
For each scenario: check the hash → `npm ci` and `npm run typecheck` (must pass) → tests with the **before** env must **all pass** → tests with the **after** env must have **≥ 1 failure**. Run inside the **inc08 container** when available (`--container` flag, the default once inc08 is merged). Running these *hand-built, trusted* scenario repos on the host with `--host` is allowed only for authoring. Output `scenarios/verification.json`: `{ id, admissible: boolean, reason?, beforePassed/Total, afterPassed/Total }`.

## Critical checkpoint
- **Failure signs:** a scenario passes after the change (it proves nothing); labels were written after running the system; a hash mismatch; fewer than 5 in a category.
- **Rollback:** the last merged `main` commit.

## Acceptance checks (EV-01, EV-02, AT-12 groundwork)
- [ ] 20 scenarios, 5 per category; 3 endpoint-removal scenarios with no replacement and `expected: refuse`
- [ ] `labels.yaml` for all 20, committed in a commit **before** any system run (the git history shows it)
- [ ] `npm run scenarios:build` is deterministic (running it twice → no git diff)
- [ ] `npm run scenarios:verify` → 20/20 admissible (or any exclusions listed with reasons, which must then be fixed or replaced so there are 20)
- [ ] Changing one file in a scenario → verify reports "modified after freezing"
- [ ] The README documents categories, difficulty, the call-pattern counts, and how to reproduce
- [ ] Typecheck, lint, tests pass; CI runs `scenarios:verify --container` (if inc08 is merged); PR opened (`Closes #<issue>`)

### CRITICAL — REMINDER ###
**MANDATORY:** 20 frozen scenarios, 5 per category, 3 deliberate refusals. Labels before runs. Failing-before is verified automatically; exclusions are never silent. Hash-frozen. Decisions → `docs/decisions/inc15.md`. End with the **INCREMENT 15 REPORT** and open the PR.
