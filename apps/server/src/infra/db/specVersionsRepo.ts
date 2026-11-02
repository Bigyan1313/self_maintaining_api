import { and, asc, eq } from 'drizzle-orm';
import type { Db } from './client.js';
import { one } from './rows.js';
import { specVersions } from './schema.js';
import type { NewSpecVersion, SpecVersion } from './types.js';

/**
 * Inserts a spec version. A duplicate `(apiId, contentSha256)` is rejected by the DB (FR-05).
 * @param db - Database handle.
 * @param values - Spec version values.
 */
export async function insertSpecVersion(db: Db, values: NewSpecVersion): Promise<SpecVersion> {
  return one(await db.insert(specVersions).values(values).returning(), 'spec version');
}

/**
 * Finds a spec version by id.
 * @param db - Database handle.
 * @param id - Spec version id.
 */
export async function getSpecVersionById(db: Db, id: string): Promise<SpecVersion | undefined> {
  return (await db.select().from(specVersions).where(eq(specVersions.id, id)))[0];
}

/**
 * Finds the version of an API with a given content hash.
 * @param db - Database handle.
 * @param apiId - API id.
 * @param contentSha256 - Lowercase hex SHA-256 of the normalized content.
 */
export async function findSpecVersionByHash(
  db: Db,
  apiId: string,
  contentSha256: string,
): Promise<SpecVersion | undefined> {
  return (
    await db
      .select()
      .from(specVersions)
      .where(and(eq(specVersions.apiId, apiId), eq(specVersions.contentSha256, contentSha256)))
  )[0];
}

/**
 * Lists an API's spec versions, oldest first.
 * @param db - Database handle.
 * @param apiId - API id.
 */
export async function listSpecVersions(db: Db, apiId: string): Promise<SpecVersion[]> {
  return db
    .select()
    .from(specVersions)
    .where(eq(specVersions.apiId, apiId))
    .orderBy(asc(specVersions.retrievedAt), asc(specVersions.id));
}
