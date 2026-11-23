import { cp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { stringify } from 'yaml';
import { hashFolder } from './integrity.js';
import { snapshotCommit } from './snapshot.js';
import type { Definition, Manifest } from './types.js';

/** Build an OpenAPI document from authored response examples and explicit change metadata. */
export function specification(d: Definition, after: boolean): Record<string, unknown> {
  const path = after && d.category === 'endpoint_removed' ? d.replacement : d.path;
  const paths: Record<string, unknown> = {};
  if (path) {
    const parameters: Record<string, unknown>[] = path.includes('{id}')
      ? [{ name: 'id', in: 'path', required: true, schema: { type: 'string' }, example: '42' }]
      : [];
    if (after && d.parameter)
      parameters.push({
        name: d.parameter.name,
        in: d.parameter.in,
        required: true,
        schema: { type: 'string', ...(d.parameter.enum ? { enum: d.parameter.enum } : {}) },
        example: d.parameter.value,
      });
    paths[path] = {
      get: {
        operationId: d.operationId,
        parameters,
        responses: {
          '200': {
            description: 'Success',
            content: {
              'application/json': {
                schema: after ? d.schemaAfter : d.schemaBefore,
                ...(d.cases
                  ? {
                      examples: Object.fromEntries(
                        d.cases.map((c) => [
                          c.id,
                          {
                            value: after ? c.after : c.before,
                            'x-request': {
                              path: path.replace('{id}', c.id),
                              parameters: after ? c.parameters : {},
                            },
                          },
                        ]),
                      ),
                    }
                  : { example: after ? d.after : d.before }),
              },
            },
          },
        },
      },
    };
  }
  paths['/health'] = {
    get: {
      operationId: 'health',
      responses: {
        '200': {
          description: 'Healthy',
          content: {
            'application/json': {
              schema: { type: 'object', properties: { ok: { type: 'boolean' } } },
              example: { ok: true },
            },
          },
        },
      },
    },
  };
  return {
    openapi: '3.0.3',
    info: { title: d.id, version: after ? '2.0.0' : '1.0.0' },
    servers: [{ url: 'https://api.example.test' }],
    paths,
  };
}

/** Extract fixture responses and parameter constraints exclusively from the emitted specs. */
export function fixtures(spec: Record<string, unknown>): unknown[] {
  interface Example {
    value: unknown;
    'x-request': { path: string; parameters: Record<string, string> };
  }
  const paths = spec.paths as Record<
    string,
    {
      get: {
        parameters?: unknown[];
        responses: {
          '200': {
            content: {
              'application/json': { example?: unknown; examples?: Record<string, Example> };
            };
          };
        };
      };
    }
  >;
  return Object.entries(paths).flatMap(([path, { get }]) => {
    const media = get.responses['200'].content['application/json'];
    if (media.examples)
      return Object.values(media.examples).map((example) => ({
        path: example['x-request'].path,
        parameters: get.parameters ?? [],
        requestParameters: example['x-request'].parameters,
        body: example.value,
      }));
    return [{ path, parameters: get.parameters ?? [], requestParameters: {}, body: media.example }];
  });
}

/** Deterministically build and freeze all cases; never create or modify ground-truth labels. */
export async function build(root = fileURLToPath(new URL('.', import.meta.url))): Promise<void> {
  const manifest: Manifest = { schemaVersion: 1, scenarios: [] };
  const files = (await readdir(join(root, 'definitions'))).filter((f) => f.endsWith('.ts')).sort();
  if (files.length !== 20) throw new Error('Exactly twenty definitions required');
  for (const file of files) {
    const d = (
      (await import(pathToFileURL(join(root, 'definitions', file)).href)) as { default: Definition }
    ).default;
    const folder = join(root, d.id);
    // Labels must already exist; do not read their contents to generate source or expectations.
    await readFile(join(folder, 'labels.yaml'));
    for (const name of ['repo', 'specs'])
      await rm(join(folder, name), { recursive: true, force: true });
    await rm(join(folder, 'migration-note.yaml'), { force: true });
    async function put(path: string, text: string): Promise<void> {
      const full = join(folder, path);
      await mkdir(dirname(full), { recursive: true });
      await writeFile(full, text);
    }
    await put(
      'scenario.yaml',
      stringify({
        id: d.id,
        category: d.category,
        difficulty: d.difficulty,
        description: d.description,
        callPatterns: d.callPatterns,
        target: { method: 'GET', path: d.path, operationId: d.operationId },
        validationEnv: { before: { API_VERSION: 'v1' }, after: { API_VERSION: 'v2' } },
        expected: {
          outcome: d.category === 'endpoint_removed' && !d.replacement ? 'refuse' : 'repair',
        },
      }),
    );
    if (d.mapping)
      await put(
        'migration-note.yaml',
        stringify({ api: d.id, from: '1.0.0', to: '2.0.0', mappings: [d.mapping] }),
      );
    for (const [after, version] of [
      [false, 'v1'],
      [true, 'v2'],
    ] as const) {
      const spec = specification(d, after);
      await put(`specs/${after ? 'after' : 'before'}.yaml`, stringify(spec));
      await put(
        `repo/test/fixtures/${version}/responses.json`,
        JSON.stringify(fixtures(spec), null, 2) + '\n',
      );
    }
    for (const name of ['package.json', 'package-lock.json', 'tsconfig.json', 'vitest.config.ts'])
      await cp(join(root, 'templates', name), join(folder, 'repo', name));
    await cp(join(root, 'templates', 'setup.ts'), join(folder, 'repo/test/setup.ts'));
    for (const [path, text] of Object.entries(d.source)) await put(`repo/${path}`, text);
    let tests = `import { expect, it } from 'vitest';\nimport { readValue } from '../src/consumer.js';\nit('preserves the caller-visible value', async () => {\n  expect(await readValue()).toEqual(${JSON.stringify(d.expectedValue)});\n});\nit('unrelated health operation remains available', async () => {\n  const response = await fetch('https://api.example.test/health');\n  expect(response.status).toBe(200);\n  expect(await response.json()).toEqual({ ok: true });\n});\n`;
    if (d.id === 'rename-weather-two-files')
      tests += `import { readSummary } from '../src/summary.js';\nit('preserves the second reader', async () => { expect(await readSummary()).toBe('Station: Austin'); });\n`;
    if (d.id === 'param-tickets-threaded')
      tests += `it('forwards a non-default caller region', async () => { expect(await readValue('43', 'eu')).toBe(9); });\n`;
    await put('repo/test/consumer.test.ts', tests);
    const repoCommit = await snapshotCommit(join(folder, 'repo'));
    manifest.scenarios.push({ id: d.id, sha256: await hashFolder(folder), repoCommit });
  }
  await writeFile(join(root, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await build();
