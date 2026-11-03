import { readFile, readdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import type { RepoReader, RepoEntry } from '../repo/limits.js';
import { locateCallSites } from './locate.js';
import type { LocateTarget } from './types.js';

function reader(files: Record<string, string>, extras: RepoEntry[] = []): RepoReader {
  return {
    async *entries() {
      for (const path of Object.keys(files)) yield { path, kind: 'file' as const };
      yield* extras;
    },
    async read(_root, path) {
      return files[path]!;
    },
  };
}
const target: LocateTarget = { method: 'GET', path: '/customers/{id}' };
const scan = (files: Record<string, string>, t = target) =>
  locateCallSites('/repo', t, reader(files));

describe('supported syntax-tree call patterns', () => {
  it('matches fetch templates, absolute URLs, methods and one-based positions', async () => {
    const result = await scan({
      'src/a.ts': [
        '// fetch("/customers/ignored")',
        'const text = "fetch /customers/nope";',
        'function load(id: number) {',
        '  return fetch(`${BASE}/customers/${id}`);',
        '}',
        'fetch("https://example.test/customers/123", {method: "POST"});',
      ].join('\n'),
    });
    expect(result.outcome).toBe('affected');
    expect(result.callSites).toHaveLength(1);
    expect(result.callSites[0]).toMatchObject({
      filePath: 'src/a.ts',
      line: 4,
      column: 10,
      pattern: 'fetch',
    });
    expect(result.callSites[0]?.excerpt.split('\n')).toHaveLength(5);
    expect(result.unsupported).toEqual([]);
  });
  it('matches static axios, callable config and same-file/imported instances', async () => {
    const result = await scan({
      'src/client.ts':
        'import axios from "axios"; export const api = axios.create({baseURL: "https://shop.test"});',
      'src/a.ts':
        'import axios from "axios"; import {api} from "./client.js";\n' +
        'axios.get("/customers/{}"); axios({url: "/customers/{}", method: "GET"}); api.get("/customers/{}");',
    });
    expect(result.callSites.map((s) => s.pattern)).toEqual([
      'axios_static',
      'axios_static',
      'axios_instance',
    ]);
  });
  it('matches generated function imports using the original operationId, including local aliases', async () => {
    const result = await scan(
      {
        'src/a.ts':
          'import {getOrderInvoice as invoice} from "./generated/apiClient.js"; invoice(1);',
      },
      { method: 'GET', path: '/orders/{id}/invoice', operationId: 'getOrderInvoice' },
    );
    expect(result.callSites).toHaveLength(1);
    expect(result.callSites[0]?.pattern).toBe('generated_client');
  });
  it('does not find calls in comments or strings', async () => {
    const result = await scan({
      'src/a.ts': '// fetch("/customers/{}")\nconst s = "axios.get /customers/{}";',
    });
    expect(result.outcome).toBe('not_affected');
  });
  it('matches a literal endpoint and ignores query parameters', async () => {
    expect(
      (
        await scan(
          { 'src/a.ts': 'fetch("https://shop.test/orders?status=all");' },
          { method: 'GET', path: '/orders' },
        )
      ).callSites,
    ).toHaveLength(1);
  });
});

describe('coverage and uncertainty', () => {
  it('distinguishes computed template paths, wrappers and aliased clients', async () => {
    const result = await scan({
      'src/a.ts':
        'const path = ["customers", "1"].join("/"); fetch(`${BASE}/${path}`);\n' +
        'function request(path: string) {return fetch(`${BASE}${path}`)}\n' +
        'const f = fetch; f("/customers/{}");',
    });
    expect(result.outcome).toBe('needs_review');
    expect(result.unsupported.map((u) => u.kind)).toEqual([
      'dynamic_url',
      'wrapper',
      'reexported_alias',
    ]);
  });
  it('does not claim a match for unknown fetch method or spread options', async () => {
    for (const options of ['{method: method}', '{...opts}', 'opts']) {
      const result = await scan({ 'src/a.ts': `fetch("/customers/{}", ${options});` });
      expect(result.outcome).toBe('needs_review');
      expect(result.callSites).toEqual([]);
    }
  });
  it('reports shadowed fetch and unknown HTTP clients conservatively', async () => {
    const result = await scan({
      'src/a.ts':
        'function load(fetch: Function) { fetch("/customers/{}"); } client.get("/customers/{}");',
    });
    expect(result.outcome).toBe('needs_review');
    expect(result.unsupported.every((u) => u.kind === 'unknown_client')).toBe(true);
  });
  it('retains unsupported evidence when a supported call is found', async () => {
    const result = await scan({ 'src/a.ts': 'fetch("/customers/{}"); fetch(buildUrl());' });
    expect(result.outcome).toBe('affected');
    expect(result.unsupported).toHaveLength(1);
  });
  it('records exclusions without reading credentials or following symlinks', async () => {
    const files = {
      'src/a.ts': 'const n = 1;',
      'src/readme.md': 'text',
      'src/.env': 'SECRET',
      'node_modules/x.ts': 'bad',
      'src/types.d.ts': 'declare const n: number;',
    };
    const base = reader(files, [{ path: 'src/link.ts', kind: 'symlink' }]);
    const reads: string[] = [];
    const result = await locateCallSites('/repo', target, {
      ...base,
      async read(root, path) {
        reads.push(path);
        return base.read(root, path);
      },
    });
    expect(reads).toEqual(['src/a.ts']);
    expect(result.coverage).toHaveLength(6);
    expect(result.coverage.find((e) => e.filePath === 'src/link.ts')?.skipReason).toBe(
      'symbolic link not followed',
    );
    expect(result.outcome).toBe('needs_review');
  });
  it('reports unreadable and syntactically invalid source as incomplete', async () => {
    const result = await locateCallSites('/repo', target, {
      ...reader({ 'src/a.ts': '' }),
      async read() {
        throw new Error('private detail');
      },
    });
    expect(result.outcome).toBe('needs_review');
    expect(result.coverage[0]?.skipReason).toBe('source could not be read');
    const invalid = await scan({ 'src/a.ts': 'function {' });
    expect(invalid.outcome).toBe('needs_review');
    expect(invalid.coverage[0]?.inspected).toBe(false);
  });
  it('refuses 201 files and more than 20,000 lines', async () => {
    for (const files of [
      Object.fromEntries(Array.from({ length: 201 }, (_, i) => [`src/f${i}.ts`, ''])),
      { 'src/a.ts': 'const x = 1;\n'.repeat(20_001) },
    ]) {
      const result = await scan(files);
      expect(result.outcome).toBe('needs_review');
      expect(result.limitsExceeded).toBeDefined();
      expect(result.callSites).toEqual([]);
      expect(result.coverage.every((e) => !e.inspected)).toBe(true);
    }
  });
  it('analyzes 200 files / 20,000 lines in under 60 seconds', async () => {
    const files = Object.fromEntries(
      Array.from({ length: 200 }, (_, i) => [
        `src/f${i}.ts`,
        'export {};\n' +
          Array.from({ length: 98 }, (_, n) => `const v${n} = ${n};\n`).join('') +
          'fetch("/orders");\n',
      ]),
    );
    const start = performance.now();
    const result = await scan(files, { method: 'GET', path: '/orders' });
    const elapsed = performance.now() - start;
    console.info(`Locate benchmark: 200 files / 20,000 lines: ${elapsed.toFixed(0)} ms`);
    expect(result.callSites).toHaveLength(200);
    expect(result.limitsExceeded).toBeUndefined();
    expect(elapsed).toBeLessThan(60_000);
  }, 60_000);
});

describe('demo consumer acceptance', () => {
  it('locates all five changes and reports unsupported examples', async () => {
    const root = fileURLToPath(new URL('../../../../demo/consumer/', import.meta.url));
    const files: Record<string, string> = {};
    for (const name of await readdir(`${root}src`, { recursive: true }))
      if (name.endsWith('.ts')) files[`src/${name}`] = await readFile(`${root}src/${name}`, 'utf8');
    const cases = [
      [{ method: 'GET', path: '/customers/{id}' }, 'src/customers.ts', 'fetch', 12],
      [{ method: 'GET', path: '/orders/{id}' }, 'src/orders.ts', 'axios_instance', 27],
      [{ method: 'GET', path: '/orders' }, 'src/orders.ts', 'axios_instance', 33],
      [
        { method: 'GET', path: '/orders/{id}/invoice', operationId: 'getOrderInvoice' },
        'src/invoices.ts',
        'generated_client',
        5,
      ],
      [{ method: 'DELETE', path: '/orders/{id}' }, 'src/admin.ts', 'axios_static', 6],
    ] as const;
    for (const [t, filePath, pattern, line] of cases) {
      const result = await scan(files, t);
      expect(result.outcome).toBe('affected');
      expect(result.callSites).toContainEqual(expect.objectContaining({ filePath, pattern, line }));
      expect(result.unsupported).toContainEqual(
        expect.objectContaining({ filePath: 'src/unsupported/dynamicUrl.ts', kind: 'dynamic_url' }),
      );
      expect(result.unsupported).toContainEqual(
        expect.objectContaining({ filePath: 'src/unsupported/wrapper.ts', kind: 'wrapper' }),
      );
    }
    expect((await scan(files, { method: 'GET', path: '/unused' })).outcome).toBe('needs_review');
  });
});

describe('binding boundaries', () => {
  it('keeps ordinary imported function calls out of unsupported HTTP findings', async () => {
    const result = await scan({
      'src/config.ts': 'export function base() { return "https://shop.test"; }',
      'src/a.ts': 'import {base} from "./config.js"; base();',
    });
    expect(result.outcome).toBe('not_affected');
  });
  it('reports imported fetch aliases, destructuring and reexported instances', async () => {
    const cases = [
      { 'src/a.ts': 'import {fetch as request} from "./client.js"; request("/customers/1");' },
      { 'src/a.ts': 'import axios from "axios"; const {get} = axios; get("/customers/1");' },
      {
        'src/client.ts': 'import axios from "axios"; export const api = axios.create({});',
        'src/barrel.ts': 'export {api} from "./client.js";',
        'src/a.ts': 'import {api} from "./barrel.js"; api.get("/customers/1");',
      },
    ];
    for (const files of cases) {
      const result = await scan(files as Record<string, string>);
      expect(result.callSites).toEqual([]);
      expect(result.outcome).toBe('needs_review');
      expect(result.unsupported.some((u) => u.kind === 'reexported_alias')).toBe(true);
    }
  });
  it('matches literal route parameter values and excludes wrong methods', async () => {
    const result = await scan({
      'src/a.ts': 'fetch("/customers/123"); fetch("/customers/123", {method: "DELETE"});',
    });
    expect(result.callSites).toHaveLength(1);
  });
});
