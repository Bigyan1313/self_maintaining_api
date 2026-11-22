/**
 * Hand-written expected results for the acceptance checks (SRS Appendix A).
 *
 * These labels were written by reading the specs (`demo/api/specs/v1.yaml`, `v2.yaml`), the
 * migration note (`demo/api/migration-notes/v1-to-v2.yaml`) and the consumer source, before the
 * acceptance script was first run. They are NOT copied from program output. If the program
 * disagrees with a label, the check fails and the record says so.
 *
 * @packageDocumentation
 */
import type { CallPattern, ChangeCategory, Classification, MappingStatus } from '@sma/core';

/** One expected difference and its hand label. */
export interface ExpectedChange {
  ruleId: string;
  method: string | null;
  path: string;
  classification: Classification;
  category: ChangeCategory;
  /** With the migration note uploaded. */
  mappingWithNote: MappingStatus;
  /** Why this label is right, in plain words. */
  why: string;
}

/** Demo Shop v1 → v2: the 9 differences a reviewer finds by reading both specs. */
export const DEMO_V1_V2: readonly ExpectedChange[] = [
  {
    ruleId: 'response-required-property-removed',
    method: 'GET',
    path: '/customers/{id}',
    classification: 'breaking',
    category: 'field_renamed',
    mappingWithNote: 'confirmed',
    why: 'customer_name is gone from the response and full_name appears; the note states the rename',
  },
  {
    ruleId: 'response-required-property-added',
    method: 'GET',
    path: '/customers/{id}',
    classification: 'safe',
    category: 'other',
    mappingWithNote: 'unconfirmed',
    why: 'a new response field (full_name) does not break a client that ignores it',
  },
  {
    ruleId: 'response-optional-property-added',
    method: 'GET',
    path: '/customers/{id}',
    classification: 'safe',
    category: 'other',
    mappingWithNote: 'unconfirmed',
    why: 'a new optional response field (phone) is safe',
  },
  {
    ruleId: 'request-parameter-became-required',
    method: 'GET',
    path: '/orders',
    classification: 'breaking',
    category: 'required_param_added',
    mappingWithNote: 'confirmed',
    why: 'query parameter status is now required; the note gives the default value',
  },
  {
    ruleId: 'response-property-type-changed',
    method: 'GET',
    path: '/orders/{id}',
    classification: 'breaking',
    category: 'field_type_changed',
    mappingWithNote: 'confirmed',
    why: 'total changed from number to string; the note gives the conversion',
  },
  {
    ruleId: 'response-property-pattern-added',
    method: 'GET',
    path: '/orders/{id}',
    classification: 'safe',
    category: 'other',
    mappingWithNote: 'unconfirmed',
    why: 'a pattern on a response value constrains the server, not the client',
  },
  {
    ruleId: 'api-removed-without-deprecation',
    method: 'DELETE',
    path: '/orders/{id}',
    classification: 'breaking',
    category: 'endpoint_removed',
    mappingWithNote: 'unconfirmed',
    why: 'DELETE /orders/{id} is removed and the note has no entry for it (no replacement, BR-05)',
  },
  {
    ruleId: 'api-path-removed-without-deprecation',
    method: 'GET',
    path: '/orders/{id}/invoice',
    classification: 'breaking',
    category: 'endpoint_removed',
    mappingWithNote: 'confirmed',
    why: 'the invoice path is removed; the note names GET /invoices/{orderId} as the replacement',
  },
  {
    ruleId: 'endpoint-added',
    method: 'GET',
    path: '/invoices/{orderId}',
    classification: 'safe',
    category: 'other',
    mappingWithNote: 'unconfirmed',
    why: 'a new endpoint is safe for existing clients',
  },
];

/**
 * v1 → v1 with `cancelled` added to the Order status enum. The SRS rule table (docs/classification-rules.md)
 * has no rule for enum changes, so a reviewer labels them unknown: reported, never repaired.
 */
export const DEMO_V1_ENUM: readonly Pick<
  ExpectedChange,
  'ruleId' | 'method' | 'path' | 'classification' | 'why'
>[] = [
  {
    ruleId: 'response-property-enum-value-added',
    method: 'GET',
    path: '/orders',
    classification: 'unknown',
    why: 'a new enum value may or may not break a client; the documented rules do not cover it',
  },
  {
    ruleId: 'response-property-enum-value-added',
    method: 'GET',
    path: '/orders/{id}',
    classification: 'unknown',
    why: 'same enum change on the single-order response',
  },
  {
    ruleId: 'api-version-not-bumped',
    method: null,
    path: '',
    classification: 'unknown',
    why: 'a whole-document note from oasdiff, not tied to an operation; not in the rule table',
  },
];

/** One call the consumer makes, found by reading `demo/consumer/src`. */
export interface ExpectedCallSite {
  target: { method: 'GET' | 'DELETE'; path: string; operationId?: string };
  filePath: string;
  line: number;
  pattern: CallPattern;
}

/** The three supported call patterns (generated client counted separately), with file and line. */
export const CONSUMER_CALL_SITES: readonly ExpectedCallSite[] = [
  {
    target: { method: 'GET', path: '/customers/{id}' },
    filePath: 'src/customers.ts',
    line: 12,
    pattern: 'fetch',
  },
  {
    target: { method: 'GET', path: '/orders/{id}' },
    filePath: 'src/orders.ts',
    line: 27,
    pattern: 'axios_instance',
  },
  {
    target: { method: 'DELETE', path: '/orders/{id}' },
    filePath: 'src/admin.ts',
    line: 6,
    pattern: 'axios_static',
  },
  {
    target: { method: 'GET', path: '/orders/{id}/invoice', operationId: 'getOrderInvoice' },
    filePath: 'src/invoices.ts',
    line: 5,
    pattern: 'generated_client',
  },
  {
    target: { method: 'GET', path: '/orders/{id}/invoice', operationId: 'getOrderInvoice' },
    filePath: 'src/invoices.ts',
    line: 11,
    pattern: 'generated_client',
  },
];

/** Coverage limits the consumer copy contains on purpose (FR-15, FR-17, BR-02). */
export const CONSUMER_COVERAGE_LIMITS = {
  unsupported: [
    { filePath: 'src/unsupported/dynamicUrl.ts', kind: 'dynamic_url' },
    { filePath: 'src/unsupported/wrapper.ts', kind: 'wrapper' },
    { filePath: 'src/alias.ts', kind: 'reexported_alias' },
  ],
  skipped: [
    { filePath: '.env', reason: 'credential or environment file' },
    { filePath: 'src/linked.ts', reason: 'symbolic link not followed' },
    { filePath: 'vitest.config.ts', reason: 'configuration file' },
    { filePath: 'README.md', reason: 'not TypeScript source' },
  ],
} as const;
