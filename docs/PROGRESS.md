# Progress

The **GitHub Issues board** is the source of truth for who is doing what. Each increment updates
its own line here in its own PR only (see Working Rules in `CLAUDE.md`).

| Inc | Capability                                                                                     | SRS refs                                 | Priority                  | Status      | Issue |
| --- | ---------------------------------------------------------------------------------------------- | ---------------------------------------- | ------------------------- | ----------- | ----- |
| 01  | Project setup: workspaces, TS, Vitest, lint, Postgres, CI, TypeDoc                             | C-05, C-07                               | Standard                  | Done        | —     |
| 02  | Demo API v1/v2 + specs + migration notes + sample consumer repo (tests pass on v1, fail on v2) | 2.2, 5.2                                 | Standard                  | Done        | —     |
| 03  | Database schema + migrations (incl. 4-attempt limit + guard-name constraints)                  | DR-01–05                                 | Standard                  | Done        | —     |
| 04  | Ingest: upload/URL, normalize, hash, baseline, dedupe, failure handling                        | FR-01–05, FR-11, FR-12                   | Standard                  | Done        | #1    |
| 05  | Detect: oasdiff runner + parser + evidence                                                     | FR-06, FR-08                             | Standard                  | Done        | #2    |
| 06  | Classify + migration-note parsing + mapping confirmation                                       | FR-07, FR-09, FR-10, BR-01, BR-04, BR-05 | **CRITICAL**              | Done        | #3    |
| 07  | Locate: ts-morph call sites + coverage report                                                  | FR-13–17, BR-02                          | Standard                  | Done        | #4    |
| 08  | Validator: Docker sandbox + output parsing                                                     | FR-25, FR-26, FR-32, NFR-03              | **CRITICAL (checkpoint)** | Done        | #5    |
| 09  | Cheat guards                                                                                   | FR-27–31, DR-04                          | **CRITICAL**              | Done        | #6    |
| 10  | LLM adapter + context assembly                                                                 | FR-19, C-06, NFR-04, NFR-08              | Standard                  | Done        | #7    |
| 11  | Repair loop (retries, error feedback, token ceiling, cost)                                     | FR-18, FR-20–24                          | **CRITICAL**              | Done        | #8    |
| 12  | Delivery: branch + PR, flagged findings                                                        | FR-33–37, C-02                           | Standard                  | Done        | #9    |
| 13  | Pipeline orchestrator + run records + JSON/HTML export                                         | FR-38, FR-39, FR-41                      | Standard                  | Not started | #10   |
| 14  | Dashboard (5 views, text labels)                                                               | UI-01–04, FR-40, FR-42                   | Standard                  | Not started | #11   |
| 15  | 20 frozen scenarios + failing-before check                                                     | EV-01, EV-02                             | **CRITICAL**              | Not started | #12   |
| 16  | Evaluation script: B1/B2/B3, results file, generated tables                                    | EV-03–09                                 | **CRITICAL**              | Not started | #13   |
| 17  | Deliverables: class diagram, statechart, TypeDoc, acceptance records AT-01–12                  | 7.1                                      | Standard                  | Not started | #14   |
| 17a | Early deliverables: diagrams, architecture, TypeDoc fix, early acceptance records              | 7.1                                      | Standard                  | Done        | #25   |

Increment 12 live delivery smoke test: https://github.com/Bigyan1313/sma-demo-consumer/pull/1 (open, never merged).
