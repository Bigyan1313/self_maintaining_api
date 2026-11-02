import { and, desc, eq } from 'drizzle-orm';
import type { Db } from './client.js';
import { one } from './rows.js';
import { migrationNotes } from './schema.js';
import type { MigrationNote, NewMigrationNote } from './types.js';

/**
 * Stores a migration note for a spec pair.
 * @param db - Database handle.
 * @param values - Migration note values (raw YAML and parsed form).
 */
export async function insertMigrationNote(
  db: Db,
  values: NewMigrationNote,
): Promise<MigrationNote> {
  return one(await db.insert(migrationNotes).values(values).returning(), 'migration note');
}

/**
 * Finds the most recently uploaded migration note for a spec pair.
 * @param db - Database handle.
 * @param fromVersionId - Older spec version id.
 * @param toVersionId - Newer spec version id.
 */
export async function findMigrationNote(
  db: Db,
  fromVersionId: string,
  toVersionId: string,
): Promise<MigrationNote | undefined> {
  return (
    await db
      .select()
      .from(migrationNotes)
      .where(
        and(
          eq(migrationNotes.fromVersionId, fromVersionId),
          eq(migrationNotes.toVersionId, toVersionId),
        ),
      )
      .orderBy(desc(migrationNotes.uploadedAt))
      .limit(1)
  )[0];
}
