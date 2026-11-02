import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';
import { decideCheckOutcome, hashSpec, MAX_SPEC_BYTES, normalizeSpec, parseSpec } from './spec.js';

const v1 = readFileSync(new URL('../../../../demo/api/specs/v1.yaml', import.meta.url), 'utf8');
const v2 = readFileSync(new URL('../../../../demo/api/specs/v2.yaml', import.meta.url), 'utf8');
describe('OpenAPI parsing and canonical identity', () => {
  it('gives YAML/JSON and reordered keys the same hash; v2 differs', async () => {
    const yaml = await parseSpec(v1, 'v1.yaml');
    const json = await parseSpec(JSON.stringify(parse(v1)), 'v1.json');
    const next = await parseSpec(v2);
    expect(yaml.ok && json.ok && next.ok).toBe(true);
    if (!yaml.ok || !json.ok || !next.ok) throw new Error('Invalid demo specs');
    expect(hashSpec(normalizeSpec(yaml.value))).toBe(hashSpec(normalizeSpec(json.value)));
    expect(hashSpec(normalizeSpec(yaml.value))).not.toBe(hashSpec(normalizeSpec(next.value)));
    expect(normalizeSpec({ b: [{ y: 2, x: 1 }], a: 0 })).toBe('{"a":0,"b":[{"x":1,"y":2}]}');
    expect(hashSpec('abc')).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    );
  });
  it('accepts a complete OpenAPI 3.0 document', async () => {
    expect(
      (
        await parseSpec(
          JSON.stringify({ openapi: '3.0.3', info: { title: 'Test', version: '1' }, paths: {} }),
        )
      ).ok,
    ).toBe(true);
  });
  it.each([
    'hello',
    'swagger: "2.0"',
    '{invalid',
    'openapi: 3.1.0\ninfo: {}',
    'a: 1\na: 2',
    'openapi: 3.2.0',
    'a: &a [*a]',
    'n: .inf',
  ])('rejects invalid input: %s', async (text) => {
    const result = await parseSpec(text);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.message.length).toBeGreaterThan(0);
  });
  it('counts UTF-8 bytes and rejects over 5 MiB', async () => {
    expect(await parseSpec('é'.repeat(MAX_SPEC_BYTES / 2 + 1))).toMatchObject({
      ok: false,
      error: { code: 'too_large' },
    });
  });
  it('does not resolve external file/network references', async () => {
    const spec = {
      openapi: '3.0.3',
      info: { title: 'Test', version: '1' },
      paths: { '/x': { $ref: 'https://example.invalid/secret' } },
    };
    expect((await parseSpec(JSON.stringify(spec))).ok).toBe(false);
  });
  it('rejects cycles/nonfinite values and preserves array order', () => {
    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;
    expect(() => normalizeSpec(cyclic)).toThrow();
    expect(() => normalizeSpec({ n: NaN })).toThrow();
    expect(normalizeSpec([2, 1])).toBe('[2,1]');
  });
});
describe('baseline decision', () => {
  it.each([
    [null, 'a', [], 'baseline_established'],
    ['a', 'a', ['a'], 'no_change'],
    ['a', 'b', ['a', 'b'], 'no_change'],
    ['a', 'b', ['a'], 'changed'],
  ] as const)('%s → %s: %s', (baselineHash, newHash, existingHashes, expected) => {
    expect(decideCheckOutcome({ baselineHash, newHash, existingHashes })).toBe(expected);
  });
});
