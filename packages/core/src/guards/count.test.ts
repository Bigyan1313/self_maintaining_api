import { describe, expect, it } from 'vitest';
import type { TestCaseResult, TestCaseStatus } from '../validate/types.js';
import { countGuard, runCountGuard, type TestCounts } from './count.js';

const t = (file: string, name: string, status: TestCaseStatus = 'passed'): TestCaseResult => ({
  file,
  name,
  status,
});
const counts = (results: TestCaseResult[]): TestCounts => ({
  testsTotal: results.length,
  testsPassed: results.filter((r) => r.status === 'passed').length,
  testResults: results,
});

/** The v2 baseline shape: 2 passing, 2 failing. */
const PRE = counts([
  t('test/a.test.ts', 'a one'),
  t('test/a.test.ts', 'a two', 'failed'),
  t('test/b.test.ts', 'b one'),
  t('test/b.test.ts', 'b two', 'failed'),
]);

describe('countGuard (FR-28)', () => {
  it('passing went up with the same total and the same tests → ok', () => {
    const post = counts(PRE.testResults.map((r) => ({ ...r, status: 'passed' as const })));
    expect(countGuard(PRE, post)).toEqual([]);
    expect(runCountGuard(PRE, post)).toEqual({ ok: true });
  });

  it('identical results → ok', () => {
    expect(runCountGuard(PRE, PRE)).toEqual({ ok: true });
  });

  it('total changed (a test was added) → reject', () => {
    const post = counts([...(PRE.testResults as TestCaseResult[]), t('src/new.test.ts', 'extra')]);
    expect(runCountGuard(PRE, post)).toEqual({
      ok: false,
      guard: 'test_count_changed',
      evidence: ['[test_count_changed] total tests changed: 4 → 5'],
      hits: [{ guard: 'test_count_changed', evidence: ['total tests changed: 4 → 5'] }],
    });
  });

  it('passing went down → reject', () => {
    const post = counts(PRE.testResults.map((r) => ({ ...r, status: 'failed' as const })));
    expect(countGuard(PRE, post)).toEqual(['passing tests went down: 2 → 0']);
  });

  it('a test was renamed (same totals) → reject, naming the missing test', () => {
    const post = counts([
      t('test/a.test.ts', 'a one'),
      t('test/a.test.ts', 'a two (renamed)', 'failed'),
      t('test/b.test.ts', 'b one'),
      t('test/b.test.ts', 'b two', 'failed'),
    ]);
    expect(countGuard(PRE, post)).toEqual(['test missing after the patch: test/a.test.ts › a two']);
  });

  it('a test was removed → reject with every hit (total, passing, missing)', () => {
    const post = counts([
      t('test/a.test.ts', 'a two', 'failed'),
      t('test/b.test.ts', 'b one'),
      t('test/b.test.ts', 'b two', 'failed'),
    ]);
    expect(countGuard(PRE, post)).toEqual([
      'total tests changed: 4 → 3',
      'passing tests went down: 2 → 1',
      'test missing after the patch: test/a.test.ts › a one',
    ]);
  });

  it('a test moved to another file counts as missing', () => {
    const post = counts([
      t('test/b.test.ts', 'a one'),
      t('test/a.test.ts', 'a two', 'failed'),
      t('test/b.test.ts', 'b one'),
      t('test/b.test.ts', 'b two', 'failed'),
    ]);
    expect(countGuard(PRE, post)).toEqual(['test missing after the patch: test/a.test.ts › a one']);
  });

  it('duplicate names are counted, so one copy cannot hide a removal', () => {
    const pre = counts([t('test/a.test.ts', 'same'), t('test/a.test.ts', 'same')]);
    const post = counts([t('test/a.test.ts', 'same'), t('test/a.test.ts', 'other')]);
    expect(countGuard(pre, post)).toEqual(['test missing after the patch: test/a.test.ts › same']);
  });

  it('uses the reported counts, not just the list', () => {
    const post = { ...PRE, testsPassed: 1 };
    expect(countGuard(PRE, post)).toEqual(['passing tests went down: 2 → 1']);
  });
});
