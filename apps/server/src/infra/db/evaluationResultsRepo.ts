import { asc, eq } from 'drizzle-orm';
import type { Db } from './client.js';
import { one } from './rows.js';
import { evaluationResults } from './schema.js';
import type { EvaluationResult, NewEvaluationResult } from './types.js';

/**
 * Stores one evaluation result. Unique per (evalLabel, scenarioId, baseline).
 * @param db - Database handle.
 * @param values - Evaluation result values.
 */
export async function insertEvaluationResult(
  db: Db,
  values: NewEvaluationResult,
): Promise<EvaluationResult> {
  return one(await db.insert(evaluationResults).values(values).returning(), 'evaluation result');
}

/**
 * Lists every result for one evaluation run label, ordered by scenario then baseline.
 * @param db - Database handle.
 * @param evalLabel - Evaluation label.
 */
export async function listEvaluationResults(
  db: Db,
  evalLabel: string,
): Promise<EvaluationResult[]> {
  return db
    .select()
    .from(evaluationResults)
    .where(eq(evaluationResults.evalLabel, evalLabel))
    .orderBy(
      asc(evaluationResults.scenarioId),
      asc(evaluationResults.baseline),
      asc(evaluationResults.repeat),
    );
}
