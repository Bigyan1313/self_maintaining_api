import { describe, expect, it } from 'vitest';
import {
  buildJsonPointer,
  escapePointerSegment,
  extractEvidence,
  locateInSpec,
  parseJsonPointer,
  resolveAnchor,
} from './pointer.js';

describe('RFC 6901 helpers', () => {
  it('escapes ~ and / in tokens', () => {
    expect(escapePointerSegment('a/b~c')).toBe('a~1b~0c');
    expect(buildJsonPointer(['paths', '/orders/{id}', 'get'])).toBe('/paths/~1orders~1{id}/get');
    expect(buildJsonPointer([])).toBe('');
  });

  it('round-trips through parseJsonPointer', () => {
    const tokens = ['paths', '/a~/b', 'get', '0'];
    expect(parseJsonPointer(buildJsonPointer(tokens))).toEqual(tokens);
    expect(parseJsonPointer('no-slash')).toBeNull();
  });

  it('extractEvidence returns a copy, or null when absent', () => {
    const doc = { a: { b: [10, { c: 1 }] }, n: null };
    expect(extractEvidence(doc, '/a/b/1')).toEqual({ c: 1 });
    expect(extractEvidence(doc, '/a/b/1')).not.toBe(doc.a.b[1]);
    expect(extractEvidence(doc, '/a/b/2')).toBeNull();
    expect(extractEvidence(doc, '/a/b/01')).toBeNull();
    expect(extractEvidence(doc, '/a/x')).toBeNull();
    expect(extractEvidence(undefined, '/a')).toBeNull();
    expect(extractEvidence(doc, '/n')).toBeNull();
  });
});

const spec = {
  paths: {
    '/items': {
      parameters: [{ name: 'tenant', in: 'header' }],
      post: {
        requestBody: { $ref: '#/components/requestBodies/NewItem' },
        responses: {
          '201': {
            content: { 'application/json': { schema: { $ref: '#/components/schemas/Item' } } },
          },
          default: { description: 'err' },
        },
      },
      get: {
        responses: {
          '200': {
            content: {
              'application/json': {
                schema: { type: 'array', items: { $ref: '#/components/schemas/Item' } },
              },
            },
          },
        },
      },
    },
  },
  components: {
    requestBodies: {
      NewItem: {
        content: { 'application/json': { schema: { $ref: '#/components/schemas/Base' } } },
      },
    },
    schemas: {
      Base: { properties: { name: { type: 'string' } } },
      Item: {
        allOf: [
          { $ref: '#/components/schemas/Base' },
          { properties: { owner: { properties: { email: { type: 'string' } } } } },
        ],
      },
      Loop: { $ref: '#/components/schemas/Loop' },
    },
  },
};

describe('resolveAnchor', () => {
  it('follows $refs and allOf to the real property location', () => {
    expect(
      resolveAnchor(spec, '/items', 'POST', {
        kind: 'response-property',
        status: '201',
        propertyPath: ['owner', 'email'],
      }),
    ).toBe('/components/schemas/Item/allOf/1/properties/owner/properties/email');
    expect(
      resolveAnchor(spec, '/items', 'POST', { kind: 'request-property', propertyPath: ['name'] }),
    ).toBe('/components/schemas/Base/properties/name');
  });

  it('handles arrays with or without an explicit items step', () => {
    for (const propertyPath of [['items', 'name'], ['name']])
      expect(
        resolveAnchor(spec, '/items', 'GET', {
          kind: 'response-property',
          status: null,
          propertyPath,
        }),
      ).toBe('/components/schemas/Base/properties/name');
  });

  it('finds path-level parameters and request bodies', () => {
    expect(
      resolveAnchor(spec, '/items', 'GET', { kind: 'parameter', in: 'header', name: 'tenant' }),
    ).toBe('/paths/~1items/parameters/0');
    expect(resolveAnchor(spec, '/items', 'POST', { kind: 'request-body' })).toBe(
      '/components/requestBodies/NewItem',
    );
    expect(resolveAnchor(spec, '/items', 'POST', { kind: 'response', status: 'default' })).toBe(
      '/paths/~1items/post/responses/default',
    );
  });

  it('returns null for missing items and survives $ref cycles', () => {
    expect(resolveAnchor(spec, '/nope', 'GET', { kind: 'operation' })).toBeNull();
    expect(resolveAnchor(spec, '/items', 'DELETE', { kind: 'operation' })).toBeNull();
    expect(
      resolveAnchor(spec, '/items', 'GET', { kind: 'parameter', in: 'query', name: 'tenant' }),
    ).toBeNull();
    const cyclic = { paths: { '/x': { $ref: '#/paths/~1x' } } };
    expect(resolveAnchor(cyclic, '/x', 'GET', { kind: 'path' })).toBeNull();
    expect(resolveAnchor(undefined, '/items', 'GET', { kind: 'operation' })).toBeNull();
  });
});

describe('locateInSpec', () => {
  it('returns the resolvable pointer and the through-the-operation pointer', () => {
    expect(
      locateInSpec(spec, '/items', 'POST', {
        kind: 'response-property',
        status: '201',
        propertyPath: ['name'],
      }),
    ).toEqual({
      pointer: '/components/schemas/Base/properties/name',
      operationPointer:
        '/paths/~1items/post/responses/201/content/application~1json/schema/allOf/0/properties/name',
    });
  });
});
