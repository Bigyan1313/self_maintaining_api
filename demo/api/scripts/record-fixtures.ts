/**
 * Records real responses from the demo server (both versions) into
 * demo/consumer/test/fixtures/<version>/. Fixtures are never typed by hand.
 *
 * Usage: npm run record:fixtures -w @sma/demo-api
 */
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { buildDemoApp } from '../src/app.js';
import type { DemoVersion } from '../src/data.js';

/** One request to record. The same list is replayed against both versions. */
interface FixtureRequest {
  method: 'GET' | 'DELETE';
  path: string;
  query?: Record<string, string>;
}

const REQUESTS: FixtureRequest[] = [
  ...[1, 2, 3, 999].map((id) => ({ method: 'GET' as const, path: `/customers/${id}` })),
  { method: 'GET', path: '/orders' },
  ...['open', 'closed', 'all', 'bogus'].map((status) => ({
    method: 'GET' as const,
    path: '/orders',
    query: { status },
  })),
  ...[1, 2, 3, 4, 999].map((id) => ({ method: 'GET' as const, path: `/orders/${id}` })),
  ...[1, 2, 3, 4, 999].map((id) => ({ method: 'GET' as const, path: `/orders/${id}/invoice` })),
  ...[1, 2, 3, 4, 999].map((id) => ({ method: 'GET' as const, path: `/invoices/${id}` })),
  ...[1, 2, 999].map((id) => ({ method: 'DELETE' as const, path: `/orders/${id}` })),
];

const VERSIONS: DemoVersion[] = ['v1', 'v2'];
const OUT_ROOT = fileURLToPath(new URL('../../consumer/test/fixtures/', import.meta.url));

/** Stable, filesystem-safe file name for a request, e.g. `GET_orders__status-open.json`. */
function fixtureFileName(req: FixtureRequest): string {
  const path = req.path.replace(/^\//, '').replace(/\//g, '_');
  const query = Object.entries(req.query ?? {})
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${k}-${v}`)
    .join('_');
  return `${req.method}_${path}${query ? `__${query}` : ''}.json`;
}

async function record(version: DemoVersion): Promise<number> {
  const dir = `${OUT_ROOT}${version}`;
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });

  for (const req of REQUESTS) {
    // Fresh app per request so a DELETE never changes what another fixture sees.
    const app = buildDemoApp(version);
    const res = await app.inject({ method: req.method, url: req.path, query: req.query ?? {} });
    await app.close();

    const fixture = {
      recordedFrom: `demo-shop ${version} (buildDemoApp via record-fixtures.ts)`,
      request: { method: req.method, path: req.path, query: req.query ?? {} },
      response: {
        status: res.statusCode,
        body: res.body.length > 0 ? (JSON.parse(res.body) as unknown) : null,
      },
    };
    writeFileSync(`${dir}/${fixtureFileName(req)}`, `${JSON.stringify(fixture, null, 2)}\n`);
  }
  return REQUESTS.length;
}

for (const version of VERSIONS) {
  const count = await record(version);
  console.log(`Recorded ${count} fixtures for ${version} → ${OUT_ROOT}${version}`);
}
