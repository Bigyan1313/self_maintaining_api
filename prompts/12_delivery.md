# INCREMENT 12: Delivery (branch + pull request, flagged findings)
Status: Standard
Dependencies: Increment 03 merged (can run in parallel with 04, 05, 07, 08, 15)

### CRITICAL — READ FIRST ###
**MANDATORY:** Follow the Working Rules in `CLAUDE.md`. Save this prompt verbatim to `prompts/12_delivery.md`. Branch: `feat/inc12-delivery`. Requirement IDs → `docs/SRS.md`.
**CRITICAL (C-02, FR-34):** The system **NEVER merges** a PR, **never enables auto-merge**, **never pushes to the default branch**, and never deploys. Build it so these actions are *impossible* through our code, not just unused.
**CRITICAL (NFR-04):** The token is read from the env var named by `repositories.credential_ref` at call time. It never appears in logs, PR bodies, errors, or exports.

---

## Context for whoever picks this up
The `repositories` table holds owner/name/default_branch/credential_ref (an env var NAME, e.g. `GITHUB_TOKEN`). `runs.pr_url` and `runs.flagged_reason` exist (inc03). **Human task (tell the user in the report):** create a separate GitHub repo (e.g. `Bigyan1313/sma-demo-consumer`), push the contents of `demo/consumer` to it, and make a **fine-grained personal access token** with *Contents: read/write* and *Pull requests: read/write* on **that repo only**, saved in `.env` as `GITHUB_TOKEN`.

## Capability
For a validated patch, create a branch and a pull request with full evidence via the GitHub REST API. For a refused/failed/cheating outcome, open no PR and record a flagged finding. A delivery failure keeps the patch and can be retried (FR-33–37, C-02, BR-03).

## Part A — Safe GitHub client `apps/server/src/infra/github/client.ts`
- A wrapper around Octokit (version pinned) that exposes **only**: get repo, get ref, create blob/tree/commit (Git Data API), create ref (**branch name must start with `sma/` and never equal the default branch**), create PR, add labels, get PR. **Nothing else is exported.** No merge, no auto-merge, no ref update on the default branch, no deletes.
- Don't push with `git` + a token in the URL (it leaks); build the commit with the Git Data API from the patched files.
- Errors are scrubbed of the token before they are returned or logged.

## Part B — Delivery `apps/server/src/pipeline/deliver.ts`
- `deliver({ run, repo, patch, patchedFiles, evidence })`:
  - branch `sma/run-<runId>-<category>`, based on the **analyzed commit** (not whatever the default branch is now)
  - PR title: `[SMA] <category>: <METHOD> <path>`
  - **PR body** (template in `pr-body.ts`, unit-tested): what changed in the spec (before/after JSON, trimmed); the migration-note citation (file + entry) or "Confirmed by <human> at <time>"; affected files + call-site lines; attempt count; the test output summary (passed/total) + a collapsed `<details>` with the trimmed raw output; a clear note: *"Machine-generated. Passing validation is evidence, not proof. Review before merging. This tool never merges."* (BR-03)
  - Labels: `machine-generated`, `awaiting-human-review` (create them if missing) (FR-35)
  - On success: set `runs.pr_url`, write the `deliver` stage result.
  - On failure: stage result `failed`, status `stage_failure` (failure_stage `deliver`), and **the validated patch stays stored** (attempt row). `retryDelivery(runId)` re-attempts from the stored patch (FR-37).
- `recordFlaggedFinding(runId, reason)` for refused/failed/cheating/aborted runs → **no PR**, the reason saved (FR-36).
- Redact token-looking strings from everything placed in the PR body.

## Acceptance checks (AT-08, delivery part)
Unit/integration tests with a mocked GitHub API (msw or nock):
- [ ] A happy path makes exactly: get ref → blob(s) → tree → commit → create ref `sma/…` → create PR → add labels; and the PR body contains the evidence, note citation, files, and test summary
- [ ] **Never-merge proof:** the client module exports no merge/auto-merge/delete function (test the export list); an attempt to create a ref equal to the default branch throws; a grep test fails the build if `pulls.merge`, `enablePullRequestAutoMerge`, or `git push` show up in `apps/server/src`
- [ ] GitHub 500 on create PR → `stage_failure` (deliver), the patch is kept, and `retryDelivery` then succeeds
- [ ] Flagged finding (e.g. cheating) → 0 GitHub calls, reason stored
- [ ] With `GITHUB_TOKEN=ghp_FAKE123`, the token never appears in any error, log, or PR body (assert)
- [ ] **Live smoke test (skipped unless `GITHUB_TOKEN` and `SMA_DEMO_REPO` are set):** open a real PR on the demo consumer repo with a tiny honest patch. Report the PR URL. **Do not merge it.**
- [ ] Typecheck, lint, tests pass; CI green; PR opened (`Closes #<issue>`)

### CRITICAL — REMINDER ###
**MANDATORY:** Merge and auto-merge are impossible through our client; branches are always `sma/…` and never the default branch; the token is never exposed; delivery failures keep the patch and can be retried; no PR for flagged outcomes. Decisions → `docs/decisions/inc12.md`. End with the **INCREMENT 12 REPORT** (including the human tasks) and open the PR.
