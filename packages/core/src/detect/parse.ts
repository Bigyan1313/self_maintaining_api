import { createHash } from 'node:crypto';
import { err, ok, type Result } from '../result.js';
import {
  buildJsonPointer,
  extractEvidence,
  locateInSpec,
  type DifferenceAnchor,
} from './pointer.js';
import {
  HTTP_METHODS,
  type DetectParseError,
  type DetectSpecs,
  type DifferenceLevel,
  type HttpMethod,
  type SpecDifference,
} from './types.js';

/**
 * Stable difference id: sha256(`ruleId|method|path|jsonPointer`), first 16 hex chars.
 * @param ruleId - oasdiff rule id.
 * @param method - HTTP method or `null` (hashed as an empty string).
 * @param path - OpenAPI path.
 * @param jsonPointer - RFC 6901 pointer.
 */
export function differenceId(
  ruleId: string,
  method: HttpMethod | null,
  path: string,
  jsonPointer: string,
): string {
  return createHash('sha256')
    .update(`${ruleId}|${method ?? ''}|${path}|${jsonPointer}`, 'utf8')
    .digest('hex')
    .slice(0, 16);
}

/**
 * Maps an oasdiff level (`3`/`2`/`1`, or `ERR`/`WARN`/`INFO`, or `error`/`warning`/`info`) to a
 * {@link DifferenceLevel}; `null` when unrecognised.
 * @param raw - Level as found in oasdiff output.
 */
export function mapOasdiffLevel(raw: unknown): DifferenceLevel | null {
  const value = typeof raw === 'string' ? raw.trim().toLowerCase() : raw;
  if (value === 3 || value === 'err' || value === 'error') return 'error';
  if (value === 2 || value === 'warn' || value === 'warning') return 'warning';
  if (value === 1 || value === 'info') return 'info';
  return null;
}

/**
 * Pulls rule-specific facts out of oasdiff's English text: property name/path, old/new type,
 * parameter name/location, response status, media type. Every backtick-quoted token is also kept
 * in `quoted`, so nothing in the text is lost. Pure.
 * @param ruleId - oasdiff rule id.
 * @param text - oasdiff text.
 */
export function extractDetails(ruleId: string, text: string): Record<string, unknown> {
  const details: Record<string, unknown> = {
    quoted: [...text.matchAll(/`([^`]*)`/g)].map((m) => m[1]),
  };
  const param = /`(path|query|header|cookie)` request parameter `([^`]+)`/i.exec(text);
  if (param) {
    details.paramIn = param[1]!.toLowerCase();
    details.paramName = param[2];
  }
  if (ruleId.includes('property')) {
    const name =
      /the `([^`]+)` (?:response's|request|response) property/.exec(text)?.[1] ??
      /property `([^`]+)`/.exec(text)?.[1];
    if (name) {
      const propertyPath = name.split('/').filter(Boolean);
      details.propertyPath = propertyPath;
      details.propertyName = propertyPath[propertyPath.length - 1] ?? name;
      const attribute = /the `[^`]+` (?:response's|request|response) property `([^`]+)`/.exec(text);
      if (attribute) details.attribute = attribute[1];
    }
    if (/\brequired property\b/.test(text)) details.required = true;
    else if (/\boptional property\b/.test(text)) details.required = false;
  }
  const changed = /changed from `([^`]*)`(?:\/`([^`]*)`)? to `([^`]*)`(?:\/`([^`]*)`)?/.exec(text);
  if (changed) {
    details.oldValue = changed[1];
    details.newValue = changed[3];
    if (ruleId.includes('type')) {
      details.oldType = changed[1];
      details.newType = changed[3];
      if (changed[2] !== undefined) details.oldFormat = changed[2];
      if (changed[4] !== undefined) details.newFormat = changed[4];
    }
  }
  const status = /status `([^`]+)`/.exec(text)?.[1] ?? /`([^`]+)` status/.exec(text)?.[1];
  if (status) details.status = status;
  const mediaType = /media type `([^`]+)`/.exec(text)?.[1];
  if (mediaType) details.mediaType = mediaType;
  if (ruleId.includes('pattern')) {
    const pattern = /pattern `([^`]+)`/.exec(text)?.[1];
    if (pattern) details.pattern = pattern;
  }
  return details;
}

/**
 * Decides what a difference is about from its rule id and extracted details. Pure.
 * @param ruleId - oasdiff rule id.
 * @param method - HTTP method or `null`.
 * @param details - Output of {@link extractDetails}.
 */
export function anchorFor(
  ruleId: string,
  method: HttpMethod | null,
  details: Record<string, unknown>,
): DifferenceAnchor {
  const status = typeof details.status === 'string' ? details.status : null;
  const mediaType = typeof details.mediaType === 'string' ? details.mediaType : undefined;
  const propertyPath = Array.isArray(details.propertyPath)
    ? (details.propertyPath as string[])
    : null;
  if (typeof details.paramName === 'string' && typeof details.paramIn === 'string')
    return { kind: 'parameter', in: details.paramIn, name: details.paramName };
  if (ruleId.startsWith('response-') && propertyPath)
    return { kind: 'response-property', status, propertyPath, mediaType };
  if (ruleId.startsWith('request-') && propertyPath)
    return { kind: 'request-property', propertyPath, mediaType };
  if (ruleId.startsWith('response-')) return { kind: 'response', status };
  if (ruleId.startsWith('request-body')) return { kind: 'request-body' };
  return method ? { kind: 'operation' } : { kind: 'path' };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function toMethod(raw: unknown): HttpMethod | null {
  if (typeof raw !== 'string') return null;
  const upper = raw.toUpperCase();
  return (HTTP_METHODS as readonly string[]).includes(upper) ? (upper as HttpMethod) : null;
}

interface Located {
  jsonPointer: string;
  pointerAfter: string | null;
  operationPointer: string;
  precision: string;
  evidenceBefore: unknown | null;
  evidenceAfter: unknown | null;
}

/** Resolves an anchor in both specs; falls back to the operation, then the path item. */
function locate(
  specs: DetectSpecs,
  path: string,
  method: HttpMethod | null,
  anchor: DifferenceAnchor,
): Located {
  const tries: DifferenceAnchor[] = [anchor];
  if (method && anchor.kind !== 'operation') tries.push({ kind: 'operation' });
  if (anchor.kind !== 'path') tries.push({ kind: 'path' });
  for (const attempt of tries) {
    const hitBefore = locateInSpec(specs.before, path, method, attempt);
    const hitAfter = locateInSpec(specs.after, path, method, attempt);
    const before = hitBefore?.pointer ?? null;
    const after = hitAfter?.pointer ?? null;
    if (before === null && after === null) continue;
    return {
      jsonPointer: (before ?? after)!,
      pointerAfter: after,
      operationPointer: (hitBefore ?? hitAfter)!.operationPointer,
      precision: attempt.kind,
      evidenceBefore: before === null ? null : extractEvidence(specs.before, before),
      evidenceAfter: after === null ? null : extractEvidence(specs.after, after),
    };
  }
  // Not found in either spec (or no specs supplied): a nominal pointer to the operation/path.
  const nominal = buildJsonPointer(
    method ? ['paths', path, method.toLowerCase()] : ['paths', path],
  );
  return {
    jsonPointer: nominal,
    pointerAfter: null,
    operationPointer: nominal,
    precision: 'nominal',
    evidenceBefore: null,
    evidenceAfter: null,
  };
}

/**
 * Parses `oasdiff changelog --format json` output into {@link SpecDifference}s, attaching a JSON
 * pointer and before/after evidence from the supplied specs (FR-06, FR-08).
 *
 * - Unknown rule ids are **kept** with their level (never dropped).
 * - A difference with no path gets `jsonPointer: ""` and `details.unattributed = true`.
 * - Output is sorted deterministically; ids are stable across runs.
 * - Does NOT label anything breaking or safe (that is Classify, Increment 06).
 *
 * Pure: no I/O, no binary needed (NFR-08).
 * @param json - The parsed JSON array (or its text).
 * @param specs - The BEFORE/AFTER spec documents oasdiff compared (for pointers and evidence).
 */
export function parseOasdiffChangelog(
  json: unknown,
  specs: DetectSpecs = {},
): Result<SpecDifference[], DetectParseError> {
  let data = json;
  if (typeof data === 'string' && data.trim() === '') data = null;
  if (typeof data === 'string') {
    try {
      data = JSON.parse(data) as unknown;
    } catch {
      return err({ code: 'bad_output', message: 'oasdiff output is not valid JSON' });
    }
  }
  if (data === null) data = []; // oasdiff prints `null` / nothing when specs are identical
  if (!Array.isArray(data))
    return err({ code: 'bad_output', message: 'oasdiff output is not a JSON array' });

  const differences: SpecDifference[] = [];
  for (const [index, entry] of data.entries()) {
    if (!isRecord(entry))
      return err({ code: 'bad_output', message: `oasdiff entry ${index} is not an object` });
    const ruleId = typeof entry.id === 'string' && entry.id ? entry.id : 'unknown';
    const description = typeof entry.text === 'string' ? entry.text : '';
    const path = typeof entry.path === 'string' ? entry.path : '';
    const method = toMethod(entry.operation);
    const details = extractDetails(ruleId, description);
    if (ruleId === 'unknown') details.missingRuleId = true;
    if (typeof entry.operation === 'string' && entry.operation && !method)
      details.rawOperation = entry.operation;
    for (const key of ['operationId', 'section'] as const)
      if (typeof entry[key] === 'string' && entry[key]) details[key] = entry[key];

    let level = mapOasdiffLevel(entry.level);
    if (level === null) {
      // Keep the difference; record the raw level instead of guessing it away.
      level = 'warning';
      details.unknownLevel = true;
      details.rawLevel = entry.level ?? null;
    }

    if (!path) {
      details.unattributed = true;
      differences.push({
        id: '',
        ruleId,
        level,
        path,
        method,
        jsonPointer: '',
        description,
        details,
        evidenceBefore: null,
        evidenceAfter: null,
      });
      continue;
    }
    const anchor = anchorFor(ruleId, method, details);
    const found = locate(specs, path, method, anchor);
    details.pointerPrecision = found.precision;
    details.operationPointer = found.operationPointer;
    if (found.pointerAfter !== null && found.pointerAfter !== found.jsonPointer)
      details.jsonPointerAfter = found.pointerAfter;
    differences.push({
      id: '',
      ruleId,
      level,
      path,
      method,
      jsonPointer: found.jsonPointer,
      description,
      details,
      evidenceBefore: found.evidenceBefore,
      evidenceAfter: found.evidenceAfter,
    });
  }

  differences.sort(
    (a, b) =>
      cmp(a.path, b.path) ||
      cmp(a.method ?? '', b.method ?? '') ||
      cmp(a.ruleId, b.ruleId) ||
      cmp(a.jsonPointer, b.jsonPointer) ||
      cmp(a.description, b.description),
  );
  const seen = new Map<string, number>();
  for (const d of differences) {
    const base = differenceId(d.ruleId, d.method, d.path, d.jsonPointer);
    const n = seen.get(base) ?? 0;
    seen.set(base, n + 1);
    // Two differences with the same rule/method/path/pointer (rare): disambiguate deterministically.
    d.id = n === 0 ? base : differenceId(d.ruleId, d.method, d.path, `${d.jsonPointer}#${n}`);
  }
  return ok(differences);
}

function cmp(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}
