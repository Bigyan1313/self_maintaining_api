# Self-Maintaining APIs

When a REST API provider changes its OpenAPI spec in a breaking way, this system detects the change, finds the affected call sites in a TypeScript consumer repo, asks an LLM agent for a fix, validates that fix in an isolated Docker sandbox, and opens a pull request for human review. It also measures how often the agent repairs breaking changes correctly, and where it fails. (CS 4398, Group 13. Requirements: `docs/SRS.docx`, with a Markdown copy in `docs/SRS.md`.)

## Prerequisites

| Tool    | Version                              | Notes                                                             |
| ------- | ------------------------------------ | ----------------------------------------------------------------- |
| Node.js | 22 LTS (≥ 22.13, see `.nvmrc`)       | `nvm use`                                                         |
| npm     | 10+ (ships with Node)                | workspaces + `save-exact`                                         |
| Docker  | Docker Desktop / Engine with Compose | PostgreSQL now; sandboxed validation later                        |
| git     | any recent version                   |                                                                   |
| oasdiff | 1.35.0 (pinned)                      | `brew install oasdiff` or see github.com/oasdiff/oasdiff/releases |

## Setup

```bash
nvm use                 # Node 22
npm ci                  # install exact, locked dependencies
cp .env.example .env    # then fill in real values (never commit .env)
npm run db:up           # start PostgreSQL 16 and wait until healthy
npm run db:migrate      # apply the SQL migrations in apps/server/drizzle/ to the dev database
```

`npm test` needs PostgreSQL running (`npm run db:up`): the server's database tests drop, recreate
and migrate a separate `sma_test` database before the suite. They never touch the dev database.

## Common commands

```bash
npm run typecheck       # tsc --noEmit in every workspace
npm run lint            # ESLint (flat config)
npm run format          # Prettier
npm test                # Vitest in every workspace
npm run docs            # TypeDoc → docs/api/
npm run db:down         # stop PostgreSQL (data kept in a named volume)
npm run db:generate     # generate a migration after editing apps/server/src/infra/db/schema.ts
npm run db:reset:test   # drop, recreate and migrate the sma_test database

npm run dev -w @sma/server   # API on http://127.0.0.1:3000 (GET /health)
npm run dev -w @sma/web      # dashboard on http://localhost:5173

npm run start:v1 -w @sma/demo-api   # Demo Shop API v1 on :4001 (start:v2 → :4002)
npm run consumer:install            # install the standalone sample consumer (demo/consumer)
npm run consumer:test:v1            # consumer tests against recorded v1 responses: all pass
npm run consumer:test:v2            # against v2: the 5 breaking changes make tests fail (by design)
```

## Layout

```
packages/core   pure domain logic (no network / Docker / LLM)
apps/server     Fastify HTTP + pipeline orchestrator (src/http, src/infra, src/pipeline)
apps/web        React + Vite dashboard
demo/api        Demo Shop API (v1/v2), OpenAPI specs, migration notes, fixture + client scripts
demo/consumer   standalone sample consumer repo (NOT a workspace member)
scenarios/      frozen evaluation scenarios
eval/           evaluation script + results
prompts/        Module-of-Thought prompts, saved verbatim
docs/           SRS, progress, decisions, diagrams, acceptance records
```
