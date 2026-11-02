import { createHash } from 'node:crypto';
import { Buffer } from 'node:buffer';
import { parseDocument } from 'yaml';
import { Validator } from '@seriousme/openapi-schema-validator';
import { err, ok, type Result } from '../result.js';

/** Maximum UTF-8 document size (SRS 5.2). */
export const MAX_SPEC_BYTES = 5 * 1024 * 1024;
/** JSON-compatible OpenAPI object. */
export type SpecDocument = Record<string, unknown>;
/** Expected ingestion errors, safe for callers to distinguish from no change. */
export interface SpecError {
  code: 'too_large' | 'parse_error' | 'invalid_openapi' | 'unreachable' | 'timeout';
  message: string;
}

/** Canonical JSON: sorted object keys, array order retained; rejects cycles/non-JSON values. */
export function normalizeSpec(doc: unknown): string {
  const active = new Set<object>();
  function encode(value: unknown): string {
    if (value === null) return 'null';
    if (typeof value === 'string' || typeof value === 'boolean') return JSON.stringify(value);
    if (typeof value === 'number' && Number.isFinite(value)) return JSON.stringify(value);
    if (typeof value !== 'object' || active.has(value))
      throw new Error('Document must be acyclic JSON');
    active.add(value);
    const result = Array.isArray(value)
      ? `[${value.map(encode).join(',')}]`
      : `{${Object.keys(value)
          .sort()
          .map((key) => `${JSON.stringify(key)}:${encode((value as Record<string, unknown>)[key])}`)
          .join(',')}}`;
    active.delete(value);
    return result;
  }
  return encode(doc);
}

/** Deterministic lowercase SHA-256; no I/O. */
export function hashSpec(canonical: string): string {
  return createHash('sha256').update(canonical, 'utf8').digest('hex');
}

/** Parse JSON/YAML as data and validate OpenAPI 3.0/3.1 without resolving external references. */
export async function parseSpec(
  text: string,
  _filenameHint?: string,
): Promise<Result<SpecDocument, SpecError>> {
  if (Buffer.byteLength(text, 'utf8') > MAX_SPEC_BYTES)
    return err({ code: 'too_large', message: 'Specification exceeds 5 MiB' });
  let value: unknown;
  try {
    const document = parseDocument(text, { version: '1.2', uniqueKeys: true, prettyErrors: false });
    if (document.errors.length)
      return err({
        code: 'parse_error',
        message: document.errors.map((e) => e.message).join('; '),
      });
    value = document.toJS({ maxAliasCount: 100 });
    // Validate the JSON representation too (YAML cycles, nonfinite values, and deep structures).
    normalizeSpec(value);
  } catch {
    return err({
      code: 'parse_error',
      message: 'Cannot parse specification as finite, acyclic JSON/YAML',
    });
  }
  if (
    !value ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    !('openapi' in value) ||
    typeof value.openapi !== 'string' ||
    !/^3\.[01]\.\d+$/.test(value.openapi)
  ) {
    return err({ code: 'invalid_openapi', message: 'Expected an OpenAPI 3.0 or 3.1 document' });
  }
  try {
    const validator = new Validator();
    const result = await validator.validate(value as Parameters<Validator['validate']>[0]);
    if (!result.valid)
      return err({
        code: 'invalid_openapi',
        message: JSON.stringify(result.errors ?? 'OpenAPI schema validation failed'),
      });
  } catch {
    return err({
      code: 'invalid_openapi',
      message: 'OpenAPI schema or reference validation failed',
    });
  }
  return ok(value as SpecDocument);
}

/** Pure baseline/deduplication decision. Re-seeing any stored version is no change (FR-05). */
export function decideCheckOutcome(input: {
  baselineHash: string | null;
  newHash: string;
  existingHashes: readonly string[];
}): 'baseline_established' | 'no_change' | 'changed' {
  if (input.baselineHash === null) return 'baseline_established';
  return input.newHash === input.baselineHash || input.existingHashes.includes(input.newHash)
    ? 'no_change'
    : 'changed';
}
