import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';
import {
  anchorFor,
  differenceId,
  extractDetails,
  mapOasdiffLevel,
  parseOasdiffChangelog,
} from './parse.js';
import { extractEvidence } from './pointer.js';
import type { SpecDifference } from './types.js';

const root = new URL('../../../../', import.meta.url);
const fixture = JSON.parse(
  readFileSync(new URL('packages/core/test/fixtures/oasdiff-demo-v1-v2.json', root), 'utf8'),
) as unknown[];
const before = parse(readFileSync(new URL('demo/api/specs/v1.yaml', root), 'utf8')) as unknown;
const after = parse(readFileSync(new URL('demo/api/specs/v2.yaml', root), 'utf8')) as unknown;

function parseDemo(json: unknown = fixture): SpecDifference[] {
  const result = parseOasdiffChangelog(json, { before, after });
  if (!result.ok) throw new Error(result.error.message);
  return result.value;
}

function find(list: SpecDifference[], ruleId: string, method: string, path: string) {
  const hit = list.find((d) => d.ruleId === ruleId && d.method === method && d.path === path);
  if (!hit) throw new Error(`missing ${ruleId} ${method} ${path}`);
  return hit;
}

describe('parseOasdiffChangelog on the recorded demo v1→v2 fixture', () => {
  const diffs = parseDemo();

  it('keeps every oasdiff entry (9: 5 error-level, 4 info-level)', () => {
    expect(diffs).toHaveLength(fixture.length);
    expect(diffs.filter((d) => d.level === 'error')).toHaveLength(5);
    expect(diffs.filter((d) => d.level === 'info')).toHaveLength(4);
  });

  it('finds the 5 breaking differences with correct path, method and pointer', () => {
    const expected = [
      [
        'response-required-property-removed',
        'GET',
        '/customers/{id}',
        '/components/schemas/Customer/properties/customer_name',
      ],
      ['request-parameter-became-required', 'GET', '/orders', '/paths/~1orders/get/parameters/0'],
      ['api-removed-without-deprecation', 'DELETE', '/orders/{id}', '/paths/~1orders~1{id}/delete'],
      [
        'response-property-type-changed',
        'GET',
        '/orders/{id}',
        '/components/schemas/Order/properties/total',
      ],
      [
        'api-path-removed-without-deprecation',
        'GET',
        '/orders/{id}/invoice',
        '/paths/~1orders~1{id}~1invoice/get',
      ],
    ] as const;
    for (const [rule, method, path, pointer] of expected) {
      const d = find(diffs, rule, method, path);
      expect(d.level).toBe('error');
      expect(d.jsonPointer).toBe(pointer);
    }
  });

  it('every pointer resolves in the spec its evidence came from', () => {
    for (const d of diffs) {
      if (d.evidenceBefore !== null)
        expect(extractEvidence(before, d.jsonPointer)).toEqual(d.evidenceBefore);
      if (d.evidenceAfter !== null)
        expect(
          extractEvidence(after, (d.details.jsonPointerAfter as string) ?? d.jsonPointer),
        ).toEqual(d.evidenceAfter);
      expect(d.evidenceBefore !== null || d.evidenceAfter !== null).toBe(true);
    }
  });

  it('total: {type: number} → {type: string, pattern, …} with old/new type in details', () => {
    const d = find(diffs, 'response-property-type-changed', 'GET', '/orders/{id}');
    expect(d.evidenceBefore).toEqual({ type: 'number' });
    expect(d.evidenceAfter).toMatchObject({ type: 'string', pattern: '^-?\\d+\\.\\d{2}$' });
    expect(d.details).toMatchObject({
      propertyName: 'total',
      oldType: 'number',
      newType: 'string',
      status: '200',
    });
  });

  it('removed endpoints have evidenceAfter = null and keep the BEFORE operation', () => {
    for (const [rule, method, path] of [
      ['api-removed-without-deprecation', 'DELETE', '/orders/{id}'],
      ['api-path-removed-without-deprecation', 'GET', '/orders/{id}/invoice'],
    ] as const) {
      const d = find(diffs, rule, method, path);
      expect(d.evidenceAfter).toBeNull();
      expect(d.evidenceBefore).toMatchObject({ operationId: expect.any(String) });
    }
  });

  it('the safe `phone` addition is found with evidenceBefore = null', () => {
    const d = find(diffs, 'response-optional-property-added', 'GET', '/customers/{id}');
    expect(d.level).toBe('info');
    expect(d.jsonPointer).toBe('/components/schemas/Customer/properties/phone');
    expect(d.evidenceBefore).toBeNull();
    expect(d.evidenceAfter).toEqual({ type: 'string' });
    expect(d.details).toMatchObject({ propertyName: 'phone', required: false });
  });

  it('removed/added property names are extracted (rename candidates for inc06)', () => {
    const removed = find(diffs, 'response-required-property-removed', 'GET', '/customers/{id}');
    const added = find(diffs, 'response-required-property-added', 'GET', '/customers/{id}');
    expect(removed.details.propertyName).toBe('customer_name');
    expect(added.details.propertyName).toBe('full_name');
    expect(removed.evidenceAfter).toBeNull();
    expect(added.evidenceBefore).toBeNull();
  });

  it('parameter became required: evidence shows required false → true', () => {
    const d = find(diffs, 'request-parameter-became-required', 'GET', '/orders');
    expect(d.details).toMatchObject({ paramIn: 'query', paramName: 'status' });
    expect(d.evidenceBefore).toMatchObject({ name: 'status', required: false });
    expect(d.evidenceAfter).toMatchObject({ name: 'status', required: true });
  });

  it('does not classify anything (no breaking/safe fields)', () => {
    for (const d of diffs) {
      expect(d).not.toHaveProperty('classification');
      expect(d.details).not.toHaveProperty('classification');
    }
  });
});

describe('stability and robustness', () => {
  it('gives the same ids (and output) when run twice, regardless of input order', () => {
    const a = parseDemo();
    const b = parseDemo([...fixture].reverse());
    expect(b).toEqual(a);
    expect(new Set(a.map((d) => d.id)).size).toBe(a.length);
    for (const d of a) expect(d.id).toMatch(/^[0-9a-f]{16}$/);
  });

  it('id = first 16 hex of sha256(ruleId|method|path|jsonPointer)', () => {
    const d = parseDemo()[0]!;
    expect(d.id).toBe(differenceId(d.ruleId, d.method, d.path, d.jsonPointer));
  });

  it('keeps an unknown rule id with its level', () => {
    const edited = [
      ...fixture,
      {
        id: 'some-future-rule',
        text: 'something new about `total`',
        level: 2,
        operation: 'GET',
        path: '/orders/{id}',
        section: 'paths',
      },
    ];
    const diffs = parseDemo(edited);
    expect(diffs).toHaveLength(fixture.length + 1);
    const d = find(diffs, 'some-future-rule', 'GET', '/orders/{id}');
    expect(d.level).toBe('warning');
    expect(d.jsonPointer).toBe('/paths/~1orders~1{id}/get');
    expect(d.details.pointerPrecision).toBe('operation');
  });

  it('keeps an entry with an unrecognised level, flagging it', () => {
    const diffs = parseDemo([{ id: 'x-rule', text: '', level: 9, path: '/orders' }]);
    expect(diffs[0]).toMatchObject({ ruleId: 'x-rule', level: 'warning', method: null });
    expect(diffs[0]!.details).toMatchObject({ unknownLevel: true, rawLevel: 9 });
  });

  it('a difference without a path is unattributed with jsonPointer ""', () => {
    const diffs = parseDemo([
      { id: 'api-security-removed', text: 'removed security', level: 3, section: 'security' },
    ]);
    expect(diffs[0]).toMatchObject({
      jsonPointer: '',
      method: null,
      evidenceBefore: null,
      evidenceAfter: null,
    });
    expect(diffs[0]!.details.unattributed).toBe(true);
  });

  it('without specs it still produces nominal pointers and null evidence', () => {
    const result = parseOasdiffChangelog(fixture);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const d = result.value.find((x) => x.ruleId === 'api-removed-without-deprecation')!;
    expect(d.jsonPointer).toBe('/paths/~1orders~1{id}/delete');
    expect(d.details.pointerPrecision).toBe('nominal');
    expect(d.evidenceBefore).toBeNull();
  });

  it('accepts JSON text and treats null/empty as no differences', () => {
    expect(parseOasdiffChangelog(JSON.stringify(fixture), { before, after })).toEqual(
      parseOasdiffChangelog(fixture, { before, after }),
    );
    expect(parseOasdiffChangelog(null)).toEqual({ ok: true, value: [] });
    expect(parseOasdiffChangelog('null')).toEqual({ ok: true, value: [] });
    expect(parseOasdiffChangelog('')).toEqual({ ok: true, value: [] });
  });

  it('rejects output that is not a JSON array of objects', () => {
    expect(parseOasdiffChangelog('not json')).toMatchObject({
      ok: false,
      error: { code: 'bad_output' },
    });
    expect(parseOasdiffChangelog({ a: 1 })).toMatchObject({
      ok: false,
      error: { code: 'bad_output' },
    });
    expect(parseOasdiffChangelog([1])).toMatchObject({ ok: false, error: { code: 'bad_output' } });
  });

  it('disambiguates two differences with the same rule/method/path/pointer', () => {
    const entry = { id: 'r', text: 'a', level: 1, operation: 'GET', path: '/orders' };
    const diffs = parseDemo([entry, { ...entry, text: 'b' }]);
    expect(diffs[0]!.id).not.toBe(diffs[1]!.id);
  });
});

describe('extractDetails', () => {
  it('reads parameter location and name', () => {
    expect(
      extractDetails(
        'new-required-request-parameter',
        'added the new required `header` request parameter `X-Key`',
      ),
    ).toMatchObject({ paramIn: 'header', paramName: 'X-Key' });
  });

  it('reads nested property paths and type/format changes', () => {
    const d = extractDetails(
      'request-property-type-changed',
      'the `address/zip` request property type/format changed from `integer`/`int32` to `string`/``',
    );
    expect(d).toMatchObject({
      propertyPath: ['address', 'zip'],
      propertyName: 'zip',
      oldType: 'integer',
      oldFormat: 'int32',
      newType: 'string',
      newFormat: '',
    });
  });

  it('keeps every quoted token', () => {
    expect(extractDetails('x', 'a `b` c `d`').quoted).toEqual(['b', 'd']);
  });
});

describe('anchorFor / mapOasdiffLevel', () => {
  it('chooses the anchor from rule family and details', () => {
    expect(anchorFor('api-removed-without-deprecation', 'GET', {})).toEqual({ kind: 'operation' });
    expect(anchorFor('api-path-removed', null, {})).toEqual({ kind: 'path' });
    expect(anchorFor('response-success-status-removed', 'GET', { status: '200' })).toEqual({
      kind: 'response',
      status: '200',
    });
    expect(anchorFor('request-body-became-required', 'POST', {})).toEqual({
      kind: 'request-body',
    });
    expect(anchorFor('request-property-removed', 'POST', { propertyPath: ['a'] })).toMatchObject({
      kind: 'request-property',
      propertyPath: ['a'],
    });
  });

  it('maps numeric and textual levels', () => {
    expect([3, 2, 1].map(mapOasdiffLevel)).toEqual(['error', 'warning', 'info']);
    expect(['ERR', 'WARN', 'INFO', 'error'].map(mapOasdiffLevel)).toEqual([
      'error',
      'warning',
      'info',
      'error',
    ]);
    expect(mapOasdiffLevel(7)).toBeNull();
  });
});
