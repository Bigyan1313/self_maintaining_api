import { and, eq, sql } from 'drizzle-orm';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import {
  decideCheckOutcome,
  hashSpec,
  normalizeSpec,
  parseSpec,
  SPEC_CHECK_OUTCOME_LABELS,
  SOURCE_MODE_LABELS,
  type IngestResponse,
  type SourceMode,
  type SpecError,
  type Result,
  ok,
  err,
} from '@sma/core';
import {
  type Db,
  getApiById,
  insertSpecVersion,
  findSpecVersionByHash,
  getSpecVersionById,
  setBaselineVersion,
} from '../infra/db/index.js';
import { apis, specVersions, specChecks } from '../infra/db/schema.js';
import { retrieveSpec, type SpecRetriever } from '../infra/spec-source/retrieve.js';
import { containsCredential, redact } from '../infra/spec-source/security.js';

/** Input modes: fixture files are selected by version, never by arbitrary client paths. */
export type IngestSource =
  | { mode: 'uploaded'; text: string; filename?: string }
  | { mode: 'retrieved' }
  | { mode: 'fixture'; version: 'v1' | 'v2' }
  | { mode: 'failed'; error: SpecError };
/** A missing API is a configuration error, not a spec check. */
export class ApiNotFoundError extends Error {
  constructor() {
    super('API not found');
  }
}

/** Parse first, then serialize persistence per API using a row lock; failed checks preserve baseline. */
export async function ingest(
  db: Db,
  apiId: string,
  source: IngestSource,
  retrieve: SpecRetriever = retrieveSpec,
): Promise<IngestResponse> {
  const api = await getApiById(db, apiId);
  if (!api) throw new ApiNotFoundError();
  const started = (
    await db
      .select({ time: sql`clock_timestamp()`.mapWith((value: string) => new Date(value)) })
      .from(apis)
      .where(eq(apis.id, apiId))
  )[0];
  if (!started) throw new Error('Cannot record check start time');
  const mode: SourceMode = source.mode === 'failed' ? 'uploaded' : source.mode;
  let identifier = 'upload';
  let fetched: Result<string, SpecError>;
  if (source.mode === 'retrieved') {
    identifier = api.specSourceUrl ?? 'unconfigured source';
    try {
      fetched = api.specSourceUrl
        ? await retrieve(api.specSourceUrl)
        : err({ code: 'unreachable', message: 'API has no specification URL' });
    } catch {
      fetched = err({ code: 'unreachable', message: 'Cannot retrieve specification' });
    }
  } else if (source.mode === 'fixture') {
    identifier = `demo/api/specs/${source.version}.yaml`;
    try {
      fetched = ok(
        await readFile(
          fileURLToPath(new URL(`../../../../${identifier}`, import.meta.url)),
          'utf8',
        ),
      );
    } catch {
      fetched = err({ code: 'unreachable', message: 'Demo fixture is unavailable' });
    }
  } else if (source.mode === 'failed') {
    fetched = err(source.error);
  } else {
    identifier = source.filename ? `upload:${redact(source.filename).slice(0, 200)}` : 'upload';
    fetched = ok(source.text);
  }
  let parsed = !fetched.ok
    ? fetched
    : containsCredential(fetched.value)
      ? err({
          code: 'invalid_openapi' as const,
          message: 'Remove credential values from specification',
        })
      : await parseSpec(fetched.value);
  if (parsed.ok && containsCredential(normalizeSpec(parsed.value))) {
    parsed = err({
      code: 'invalid_openapi',
      message: 'Remove credential values from specification',
    });
  }
  return db.transaction(async (tx) => {
    const locked = (await tx.select().from(apis).where(eq(apis.id, apiId)).for('update'))[0];
    if (!locked) throw new ApiNotFoundError();
    let baselineVersionId = locked.baselineVersionId;
    let versionId: string | null = null;
    let outcome: 'baseline_established' | 'no_change' | 'changed' | 'failed' = 'failed';
    let errorDetail: string | null = null;
    if (!parsed.ok)
      errorDetail = redact(`${parsed.error.code}: ${parsed.error.message}`).slice(0, 4000);
    else {
      const canonical = normalizeSpec(parsed.value);
      const hash = hashSpec(canonical);
      const existing = await findSpecVersionByHash(tx, apiId, hash);
      const baseline = baselineVersionId
        ? await getSpecVersionById(tx, baselineVersionId)
        : undefined;
      outcome = decideCheckOutcome({
        baselineHash: baseline?.contentSha256 ?? null,
        newHash: hash,
        existingHashes: existing ? [hash] : [],
      });
      const version =
        existing ??
        (await insertSpecVersion(tx, {
          apiId,
          sourceMode: mode,
          sourceIdentifier: redact(identifier),
          contentSha256: hash,
          normalized: JSON.parse(canonical) as unknown,
        }));
      versionId = version.id;
      if (outcome === 'baseline_established') {
        await setBaselineVersion(tx, apiId, version.id);
        baselineVersionId = version.id;
      }
    }
    const check = (
      await tx
        .insert(specChecks)
        .values({
          apiId,
          outcome,
          specVersionId: versionId,
          errorDetail,
          startedAt: started.time,
          finishedAt: sql`clock_timestamp()`,
        })
        .returning()
    )[0];
    if (!check) throw new Error('Could not record specification check');
    return {
      check: {
        ...check,
        startedAt: check.startedAt.toISOString(),
        finishedAt: check.finishedAt?.toISOString() ?? null,
        outcome: { value: outcome, label: SPEC_CHECK_OUTCOME_LABELS[outcome] },
      },
      baselineVersionId,
      sourceMode: { value: mode, label: SOURCE_MODE_LABELS[mode] },
    };
  });
}

/** Explicit future-orchestrator operation; only a version owned by this API can be selected. */
export async function advanceBaseline(db: Db, apiId: string, versionId: string): Promise<void> {
  await db.transaction(async (tx) => {
    const api = (await tx.select().from(apis).where(eq(apis.id, apiId)).for('update'))[0];
    if (!api) throw new ApiNotFoundError();
    const version = (
      await tx
        .select()
        .from(specVersions)
        .where(and(eq(specVersions.id, versionId), eq(specVersions.apiId, apiId)))
    )[0];
    if (!version) throw new Error('Baseline version must belong to this API');
    await setBaselineVersion(tx, apiId, version.id);
  });
}
