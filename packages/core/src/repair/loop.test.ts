import { describe, expect, it } from 'vitest';
import type { ValidationResult } from '../validate/types.js';
import type { RepairContextInput } from './context.js';
import {
  FOUR_ATTEMPTS_REASON,
  MAX_REPAIR_ATTEMPTS,
  exceedsTokenCeiling,
  repairPreconditionReason,
  unvalidatedFeedback,
  validatorFeedback,
} from './loop.js';

const mapping = {
  kind: 'field_renamed',
  method: 'GET',
  path: '/customers/{id}',
  location: 'response',
  old: 'customer_name',
  new: 'full_name',
} as unknown as NonNullable<RepairContextInput['change']['mapping']>;

const change = (over: Partial<RepairContextInput['change']> = {}): RepairContextInput['change'] =>
  ({
    classification: 'breaking',
    mappingStatus: 'confirmed',
    mappingSource: 'migration_note',
    mapping,
    ...over,
  }) as RepairContextInput['change'];

const site = { filePath: 'src/customers.ts', line: 1, column: 1, pattern: 'fetch', excerpt: '' };
const located = { callSites: [site] } as never;

describe('repairPreconditionReason (FR-18)', () => {
  it('allows breaking + confirmed + located', () => {
    expect(repairPreconditionReason(change(), located)).toBeNull();
    expect(repairPreconditionReason(change({ mappingSource: 'human' }), located)).toBeNull();
  });
  it('flags an unconfirmed mapping', () => {
    expect(
      repairPreconditionReason(
        change({ mappingStatus: 'unconfirmed', mappingSource: null, mapping: null }),
        located,
      ),
    ).toBe('No confirmed mapping: reported, not repaired.');
  });
  it('flags a "confirmed" status without a source or mapping', () => {
    expect(repairPreconditionReason(change({ mappingSource: null }), located)).toMatch(
      /No confirmed mapping/,
    );
    expect(repairPreconditionReason(change({ mapping: null }), located)).toMatch(
      /No confirmed mapping/,
    );
  });
  it('flags safe and unknown changes', () => {
    expect(repairPreconditionReason(change({ classification: 'safe' }), located)).toMatch(
      /classified safe, not breaking/,
    );
    expect(repairPreconditionReason(change({ classification: 'unknown' }), located)).toMatch(
      /classified unknown/,
    );
  });
  it('flags zero call sites', () => {
    expect(repairPreconditionReason(change(), { callSites: [] })).toBe(
      'No located call sites: reported, not repaired.',
    );
  });
});

describe('exceedsTokenCeiling (FR-24)', () => {
  it('is false at exactly the ceiling and true one above', () => {
    expect(exceedsTokenCeiling(100, 50, 50, 200)).toBe(false);
    expect(exceedsTokenCeiling(101, 50, 50, 200)).toBe(true);
  });
});

describe('constants', () => {
  it('match the SRS', () => {
    expect(MAX_REPAIR_ATTEMPTS).toBe(4);
    expect(FOUR_ATTEMPTS_REASON).toBe(
      '4 attempts used without passing validation; flagged for a human.',
    );
  });
});

const result = (over: Partial<ValidationResult> = {}): ValidationResult => ({
  status: 'fail',
  compileErrors: 1,
  testsPassed: 10,
  testsTotal: 12,
  testResults: [
    { file: 'test/customers.test.ts', name: 'customers display name for 1', status: 'failed' },
    { file: 'test/orders.test.ts', name: 'orders total', status: 'passed' },
  ],
  testFiles: ['test/customers.test.ts', 'test/orders.test.ts'],
  durationMs: 1,
  rawOutput: [
    'src/customers.ts(16,19): error TS2339: Property "customer_name" does not exist.',
    'src/customers.ts(16,19): error TS2339: Property "customer_name" does not exist.',
    'AssertionError: expected undefined to be "Ada Lovelace"',
    'some noisy runner line',
  ].join('\n'),
  ...over,
});

describe('validatorFeedback (FR-21)', () => {
  it('names the failing tests, compiler errors and assertions, without noise or duplicates', () => {
    const text = validatorFeedback(1, result());
    expect(text).toContain('Attempt 1 validation fail: 1 compile error(s), 10/12 tests passed.');
    expect(text).toContain('FAIL test/customers.test.ts > customers display name for 1');
    expect(text).not.toContain('orders total');
    expect(text.match(/error TS2339/g)).toHaveLength(1);
    expect(text).toContain('AssertionError: expected undefined to be "Ada Lovelace"');
    expect(text).not.toContain('noisy');
  });
  it('includes the runner error reason', () => {
    expect(validatorFeedback(2, result({ status: 'error', errorReason: 'no report' }))).toContain(
      'Error: no report',
    );
  });
  it('caps the raw lines it copies', () => {
    const raw = Array.from({ length: 100 }, (_, i) => `x.ts(1,1): error TS${1000 + i}: e`).join(
      '\n',
    );
    const text = validatorFeedback(1, result({ rawOutput: raw, testResults: [] }));
    expect(text.split('\n').length).toBe(41);
  });
});

describe('unvalidatedFeedback', () => {
  it('states the reason with an Error: prefix the context builder keeps', () => {
    expect(unvalidatedFeedback(3, 'patch does not apply')).toBe(
      'Attempt 3 patch rejected before validation. Error: patch does not apply',
    );
  });
});
