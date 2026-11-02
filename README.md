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

## Ingest API (Increment 04)

Start the server with `npm run dev -w @sma/server`; it loads the root `.env`.
Use Node 22 (`nvm use`, or on Homebrew: `export PATH="/opt/homebrew/opt/node@22/bin:$PATH"`).

- `GET/POST /api/repositories`: register `{ owner, name, defaultBranch, localPath, credentialRef? }`.
  The path must be a Git repository root with the named local branch. Credentials are environment
  variable **names**, never token values. Source limits are 200 selected TS/TSX files and 20,000 lines.
- `GET/POST /api/apis`: register `{ name, specSourceUrl?, specText?, filename?, pollIntervalSeconds? }`.
  Supply a URL or uploaded spec text. An uploaded registration establishes its baseline atomically.
- `POST /api/apis/:id/specs`: raw JSON/YAML body, up to 5 MiB. Use `application/json`,
  `application/yaml`, `application/x-yaml`, `text/yaml`, `text/plain`, or `application/octet-stream`.
- `POST /api/apis/:id/check`: retrieve the configured URL (empty body or `{}`).
- `GET /api/apis/:id/checks`: persisted history, including failed checks.

```bash
curl -H 'Content-Type: application/json' \
  -d '{"name":"demo-shop","specSourceUrl":"http://localhost:4001/openapi.yaml"}' \
  http://127.0.0.1:3000/api/apis
# Replace API_ID with the returned id; manual upload works without a spec HTTP server.
curl -H 'Content-Type: application/yaml' --data-binary @demo/api/specs/v1.yaml \
  http://127.0.0.1:3000/api/apis/API_ID/specs
```

The demo REST app does not currently publish an `/openapi.yaml` route. For URL retrieval, point
`specSourceUrl` at a server that actually serves a spec; the acceptance test serves the checked-in
v2 document on a test route of the demo app. Uploaded copies are labeled `uploaded`; the internal
`ingest(..., { mode: 'fixture', version: 'v1' })` option explicitly labels disk-loaded demo fixtures.

Uploads/checks return `{ check, baselineVersionId, sourceMode }`, with outcome/source values and
text labels. Failed checks return HTTP 422 (413 for oversized uploads), remain in history, and
preserve the baseline. Invalid registration returns HTTP 400 with `{ field, message }[]` and
creates no check. Duplicate registration returns 409. Missing APIs return 404; storage failures
return 500 without exposing database details. No change list or repair run is created in this increment.

Polling is off unless `pollIntervalSeconds >= 60` is configured. In this single-process server,
manual and scheduled checks share a queue. Failed checks can be retried; changed specifications
never advance the baseline automatically. The future orchestrator must explicitly call
`advanceBaseline` after classification.

The full shared contract is `packages/core/src/api/contract.ts`; dashboard code should import
`@sma/core/api/contract` to avoid Node-only ingestion imports. Later endpoint contracts are declared
but their routes are not implemented yet. Increment 07 should reuse `countRepoSize` and
`repoSkipReason` with the server's `fileSystemRepoReader` instead of adding a second file selector.
