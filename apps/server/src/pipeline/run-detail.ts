/**
 * Run records as the wire contract shows them (RunSchema, RunDetailSchema): every outcome as a
 * `{ value, label }` pair (FR-42), every timestamp as ISO-8601, and every string scrubbed of
 * credentials (NFR-04). The Run Detail endpoint and the JSON/HTML export use the same builder,
 * so the export always matches what is stored (FR-41).
 * @packageDocumentation
 */
import { asc, eq } from 'drizzle-orm';
import {
  ATTEMPT_OUTCOME_LABELS,
  CALL_PATTERN_LABELS,
  CHANGE_CATEGORY_LABELS,
  CLASSIFICATION_LABELS,
  GUARD_NAME_LABELS,
  MAPPING_SOURCE_LABELS,
  MAPPING_STATUS_LABELS,
  RUN_STATUS_LABELS,
  STAGE_LABELS,
  STAGE_RESULT_STATUS_LABELS,
  redactForDelivery,
  type ChangeResponse,
  type MigrationNoteResponse,
  type RunDetail,
  type RunResponse,
} from '@sma/core';
import {
  getChangeById,
  getRunById,
  listAttempts,
  listCallSites,
  listCoverageEntries,
  type Attempt,
  type CallSite,
  type Change,
  type CoverageEntry,
  type Db,
  type MigrationNote,
  type Run,
  type RunStageResult,
} from '../infra/db/index.js';
import { migrationNotes, runStageResults } from '../infra/db/schema.js';

type Detail = RunDetail;

const iso = (d: Date) => d.toISOString();
const isoOrNull = (d: Date | null) => (d ? d.toISOString() : null);

/** Env var names whose values are treated as secrets wherever they appear. */
const SECRET_NAME = /(TOKEN|SECRET|PASSWORD|PASSWD|API_KEY|PRIVATE_KEY|CREDENTIAL)/i;

/**
 * Secret values currently in the environment: every variable whose name looks like a secret,
 * the variables named by `extraNames` (repository `credential_ref`s), and the password inside
 * `DATABASE_URL`. Used to scrub stored text before it leaves the system (NFR-04).
 * @param env - Environment to read (default `process.env`).
 * @param extraNames - More variable names to treat as secrets.
 */
export function knownSecrets(
  env: Record<string, string | undefined> = process.env,
  extraNames: readonly string[] = [],
): string[] {
  const out = new Set<string>();
  for (const [name, value] of Object.entries(env))
    if (value && value.length >= 8 && (SECRET_NAME.test(name) || extraNames.includes(name)))
      out.add(value);
  for (const name of ['DATABASE_URL', 'TEST_DATABASE_URL']) {
    const url = env[name];
    if (!url) continue;
    try {
      const password = decodeURIComponent(new URL(url).password);
      if (password.length >= 4) out.add(password);
    } catch {
      // Not a URL: nothing to extract.
    }
  }
  return [...out];
}

/**
 * Removes credentials from text (exact known values, token shapes, auth headers, URL
 * credentials).
 * @param text - Text to clean.
 * @param secrets - Exact values to remove.
 */
export function scrubText(text: string, secrets: readonly string[]): string {
  return redactForDelivery(text, secrets);
}

/**
 * A copy of plain JSON data with every string, keys included, scrubbed.
 * @param value - JSON-safe data.
 * @param secrets - Exact values to remove.
 */
export function scrubDeep<T>(value: T, secrets: readonly string[]): T {
  const walk = (v: unknown): unknown => {
    if (typeof v === 'string') return scrubText(v, secrets);
    if (Array.isArray(v)) return v.map(walk);
    if (v && typeof v === 'object')
      return Object.fromEntries(
        Object.entries(v).map(([k, x]) => [scrubText(k, secrets), walk(x)]),
      );
    return v;
  };
  return walk(value) as T;
}

/** A run row on the wire, with text labels. */
export function serializeRun(run: Run): RunResponse {
  return {
    id: run.id,
    changeId: run.changeId,
    repositoryId: run.repositoryId,
    commitSha: run.commitSha,
    parentRunId: run.parentRunId,
    stageReached: { value: run.stageReached, label: STAGE_LABELS[run.stageReached] },
    status: { value: run.status, label: RUN_STATUS_LABELS[run.status] },
    failureStage: run.failureStage
      ? { value: run.failureStage, label: STAGE_LABELS[run.failureStage] }
      : null,
    failureDetail: run.failureDetail,
    flaggedReason: run.flaggedReason,
    attemptCount: run.attemptCount,
    tokensIn: run.tokensIn,
    tokensOut: run.tokensOut,
    costUsd: run.costUsd,
    modelId: run.modelId,
    isFixture: run.isFixture,
    prUrl: run.prUrl,
    startedAt: iso(run.startedAt),
    finishedAt: isoOrNull(run.finishedAt),
  };
}

/** A change row on the wire, with text labels. */
export function serializeChange(c: Change): ChangeResponse {
  return {
    id: c.id,
    apiId: c.apiId,
    fromVersionId: c.fromVersionId,
    toVersionId: c.toVersionId,
    category: { value: c.category, label: CHANGE_CATEGORY_LABELS[c.category] },
    oasdiffRuleId: c.oasdiffRuleId,
    classification: { value: c.classification, label: CLASSIFICATION_LABELS[c.classification] },
    confidence: c.confidence,
    path: c.path,
    method: c.method,
    jsonPointer: c.jsonPointer,
    evidenceBefore: c.evidenceBefore ?? null,
    evidenceAfter: c.evidenceAfter ?? null,
    mappingStatus: { value: c.mappingStatus, label: MAPPING_STATUS_LABELS[c.mappingStatus] },
    mappingSource: c.mappingSource
      ? { value: c.mappingSource, label: MAPPING_SOURCE_LABELS[c.mappingSource] }
      : null,
    mapping: c.mapping ?? null,
    migrationNoteId: c.migrationNoteId,
    confirmedBy: c.confirmedBy,
    confirmedAt: isoOrNull(c.confirmedAt),
    createdAt: iso(c.createdAt),
  };
}

function serializeNote(n: MigrationNote): MigrationNoteResponse {
  return {
    id: n.id,
    apiId: n.apiId,
    fromVersionId: n.fromVersionId,
    toVersionId: n.toVersionId,
    rawYaml: n.rawYaml,
    parsed: n.parsed,
    uploadedAt: iso(n.uploadedAt),
  };
}

function serializeStage(r: RunStageResult): Detail['stageResults'][number] {
  return {
    id: r.id,
    runId: r.runId,
    stage: { value: r.stage, label: STAGE_LABELS[r.stage] },
    status: { value: r.status, label: STAGE_RESULT_STATUS_LABELS[r.status] },
    result: r.result,
    startedAt: iso(r.startedAt),
    finishedAt: iso(r.finishedAt),
  };
}

function serializeCallSite(s: CallSite): Detail['callSites'][number] {
  return {
    id: s.id,
    runId: s.runId,
    filePath: s.filePath,
    line: s.line,
    column: s.column,
    pattern: { value: s.pattern, label: CALL_PATTERN_LABELS[s.pattern] },
    excerpt: s.excerpt,
  };
}

function serializeCoverage(e: CoverageEntry): Detail['coverage'][number] {
  return {
    id: e.id,
    runId: e.runId,
    filePath: e.filePath,
    inspected: e.inspected,
    skipReason: e.skipReason,
  };
}

function serializeAttempt(a: Attempt): Detail['attempts'][number] {
  return {
    id: a.id,
    runId: a.runId,
    attemptNumber: a.attemptNumber,
    patch: a.patch,
    validationOutput: a.validationOutput,
    compileErrors: a.compileErrors,
    testsPassed: a.testsPassed,
    testsTotal: a.testsTotal,
    outcome: { value: a.outcome, label: ATTEMPT_OUTCOME_LABELS[a.outcome] },
    guardName: a.guardName ? { value: a.guardName, label: GUARD_NAME_LABELS[a.guardName] } : null,
    tokensIn: a.tokensIn,
    tokensOut: a.tokensOut,
    costUsd: a.costUsd,
    modelId: a.modelId,
    durationMs: a.durationMs,
    createdAt: iso(a.createdAt),
  };
}

/**
 * A run's stage results in the order they were completed (each was written before the next
 * stage began, FR-38).
 * @param db - Database handle.
 * @param runId - Run id.
 */
export async function stageResultsInOrder(db: Db, runId: string): Promise<RunStageResult[]> {
  return db
    .select()
    .from(runStageResults)
    .where(eq(runStageResults.runId, runId))
    .orderBy(
      asc(runStageResults.finishedAt),
      asc(runStageResults.startedAt),
      asc(runStageResults.id),
    );
}

/**
 * Loads one run's complete record (FR-41, UI-03): the run, its change and evidence, the
 * migration note that confirmed the mapping, every stage result, call site, coverage entry and
 * attempt. Every string is scrubbed of `secrets`.
 * @param db - Database handle.
 * @param runId - Run id.
 * @param secrets - Exact secret values to remove (see {@link knownSecrets}).
 * @returns The detail, or `undefined` when the run does not exist.
 */
export async function loadRunDetail(
  db: Db,
  runId: string,
  secrets: readonly string[] = [],
): Promise<RunDetail | undefined> {
  const run = await getRunById(db, runId);
  if (!run) return undefined;
  const change = await getChangeById(db, run.changeId);
  if (!change) throw new Error('Run references a missing change');
  const note = change.migrationNoteId
    ? (
        await db.select().from(migrationNotes).where(eq(migrationNotes.id, change.migrationNoteId))
      )[0]
    : undefined;
  const detail: RunDetail = {
    run: serializeRun(run),
    change: serializeChange(change),
    migrationNote: note ? serializeNote(note) : null,
    stageResults: (await stageResultsInOrder(db, run.id)).map(serializeStage),
    callSites: (await listCallSites(db, run.id)).map(serializeCallSite),
    coverage: (await listCoverageEntries(db, run.id)).map(serializeCoverage),
    attempts: (await listAttempts(db, run.id)).map(serializeAttempt),
  };
  return scrubDeep(detail, secrets);
}
