# @sma/demo-api

"Demo Shop" REST API used as the test material for the whole system (SRS 2.2, 5.2).

- `npm run start:v1 -w @sma/demo-api` → http://127.0.0.1:4001
- `npm run start:v2 -w @sma/demo-api` → http://127.0.0.1:4002
- `specs/v1.yaml`, `specs/v2.yaml` — OpenAPI 3.1 specs
- `migration-notes/v1-to-v2.yaml` — confirmed mappings (defines the migration-note format)
- `npm run record:fixtures -w @sma/demo-api` — records real responses into `demo/consumer/test/fixtures/`
- `npm run gen:client -w @sma/demo-api` — generates `demo/consumer/src/generated/apiClient.ts` from `specs/v1.yaml`

## v1 → v2 changes

| #   | Category             | Change                                             | Migration note                    |
| --- | -------------------- | -------------------------------------------------- | --------------------------------- |
| 1   | field_renamed        | GET /customers/{id}: `customer_name` → `full_name` | yes                               |
| 2   | field_type_changed   | GET /orders/{id}: `total` number → decimal string  | yes                               |
| 3   | required_param_added | GET /orders: query `status` becomes required       | yes                               |
| 4   | endpoint_removed     | GET /orders/{id}/invoice → GET /invoices/{orderId} | yes                               |
| 5   | endpoint_removed     | DELETE /orders/{id}, no replacement                | **no (deliberately unconfirmed)** |
| —   | safe                 | optional `phone` added to Customer                 | n/a                               |
