# Decisions Log (index)

Decisions are kept in **one file per increment** so parallel PRs do not conflict.
Each file is a table with columns: Date | Increment | Decision | Why.

| Increment                            | File                                            |
| ------------------------------------ | ----------------------------------------------- |
| 00–01 Master context + project setup | [docs/decisions/inc01.md](decisions/inc01.md)   |
| 02 Demo API and consumer             | [docs/decisions/inc02.md](decisions/inc02.md)   |
| 03 Database schema                   | [docs/decisions/inc03.md](decisions/inc03.md)   |
| 03b Team workflow                    | [docs/decisions/inc03b.md](decisions/inc03b.md) |
| 04 Ingest                            | [docs/decisions/inc04.md](decisions/inc04.md)   |
| 05 Detect                            | [docs/decisions/inc05.md](decisions/inc05.md)   |
| 06 Classify and mapping confirmation | [docs/decisions/inc06.md](decisions/inc06.md)   |
| 07 Locate and coverage               | [docs/decisions/inc07.md](decisions/inc07.md)   |
| 08 Validator (Docker sandbox)        | [docs/decisions/inc08.md](decisions/inc08.md)   |
| 09 Cheat guards                      | [docs/decisions/inc09.md](decisions/inc09.md)   |

New increments add `docs/decisions/incNN.md` in their own PR and add one row here.
