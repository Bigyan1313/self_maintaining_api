# SRS Requirement → Prompt Coverage (Group 13, Self-Maintaining APIs)

Every requirement ID in `docs/SRS.md` and the prompt(s) that build or test it.

| Area | IDs | Prompt(s) |
|---|---|---|
| Configuration & ingest | FR-01, FR-02, FR-03, FR-04, FR-05, FR-11, FR-12 | 04 |
| Detection & evidence | FR-06, FR-08 | 05 (evidence also used in 06) |
| Classification & mapping | FR-07, FR-09, FR-10 | 06 |
| Location & coverage | FR-13, FR-14, FR-15, FR-16, FR-17 | 07 |
| Repair | FR-18, FR-20, FR-21, FR-22, FR-23, FR-24 | 11 (FR-20 working copy built in 08) |
| Model context | FR-19 | 10 |
| Validation | FR-25, FR-26, FR-32 | 08 |
| Cheat guards | FR-27, FR-28, FR-29, FR-30, FR-31 | 09 |
| Delivery | FR-33, FR-34, FR-35, FR-36, FR-37 | 12 |
| Run records & export | FR-38, FR-39, FR-41 | 13 (DB enforcement in 03) |
| Dashboard | FR-40, FR-42, UI-01, UI-02, UI-03, UI-04 | 14 |
| Data | DR-01, DR-02 | 03, 13 |
| | DR-03 | 03, 11 |
| | DR-04 | 03, 09 |
| | DR-05 | 13 |
| Nonfunctional | NFR-01 | 13, 16 |
| | NFR-02 | 04, 13 |
| | NFR-03 | 08 |
| | NFR-04 | 04, 10, 12, 13 |
| | NFR-05 | 07, 16 |
| | NFR-06 | 08 (container), 10 (model) |
| | NFR-07 | 11 |
| | NFR-08 | 05, 10 |
| | NFR-09 | 08 (image digest), 16 (reproduce docs) |
| Business rules | BR-01 | 05, 06 |
| | BR-02 | 07 |
| | BR-03 | 12 |
| | BR-04 | 06, 11 |
| | BR-05 | 06 |
| | BR-06 | 04, 13, 14 |
| Constraints | C-01 | 07 |
| | C-02 | 12 |
| | C-03 | 08 |
| | C-04 | 06, 11 |
| | C-05 | 01 (structure), followed by all |
| | C-06 | 10 |
| | C-07 | 01, 08 |
| Evaluation | EV-01, EV-02 | 15 |
| | EV-03, EV-05, EV-06, EV-07, EV-08, EV-09 | 16 |
| | EV-04 | 15 (labels), 16 (scoring) |
| Acceptance | AT-01 | 04, 14 |
| | AT-02 | 04 |
| | AT-03 | 05, 06 |
| | AT-04 | 06 |
| | AT-05, AT-09 | 07 |
| | AT-06 | 08, 11 |
| | AT-07 | 09, 11, 13 |
| | AT-08 | 12, 13, 14 |
| | AT-10 | 10 |
| | AT-11 | 08, 12 |
| | AT-12 | 15, 16 |
| | AT-01 … AT-12 written records | 17 |
| Course deliverables (not SRS) | prompts, screenshots, class diagram, statecharts, description, TypeDoc, unit tests, presentation, archive | 14 (screenshots), 17 (everything else) |

**SRS IDs not covered by any prompt: none.**

## Dependency order (for the GitHub Issues board)
- Ready after 03: **04, 05, 07, 08, 12, 15**
- 06 ← 05 · 09 ← 08 · 14 ← 04 · 10 ← 06 + 07 · 11 ← 08 + 09 + 10 · 13 ← 04, 05, 06, 07, 11, 12 · 16 ← 13 + 15 · 17 ← 13 (finish after 14, 16)
