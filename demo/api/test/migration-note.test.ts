import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parseDocument } from 'yaml';
import { describe, expect, it } from 'vitest';
import { loadSpec } from './spec-helpers.js';

interface Mapping {
  kind: string;
  method: string;
  path: string;
  replacement?: { method: string; path: string };
}

const file = fileURLToPath(new URL('../migration-notes/v1-to-v2.yaml', import.meta.url));
const doc = parseDocument(readFileSync(file, 'utf8'));
const note = doc.toJS() as { api: string; from: string; to: string; mappings: Mapping[] };

describe('migration-notes/v1-to-v2.yaml', () => {
  it('is valid YAML with header fields matching the spec versions', () => {
    expect(doc.errors).toEqual([]);
    expect(note.api).toBe('demo-shop');
    expect(note.from).toBe(loadSpec('v1').info.version);
    expect(note.to).toBe(loadSpec('v2').info.version);
  });

  it('confirms exactly the 4 mapped changes, one per category', () => {
    expect(note.mappings.map((m) => `${m.kind} ${m.method} ${m.path}`)).toEqual([
      'field_renamed GET /customers/{id}',
      'field_type_changed GET /orders/{id}',
      'required_param_added GET /orders',
      'endpoint_removed GET /orders/{id}/invoice',
    ]);
  });

  it('has NO entry for DELETE /orders/{id} (deliberately unconfirmed, BR-04/BR-05)', () => {
    expect(note.mappings.some((m) => m.method === 'DELETE')).toBe(false);
    expect(
      note.mappings.some((m) => m.path === '/orders/{id}' && m.kind === 'endpoint_removed'),
    ).toBe(false);
  });

  it('points the invoice replacement at an operation that exists in v2', () => {
    const replacement = note.mappings.find((m) => m.kind === 'endpoint_removed')?.replacement;
    expect(replacement).toEqual({ method: 'GET', path: '/invoices/{orderId}' });
    expect(loadSpec('v2').paths['/invoices/{orderId}']?.get?.operationId).toBe('getInvoice');
  });
});
