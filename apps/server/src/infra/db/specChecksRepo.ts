import { desc, eq } from 'drizzle-orm';
import type { Db } from './client.js';
import { one } from './rows.js';
import { specChecks } from './schema.js';
import type { NewSpecCheck, SpecCheck } from './types.js';

/**
 * Records a spec check. A `failed` outcome requires `errorDetail` (FR-11, enforced by the DB).
 * @param db - Database handle.
 * @param values - Spec check values.
 */
export async function insertSpecCheck(db: Db, values: NewSpecCheck): Promise<SpecCheck> {
  return one(await db.insert(specChecks).values(values).returning(), 'spec check');
}

/**
 * Lists an API's spec checks, newest first.
 * @param db - Database handle.
 * @param apiId - API id.
 */
export async function listSpecChecks(db: Db, apiId: string): Promise<SpecCheck[]> {
  return db
    .select()
    .from(specChecks)
    .where(eq(specChecks.apiId, apiId))
    .orderBy(desc(specChecks.startedAt));
}
