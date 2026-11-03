# Specification classification rules — Increment 06

These verdicts concern API specifications, never whether consumer code is broken (BR-01).
`packages/core/src/classify/rules.ts` contains the same rule data. Detection severity alone does not determine classification.

| oasdiff rule ID                      | Category             | Classification | Confidence |
| ------------------------------------ | -------------------- | -------------- | ---------- |
| response-property-type-changed       | field_type_changed   | breaking       | 0.95       |
| request-property-type-changed        | field_type_changed   | breaking       | 0.95       |
| request-parameter-became-required    | required_param_added | breaking       | 0.95       |
| new-required-request-parameter       | required_param_added | breaking       | 0.95       |
| api-path-removed-without-deprecation | endpoint_removed     | breaking       | 0.95       |
| api-removed-without-deprecation      | endpoint_removed     | breaking       | 0.95       |
| api-path-removed                     | endpoint_removed     | breaking       | 0.95       |
| api-removed                          | endpoint_removed     | breaking       | 0.95       |
| response-required-property-removed   | other                | breaking       | 0.95       |
| response-optional-property-removed   | other                | breaking       | 0.95       |
| response-optional-property-added     | other                | safe           | 0.90       |
| response-required-property-added     | other                | safe           | 0.90       |
| endpoint-added                       | other                | safe           | 0.90       |
| response-property-pattern-added      | other                | safe           | 0.90       |
| new-optional-request-parameter       | other                | safe           | 0.90       |
| request-parameter-became-optional    | other                | safe           | 0.90       |

Response additions and response pattern constraints above are safe for existing consumers within the supported scope. Request type changes remain conservatively breaking; unsupported rules remain unknown.

## Overrides and mapping authority

- Unknown IDs, unattributed differences, or unknown detector levels become `other` / `unknown` / 0.5, unconfirmed. No difference is discarded.
- A response property removal with a sibling addition on the same path, method, response status, and media type is a `field_renamed` candidate: breaking, 0.6. The addition remains its own safe difference. Names looking similar never confirm anything.
- A matching note specifies kind + method + path + old field (including its nested path), or parameter name/location; type mappings must also match old/new types. Rename mappings must name an actually detected sibling addition. A confirmed rename has confidence 0.95. An ambiguous selector confirms nothing; duplicate selectors are rejected during parsing.
- Endpoint removal without a documented replacement remains unconfirmed with: “Removed with no documented replacement; reported as affected, no migration proposed.” A note naming the removed operation itself as replacement cannot confirm it.
- All other changes without a mapping remain unconfirmed and are reported, not repaired. Safe differences never receive a fabricated mapping.
- Humans submit an explicit mapping and nonempty identity. The server checks kind/path/method, the source pointer/evidence, and the target in the immutable stored after-spec; nonexistent fields or replacement operations return 400. Already-confirmed changes return 409. A row lock ensures only one concurrent confirmation succeeds.

## Notes and persistence

Upload JSON `{fromVersionId, toVersionId, rawYaml}` to `POST /api/apis/:id/migration-notes`.
The YAML format is the demo note, bounded to 256 KiB UTF-8. Custom tags, aliases, duplicate keys/selectors, unexpected fields, and malformed data are rejected with field-level errors. `default_value` is a JSON scalar; conversion expressions are stored as text and never executed. Note `from`/`to` must match the selected specs' `info.version`; `api` is a descriptive name, while the route and version ownership establish API identity.

`detectAndClassify(db, apiId, fromVersionId, toVersionId, deps?)` runs detection, reads the pair's latest note, and persists all verdicts. Existing rows are returned on repeat analysis; late notes do not rewrite immutable classifications. Explicit human confirmation remains available. An empty diff is rerunnable and writes zero rows. The orchestrator will invoke this function in Increment 13; no new analysis HTTP route is introduced here.

`GET /api/changes?apiId=<uuid>` returns the shared contract with text labels. Core verdicts contain reasons; the existing database contract persists category, confidence, evidence, mapping authority, and note linkage without adding a migration.
