import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parse } from 'yaml';
import type { DemoVersion } from '../src/data.js';

/** Minimal view of an OpenAPI document used by the tests. */
export interface OpenApiDoc {
  openapi: string;
  info: { version: string };
  paths: Record<
    string,
    Record<string, { operationId: string; responses: Record<string, ResponseObj> }>
  >;
  components: { responses?: Record<string, ResponseObj> };
}

interface ResponseObj {
  $ref?: string;
  content?: Record<string, { schema: unknown }>;
}

/** Loads `specs/<version>.yaml` as a plain object. */
export function loadSpec(version: DemoVersion): OpenApiDoc {
  const file = fileURLToPath(new URL(`../specs/${version}.yaml`, import.meta.url));
  return parse(readFileSync(file, 'utf8')) as OpenApiDoc;
}

const escapeSegment = (s: string): string =>
  encodeURIComponent(s.replace(/~/g, '~0').replace(/\//g, '~1'));

/**
 * JSON-pointer fragment (URI-encoded) to the JSON response schema for one operation/status,
 * following a `$ref` to `components/responses` when present. `undefined` when no body is defined.
 */
export function responseSchemaPointer(
  spec: OpenApiDoc,
  path: string,
  method: string,
  status: string,
): string | undefined {
  const response = spec.paths[path]?.[method]?.responses[status];
  if (!response) throw new Error(`Spec has no ${status} response for ${method} ${path}`);

  let segments = ['paths', path, method, 'responses', status];
  let target = response;
  if (response.$ref) {
    const name = response.$ref.split('/').at(-1) ?? '';
    const resolved = spec.components.responses?.[name];
    if (!resolved) throw new Error(`Unresolved ${response.$ref}`);
    segments = ['components', 'responses', name];
    target = resolved;
  }
  if (!target.content?.['application/json']) return undefined;
  return `#/${[...segments, 'content', 'application/json', 'schema'].map(escapeSegment).join('/')}`;
}
