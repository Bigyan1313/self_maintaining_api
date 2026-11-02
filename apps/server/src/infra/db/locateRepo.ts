import { asc, eq } from 'drizzle-orm';
import type { Db } from './client.js';
import { callSites, coverageEntries } from './schema.js';
import type { CallSite, CoverageEntry, NewCallSite, NewCoverageEntry } from './types.js';

/**
 * Stores located call sites (FR-14). Append-only. An empty list is a no-op.
 * @param db - Database handle.
 * @param values - Call sites to store.
 */
export async function insertCallSites(db: Db, values: NewCallSite[]): Promise<CallSite[]> {
  if (values.length === 0) return [];
  return db.insert(callSites).values(values).returning();
}

/**
 * Lists a run's call sites by file and position.
 * @param db - Database handle.
 * @param runId - Run id.
 */
export async function listCallSites(db: Db, runId: string): Promise<CallSite[]> {
  return db
    .select()
    .from(callSites)
    .where(eq(callSites.runId, runId))
    .orderBy(asc(callSites.filePath), asc(callSites.line), asc(callSites.column));
}

/**
 * Stores coverage entries (FR-15). Skipped files need a `skipReason` (enforced by the DB).
 * @param db - Database handle.
 * @param values - Coverage entries to store.
 */
export async function insertCoverageEntries(
  db: Db,
  values: NewCoverageEntry[],
): Promise<CoverageEntry[]> {
  if (values.length === 0) return [];
  return db.insert(coverageEntries).values(values).returning();
}

/**
 * Lists a run's coverage entries by file.
 * @param db - Database handle.
 * @param runId - Run id.
 */
export async function listCoverageEntries(db: Db, runId: string): Promise<CoverageEntry[]> {
  return db
    .select()
    .from(coverageEntries)
    .where(eq(coverageEntries.runId, runId))
    .orderBy(asc(coverageEntries.filePath));
}
