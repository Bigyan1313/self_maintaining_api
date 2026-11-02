import { asc, eq } from 'drizzle-orm';
import type { Db } from './client.js';
import { one } from './rows.js';
import { runStageResults } from './schema.js';
import type { NewRunStageResult, RunStageResult } from './types.js';

/**
 * Records one stage's result for a run (FR-38). One row per (run, stage); append-only.
 * @param db - Database handle.
 * @param values - Stage result values.
 */
export async function insertStageResult(
  db: Db,
  values: NewRunStageResult,
): Promise<RunStageResult> {
  return one(await db.insert(runStageResults).values(values).returning(), 'stage result');
}

/**
 * Lists a run's stage results in the order they were written.
 * @param db - Database handle.
 * @param runId - Run id.
 */
export async function listStageResults(db: Db, runId: string): Promise<RunStageResult[]> {
  return db
    .select()
    .from(runStageResults)
    .where(eq(runStageResults.runId, runId))
    .orderBy(asc(runStageResults.startedAt), asc(runStageResults.id));
}
