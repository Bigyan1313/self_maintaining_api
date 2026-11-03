import { eq } from 'drizzle-orm';
import {
  err,
  parseOasdiffChangelog,
  type ChangeCategory,
  type Classification,
  type DetectParseError,
  type MappingSource,
  type Result,
  type SpecDifference,
} from '@sma/core';
import { type Change, type Db, insertChange, listChangesForVersions } from '../infra/db/index.js';
import { apis, specVersions } from '../infra/db/schema.js';
import {
  runOasdiff,
  type OasdiffError,
  type OasdiffRunner,
  type OasdiffRunnerOptions,
} from '../infra/oasdiff/runner.js';

/** A version pair that cannot be compared (missing, foreign to the API, or identical). */
export interface DetectInputError {
  code: 'version_not_found' | 'same_version';
  message: string;
}

/** Every way detection can fail; each is typed, none is a crash. */
export type DetectError = DetectInputError | OasdiffError | DetectParseError;

/** Injectable collaborators (tests swap the runner). */
export interface DetectDeps {
  runner?: OasdiffRunner;
  runnerOptions?: OasdiffRunnerOptions;
}

/**
 * Stage 2 — Detect (FR-06, FR-08). Loads two stored spec versions of one API, runs oasdiff on
 * their normalized documents, and parses the changelog into {@link SpecDifference}s with
 * pointers and before/after evidence.
 *
 * Pure with respect to the database: nothing is written. Detection does not classify; rows in
 * `changes` are written only after classification, via {@link persistClassifiedChanges}.
 * @param db - Database handle.
 * @param apiId - API that owns both versions.
 * @param fromVersionId - BEFORE version.
 * @param toVersionId - AFTER version.
 * @param deps - Optional runner override.
 */
export async function detectChanges(
  db: Db,
  apiId: string,
  fromVersionId: string,
  toVersionId: string,
  deps: DetectDeps = {},
): Promise<Result<SpecDifference[], DetectError>> {
  if (fromVersionId === toVersionId)
    return err({ code: 'same_version', message: 'Cannot compare a spec version with itself' });
  const rows = await db
    .select({ id: specVersions.id, apiId: specVersions.apiId, normalized: specVersions.normalized })
    .from(specVersions)
    .where(eq(specVersions.apiId, apiId));
  const from = rows.find((r) => r.id === fromVersionId);
  const to = rows.find((r) => r.id === toVersionId);
  if (!from || !to)
    return err({
      code: 'version_not_found',
      message: 'Both spec versions must exist and belong to this API',
    });
  const raw = await (deps.runner ?? runOasdiff)(from.normalized, to.normalized, deps.runnerOptions);
  if (!raw.ok) return raw;
  return parseOasdiffChangelog(raw.value, { before: from.normalized, after: to.normalized });
}

/** One difference after Classify (Increment 06) has judged it. */
export interface ClassifiedDifference {
  difference: SpecDifference;
  category: ChangeCategory;
  classification: Classification;
  /** 0–1 (FR-07; also enforced by a DB check). */
  confidence: number;
  /** Set only when a migration note or a human confirmed the mapping (FR-10, BR-04). */
  confirmation?: {
    source: MappingSource;
    mapping: unknown;
    migrationNoteId?: string | null;
    confirmedBy?: string | null;
    confirmedAt?: Date | null;
  };
}

/**
 * Writes classified differences as `changes` rows for one version pair, with their path,
 * method, pointer and before/after evidence (FR-06, FR-08). Idempotent per pair: when rows
 * already exist for (from, to), they are returned and nothing is inserted (changes are
 * append-only, FR-39). Serialized per API with a row lock.
 * @param db - Database handle.
 * @param apiId - API that owns both versions.
 * @param fromVersionId - BEFORE version.
 * @param toVersionId - AFTER version.
 * @param items - Output of classification.
 * @returns The stored rows for the pair.
 */
export async function persistClassifiedChanges(
  db: Db,
  apiId: string,
  fromVersionId: string,
  toVersionId: string,
  items: readonly ClassifiedDifference[],
): Promise<Change[]> {
  return db.transaction(async (tx) => {
    const locked = await tx
      .select({ id: apis.id })
      .from(apis)
      .where(eq(apis.id, apiId))
      .for('update');
    if (!locked[0]) throw new Error('API not found');
    const owned = await tx
      .select({ id: specVersions.id })
      .from(specVersions)
      .where(eq(specVersions.apiId, apiId));
    const ids = new Set(owned.map((r) => r.id));
    if (!ids.has(fromVersionId) || !ids.has(toVersionId))
      throw new Error('Both spec versions must belong to this API');
    const existing = await listChangesForVersions(tx, fromVersionId, toVersionId);
    if (existing.length > 0) return existing;
    const stored: Change[] = [];
    for (const item of items) {
      const d = item.difference;
      const c = item.confirmation;
      stored.push(
        await insertChange(tx, {
          apiId,
          fromVersionId,
          toVersionId,
          category: item.category,
          oasdiffRuleId: d.ruleId,
          classification: item.classification,
          confidence: item.confidence,
          path: d.path,
          method: d.method,
          jsonPointer: d.jsonPointer,
          evidenceBefore: d.evidenceBefore,
          evidenceAfter: d.evidenceAfter,
          mappingStatus: c ? 'confirmed' : 'unconfirmed',
          mappingSource: c?.source ?? null,
          mapping: c?.mapping ?? null,
          migrationNoteId: c?.migrationNoteId ?? null,
          confirmedBy: c?.confirmedBy ?? null,
          confirmedAt: c?.confirmedAt ?? null,
        }),
      );
    }
    return stored;
  });
}
