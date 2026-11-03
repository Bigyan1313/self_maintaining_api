/**
 * Pure RFC 6901 JSON Pointer helpers plus a resolver that maps a difference's "anchor" (an
 * operation, a parameter, a response property…) to the pointer where that item actually lives,
 * following local `$ref`s. No I/O.
 */

const MAX_REF_HOPS = 32;
const MAX_COMBINATOR_DEPTH = 8;

/**
 * Escapes one reference token (RFC 6901 §3: `~` → `~0`, `/` → `~1`).
 * @param segment - Raw token.
 */
export function escapePointerSegment(segment: string): string {
  return segment.replace(/~/g, '~0').replace(/\//g, '~1');
}

/**
 * Builds an RFC 6901 pointer from raw tokens, e.g. `['paths', '/orders', 'get']` →
 * `/paths/~1orders/get`. An empty list gives `""` (the whole document).
 * @param segments - Unescaped tokens.
 */
export function buildJsonPointer(segments: readonly (string | number)[]): string {
  return segments.map((s) => `/${escapePointerSegment(String(s))}`).join('');
}

/**
 * Splits a pointer into unescaped tokens, or `null` when it is not a valid pointer.
 * @param pointer - RFC 6901 pointer.
 */
export function parseJsonPointer(pointer: string): string[] | null {
  if (pointer === '') return [];
  if (!pointer.startsWith('/')) return null;
  return pointer
    .slice(1)
    .split('/')
    .map((s) => s.replace(/~1/g, '/').replace(/~0/g, '~'));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function lookup(doc: unknown, pointer: string): { found: boolean; value: unknown } {
  const tokens = parseJsonPointer(pointer);
  if (!tokens) return { found: false, value: undefined };
  let current: unknown = doc;
  for (const token of tokens) {
    if (Array.isArray(current)) {
      if (!/^(0|[1-9]\d*)$/.test(token) || Number(token) >= current.length)
        return { found: false, value: undefined };
      current = current[Number(token)];
    } else if (isRecord(current) && Object.prototype.hasOwnProperty.call(current, token)) {
      current = current[token];
    } else {
      return { found: false, value: undefined };
    }
  }
  return { found: true, value: current };
}

/**
 * Returns a deep copy of the JSON at `pointer` in `doc`, or `null` when nothing is there.
 * Plain RFC 6901 lookup: `$ref`s are not followed (pointers from {@link resolveAnchor} already
 * point at the dereferenced location).
 * @param doc - JSON document (e.g. a normalized spec).
 * @param pointer - RFC 6901 pointer.
 */
export function extractEvidence(doc: unknown, pointer: string): unknown | null {
  if (doc === undefined || doc === null) return null;
  const { found, value } = lookup(doc, pointer);
  if (!found || value === undefined) return null;
  return JSON.parse(JSON.stringify(value)) as unknown;
}

/** What a difference is about, independent of where it lives in a particular spec. */
export type DifferenceAnchor =
  | { kind: 'path' }
  | { kind: 'operation' }
  | { kind: 'parameter'; in: string; name: string }
  | { kind: 'request-body' }
  | { kind: 'request-property'; propertyPath: string[]; mediaType?: string }
  | { kind: 'response'; status: string | null }
  | {
      kind: 'response-property';
      status: string | null;
      propertyPath: string[];
      mediaType?: string;
    };

/**
 * Where an anchored item was found in one spec.
 * - `pointer`: RFC 6901 pointer to the real location (local `$ref`s followed), so a plain lookup
 *   resolves it.
 * - `operationPointer`: the same item addressed through the path/operation (FR-06 "pointer into
 *   the operation"); it resolves only when `$ref`s along the way are followed.
 */
export interface AnchorLocation {
  pointer: string;
  operationPointer: string;
}

interface Located {
  pointer: string;
  logical: string;
  value: unknown;
}

const ROOT: Omit<Located, 'value'> = { pointer: '', logical: '' };

/** Follows local `$ref`s (`#/...`) from `pointer` until a non-reference node is reached. */
function deref(doc: unknown, pointer: string, logical: string): Located | null {
  let current = pointer;
  for (let hop = 0; hop <= MAX_REF_HOPS; hop++) {
    const { found, value } = lookup(doc, current);
    if (!found) return null;
    if (isRecord(value) && typeof value.$ref === 'string') {
      const ref = value.$ref;
      if (!ref.startsWith('#')) return { pointer: current, logical, value }; // external: not followed
      try {
        current = decodeURIComponent(ref.slice(1));
      } catch {
        return null;
      }
      continue;
    }
    return { pointer: current, logical, value };
  }
  return null; // reference cycle
}

function child(doc: unknown, parent: Omit<Located, 'value'>, ...tokens: string[]): Located | null {
  const suffix = buildJsonPointer(tokens);
  return deref(doc, parent.pointer + suffix, parent.logical + suffix);
}

function findParameter(
  doc: unknown,
  path: string,
  method: string | null,
  where: string,
  name: string,
): Located | null {
  const item = child(doc, ROOT, 'paths', path);
  if (!item) return null;
  const containers: Located[] = [];
  if (method) {
    const op = child(doc, item, method.toLowerCase());
    if (op) containers.push(op);
  }
  containers.push(item); // path-level parameters apply to every operation
  for (const container of containers) {
    const list = child(doc, container, 'parameters');
    if (!list || !Array.isArray(list.value)) continue;
    for (let i = 0; i < list.value.length; i++) {
      const param = child(doc, list, String(i));
      if (
        param &&
        isRecord(param.value) &&
        param.value.name === name &&
        typeof param.value.in === 'string' &&
        param.value.in.toLowerCase() === where.toLowerCase()
      )
        return param;
    }
  }
  return null;
}

/** Finds a named property in a schema, looking through `allOf`/`oneOf`/`anyOf` members. */
function findProperty(doc: unknown, schema: Located, name: string, depth = 0): Located | null {
  if (depth > MAX_COMBINATOR_DEPTH || !isRecord(schema.value)) return null;
  const props = schema.value.properties;
  if (isRecord(props) && Object.prototype.hasOwnProperty.call(props, name))
    return child(doc, schema, 'properties', name);
  for (const key of ['allOf', 'oneOf', 'anyOf']) {
    const members = schema.value[key];
    if (!Array.isArray(members)) continue;
    for (let i = 0; i < members.length; i++) {
      const member = child(doc, schema, key, String(i));
      const hit = member && findProperty(doc, member, name, depth + 1);
      if (hit) return hit;
    }
  }
  if (name !== 'items' && schema.value.items !== undefined) {
    // oasdiff sometimes omits the array step; try the item schema.
    const items = child(doc, schema, 'items');
    if (items) return findProperty(doc, items, name, depth + 1);
  }
  return null;
}

function walkSchema(doc: unknown, schema: Located, propertyPath: string[]): Located | null {
  let current: Located | null = schema;
  for (const segment of propertyPath) {
    if (!current) return null;
    const prop = findProperty(doc, current, segment);
    if (prop) current = prop;
    else if (segment === 'items' && isRecord(current.value) && current.value.items !== undefined)
      current = child(doc, current, 'items');
    else return null;
  }
  return current;
}

function mediaTypes(content: Located, preferred?: string): string[] {
  if (!isRecord(content.value)) return [];
  const keys = Object.keys(content.value).sort();
  if (preferred !== undefined) return keys.includes(preferred) ? [preferred] : [];
  const first = ['application/json'].filter((k): k is string => !!k && keys.includes(k));
  return [...new Set([...first, ...keys])];
}

function propertyInContent(
  doc: unknown,
  holder: Located,
  propertyPath: string[],
  mediaType?: string,
): Located | null {
  const content = child(doc, holder, 'content');
  if (!content) return null;
  for (const mt of mediaTypes(content, mediaType)) {
    const schema = child(doc, content, mt, 'schema');
    const hit = schema && walkSchema(doc, schema, propertyPath);
    if (hit) return hit;
  }
  return null;
}

function responseStatuses(responses: Located, status: string | null): string[] {
  if (!isRecord(responses.value)) return [];
  const keys = Object.keys(responses.value);
  if (status !== null) return keys.includes(status) ? [status] : [];
  // No status given: success responses first, then the rest, in a fixed order.
  return keys.sort(
    (a, b) => Number(!a.startsWith('2')) - Number(!b.startsWith('2')) || (a < b ? -1 : 1),
  );
}

function locateAnchor(
  doc: unknown,
  path: string,
  method: string | null,
  anchor: DifferenceAnchor,
): Located | null {
  if (doc === undefined || doc === null || !path) return null;
  if (anchor.kind === 'path') return child(doc, ROOT, 'paths', path);
  if (anchor.kind === 'parameter') return findParameter(doc, path, method, anchor.in, anchor.name);
  if (!method) return null;
  const item = child(doc, ROOT, 'paths', path);
  const op = item && child(doc, item, method.toLowerCase());
  if (!op) return null;
  switch (anchor.kind) {
    case 'operation':
      return op;
    case 'request-body':
      return child(doc, op, 'requestBody');
    case 'request-property': {
      const body = child(doc, op, 'requestBody');
      return body && propertyInContent(doc, body, anchor.propertyPath, anchor.mediaType);
    }
    case 'response':
    case 'response-property': {
      const responses = child(doc, op, 'responses');
      if (!responses) return null;
      for (const status of responseStatuses(responses, anchor.status)) {
        const response = child(doc, responses, status);
        if (!response) continue;
        if (anchor.kind === 'response') return response;
        const hit = propertyInContent(doc, response, anchor.propertyPath, anchor.mediaType);
        if (hit) return hit;
      }
      return null;
    }
  }
}

/**
 * Finds where an anchored item lives in one spec, following local `$ref`s.
 * @param doc - Spec document.
 * @param path - OpenAPI path.
 * @param method - HTTP method, or `null`.
 * @param anchor - What the difference is about.
 * @returns Both pointers (see {@link AnchorLocation}), or `null` if the spec lacks the item.
 */
export function locateInSpec(
  doc: unknown,
  path: string,
  method: string | null,
  anchor: DifferenceAnchor,
): AnchorLocation | null {
  const hit = locateAnchor(doc, path, method, anchor);
  return hit ? { pointer: hit.pointer, operationPointer: hit.logical } : null;
}

/**
 * Like {@link locateInSpec} but returns only the resolvable RFC 6901 pointer.
 * @param doc - Spec document.
 * @param path - OpenAPI path.
 * @param method - HTTP method, or `null`.
 * @param anchor - What the difference is about.
 */
export function resolveAnchor(
  doc: unknown,
  path: string,
  method: string | null,
  anchor: DifferenceAnchor,
): string | null {
  return locateInSpec(doc, path, method, anchor)?.pointer ?? null;
}
