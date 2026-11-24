import type { FastifyInstance } from 'fastify';
import {
  BASELINE_LABELS,
  RUN_STATUS_LABELS,
  REVIEW_VERDICT_LABELS,
  ResultsQuerySchema,
  summarizeEvaluation,
  evaluationFailures,
} from '@sma/core';
import type { Db } from '../infra/db/client.js';
import { loadEvaluationStudy } from '../infra/db/evaluationStudyRepo.js';
import { listEvaluationResults } from '../infra/db/evaluationResultsRepo.js';
/** Results and report metrics share the persisted file snapshot; no re-derived dashboard scores. */
export async function registerResultsRoutes(app: FastifyInstance, deps: { db: Db }): Promise<void> {
  app.get('/api/results', async (request, reply) => {
    const query = ResultsQuerySchema.safeParse(request.query);
    if (!query.success)
      return reply.code(400).send([{ field: 'label', message: 'Invalid evaluation label' }]);
    const study = await loadEvaluationStudy(deps.db, query.data.label);
    if (!study) return { label: null, results: [], summaries: [], failures: [] };
    const rows = await listEvaluationResults(deps.db, study.label);
    return {
      label: study.label,
      results: rows.map((row) => ({
        ...row,
        createdAt: row.createdAt.toISOString(),
        baseline: { value: row.baseline, label: BASELINE_LABELS[row.baseline] },
        outcome: { value: row.outcome, label: RUN_STATUS_LABELS[row.outcome] },
        reviewVerdict: {
          value: row.reviewVerdict,
          label: REVIEW_VERDICT_LABELS[row.reviewVerdict],
        },
      })),
      summaries: study.config.baselines.map((b) => summarizeEvaluation(study, b)),
      failures: evaluationFailures(study),
      study,
    };
  });
}
