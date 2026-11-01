# INCREMENT 07: Locate (ts-morph call sites + coverage report)
Status: Standard
Dependencies: Increment 03 merged (can run in parallel with 04, 05, 08, 12, 15)

### CRITICAL — READ FIRST ###
**MANDATORY:** Follow the Working Rules in `CLAUDE.md`. Save this prompt verbatim to `prompts/07_locate.md`. Branch: `feat/inc07-locate`. Requirement IDs → `docs/SRS.md`.
**CRITICAL:** Use the **TypeScript syntax tree (ts-morph)**, never text/regex search (FR-13). Code is **read, never executed**.
**CRITICAL (BR-02, FR-17):** "Not affected" is allowed ONLY when coverage is complete AND no dynamic/unsupported usage was seen. Anything uncertain → **"Needs review"**. Never infer compatibility from code you didn't inspect.

---

## Context for whoever picks this up
`demo/consumer/` is the sample repo: `src/customers.ts` (fetch + template URL), `src/orders.ts` (axios instance), `src/invoices.ts` (generated client from `src/generated/apiClient.ts`), `src/admin.ts` (axios static import), `src/unsupported/dynamicUrl.ts` and `src/unsupported/wrapper.ts` (must be reported as coverage limits). If inc04 is merged, reuse `packages/core/src/repo/limits.ts` (`countRepoSize`); if not, create that file with the same name and exclusions (see SRS 5.2), and note it in the PR.

## Capability
Given a changed API operation (method + path, and operationId when known) and a repo path, find every supported call site (file, line, column, pattern, excerpt) and report which files were inspected or skipped and why (FR-13–17, BR-02, C-01).

## Part A — Types `packages/core/src/locate/types.ts`
```ts
export interface LocateTarget { method: HttpMethod; path: string; operationId?: string; field?: string; }
export interface CallSite { filePath: string; line: number; column: number; pattern: 'fetch'|'axios_instance'|'axios_static'|'generated_client'; excerpt: string; }
export interface CoverageEntry { filePath: string; inspected: boolean; skipReason?: string; }
export interface UnsupportedUsage { filePath: string; line: number; kind: 'dynamic_url'|'wrapper'|'reexported_alias'|'unknown_client'; excerpt: string; }
export interface LocateResult {
  outcome: 'affected' | 'not_affected' | 'needs_review';
  callSites: CallSite[]; coverage: CoverageEntry[]; unsupported: UnsupportedUsage[];
  limitsExceeded?: { files: number; lines: number; message: string };
  reason: string; // plain sentence
}
```

## Part B — Locator `packages/core/src/locate/`
- **File selection (SRS 5.2):** `.ts`/`.tsx` only; exclude `node_modules`, `.git`, `dist`, `build`, `coverage`, `*.d.ts`, `.env*`, credential/key files; **don't follow symlinks** (record them as skipped: "symbolic link not followed"). Every non-selected file inside `src/` gets a coverage entry with a reason. Repo over **200 files or 20,000 lines** → refuse with `limitsExceeded` and a clear message, and `needs_review`.
- **URL matching:** turn a call's URL argument into a template: string literal or template literal; drop a leading base expression (`${BASE}`, `${baseUrl}`, `process.env...`) or the axios instance's `baseURL`; replace every `${...}` with `{}`; compare with the target path where `{param}` → `{}`. Match the HTTP method: fetch `method` option (default GET); `axios.get/post/put/patch/delete`, `axios({ method })`, `instance.get(...)`.
- **Patterns:**
  1. `fetch(url, opts?)` with a literal/template URL → `fetch`
  2. a variable created by `axios.create(...)` (same file or imported), then `.get/.post/...` → `axios_instance`
  3. `import axios from 'axios'` then `axios.get(...)` etc. → `axios_static`
  4. a call to a function imported from a module under `generated/` whose **name equals the target operationId** → `generated_client`
- **Unsupported (FR-17):** a fetch/axios call whose URL is NOT a literal/template (built at runtime, e.g. `[..].join('/')`, a function parameter) → `dynamic_url`. A local function that forwards its argument into fetch/axios → `wrapper` (and the wrapper's callers are not resolved). Re-exported/aliased axios or fetch → `reexported_alias`.
- **Outcome:** ≥ 1 call site → `affected` (unsupported usages are still listed). 0 sites + complete coverage + no unsupported usage → `not_affected`, reason "Not affected within supported scope". Otherwise → `needs_review`.
- Excerpt = the call line ± 2 lines.

## Part C — Server
`apps/server/src/pipeline/locate.ts`: `locate(runId, repoPath, target)` → runs the locator, records the analyzed commit (`git rev-parse HEAD`), writes `call_sites` and `coverage_entries`, returns `LocateResult`. (The `runs` row is created by the orchestrator in inc13; for now, accept a runId created in tests.)

## Acceptance checks (AT-05, AT-09)
- [ ] Against `demo/consumer`: each of the 5 demo changes finds the right file + line + pattern (customers → fetch, orders total → axios_instance, list orders → axios_instance, invoice → generated_client, DELETE → axios_static)
- [ ] `src/unsupported/dynamicUrl.ts` → `dynamic_url`; `wrapper.ts` → `wrapper`; neither is treated as "not used"
- [ ] A target that nothing calls → `not_affected` **only** if no unsupported usage exists; in demo/consumer (which has unsupported files) it must be `needs_review`
- [ ] A comment or string containing `/customers/` is NOT a call site (proves it's syntax-tree based)
- [ ] Symlink skipped with a reason; `.env` and `node_modules` excluded; a generated 201-file repo is refused with a limit message
- [ ] **NFR-05:** a generated repo with 200 files / ~20,000 lines locates in **< 60 s** (report the time; green < 30 s)
- [ ] Typecheck, lint, tests pass; CI green; PR opened (`Closes #<issue>`)

### CRITICAL — REMINDER ###
**MANDATORY:** Syntax tree, not text. Read, never execute. Uncertain = "Needs review", never "Not affected". Every skipped file has a reason. Decisions → `docs/decisions/inc07.md`. End with the **INCREMENT 07 REPORT** and open the PR.
