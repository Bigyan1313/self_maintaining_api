# Progress

| Inc | Capability                                                                                     | SRS refs                                 | Priority                  | Status      |
| --- | ---------------------------------------------------------------------------------------------- | ---------------------------------------- | ------------------------- | ----------- |
| 01  | Project setup: workspaces, TS, Vitest, lint, Postgres, CI, TypeDoc                             | C-05, C-07                               | Standard                  | Done        |
| 02  | Demo API v1/v2 + specs + migration notes + sample consumer repo (tests pass on v1, fail on v2) | 2.2, 5.2                                 | Standard                  | Not started |
| 03  | Database schema + migrations (incl. 4-attempt limit + guard-name constraints)                  | DR-01–05                                 | Standard                  | Not started |
| 04  | Ingest: upload/URL, normalize, hash, baseline, dedupe, failure handling                        | FR-01–05, FR-11, FR-12                   | Standard                  | Not started |
| 05  | Detect: oasdiff runner + parser + evidence                                                     | FR-06, FR-08                             | Standard                  | Not started |
| 06  | Classify + migration-note parsing + mapping confirmation                                       | FR-07, FR-09, FR-10, BR-01, BR-04, BR-05 | **CRITICAL**              | Not started |
| 07  | Locate: ts-morph call sites + coverage report                                                  | FR-13–17, BR-02                          | Standard                  | Not started |
| 08  | Validator: Docker sandbox + output parsing                                                     | FR-25, FR-26, FR-32, NFR-03              | **CRITICAL (checkpoint)** | Not started |
| 09  | Cheat guards                                                                                   | FR-27–31, DR-04                          | **CRITICAL**              | Not started |
| 10  | LLM adapter + context assembly                                                                 | FR-19, C-06, NFR-04, NFR-08              | Standard                  | Not started |
| 11  | Repair loop (retries, error feedback, token ceiling, cost)                                     | FR-18, FR-20–24                          | **CRITICAL**              | Not started |
| 12  | Delivery: branch + PR, flagged findings                                                        | FR-33–37, C-02                           | Standard                  | Not started |
| 13  | Pipeline orchestrator + run records + JSON/HTML export                                         | FR-38, FR-39, FR-41                      | Standard                  | Not started |
| 14  | Dashboard (5 views, text labels)                                                               | UI-01–04, FR-40, FR-42                   | Standard                  | Not started |
| 15  | 20 frozen scenarios + failing-before check                                                     | EV-01, EV-02                             | **CRITICAL**              | Not started |
| 16  | Evaluation script: B1/B2/B3, results file, generated tables                                    | EV-03–09                                 | **CRITICAL**              | Not started |
| 17  | Deliverables: class diagram, statechart, TypeDoc, acceptance records AT-01–12                  | 7.1                                      | Standard                  | Not started |
