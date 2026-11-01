/**
 * Generates demo/consumer/src/generated/apiClient.ts from specs/v1.yaml:
 * one exported async function per operationId, using fetch internally.
 * A deliberately simple string-template generator (no codegen library).
 *
 * Usage: npm run gen:client -w @sma/demo-api
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from 'yaml';

/** Minimal subset of JSON Schema / OpenAPI used by the demo spec. */
interface Schema {
  $ref?: string;
  type?: string;
  enum?: (string | number)[];
  items?: Schema;
  properties?: Record<string, Schema>;
  required?: string[];
  description?: string;
}

interface Parameter {
  $ref?: string;
  name: string;
  in: 'path' | 'query' | 'header' | 'cookie';
  required?: boolean;
  schema: Schema;
}

interface Operation {
  operationId: string;
  summary?: string;
  parameters?: Parameter[];
  responses: Record<string, { $ref?: string; content?: Record<string, { schema: Schema }> }>;
}

interface Spec {
  info: { title: string; version: string };
  paths: Record<string, Record<string, Operation>>;
  components: { schemas: Record<string, Schema>; parameters?: Record<string, Parameter> };
}

const SPEC_PATH = fileURLToPath(new URL('../specs/v1.yaml', import.meta.url));
const OUT_PATH = fileURLToPath(
  new URL('../../consumer/src/generated/apiClient.ts', import.meta.url),
);
const HTTP_METHODS = ['get', 'put', 'post', 'delete', 'patch'] as const;

const refName = (ref: string): string => ref.split('/').at(-1) ?? 'unknown';

/** Globals a generated type must not shadow (e.g. a schema named `Error` would break `extends Error`). */
const RESERVED = new Set([
  'Error',
  'Object',
  'Array',
  'String',
  'Number',
  'Boolean',
  'Date',
  'Map',
  'Set',
  'Promise',
  'Request',
  'Response',
  'URL',
  'ApiError',
]);

/** TypeScript name for a component schema; reserved names get a `Schema` suffix. */
const typeName = (schemaName: string): string =>
  RESERVED.has(schemaName) ? `${schemaName}Schema` : schemaName;

function tsType(schema: Schema, indent = ''): string {
  if (schema.$ref) return typeName(refName(schema.$ref));
  if (schema.enum) return schema.enum.map((v) => JSON.stringify(v)).join(' | ');
  switch (schema.type) {
    case 'integer':
    case 'number':
      return 'number';
    case 'string':
      return 'string';
    case 'boolean':
      return 'boolean';
    case 'array':
      return `Array<${schema.items ? tsType(schema.items, indent) : 'unknown'}>`;
    case 'object': {
      const required = new Set(schema.required ?? []);
      const props = Object.entries(schema.properties ?? {}).map(
        ([name, prop]) =>
          `${indent}  ${name}${required.has(name) ? '' : '?'}: ${tsType(prop, `${indent}  `)};`,
      );
      return `{\n${props.join('\n')}\n${indent}}`;
    }
    default:
      return 'unknown';
  }
}

function resolveParam(spec: Spec, p: Parameter): Parameter {
  if (!p.$ref) return p;
  const resolved = spec.components.parameters?.[refName(p.$ref)];
  if (!resolved) throw new Error(`Unresolved parameter ${p.$ref}`);
  return resolved;
}

function emitTypes(spec: Spec): string {
  return Object.entries(spec.components.schemas)
    .map(([name, schema]) =>
      schema.type === 'object'
        ? `export interface ${typeName(name)} ${tsType(schema)}`
        : `export type ${typeName(name)} = ${tsType(schema)};`,
    )
    .join('\n\n');
}

function emitOperation(spec: Spec, method: string, path: string, op: Operation): string {
  const params = (op.parameters ?? []).map((p) => resolveParam(spec, p));
  const pathParams = params.filter((p) => p.in === 'path');
  const queryParams = params.filter((p) => p.in === 'query');

  const args = pathParams.map((p) => `${p.name}: ${tsType(p.schema)}`);
  if (queryParams.length > 0) {
    const anyRequired = queryParams.some((p) => p.required);
    const fields = queryParams
      .map((p) => `${p.name}${p.required ? '' : '?'}: ${tsType(p.schema)}`)
      .join('; ');
    args.push(`query: { ${fields} }${anyRequired ? '' : ' = {}'}`);
  }

  const okSchema = op.responses['200']?.content?.['application/json']?.schema;
  const returnType = okSchema ? tsType(okSchema) : 'void';
  const urlExpr = path.includes('{')
    ? `\`${path.replace(/\{(\w+)\}/g, (_m, name: string) => `\${encodeURIComponent(String(${name}))}`)}\``
    : `'${path}'`;
  const queryArg = queryParams.length > 0 ? ', query' : '';

  return [
    '/**',
    ` * ${op.summary ?? op.operationId} — \`${method.toUpperCase()} ${path}\``,
    ' */',
    `export async function ${op.operationId}(${args.join(', ')}): Promise<${returnType}> {`,
    `  return request<${returnType}>('${method.toUpperCase()}', ${urlExpr}${queryArg});`,
    '}',
  ].join('\n');
}

function generate(spec: Spec): string {
  const ops: string[] = [];
  for (const [path, item] of Object.entries(spec.paths)) {
    for (const method of HTTP_METHODS) {
      const op = item[method];
      if (op) ops.push(emitOperation(spec, method, path, op));
    }
  }

  return `// GENERATED from demo-shop v1 spec — do not edit by hand
// Source: ${spec.info.title} ${spec.info.version} (demo/api/specs/v1.yaml)
// Regenerate with: npm run gen:client -w @sma/demo-api

/** Thrown when the API answers with a non-2xx status. */
export class ApiError extends Error {
  readonly status: number;
  readonly body: unknown;

  constructor(method: string, path: string, status: number, body: unknown) {
    super(\`\${method} \${path} failed with status \${status}\`);
    this.name = 'ApiError';
    this.status = status;
    this.body = body;
  }
}

function baseUrl(): string {
  return process.env.DEMO_API_URL ?? 'http://localhost:4001';
}

async function request<T>(
  method: string,
  path: string,
  query: Record<string, string | number | undefined> = {},
): Promise<T> {
  const url = new URL(path, baseUrl());
  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined) url.searchParams.set(key, String(value));
  }
  const res = await fetch(url, { method, headers: { accept: 'application/json' } });
  const text = await res.text();
  const body: unknown = text.length > 0 ? JSON.parse(text) : undefined;
  if (!res.ok) throw new ApiError(method, path, res.status, body);
  return body as T;
}

${emitTypes(spec)}

${ops.join('\n\n')}
`;
}

const spec = parse(readFileSync(SPEC_PATH, 'utf8')) as Spec;
mkdirSync(dirname(OUT_PATH), { recursive: true });
writeFileSync(OUT_PATH, generate(spec));
console.log(`Generated ${OUT_PATH}`);
