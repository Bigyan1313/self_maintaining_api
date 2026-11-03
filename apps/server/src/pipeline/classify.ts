import { eq } from 'drizzle-orm';
import { classify, err, ok, parseMigrationNote, type FieldErrors, type Result } from '@sma/core';
import {
  findMigrationNote,
  getSpecVersionById,
  listChangesForVersions,
  type Change,
  type Db,
} from '../infra/db/index.js';
import { specVersions } from '../infra/db/schema.js';
import {
  detectChanges,
  persistClassifiedChanges,
  type DetectDeps,
  type DetectError,
} from './detect.js';

/** Load and verify an API's immutable version pair. */
export async function loadVersionPair(db: Db, apiId: string, from: string, to: string) {
  if (from === to) return null;
  const rows = await db.select().from(specVersions).where(eq(specVersions.apiId, apiId));
  const before = rows.find((r) => r.id === from);
  const after = rows.find((r) => r.id === to);
  return before && after ? { before, after } : null;
}

/** Detect, classify with the pair's latest note, and persist immutable, idempotent changes. */
export async function detectAndClassify(
  db: Db,
  apiId: string,
  from: string,
  to: string,
  deps: DetectDeps = {},
): Promise<Result<Change[], DetectError | { code: 'invalid_note'; errors: FieldErrors }>> {
  const pair = await loadVersionPair(db, apiId, from, to);
  if (!pair)
    return err({
      code: 'version_not_found',
      message: 'Expected distinct versions belonging to this API',
    });
  const existing = await listChangesForVersions(db, from, to);
  if (existing.length) return ok(existing);
  const detected = await detectChanges(db, apiId, from, to, deps);
  if (!detected.ok) return detected;
  const stored = await findMigrationNote(db, from, to);
  const parsed = stored ? parseMigrationNote(stored.rawYaml) : null;
  if (parsed && !parsed.ok) return err({ code: 'invalid_note', errors: parsed.error });
  const verdicts = classify(detected.value, parsed?.ok ? parsed.value : null);
  return ok(
    await persistClassifiedChanges(
      db,
      apiId,
      from,
      to,
      verdicts.map((v) => ({
        difference: v.difference,
        category: v.category,
        classification: v.classification,
        confidence: v.confidence,
        ...(v.mapping && stored
          ? {
              confirmation: {
                source: 'migration_note' as const,
                mapping: v.mapping,
                migrationNoteId: stored.id,
              },
            }
          : {}),
      })),
    ),
  );
}

/** Load source documents for an existing change without accepting client-supplied evidence. */
export async function changeSpecs(db: Db, change: Change) {
  const before = await getSpecVersionById(db, change.fromVersionId);
  const after = await getSpecVersionById(db, change.toVersionId);
  return before && after && before.apiId === change.apiId && after.apiId === change.apiId
    ? { before: before.normalized, after: after.normalized }
    : null;
}
