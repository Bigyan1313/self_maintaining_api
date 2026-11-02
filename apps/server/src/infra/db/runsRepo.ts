import { asc, eq, sql } from 'drizzle-orm';
import type { Db } from './client.js';
import { one } from './rows.js';
import { runs } from './schema.js';
import type { NewRun, Run } from './types.js';

/** Columns that may change while a run is still in progress. */
export type RunProgress = Partial<
  Pick<
    Run,
    | 'stageReached'
    | 'attemptCount'
    | 'tokensIn'
    | 'tokensOut'
    | 'costUsd'
    | 'modelId'
    | 'failureStage'
    | 'failureDetail'
    | 'flaggedReason'
    | 'prUrl'
  >
>;

/** Final values written when a run finishes (after this the DB freezes the row, FR-39). */
export type RunFinish = RunProgress & Pick<Run, 'status'> & { finishedAt?: Date };

/**
 * Inserts a run. For a reanalysis pass `parentRunId`.
 * @param db - Database handle.
 * @param values - Run values.
 */
export async function insertRun(db: Db, values: NewRun): Promise<Run> {
  return one(await db.insert(runs).values(values).returning(), 'run');
}

/**
 * Finds a run by id.
 * @param db - Database handle.
 * @param id - Run id.
 */
export async function getRunById(db: Db, id: string): Promise<Run | undefined> {
  return (await db.select().from(runs).where(eq(runs.id, id)))[0];
}

/**
 * Lists runs for a change, oldest first.
 * @param db - Database handle.
 * @param changeId - Change id.
 */
export async function listRunsForChange(db: Db, changeId: string): Promise<Run[]> {
  return db
    .select()
    .from(runs)
    .where(eq(runs.changeId, changeId))
    .orderBy(asc(runs.startedAt), asc(runs.id));
}

/**
 * Lists reanalysis runs created from a parent run.
 * @param db - Database handle.
 * @param parentRunId - Parent run id.
 */
export async function listChildRuns(db: Db, parentRunId: string): Promise<Run[]> {
  return db
    .select()
    .from(runs)
    .where(eq(runs.parentRunId, parentRunId))
    .orderBy(asc(runs.startedAt));
}

/**
 * Updates an unfinished run's progress columns. The DB rejects this once the run is finished.
 * @param db - Database handle.
 * @param id - Run id.
 * @param progress - Columns to update.
 */
export async function updateRunProgress(db: Db, id: string, progress: RunProgress): Promise<Run> {
  return one(await db.update(runs).set(progress).where(eq(runs.id, id)).returning(), 'run');
}

/**
 * Finishes a run: sets its final status and `finishedAt` (default: the database's `now()`, so
 * host/DB clock skew can never put it before `started_at`). Afterwards the row is frozen by the
 * database.
 * @param db - Database handle.
 * @param id - Run id.
 * @param finish - Final status and any last progress values.
 */
export async function finishRun(db: Db, id: string, finish: RunFinish): Promise<Run> {
  const { finishedAt, ...rest } = finish;
  return one(
    await db
      .update(runs)
      .set({ ...rest, finishedAt: finishedAt ?? sql`now()` })
      .where(eq(runs.id, id))
      .returning(),
    'run',
  );
}
