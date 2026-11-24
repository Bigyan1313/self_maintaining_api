import { CLASSIFICATIONS, GUARD_NAMES, type Baseline } from '../domain/enums.js';
import type { EvaluationSummary } from '../api/evaluation-summary.js';
import type { DetectionLabel, EvaluationStudy, EvaluationTrial } from './study.js';

/** Undefined denominators remain null, never a fabricated zero. */
export function ratio(numerator: number, denominator: number): number | null {
  return denominator ? numerator / denominator : null;
}
/** Match detections one-to-one, including classification, field and parameter identity. */
export function scoreDetection(expected: DetectionLabel[], actual: DetectionLabel[]) {
  const identity = (x: DetectionLabel) =>
    JSON.stringify([
      x.method,
      x.path,
      x.category,
      x.classification,
      x.field ?? null,
      x.parameter ?? null,
      x.location ?? null,
    ]);
  return Object.fromEntries(
    CLASSIFICATIONS.map((classification) => {
      const remaining = expected.filter((x) => x.classification === classification).map(identity);
      let tp = 0,
        fp = 0;
      for (const item of actual.filter((x) => x.classification === classification)) {
        const i = remaining.indexOf(identity(item));
        if (i < 0) fp++;
        else {
          tp++;
          remaining.splice(i, 1);
        }
      }
      return [classification, { tp, fp, fn: remaining.length }];
    }),
  ) as NonNullable<EvaluationTrial['detection']>;
}
/** A refusal is correct only when no patch was proposed for an explicitly unmapped case. */
export function correctRefusal(t: EvaluationTrial): boolean {
  return t.completed && t.expected === 'refuse' && t.outcome === 'flagged' && !t.patch;
}
/** Human correctness is separate from validation success. */
export function reviewedRepair(t: EvaluationTrial): boolean {
  return (
    t.completed &&
    t.expected === 'repair' &&
    t.outcome === 'repaired' &&
    t.review?.verdict === 'correct'
  );
}
/** Compute every baseline summary from completed, admitted trials only. */
export function summarizeEvaluation(study: EvaluationStudy, baseline: Baseline): EvaluationSummary {
  const rows = study.trials.filter((t) => t.baseline === baseline && t.completed);
  // SRS 6.4 defines repair rate as tests passing, separately from semantic correctness.
  const repaired = rows.filter((t) => t.outcome === 'repaired');
  const passed = rows.filter((t) => t.outcome === 'repaired');
  const reviewed = passed.filter((t) => t.review);
  const counts = rows.flatMap((t) => (t.detection ? Object.values(t.detection) : []));
  const sum = (key: 'tp' | 'fp' | 'fn') => counts.reduce((s, c) => s + c[key], 0);
  const expense = (key: 'costUsd' | 'durationMs' | 'modelMs' | 'containerMs') =>
    ratio(
      rows.reduce((s, t) => s + t[key], 0),
      repaired.length,
    );
  const refusals = rows.filter((t) => t.expected === 'refuse');
  return {
    baseline,
    detectionPrecision: ratio(sum('tp'), sum('tp') + sum('fp')),
    detectionRecall: ratio(sum('tp'), sum('tp') + sum('fn')),
    repairRate: ratio(repaired.length, rows.length),
    repairRateByCategory: [...new Set(rows.map((t) => t.category))].sort().map((category) => ({
      category,
      rate: ratio(
        repaired.filter((t) => t.category === category).length,
        rows.filter((t) => t.category === category).length,
      ),
    })),
    refusalCorrectness: ratio(refusals.filter(correctRefusal).length, refusals.length),
    attemptsDistribution: [1, 2, 3, 4].map((attempts) => ({
      attempts,
      count: repaired.filter((t) => t.attemptsUsed === attempts).length,
    })),
    cheatRejections: GUARD_NAMES.map((guard) => ({
      guard,
      count: rows.filter((t) => t.guard === guard).length,
    })),
    falseConfidence:
      reviewed.length === passed.length
        ? ratio(reviewed.filter((t) => t.review?.verdict === 'incorrect').length, passed.length)
        : null,
    costPerRepairUsd: expense('costUsd'),
    timePerRepairMs: expense('durationMs'),
    modelTimePerRepairMs: expense('modelMs'),
    containerTimePerRepairMs: expense('containerMs'),
  };
}
/** Failures include unreviewed passes explicitly, never silently treating them as correct. */
export function evaluationFailures(study: EvaluationStudy) {
  return study.trials
    .filter((t) => !correctRefusal(t) && !reviewedRepair(t))
    .map((t) => ({
      scenarioId: t.scenarioId,
      baseline: t.baseline,
      repeat: t.repeat,
      category: t.category,
      reason: !t.completed
        ? `Interrupted: ${t.reason}`
        : t.outcome === 'repaired' && !t.review
          ? 'Passed validation; not yet reviewed'
          : t.review?.verdict === 'incorrect'
            ? `Incorrect: ${t.review.note}`
            : t.reason,
    }));
}
/** Report outcome variation only among completed repetitions of the same trial. */
export function evaluationVariations(study: EvaluationStudy) {
  const groups = new Map<string, Set<string>>();
  for (const t of study.trials.filter((t) => t.completed)) {
    const key = `${t.scenarioId}/${t.baseline}`;
    const outcomes = groups.get(key) ?? new Set<string>();
    outcomes.add(t.outcome);
    groups.set(key, outcomes);
  }
  return [...groups]
    .filter(([, outcomes]) => outcomes.size > 1)
    .map(([trial, outcomes]) => ({ trial, outcomes: [...outcomes] }));
}
/** Apply a named human review; no-replacement patches can never be marked correct. */
export function reviewTrial(
  trial: EvaluationTrial,
  verdict: 'correct' | 'incorrect',
  name: string,
  note: string,
  at: string,
): EvaluationTrial {
  if (trial.baseline === 'B1' || trial.outcome !== 'repaired' || !trial.patch || !trial.completed)
    throw new Error('Only completed B2/B3 validation passes can be reviewed');
  if (!name.trim() || !note.trim()) throw new Error('Reviewer name and note are required');
  return {
    ...trial,
    review: {
      verdict: trial.expected === 'refuse' ? 'incorrect' : verdict,
      name: name.trim(),
      note: trial.expected === 'refuse' ? `Should have refused. ${note.trim()}` : note.trim(),
      at,
    },
  };
}

/** A completed subset is still partial evidence for the full three-baseline study. */
export function isPartialEvaluation(study: EvaluationStudy): boolean {
  return (
    study.status === 'partial' ||
    study.config.scenarioIds.length !== study.manifest.length ||
    study.config.baselines.length !== 3
  );
}
