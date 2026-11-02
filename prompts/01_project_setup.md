# INCREMENT 01: Project Setup
Status: Standard
Dependencies: Prompt 00 (master context)

### CRITICAL — READ FIRST ###
**MANDATORY:** Follow the Working Rules in `prompts/00_master_context.md` Section 7. Save this prompt verbatim to `prompts/01_project_setup.md` first. Work on branch `feat/inc01-project-setup`.
**CRITICAL:** Build ONLY the project skeleton and tooling. **No pipeline logic** (no ingest, diff, or LLM code) in this increment.

---

## Capability
A working npm-workspaces monorepo where `npm ci`, `npm run typecheck`, `npm run lint`, `npm test`, and `npm run docs` all succeed on a clean clone, with PostgreSQL available through docker-compose and CI running on every push.

## Tasks

1. **Root setup**
   - `package.json` with npm workspaces: `packages/*`, `apps/*`, `demo/*`, `eval`.
   - Root scripts: `typecheck`, `lint`, `format`, `test`, `docs` (TypeDoc), `db:up`, `db:down`.
   - `.nvmrc` = Node 22. `engines` field set.
   - `tsconfig.base.json`: `strict: true`, `noUncheckedIndexedAccess: true`, ES2022, NodeNext modules. Each workspace extends it.
   - ESLint (flat config) + Prettier. Lint rule: ban `@ts-ignore` / `@ts-nocheck` in our own source.
   - `.gitignore` (node_modules, dist, .env, coverage, `.work/` for future isolated working copies).
   - `.env.example` with placeholders only: `DATABASE_URL`, `GITHUB_TOKEN`, `ANTHROPIC_API_KEY`, `LLM_MODEL`, `RUN_TOKEN_CEILING`.
   - **Pin every dependency to an exact version** (`save-exact=true` in `.npmrc`).

2. **Workspaces (empty shells, each with 1 smoke test)**
   - `packages/core` — exports a `version` constant + a `Result<T,E>` type. **No imports from apps/*.**
   - `apps/server` — Fastify app with `GET /health` → `{ status: "ok" }`, built with a `buildApp()` factory so tests can use `app.inject()` without opening a port. Folders: `src/http/`, `src/infra/`, `src/pipeline/` (empty `index.ts` placeholders).
   - `apps/web` — React + Vite page that shows "Self-Maintaining APIs" and calls `/health`.
   - `demo/api`, `demo/consumer`, `eval` — placeholder `package.json` + README line saying which increment fills them.

3. **Database**
   - `docker-compose.yml` with `postgres:16` **pinned by digest**, a named volume, and a healthcheck. Credentials only from `.env`.
   - Add Drizzle ORM + drizzle-kit to `apps/server`, with a config file and an empty schema file (tables come in Increment 03).

4. **CI** — `.github/workflows/ci.yml`: on push/PR → setup Node 22, `npm ci`, typecheck, lint, test. (No Docker or DB steps yet.)

5. **Docs**
   - `typedoc.json` covering `packages/core` and `apps/server`, output to `docs/api/` (gitignored).
   - `README.md`: what the project is (2–3 lines), prerequisites (Node 22, Docker, git, oasdiff), and setup commands.
   - Check that `docs/SRS.docx` exists. If it does not, note it under "things the human must do".

6. **Prerequisite check** — run and report the versions of `node`, `npm`, `docker`, `git`, and `oasdiff`. If any is missing, say how to install it on this OS and continue with everything else.

## Acceptance checks (all must pass before merge)
- [ ] `npm ci` works from a clean state
- [ ] `npm run typecheck`, `npm run lint`, `npm test` all pass (≥ 1 test each in core, server, web)
- [ ] Server test: `GET /health` returns 200 `{status:"ok"}` via `app.inject()`
- [ ] `npm run db:up` starts Postgres and the healthcheck turns healthy (skip with a note if Docker isn't running)
- [ ] `npm run docs` generates TypeDoc output
- [ ] `packages/core` has no imports from `apps/*`
- [ ] No unpinned versions (`^`/`~`) in any package.json
- [ ] At least 3 meaningful commits on the branch, then `git merge --no-ff` into `main` and push (if a remote is set; if not, report it)

### CRITICAL — REMINDER ###
**MANDATORY:** Skeleton and tooling ONLY. No pipeline logic. Exact versions only. No secrets committed. Log choices in `docs/DECISIONS.md`, update `docs/PROGRESS.md`, and finish with the **INCREMENT 01 REPORT** in the exact format from Section 8 of the master context. Do not start Increment 02.
