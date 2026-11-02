import { asc, eq } from 'drizzle-orm';
import type { Db } from './client.js';
import { one } from './rows.js';
import { attempts } from './schema.js';
import type { Attempt, NewAttempt } from './types.js';

/**
 * Records a repair attempt. The DB rejects attempt 5+ (DR-03), duplicate numbers, and a guard
 * name on anything but a cheating outcome (DR-04). Append-only.
 * @param db - Database handle.
 * @param values - Attempt values.
 */
export async function insertAttempt(db: Db, values: NewAttempt): Promise<Attempt> {
  return one(await db.insert(attempts).values(values).returning(), 'attempt');
}

/**
 * Lists a run's attempts in order.
 * @param db - Database handle.
 * @param runId - Run id.
 */
export async function listAttempts(db: Db, runId: string): Promise<Attempt[]> {
  return db
    .select()
    .from(attempts)
    .where(eq(attempts.runId, runId))
    .orderBy(asc(attempts.attemptNumber));
}
