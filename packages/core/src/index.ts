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
