import { and, asc, eq } from 'drizzle-orm';
import type { MappingSource } from '@sma/core';
import type { Db } from './client.js';
import { one } from './rows.js';
import { changes } from './schema.js';
import type { Change, NewChange } from './types.js';

/** Values that confirm a change's old→new mapping (FR-10, BR-04). */
export interface MappingConfirmation {
  mappingSource: MappingSource;
  mapping: unknown;
  /** Required by the DB when `mappingSource` is `human`. */
  confirmedBy?: string | null;
  /** Required by the DB when `mappingSource` is `human`. */
  confirmedAt?: Date | null;
}

/**
 * Inserts a classified change.
 * @param db - Database handle.
 * @param values - Change values.
 */
export async function insertChange(db: Db, values: NewChange): Promise<Change> {
  return one(await db.insert(changes).values(values).returning(), 'change');
}

/**
 * Finds a change by id.
 * @param db - Database handle.
 * @param id - Change id.
 */
export async function getChangeById(db: Db, id: string): Promise<Change | undefined> {
  return (await db.select().from(changes).where(eq(changes.id, id)))[0];
}

/**
 * Lists the changes detected between two spec versions.
 * @param db - Database handle.
 * @param fromVersionId - Older spec version id.
 * @param toVersionId - Newer spec version id.
 */
export async function listChangesForVersions(
  db: Db,
  fromVersionId: string,
  toVersionId: string,
): Promise<Change[]> {
  return db
    .select()
    .from(changes)
    .where(and(eq(changes.fromVersionId, fromVersionId), eq(changes.toVersionId, toVersionId)))
    .orderBy(asc(changes.createdAt), asc(changes.id));
}

/**
 * Marks a change's mapping as confirmed. Only the confirmation columns are written; the DB
 * trigger rejects updates to any other column of a change.
 * @param db - Database handle.
 * @param id - Change id.
 * @param confirmation - Who confirmed it and the mapping.
 */
export async function confirmMapping(
  db: Db,
  id: string,
  confirmation: MappingConfirmation,
): Promise<Change> {
  return one(
    await db
      .update(changes)
      .set({
        mappingStatus: 'confirmed',
        mappingSource: confirmation.mappingSource,
        mapping: confirmation.mapping,
        confirmedBy: confirmation.confirmedBy ?? null,
        confirmedAt: confirmation.confirmedAt ?? null,
      })
      .where(eq(changes.id, id))
      .returning(),
    'change',
  );
}
