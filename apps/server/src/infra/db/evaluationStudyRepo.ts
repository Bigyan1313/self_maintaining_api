import { desc, eq } from 'drizzle-orm';
import { EvaluationStudySchema, isPartialEvaluation, type EvaluationStudy } from '@sma/core';
import type { Db } from './client.js';
import { evaluationResults, evaluationStudies } from './schema.js';

/** Mirror a complete file snapshot and its latest trial rows in one database transaction. */
export async function saveEvaluationStudy(db: Db, input: EvaluationStudy): Promise<void> {
  const study = EvaluationStudySchema.parse(input);
  await db.transaction(async (tx) => {
    await tx
      .insert(evaluationStudies)
      .values({ label: study.label, snapshot: study, updatedAt: new Date(study.updatedAt) })
      .onConflictDoUpdate({
        target: evaluationStudies.label,
        set: { snapshot: study, updatedAt: new Date(study.updatedAt) },
      });
    for (const t of study.trials) {
      const values = {
        evalLabel: study.label,
        scenarioId: t.scenarioId,
        baseline: t.baseline,
        repeat: t.repeat,
        outcome: t.outcome,
        attemptsUsed: t.attemptsUsed,
        costUsd: t.costUsd.toFixed(6),
        durationMs: Math.round(t.durationMs),
        modelMs: Math.round(t.modelMs),
        containerMs: Math.round(t.containerMs),
        reviewVerdict: t.review?.verdict ?? ('not_reviewed' as const),
        isPartial: isPartialEvaluation(study),
      };
      await tx
        .insert(evaluationResults)
        .values(values)
        .onConflictDoUpdate({
          target: [
            evaluationResults.evalLabel,
            evaluationResults.scenarioId,
            evaluationResults.baseline,
            evaluationResults.repeat,
          ],
          set: values,
        });
    }
    for (const a of study.admissions.filter((a) => !a.admissible)) {
      for (const baseline of study.config.baselines) {
        const values = {
          evalLabel: study.label,
          scenarioId: a.id,
          baseline,
          repeat: 1,
          outcome: 'flagged' as const,
          attemptsUsed: 0,
          costUsd: '0',
          durationMs: 0,
          excluded: true,
          exclusionReason: a.reason ?? 'Admission failed',
          isPartial: isPartialEvaluation(study),
        };
        await tx
          .insert(evaluationResults)
          .values(values)
          .onConflictDoUpdate({
            target: [
              evaluationResults.evalLabel,
              evaluationResults.scenarioId,
              evaluationResults.baseline,
              evaluationResults.repeat,
            ],
            set: values,
          });
      }
    }
  });
}
/** Latest study, or one exact label. Returns null before the first evaluation. */
export async function loadEvaluationStudy(db: Db, label?: string): Promise<EvaluationStudy | null> {
  const query = db.select().from(evaluationStudies);
  const rows = await (
    label
      ? query.where(eq(evaluationStudies.label, label))
      : query.orderBy(desc(evaluationStudies.updatedAt))
  ).limit(1);
  return rows[0] ? EvaluationStudySchema.parse(rows[0].snapshot) : null;
}
