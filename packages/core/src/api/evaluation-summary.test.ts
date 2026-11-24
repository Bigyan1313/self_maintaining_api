import { expect, it } from 'vitest';
import { ResultsSchema, EvaluationSummarySchema } from './contract.js';
it('preserves the pre-inc14 results contract', () => {
  expect(ResultsSchema.parse({ label: null, results: [] })).toEqual({ label: null, results: [] });
});
it('keeps unavailable metrics distinct from zero and validates rates/counts', () => {
  const s = {
    baseline: 'B1',
    detectionPrecision: null,
    detectionRecall: 0,
    repairRate: 0,
    repairCounts: { repaired: 0, eligible: 0 },
    repairRateByCategory: [],
    refusalCorrectness: null,
    refusalCounts: null,
    wrongActions: 0,
    attemptsDistribution: [],
    cheatRejections: [],
    cheatRejectionsByCategory: [],
    falseConfidence: null,
    costPerRepairUsd: null,
    timePerRepairMs: null,
    modelTimePerRepairMs: null,
    containerTimePerRepairMs: null,
  };
  expect(EvaluationSummarySchema.parse(s).detectionPrecision).toBeNull();
  expect(EvaluationSummarySchema.safeParse({ ...s, repairRate: 1.1 }).success).toBe(false);
  expect(
    EvaluationSummarySchema.safeParse({ ...s, attemptsDistribution: [{ attempts: 5, count: 1 }] })
      .success,
  ).toBe(false);
  expect(
    EvaluationSummarySchema.safeParse({ ...s, cheatRejections: [{ guard: 'made_up', count: 1 }] })
      .success,
  ).toBe(false);
});
