# INCREMENT 06: Classify + Migration Note + Mapping Confirmation
Status: **CRITICAL**
Dependencies: Increment 05 (detect) merged

### CRITICAL — READ FIRST ###
**MANDATORY:** Follow the Working Rules in `CLAUDE.md`. Save this prompt verbatim to `prompts/06_classify.md`. Branch: `feat/inc06-classify`. Requirement IDs → `docs/SRS.md`.
**CRITICAL — THE RULE THAT IS NEVER BROKEN (BR-04, C-04, FR-10):** A mapping (old → new) is **confirmed ONLY** by a migration note entry or an explicit human confirmation. **Never** by names looking similar. A `customer_name` removal next to a `full_name` addition is a *candidate*, NOT a confirmed mapping.
**CRITICAL:** Before writing code, list the failure signs for this increment and the rollback point (the last merged commit on `main`) in `docs/decisions/inc06.md`.

---

## Context for whoever picks this up
Inc05 gives `SpecDifference[]` (`packages/core/src/detect/types.ts`). The migration-note format is defined by `demo/api/migration-notes/v1-to-v2.yaml` (inc02). Tables `changes` and `migration_notes` are from inc03, with DB checks for confirmed ⇔ source. The API contract is `packages/core/src/api/contract.ts` (inc04).

## Capability
Turn each difference into a classified change (category, breaking/safe/unknown, confidence 0–1) with before/after evidence, and resolve its mapping status from the migration note or a human (FR-07, FR-08, FR-09, FR-10, BR-01, BR-04, BR-05).

## Part A — Migration note parser `packages/core/src/migration-note/`
- zod schema for the format in `demo/api/migration-notes/v1-to-v2.yaml` (kinds: `field_renamed`, `field_type_changed`, `required_param_added`, `endpoint_removed` with optional `replacement`).
- `parseMigrationNote(yamlText)` → typed note, or field-level errors. Untrusted input: size cap 256 KiB, YAML parsed safely (no custom tags).
- `findMapping(note, difference, category)` → the matching entry by kind + method + path (+ field/param name), or `null`.

## Part B — Classifier `packages/core/src/classify/`
- `classify(differences, note | null)` → `ClassifiedChange[]`:
```ts
export interface ClassifiedChange {
  difference: SpecDifference;
  category: ChangeCategory;          // field_renamed | field_type_changed | required_param_added | endpoint_removed | other
  classification: 'breaking' | 'safe' | 'unknown';
  confidence: number;                // 0..1
  mappingStatus: 'confirmed' | 'unconfirmed';
  mappingSource: 'migration_note' | null;  // 'human' is only set later via confirm-mapping
  mapping: MigrationMapping | null;
  reason: string;                    // one plain sentence explaining the verdict
}
```
- **Documented rule table** in `docs/classification-rules.md` AND as code data (`rules.ts`), covering each oasdiff rule id seen in the demo + the common ones: rule id → category, classification, base confidence. Examples:
  - `response-property-type-changed` → `field_type_changed`, breaking, 0.95
  - `request-parameter-became-required` / `new-required-request-parameter` → `required_param_added`, breaking, 0.95
  - `api-path-removed-without-deprecation`, `api-removed-without-deprecation` → `endpoint_removed`, breaking, 0.95
  - `response-optional-property-added` → `other`, safe, 0.9
  - **Rename candidate:** a response property removed AND another added on the same operation → `field_renamed`, breaking, confidence 0.6 if unconfirmed, 0.95 once confirmed. A property removed with no sibling added → `other`, breaking.
  - Unknown rule id, or `details.unattributed` → `unknown`, confidence 0.5, never guessed (SRS 3.1).
- Mapping resolution: a note entry matches → `confirmed` / `migration_note`. Otherwise `unconfirmed`, and `reason` says the change will be **reported, not repaired**.
- **BR-05:** `endpoint_removed` with no replacement in the note → breaking, unconfirmed, reason "Removed with no documented replacement; reported as affected, no migration proposed."
- **BR-01:** nothing in this module claims code is broken. The words are about the *spec*.

## Part C — Server
- `POST /api/apis/:id/migration-notes` → parse + store (raw + parsed) linked to a from/to version pair; field-level errors on bad notes.
- `apps/server/src/pipeline/classify.ts`: `detectAndClassify(apiId, fromVersionId, toVersionId)` = inc05 detect → classify with the note for that pair (if any) → **insert `changes` rows** (category, classification, confidence, path, method, pointer, evidence before/after, mapping fields, migration_note_id). Idempotent per (from, to) pair: re-running doesn't duplicate rows.
- `GET /api/changes?apiId=` (with text labels).
- `POST /api/changes/:id/confirm-mapping` `{ mapping, confirmedBy }` → sets `confirmed`/`human` with confirmed_by/at. Allowed **only** for `unconfirmed` changes; the mapping must reference fields/paths that really exist in the before/after evidence (else 400). This is the "human confirms" path of FR-10.

## Critical checkpoint
- **Failure signs:** any unconfirmed change ends up `confirmed`; DELETE /orders/{id} gets a mapping; a difference gets dropped; confidence outside 0–1.
- **Isolation test:** run the classifier on the demo fixture with **no note** → every breaking change must be `unconfirmed`.
- **Rollback:** the last merged `main` commit.

## Acceptance checks (AT-03, AT-04)
- [ ] Hand labels file `packages/core/test/fixtures/demo-v1-v2.labels.yaml` (written FIRST, before running the classifier) with the expected category / classification / mapping status for every demo difference; the test compares the classifier against it
- [ ] Demo v1→v2 **with** the note: #1–#4 confirmed (migration_note), #5 DELETE unconfirmed with the BR-05 reason, `phone` = safe
- [ ] **Without** the note: all 5 breaking changes unconfirmed; #1 is still `field_renamed` (candidate) with confidence 0.6 and is NOT confirmed
- [ ] Note that matches nothing → no mapping is applied; bad YAML → field errors
- [ ] Human confirm: works on an unconfirmed change; rejected on an already-confirmed one; rejected when the mapping names a field not in the evidence; the DB check (human ⇒ confirmed_by) holds
- [ ] Unknown rule → `unknown` 0.5; confidence always within 0–1 (property test with random inputs)
- [ ] Typecheck, lint, tests pass; CI green; PR opened (`Closes #<issue>`)

### CRITICAL — REMINDER ###
**MANDATORY:** Confirmed = migration note or human. **Never** inferred from names. Removed-with-no-replacement is reported, never "fixed". Every verdict has evidence, a confidence in 0–1, and a plain-sentence reason. Decisions → `docs/decisions/inc06.md`. End with the **INCREMENT 06 REPORT** and open the PR.
