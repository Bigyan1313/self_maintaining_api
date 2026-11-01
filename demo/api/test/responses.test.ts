import { Ajv2020 } from 'ajv/dist/2020.js';
import addFormatsModule from 'ajv-formats';
import { describe, expect, it } from 'vitest';
import { buildDemoApp } from '../src/app.js';
import type { DemoVersion } from '../src/data.js';
import { loadSpec, responseSchemaPointer } from './spec-helpers.js';

// ajv-formats is CommonJS; under NodeNext the callable lives on `.default`.
const addFormats = addFormatsModule.default;

/** A concrete request that exercises one documented response of one operation. */
interface Case {
  method: 'GET' | 'DELETE';
  specPath: string;
  url: string;
  status: number;
}

const COMMON: Case[] = [
  { method: 'GET', specPath: '/customers/{id}', url: '/customers/1', status: 200 },
  { method: 'GET', specPath: '/customers/{id}', url: '/customers/2', status: 200 },
  { method: 'GET', specPath: '/customers/{id}', url: '/customers/999', status: 404 },
  { method: 'GET', specPath: '/orders', url: '/orders?status=open', status: 200 },
  { method: 'GET', specPath: '/orders', url: '/orders?status=all', status: 200 },
  { method: 'GET', specPath: '/orders', url: '/orders?status=bogus', status: 400 },
  { method: 'GET', specPath: '/orders/{id}', url: '/orders/1', status: 200 },
  { method: 'GET', specPath: '/orders/{id}', url: '/orders/999', status: 404 },
];

const CASES: Record<DemoVersion, Case[]> = {
  v1: [
    ...COMMON,
    { method: 'GET', specPath: '/orders', url: '/orders', status: 200 },
    { method: 'GET', specPath: '/orders/{id}/invoice', url: '/orders/1/invoice', status: 200 },
    { method: 'GET', specPath: '/orders/{id}/invoice', url: '/orders/999/invoice', status: 404 },
    { method: 'DELETE', specPath: '/orders/{id}', url: '/orders/1', status: 204 },
    { method: 'DELETE', specPath: '/orders/{id}', url: '/orders/999', status: 404 },
  ],
  v2: [
    ...COMMON,
    { method: 'GET', specPath: '/orders', url: '/orders', status: 400 },
    { method: 'GET', specPath: '/invoices/{orderId}', url: '/invoices/1', status: 200 },
    { method: 'GET', specPath: '/invoices/{orderId}', url: '/invoices/999', status: 404 },
  ],
};

describe.each(['v1', 'v2'] as const)('demo app %s matches its own spec', (version) => {
  const spec = loadSpec(version);
  const specId = `https://demo-shop.local/${version}.json`;
  const ajv = new Ajv2020({ strict: false, allErrors: true });
  addFormats(ajv);
  ajv.addSchema(spec, specId);

  it.each(CASES[version])('$method $url → $status', async ({ method, specPath, url, status }) => {
    const app = buildDemoApp(version);
    const res = await app.inject({ method, url });
    await app.close();

    expect(res.statusCode).toBe(status);
    const pointer = responseSchemaPointer(spec, specPath, method.toLowerCase(), String(status));
    if (pointer === undefined) {
      expect(res.body).toBe('');
      return;
    }
    const validate = ajv.compile({ $ref: `${specId}${pointer}` });
    const body: unknown = res.json();
    expect(validate(body), JSON.stringify(validate.errors)).toBe(true);
  });

  it('every spec operation is exercised by at least one case', () => {
    const documented = Object.entries(spec.paths).flatMap(([path, item]) =>
      Object.keys(item).map((m) => `${m.toUpperCase()} ${path}`),
    );
    const exercised = new Set(CASES[version].map((c) => `${c.method} ${c.specPath}`));
    expect(documented.filter((op) => !exercised.has(op))).toEqual([]);
  });
});

describe('v2 rejects removed or changed usage', () => {
  it('returns 400 for GET /orders without status', async () => {
    const app = buildDemoApp('v2');
    const res = await app.inject({ method: 'GET', url: '/orders' });
    await app.close();
    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({ error: 'Missing required query parameter: status' });
  });

  it.each([
    ['GET', '/orders/1/invoice'],
    ['DELETE', '/orders/1'],
  ] as const)('returns 404 for removed endpoint %s %s', async (method, url) => {
    const app = buildDemoApp('v2');
    const res = await app.inject({ method, url });
    await app.close();
    expect(res.statusCode).toBe(404);
  });

  it('serves the replacement GET /invoices/{orderId} with the same invoice as v1', async () => {
    const v1 = buildDemoApp('v1');
    const v2 = buildDemoApp('v2');
    const [a, b] = await Promise.all([
      v1.inject({ method: 'GET', url: '/orders/1/invoice' }),
      v2.inject({ method: 'GET', url: '/invoices/1' }),
    ]);
    await Promise.all([v1.close(), v2.close()]);
    expect(b.json()).toEqual(a.json());
  });
});

describe('v1 and v2 represent the same business data', () => {
  it('order total: v1 number 19.99, v2 decimal string "19.99"', async () => {
    const [r1, r2] = await Promise.all(
      (['v1', 'v2'] as const).map(async (v) => {
        const app = buildDemoApp(v);
        const res = await app.inject({ method: 'GET', url: '/orders/1' });
        await app.close();
        return res.json() as { total: unknown };
      }),
    );
    expect(r1?.total).toBe(19.99);
    expect(r2?.total).toBe('19.99');
  });

  it('customer name: v1 customer_name, v2 full_name (+ optional phone)', async () => {
    const v1 = buildDemoApp('v1');
    const v2 = buildDemoApp('v2');
    const a = (await v1.inject({ method: 'GET', url: '/customers/1' })).json();
    const b = (await v2.inject({ method: 'GET', url: '/customers/1' })).json();
    await Promise.all([v1.close(), v2.close()]);
    expect(a).toEqual({ id: 1, customer_name: 'Ada Lovelace', email: 'ada@example.com' });
    expect(b).toEqual({
      id: 1,
      full_name: 'Ada Lovelace',
      email: 'ada@example.com',
      phone: '+44 20 7946 0001',
    });
  });
});
