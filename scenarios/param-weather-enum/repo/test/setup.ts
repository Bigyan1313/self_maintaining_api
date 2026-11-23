import { readFileSync } from 'node:fs';
import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import { afterAll, afterEach, beforeAll } from 'vitest';

interface Fixture {
  path: string;
  parameters: { name: string; in: string; required?: boolean; schema: { enum?: string[] } }[];
  requestParameters: Record<string, string>;
  body: Record<string, unknown>;
}
const version = process.env.API_VERSION ?? 'v1';
if (version !== 'v1' && version !== 'v2') throw new Error('Invalid API_VERSION');
const fixtures = JSON.parse(readFileSync(new URL(`./fixtures/${version}/responses.json`, import.meta.url), 'utf8')) as Fixture[];
const server = setupServer(http.get('https://api.example.test/*', ({ request }) => {
  const url = new URL(request.url);
  const fixture = fixtures.find(f => new RegExp('^' + f.path.replace(/\{[^}]+\}/g, '[^/]+') + '$').test(url.pathname));
  if (fixture && Object.entries(fixture.requestParameters).some(([key, value]) => url.searchParams.get(key) !== value)) return HttpResponse.json({error: 'Wrong caller parameter'}, {status: 400});
  if (!fixture) return HttpResponse.json({ error: 'Endpoint removed' }, { status: 404 });
  for (const p of fixture.parameters) {
    if (p.in === 'path') continue;
    const value = p.in === 'header' ? request.headers.get(p.name) : url.searchParams.get(p.name);
    if ((p.required && !value) || (value && p.schema.enum && !p.schema.enum.includes(value))) {
      return HttpResponse.json({ error: `Invalid required ${p.in} ${p.name}` }, { status: 400 });
    }
  }
  return HttpResponse.json(fixture.body);
}));
beforeAll(() => server.listen({ onUnhandledFrame: 'error' }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());
