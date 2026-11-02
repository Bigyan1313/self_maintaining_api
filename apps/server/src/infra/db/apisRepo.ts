import { eq } from 'drizzle-orm';
import type { Db } from './client.js';
import { one } from './rows.js';
import { apis } from './schema.js';
import type { Api, NewApi } from './types.js';

/**
 * Inserts an API.
 * @param db - Database handle.
 * @param values - API values.
 */
export async function insertApi(db: Db, values: NewApi): Promise<Api> {
  return one(await db.insert(apis).values(values).returning(), 'api');
}

/**
 * Finds an API by id.
 * @param db - Database handle.
 * @param id - API id.
 */
export async function getApiById(db: Db, id: string): Promise<Api | undefined> {
  return (await db.select().from(apis).where(eq(apis.id, id)))[0];
}

/**
 * Finds an API by its unique name.
 * @param db - Database handle.
 * @param name - API name.
 */
export async function getApiByName(db: Db, name: string): Promise<Api | undefined> {
  return (await db.select().from(apis).where(eq(apis.name, name)))[0];
}

/**
 * Sets the API's current baseline spec version.
 * @param db - Database handle.
 * @param apiId - API id.
 * @param specVersionId - The new baseline version id.
 */
export async function setBaselineVersion(
  db: Db,
  apiId: string,
  specVersionId: string,
): Promise<Api> {
  return one(
    await db
      .update(apis)
      .set({ baselineVersionId: specVersionId })
      .where(eq(apis.id, apiId))
      .returning(),
    'api',
  );
}
