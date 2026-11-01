# INCREMENT 02: Demo API (v1 + v2) and Sample Consumer Repo
Status: Standard
Dependencies: Increment 01 (merged)

### CRITICAL — READ FIRST ###
**MANDATORY:** Follow the Working Rules in `prompts/00_master_context.md` Section 7. Save this prompt verbatim to `prompts/02_demo_api_and_consumer.md` first. Work on branch `feat/inc02-demo-api-consumer`.
**CRITICAL:** This increment builds the **test material** the whole system is measured on (SRS 2.2, 5.2). Do NOT build any pipeline logic (no ingest, diff, classify, locate, or LLM code).
**CRITICAL:** The consumer's tests must **PASS against v1** and **FAIL against v2** for every breaking change below. This is the "failing-before" rule the evaluation depends on (EV-02).

---

## Capability
A small "Demo Shop" REST API served at two versions with two OpenAPI specs, a structured migration note, and a standalone TypeScript consumer repo that uses all 3 supported call patterns. Its tests pass on v1 and break on v2 for each of the 4 change categories.

## Part A — `demo/api` (workspace member)

1. **Fastify server** that serves either version: `npm run start:v1 -w @sma/demo-api` (port 4001) and `start:v2` (port 4002). Seeded in-memory data (2–3 customers, 3–4 orders). Built with a `buildDemoApp(version)` factory for `app.inject()` tests.

2. **OpenAPI 3.1 specs** at `demo/api/specs/v1.yaml` and `v2.yaml`. Every operation has an `operationId`.

   **v1 operations:**
   | Method | Path | operationId | Notes |
   |---|---|---|---|
   | GET | /customers/{id} | getCustomer | returns `{ id, customer_name, email }` |
   | GET | /orders | listOrders | optional query `status` |
   | GET | /orders/{id} | getOrder | returns `{ id, customerId, total: number, status }` |
   | GET | /orders/{id}/invoice | getOrderInvoice | returns invoice |
   | DELETE | /orders/{id} | deleteOrder | 204 |

   **v2 = exactly these 5 breaking changes (and nothing else):**
   | # | Category | Change |
   |---|---|---|
   | 1 | `field_renamed` | GET /customers/{id}: `customer_name` → `full_name` |
   | 2 | `field_type_changed` | GET /orders/{id}: `total` number → string (decimal, e.g. `"19.99"`) |
   | 3 | `required_param_added` | GET /orders: query `status` becomes **required** (enum `open`, `closed`, `all`); v2 returns 400 without it |
   | 4 | `endpoint_removed` (with replacement) | GET /orders/{id}/invoice removed → replaced by GET /invoices/{orderId} (operationId `getInvoice`) |
   | 5 | `endpoint_removed` (NO replacement) | DELETE /orders/{id} removed. v2 returns 404. |

   Add one **non-breaking** change too (for example, a new optional field `phone` on customer), so detection can be tested for "safe".

3. **Migration note** at `demo/api/migration-notes/v1-to-v2.yaml`. **This file defines the migration-note format** for the whole project (log it in DECISIONS.md):
   ```yaml
   api: demo-shop
   from: "1.0.0"
   to: "2.0.0"
   mappings:
     - kind: field_renamed
       method: GET
       path: /customers/{id}
       location: response
       old: customer_name
       new: full_name
     - kind: field_type_changed
       method: GET
       path: /orders/{id}
       field: total
       old_type: number
       new_type: string
       conversion: "Number(value)"
     - kind: required_param_added
       method: GET
       path: /orders
       param: status
       in: query
       default_value: "all"
     - kind: endpoint_removed
       method: GET
       path: /orders/{id}/invoice
       replacement: { method: GET, path: /invoices/{orderId} }
   ```
   **CRITICAL:** Change #5 (DELETE /orders/{id}) must have **NO entry**. It is deliberately unconfirmed, and the correct system behavior later is to **refuse** to repair it (BR-04, BR-05).

4. **Fixture recorder script** `demo/api/scripts/record-fixtures.ts`: starts the app in-process for each version, calls every operation, and writes the JSON responses (status + body) to `demo/consumer/test/fixtures/v1/` and `.../v2/`. The fixtures must come from the real demo server, not be typed by hand.

5. **Generated client script** `demo/api/scripts/gen-client.ts`: reads `specs/v1.yaml` and writes `demo/consumer/src/generated/apiClient.ts`, with one exported async function per `operationId` (for example `getInvoice`, `getOrderInvoice`) that uses `fetch` internally. Put a header comment on the file: `// GENERATED from demo-shop v1 spec — do not edit by hand`. A simple string-template generator is fine; no codegen library is needed.

6. **Tests (demo/api):** both specs are valid OpenAPI 3.1 (use a validator library); each version's responses match its own spec schemas (`app.inject()` + ajv); v2 returns 400 for GET /orders without `status`; v2 returns 404 for the removed endpoints.

## Part B — `demo/consumer` (standalone project, NOT a workspace member)

**CRITICAL:** The consumer stands in for a *developer's own repo*. Later it gets copied into the validation container and receives PRs. So it must be **self-contained**: its own `package.json`, `package-lock.json`, `tsconfig.json` and `vitest.config.ts`, with no imports from our monorepo. **Remove `demo/consumer` from the root `workspaces`** (keep `demo/api`). Add root scripts `consumer:install`, `consumer:test:v1`, and `consumer:test:v2`.

1. **Scripts:** `typecheck` (`tsc --noEmit`) and `test` (`vitest run`). Exact pinned versions. Dependencies: `axios` and `msw` (dev).

2. **Source modules.** Use one file per change category so evaluation scenarios can target them later:
   | File | Call pattern | Uses |
   |---|---|---|
   | `src/customers.ts` | **fetch** with a template-literal URL | GET /customers/{id} → `getCustomerDisplayName(id)` reads `customer_name` |
   | `src/orders.ts` | **axios configured instance** (`axios.create({ baseURL })`) | GET /orders/{id} → `getOrderTotalWithShipping(id)` does math on `total`; GET /orders → `listOpenOrders()` without `status` |
   | `src/invoices.ts` | **generated client** | `getOrderInvoice(id)` from `src/generated/apiClient.ts` |
   | `src/admin.ts` | **axios static import** (`import axios from 'axios'`) | DELETE /orders/{id} → `cancelOrder(id)` |
   | `src/unsupported/dynamicUrl.ts` | URL built at runtime (`["orders", id].join("/")`) | for coverage-limit tests later (FR-17) |
   | `src/unsupported/wrapper.ts` | a custom `request(path)` wrapper around fetch | for coverage-limit tests later |

   Base URL comes from `process.env.DEMO_API_URL`, defaulting to `http://localhost:4001`.

3. **Tests with msw (no real network):** `test/setup.ts` reads `process.env.API_VERSION` (default `v1`) and registers msw handlers that serve the recorded fixtures from `test/fixtures/<version>/`. Unknown routes → 404. In v2, a GET /orders without `status` → 400.
   - Test assertions describe **business behavior that does not depend on the version** (for example, "display name for customer 1 is `Ada Lovelace`", "order 1 total with shipping is `24.99`"). This makes them pass on v1, fail on v2, and pass again once the code is correctly fixed for v2.
   - At least one test per source module (not the `unsupported/` ones, which just need to compile).

## Acceptance checks (all must pass before merge)
- [ ] `npm test -w @sma/demo-api` passes: specs valid, responses match specs, v2 rejects as described
- [ ] `oasdiff breaking demo/api/specs/v1.yaml demo/api/specs/v2.yaml` reports the 5 breaking changes and does NOT report the `phone` addition as breaking. Paste the output summary in the report.
- [ ] Fixtures were produced by `record-fixtures.ts`; `apiClient.ts` was produced by `gen-client.ts`
- [ ] `npm run consumer:test:v1` → **all tests pass**; consumer typecheck passes
- [ ] `npm run consumer:test:v2` → tests for changes **#1–#5 FAIL**, and any other tests still pass. List each failing test and which change caused it.
- [ ] Root `npm run typecheck && npm run lint && npm test` still pass (consumer excluded from root)
- [ ] CI updated: add steps to install the consumer and run `consumer:test:v1` (v2 is expected to fail, so it is not in CI)
- [ ] Commits on the branch, `git merge --no-ff` into `main`, push, and CI green

### CRITICAL — REMINDER ###
**MANDATORY:** No pipeline logic. Exactly 5 breaking changes + 1 safe change. DELETE /orders/{id} has **no** migration-note entry. The consumer is standalone (not a workspace member). Tests: **pass on v1, fail on v2**. Fixtures and the generated client come from scripts, not by hand. Log decisions, update `docs/PROGRESS.md`, and end with the **INCREMENT 02 REPORT** in the exact format. Do not start Increment 03.
