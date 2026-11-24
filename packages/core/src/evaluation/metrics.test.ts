import { describe, expect, it } from 'vitest';
import {
  scoreDetection,
  ratio,
  correctRefusal,
  reviewedRepair,
  summarizeEvaluation,
  evaluationFailures,
  evaluationVariations,
  reviewTrial,
  isPartialEvaluation,
} from './metrics.js';
import {
  EvaluationStudySchema,
  type EvaluationStudy,
  type EvaluationTrial,
  type DetectionLabel,
} from './study.js';
const label: DetectionLabel = {
  method: 'GET',
  path: '/x',
  category: 'field_renamed',
  classification: 'breaking',
  field: 'old',
};
const trial = (overrides: Partial<EvaluationTrial> = {}): EvaluationTrial => ({
  id: '10000000-0000-4000-8000-000000000001',
  scenarioId: 'x',
  baseline: 'B3',
  repeat: 1,
  category: 'field_renamed',
  expected: 'repair',
  outcome: 'repaired',
  reason: 'Passed validation',
  attemptsUsed: 2,
  tokensIn: 10,
  tokensOut: 20,
  costUsd: 2,
  durationMs: 100,
  modelMs: 30,
  containerMs: 60,
  guard: null,
  patch: 'patch',
  migrationNote: 'note',
  runId: null,
  detection: scoreDetection([label], [label]),
  detected: [label],
  labels: [label],
  review: {
    verdict: 'correct',
    name: 'Reviewer',
    note: 'Checked semantics',
    at: '2026-11-23T00:00:00.000Z',
  },
  completed: true,
  createdAt: '2026-11-23T00:00:00.000Z',
  stopReasons: ['end_turn'],
  ...overrides,
});
const study = (trials: EvaluationTrial[]): EvaluationStudy => ({
  schemaVersion: 1,
  label: 'test',
  startedAt: '2026-11-23T00:00:00.000Z',
  updatedAt: '2026-11-23T00:00:00.000Z',
  status: 'complete',
  stopReason: null,
  fake: true,
  config: { baselines: ['B1', 'B2', 'B3'], scenarioIds: ['x'], repeat: 3, maxCost: 5 },
  environment: {
    gitCommit: 'sha',
    modelId: 'fake',
    image: 'digest',
    oasdiff: '1.35.0',
    node: '22',
    platform: 'linux',
    arch: 'x64',
    cpuCores: 2,
    ramBytes: 1024,
    pricing: { input: 0, output: 0 },
    maxOutputTokens: 16000,
    effort: 'high',
  },
  manifest: [],
  admissions: [],
  trials,
  inFlight: null,
  spentUsd: 0,
  reservedUsd: 0,
  modelCalls: { total: 0, maxTokensStops: 0, stopReasons: {} },
});
describe('evaluation metrics: hand-computed examples', () => {
  it('marks a completed subset as partial study evidence', () => {
    const s = study([]);
    s.config.baselines = ['B1'];
    expect(isPartialEvaluation(s)).toBe(true);
    s.config.baselines = ['B1', 'B2', 'B3'];
    s.config.scenarioIds = [];
    expect(isPartialEvaluation(s)).toBe(false);
  });
  it('keeps zero denominators unavailable', () => {
    expect(ratio(0, 0)).toBeNull();
    expect(ratio(1, 4)).toBe(0.25);
  });
  it('matches identity one-to-one and counts duplicates, wrong fields and wrong classes', () => {
    const result = scoreDetection(
      [label, { ...label, classification: 'safe', field: 'new' }],
      [
        label,
        label,
        { ...label, field: 'different' },
        { ...label, classification: 'unknown', field: 'new' },
      ],
    );
    expect(result).toEqual({
      breaking: { tp: 1, fp: 2, fn: 0 },
      safe: { tp: 0, fp: 0, fn: 1 },
      unknown: { tp: 0, fp: 1, fn: 0 },
    });
  });
  it('does not call a passing patch or an unsupported refusal correct', () => {
    expect(reviewedRepair(trial({ review: null }))).toBe(false);
    expect(correctRefusal(trial({ expected: 'refuse', outcome: 'flagged', patch: '' }))).toBe(true);
    expect(correctRefusal(trial({ expected: 'refuse', outcome: 'flagged' }))).toBe(false);
    expect(correctRefusal(trial({ expected: 'refuse', outcome: 'failed', patch: '' }))).toBe(false);
  });
  it('computes every metric with separate reviewed successes, categories, failures and refusals', () => {
    const s = study([
      trial(),
      trial({
        category: 'field_type_changed',
        outcome: 'cheating_rejected',
        guard: 'type_suppression',
        review: null,
      }),
      trial({
        outcome: 'repaired',
        review: {
          verdict: 'incorrect',
          name: 'R',
          note: 'Wrong meaning',
          at: '2026-11-23T00:00:00.000Z',
        },
      }),
      trial({
        expected: 'refuse',
        category: 'endpoint_removed',
        outcome: 'flagged',
        patch: '',
        review: null,
      }),
      trial({ completed: false, costUsd: 99 }),
    ]);
    const summary = summarizeEvaluation(s, 'B3');
    expect(summary.detectionPrecision).toBe(1);
    expect(summary.detectionRecall).toBe(1);
    // Only the three expected-repair trials are in the denominator; the refusal is not.
    expect(summary.repairRate).toBe(2 / 3);
    expect(summary.repairCounts).toEqual({ repaired: 2, eligible: 3 });
    expect(summary.repairRateByCategory).toEqual([
      { category: 'field_renamed', rate: 1, repaired: 2, eligible: 2 },
      { category: 'field_type_changed', rate: 0, repaired: 0, eligible: 1 },
    ]);
    expect(summary.refusalCorrectness).toBe(1);
    expect(summary.refusalCounts).toEqual({ correct: 1, total: 1 });
    expect(summary.wrongActions).toBe(0);
    expect(summary.attemptsDistribution.map((x) => x.count)).toEqual([0, 2, 0, 0]);
    expect(summary.cheatRejections.find((x) => x.guard === 'type_suppression')?.count).toBe(1);
    expect(summary.falseConfidence).toBe(0.5);
    expect(summary.costPerRepairUsd).toBe(4);
    expect(summary.timePerRepairMs).toBe(200);
    expect(summary.modelTimePerRepairMs).toBe(60);
    expect(summary.containerTimePerRepairMs).toBe(120);
    expect(evaluationFailures(s)).toHaveLength(3);
  });
  it('repair rate is over expected-repair scenarios only, e.g. 12/17 (SRS 6.4)', () => {
    const repairs = Array.from({ length: 17 }, (_, i) =>
      trial({ scenarioId: `r${i}`, outcome: i < 12 ? 'repaired' : 'failed' }),
    );
    const refusals = Array.from({ length: 3 }, (_, i) =>
      trial({
        scenarioId: `n${i}`,
        expected: 'refuse',
        category: 'endpoint_removed',
        outcome: 'flagged',
        patch: '',
        review: null,
      }),
    );
    const summary = summarizeEvaluation(study([...repairs, ...refusals]), 'B3');
    expect(summary.repairCounts).toEqual({ repaired: 12, eligible: 17 });
    expect(summary.repairRate).toBe(12 / 17);
    expect(summary.refusalCounts).toEqual({ correct: 3, total: 3 });
  });
  it('a "repaired" refusal scenario is a wrong action: no repair-rate gain, fails refusal, listed', () => {
    const wrong = trial({
      scenarioId: 'nothing-to-map',
      expected: 'refuse',
      category: 'endpoint_removed',
      outcome: 'repaired',
      review: null,
    });
    const s = study([trial({ outcome: 'failed' }), wrong]);
    const summary = summarizeEvaluation(s, 'B3');
    expect(summary.repairCounts).toEqual({ repaired: 0, eligible: 1 });
    expect(summary.repairRate).toBe(0);
    expect(summary.repairRateByCategory.map((c) => c.category)).toEqual(['field_renamed']);
    expect(summary.refusalCorrectness).toBe(0);
    expect(summary.refusalCounts).toEqual({ correct: 0, total: 1 });
    expect(summary.wrongActions).toBe(1);
    expect(summary.costPerRepairUsd).toBeNull();
    expect(evaluationFailures(s).find((f) => f.scenarioId === 'nothing-to-map')?.reason).toMatch(
      /^Wrong action: repaired a refusal scenario/,
    );
  });
  it('B1 makes no decision: refusal correctness is n/a (null), not 0%', () => {
    const s = study([
      trial({ baseline: 'B1', expected: 'refuse', outcome: 'failed', patch: '', review: null }),
    ]);
    const summary = summarizeEvaluation(s, 'B1');
    expect(summary.refusalCorrectness).toBeNull();
    expect(summary.refusalCounts).toBeNull();
  });
  it('counts cheat rejections per guard and per change category', () => {
    const s = study([
      trial({
        category: 'field_renamed',
        outcome: 'cheating_rejected',
        guard: 'test_file_changed',
      }),
      trial({
        category: 'field_type_changed',
        outcome: 'cheating_rejected',
        guard: 'type_suppression',
      }),
      trial({
        category: 'field_type_changed',
        outcome: 'cheating_rejected',
        guard: 'type_suppression',
      }),
    ]);
    const summary = summarizeEvaluation(s, 'B3');
    const at = (category: string, guard: string) =>
      summary.cheatRejectionsByCategory.find((x) => x.category === category && x.guard === guard)
        ?.count;
    expect(at('field_type_changed', 'type_suppression')).toBe(2);
    expect(at('field_renamed', 'test_file_changed')).toBe(1);
    expect(at('field_renamed', 'type_suppression')).toBe(0);
    expect(summary.cheatRejectionsByCategory).toHaveLength(2 * 4);
    expect(summary.cheatRejections.find((x) => x.guard === 'type_suppression')?.count).toBe(2);
  });
  it('reads artifacts written before effort, stop reasons and call counts were recorded', () => {
    const old = structuredClone(study([trial()])) as Record<string, unknown>;
    delete old.modelCalls;
    delete (old.environment as Record<string, unknown>).effort;
    delete ((old.trials as Record<string, unknown>[])[0] as Record<string, unknown>).stopReasons;
    const parsed = EvaluationStudySchema.parse(old);
    expect(parsed.environment.effort).toBe('not recorded');
    expect(parsed.trials[0]?.stopReasons).toEqual([]);
    expect(parsed.modelCalls).toEqual({ total: 0, maxTokensStops: 0, stopReasons: {} });
  });
  it('keeps incomplete review false-confidence rate null and labels the pending pass', () => {
    const s = study([trial({ review: null })]);
    expect(summarizeEvaluation(s, 'B3').falseConfidence).toBeNull();
    expect(evaluationFailures(s)[0]?.reason).toContain('not yet reviewed');
    expect(summarizeEvaluation(s, 'B1').costPerRepairUsd).toBeNull();
  });
  it('reports repeat differences without counting interruptions', () => {
    expect(
      evaluationVariations(
        study([
          trial(),
          trial({ repeat: 2, outcome: 'failed' }),
          trial({ repeat: 3, outcome: 'stage_failure', completed: false }),
        ]),
      ),
    ).toEqual([{ trial: 'x/B3', outcomes: ['repaired', 'failed'] }]);
  });
  it('records reviews, disallows blank identity and forces unmapped patches incorrect', () => {
    expect(
      reviewTrial(trial(), 'incorrect', ' R ', ' note ', '2026-11-23T00:00:00.000Z').review?.name,
    ).toBe('R');
    expect(
      reviewTrial(trial({ expected: 'refuse' }), 'correct', 'R', 'note', '2026-11-23T00:00:00.000Z')
        .review?.verdict,
    ).toBe('incorrect');
    expect(() => reviewTrial(trial(), 'correct', '', 'note', '')).toThrow();
    expect(() => reviewTrial(trial({ baseline: 'B1' }), 'correct', 'R', 'note', '')).toThrow();
  });
  it('rejects unknown versions, path labels and invalid spending', () => {
    expect(EvaluationStudySchema.safeParse(study([])).success).toBe(true);
    for (const invalid of [{ schemaVersion: 2 }, { label: '../bad' }, { spentUsd: -1 }])
      expect(EvaluationStudySchema.safeParse({ ...study([]), ...invalid }).success).toBe(false);
  });
});
