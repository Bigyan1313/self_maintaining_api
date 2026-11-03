# Decisions — Increment 08: Validator (Docker sandbox + output parsing)

## Critical checkpoint (written before any code)

**Rollback point:** `f9b0ad8` (Merge pull request #18, `feat/inc06-classify`), the last merged commit on `main` when this increment started.

**Failure signs.** If any of these appears, the validator is not trustworthy and nothing after it is either:

1. The validate container can reach the network (DNS or HTTP to any host succeeds).
2. The container process runs as root (`uid 0`), or can gain privileges.
3. A host environment variable (for example `GITHUB_TOKEN` or `ANTHROPIC_API_KEY`) is visible inside the container.
4. A test count differs from running vitest by hand on the same trusted demo code. Specifically, consumer v1 is not 12/12, or consumer v2 is not 4/12 with the inc02 failing names.
5. A file on the host changes: `demo/consumer` (`git status` not clean), or anything outside the per-run `.work/<uuid>/` copy.
6. A timed-out container is still running (`docker ps`) after `status: 'timeout'`.
7. A patch with `../`, an absolute path, or binary content is applied instead of being rejected as `patch_invalid`.
8. Target-repo code runs on the host, for example `npm ci` running lifecycle scripts on the host, or the host running tests on the work copy.

**Isolation protocol.** Run each security test on its own (separate throwaway repo, separate container). Then run consumer v1 alone. Compare with a manual host `npm test` of our own trusted demo code only. Fix order if a check fails: isolate the component, test it alone with a simple input, check intermediate outputs, fix, then re-run all tests.

## Decisions

| Date | Increment | Decision | Why |
| ---- | --------- | -------- | --- |
