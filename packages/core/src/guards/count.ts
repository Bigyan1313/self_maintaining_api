import type { TestCaseResult } from '../validate/types.js';
import { verdictFromHits, type GuardVerdict } from './verdict.js';

/** The parts of a validation result the count guard compares. */
export interface TestCounts {
  testsTotal: number;
  testsPassed: number;
  testResults: readonly Pick<TestCaseResult, 'file' | 'name'>[];
}

const key = (t: Pick<TestCaseResult, 'file' | 'name'>) => `${t.file}\u0000${t.name}`;

/**
 * `test_count_changed` (FR-28), after validation: the total number of tests changed, fewer
 * tests pass than before the patch, or a test that existed before is missing afterwards
 * (compared by file + name, counting duplicates).
 * @param pre - The pre-patch baseline.
 * @param post - The result for the patched copy.
 * @returns Every hit; empty when the guard passes.
 */
export function countGuard(pre: TestCounts, post: TestCounts): string[] {
  const out: string[] = [];
  if (post.testsTotal !== pre.testsTotal)
    out.push(`total tests changed: ${pre.testsTotal} → ${post.testsTotal}`);
  if (post.testsPassed < pre.testsPassed)
    out.push(`passing tests went down: ${pre.testsPassed} → ${post.testsPassed}`);
  const after = new Map<string, number>();
  for (const t of post.testResults) after.set(key(t), (after.get(key(t)) ?? 0) + 1);
  for (const t of pre.testResults) {
    const left = after.get(key(t)) ?? 0;
    if (left > 0) after.set(key(t), left - 1);
    else out.push(`test missing after the patch: ${t.file} › ${t.name}`);
  }
  return out;
}

/**
 * Runs the count guard (FR-28) as a verdict.
 * @param pre - The pre-patch baseline.
 * @param post - The result for the patched copy.
 */
export function runCountGuard(pre: TestCounts, post: TestCounts): GuardVerdict {
  return verdictFromHits([{ guard: 'test_count_changed', evidence: countGuard(pre, post) }]);
}
