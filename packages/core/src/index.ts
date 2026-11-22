/**
 * `@sma/core` — pure domain logic for the Self-Maintaining APIs pipeline.
 *
 * This package must never import from `apps/*` and must never touch the
 * network, Docker, or an LLM (C-05, NFR-08).
 *
 * @packageDocumentation
 */

export { version } from './version.js';
export { ok, err, isOk, isErr } from './result.js';
export type { Result, Ok, Err } from './result.js';
export * from './domain/enums.js';
export * from './api/contract.js';
export * from './ingest/spec.js';
export * from './repo/limits.js';
export * from './detect/types.js';
export * from './detect/pointer.js';
export * from './detect/parse.js';
export * from './migration-note/parse.js';
export * from './migration-note/validate.js';
export * from './classify/rules.js';
export * from './classify/classify.js';
export * from './locate/types.js';
export * from './locate/locate.js';
export * from './validate/types.js';
export * from './validate/tsc.js';
export * from './validate/vitest.js';
export * from './validate/result.js';
export * from './validate/patch.js';
export * from './guards/diff.js';
export * from './guards/paths.js';
export * from './guards/verdict.js';
export * from './guards/static.js';
export * from './guards/count.js';
export * from './repair/context.js';
export * from './repair/output.js';
export * from './repair/loop.js';
export * from './delivery/redact.js';
export * from './delivery/branch.js';
export * from './delivery/pr-body.js';
