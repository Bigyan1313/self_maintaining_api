# INCREMENT 08: Validator (Docker sandbox + output parsing)
Status: **CRITICAL — PROJECT CHECKPOINT**
Dependencies: Increments 02, 03 merged (can run in parallel with 04, 05, 07, 12, 15)

### CRITICAL — READ FIRST ###
**MANDATORY:** Follow the Working Rules in `CLAUDE.md`. Save this prompt verbatim to `prompts/08_validator.md`. Branch: `feat/inc08-validator`. Requirement IDs → `docs/SRS.md`.
**CRITICAL (C-03, FR-32):** Code from a target repo (and later, AI-generated code) **never runs on the host**. Only inside the container.
**CRITICAL (FR-25, NFR-03):** The validation container has **no network**, **no host credentials or env secrets**, runs as a **non-root** user, with **memory/CPU/pids limits**, and a **10-minute wall clock**. The image is **pinned by digest**.
**CRITICAL:** The SRS says nothing after this works is trustworthy. Before coding, write the failure signs + rollback point in `docs/decisions/inc08.md`.

---

## Context for whoever picks this up
`demo/consumer/` is a standalone TS repo. `npm run typecheck` and `npm test` work. Tests pass with `API_VERSION=v1` and fail with `API_VERSION=v2` (8 failing, 4 passing). Use it as the test subject. Docker Desktop must be running.

## Capability
Given a repo (and optionally a patch), create an isolated working copy, install its dependencies safely, run its **own** type check and test suite inside a locked-down container, and return a structured result: compile errors, tests passed/total, duration, raw output (FR-20, FR-25, FR-26).

## Part A — Isolated working copy `apps/server/src/infra/workcopy/`
- `createWorkingCopy(repoPath, commitSha?)` → copies into `.work/<uuid>/` (gitignored) using `git clone --no-hardlinks` + checkout of the commit (or a plain copy for non-git test repos). **The developer's repo is never written to** (FR-20). Return the path + the commit.
- `applyPatch(workDir, unifiedDiff)` → `git apply --check` then `git apply`. Reject patches touching paths outside the repo (`..`, absolute paths) or binary files → typed error `patch_invalid`.
- `disposeWorkingCopy(workDir)`.

## Part B — Sandbox runner `apps/server/src/infra/validator/`
- `image.ts`: `node:22-bookworm-slim@sha256:<digest>` — look up the real current digest and pin it (NFR-09). Document how to update it.
- **Two phases:**
  1. **Install** (before any patch is applied): container **with** network, `npm ci --ignore-scripts` on the *unpatched* lockfile, writing `node_modules` into the working copy. Non-root, same limits. No host env vars passed.
  2. **Validate** (after the patch): `docker run --rm --network none --user 1000:1000 --memory 2g --cpus 2 --pids-limit 256 --cap-drop ALL --security-opt no-new-privileges --tmpfs /tmp -v <workDir>:/work -w /work`, with **only** an explicit allow-list of env vars (e.g. `API_VERSION`, `CI=true`). Run the repo's own `npm run typecheck`, then `npm test -- --reporter=json --outputFile=/work/.sma/vitest.json` (adding a reporter flag is allowed; the repo's commands are otherwise unchanged; log this decision).
- **Timeout:** wall clock 10 min (configurable for tests). On timeout → `docker kill` the named container → `status: 'timeout'` (NFR-06, no automatic retry).
- Docker missing / daemon down → typed error `container_unavailable` (for NFR-02 stage-failure reporting).

## Part C — Result parsing `packages/core/src/validate/` (pure, testable without Docker)
```ts
export interface ValidationResult {
  status: 'pass' | 'fail' | 'error' | 'timeout';
  compileErrors: number;      // count of "error TS\d+" lines from tsc
  testsPassed: number; testsTotal: number;
  testResults: { file: string; name: string; status: 'passed'|'failed'|'skipped'|'todo' }[];
  testFiles: string[];
  durationMs: number;
  rawOutput: string;          // full stdout+stderr, kept (FR-26)
}
```
- `pass` = 0 compile errors AND all tests passed AND testsTotal > 0. `error` = the runner itself failed (e.g. no JSON report).
- `parseTscOutput`, `parseVitestJson` with recorded fixtures.
- Export `validate({ repoPath, commitSha?, patch?, env })` from `apps/server/src/pipeline/validate.ts`, returning `{ workDir, baseline?: ValidationResult, result: ValidationResult }`, plus an option to run the **pre-patch baseline** first (inc09/inc11 need it for the test-count guard).

## Critical checkpoint
- **Failure signs:** the container can reach the internet; runs as root; host env vars visible inside; a test result counts differently from running vitest by hand; host files change.
- **Isolation protocol:** run each security test below on its own; then run consumer v1 alone; compare with a manual `npm test` run on the host *of our own trusted demo code only*.
- **Rollback:** the last merged `main` commit. If the validator isn't reliable, cut scope elsewhere, never here (SRS 7.2).

## Acceptance checks (AT-11 + parts of AT-06/07)
Integration tests (need Docker; run in CI — GitHub's ubuntu runners have Docker):
- [ ] consumer + `API_VERSION=v1` → `pass`, 12/12, 0 compile errors
- [ ] consumer + `API_VERSION=v2` → `fail`, 4/12 passed, and the failing test names match inc02's report
- [ ] **No network:** a throwaway test repo whose test does `fetch('https://example.com')` → that test fails with a network error
- [ ] **Not root:** a test that checks `process.getuid() !== 0` passes
- [ ] **No secrets:** with `GITHUB_TOKEN=ghp_FAKE` and `ANTHROPIC_API_KEY=sk-ant-FAKE` set on the host, a test that prints `process.env` shows neither
- [ ] **Host untouched:** a test that writes to `/etc/hosts` or outside `/work` fails, and the original `demo/consumer` folder has no changes (`git status` clean)
- [ ] **Timeout:** an infinite-loop test with a 20 s test timeout → `timeout`, and the container is gone (`docker ps`)
- [ ] Patch with a `../` path → `patch_invalid`; Docker stopped → `container_unavailable`
- [ ] Unit tests for the parsers using recorded fixtures (no Docker)
- [ ] Report the timings: install phase, validate phase (green < 5 min)
- [ ] Typecheck, lint, tests pass; CI green; PR opened (`Closes #<issue>`)

### CRITICAL — REMINDER ###
**MANDATORY:** Nothing from a target repo runs on the host. Validate container: no network, non-root, limits, 10-min cap, pinned digest, no secrets. The developer's repo is never modified. Raw output is always kept. Decisions → `docs/decisions/inc08.md`. End with the **INCREMENT 08 REPORT** and open the PR.
