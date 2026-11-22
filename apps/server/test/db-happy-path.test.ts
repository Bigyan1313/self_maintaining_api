/**
 * Proves the database ACCEPTS a full, valid record chain (DR-01, DR-02) and a reanalysis run
 * linked by parent_run_id (FR-39), using the repository functions.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { DbClient } from '../src/infra/db/client.js';
import {
  findMigrationNote,
  findRepository,
  findSpecVersionByHash,
  finishRun,
  getApiById,
  getApiByName,
  getChangeById,
  getRepositoryById,
  getRunById,
  getSpecVersionById,
  insertAttempt,
  insertCallSites,
  insertCoverageEntries,
  insertEvaluationResult,
  insertMigrationNote,
  insertRun,
  insertSpecCheck,
  insertStageResult,
  listAttempts,
  listCallSites,
  listChangesForVersions,
  listChildRuns,
  listCoverageEntries,
  listEvaluationResults,
  listRunsForChange,
  listSpecChecks,
  listSpecVersions,
  listStageResults,
  setBaselineVersion,
  updateRunProgress,
} from '../src/infra/db/index.js';
import {
  attemptValues,
  openTestDb,
  randomCommitSha,
  seedChain,
  uid,
  type Chain,
} from './db-helpers.js';

let client: DbClient;
let chain: Chain;

beforeAll(async () => {
  client = openTestDb();
  chain = await seedChain(client);
});
afterAll(async () => {
  await client.close();
});

describe('full happy-path chain', () => {
  it('stores repository → api → 2 spec versions → change → run → … → evaluation result', async () => {
    const { db } = client;
    const { repository, api, v1, v2, change, run } = chain;

    // configuration + spec history
    await setBaselineVersion(db, api.id, v1.id);
    expect((await getApiById(db, api.id))?.baselineVersionId).toBe(v1.id);
    expect((await getApiByName(db, api.name))?.id).toBe(api.id);
    expect(await getRepositoryById(db, repository.id)).toEqual(repository);
    expect((await findRepository(db, repository.owner, repository.name))?.id).toBe(repository.id);
    expect((await listSpecVersions(db, api.id)).map((v) => v.id)).toEqual([v1.id, v2.id]);
    expect((await findSpecVersionByHash(db, api.id, v2.contentSha256))?.id).toBe(v2.id);
    expect((await getSpecVersionById(db, v1.id))?.normalized).toEqual(v1.normalized);

    await insertSpecCheck(db, {
      apiId: api.id,
      outcome: 'baseline_established',
      specVersionId: v1.id,
      finishedAt: new Date(),
    });
    await insertSpecCheck(db, {
      apiId: api.id,
      outcome: 'failed',
      errorDetail: 'HTTP 503 from provider',
      failureStage: 'ingest',
      finishedAt: new Date(),
    });
    expect((await listSpecChecks(db, api.id)).map((c) => c.outcome).sort()).toEqual([
      'baseline_established',
      'failed',
    ]);

    const note = await insertMigrationNote(db, {
      apiId: api.id,
      fromVersionId: v1.id,
      toVersionId: v2.id,
      rawYaml: 'api: demo-shop\nmappings: []\n',
      parsed: { api: 'demo-shop', mappings: [] },
    });
    expect((await findMigrationNote(db, v1.id, v2.id))?.id).toBe(note.id);

    // change → run (DR-02 links)
    expect((await getChangeById(db, change.id))?.fromVersionId).toBe(v1.id);
    expect((await listChangesForVersions(db, v1.id, v2.id)).map((c) => c.id)).toContain(change.id);
    expect(run.changeId).toBe(change.id);
    expect(run.repositoryId).toBe(repository.id);
    expect(run.status).toBe('running');

    // 4 stage results
    const t0 = Date.now();
    const stages = ['ingest', 'detect', 'classify', 'locate'] as const;
    for (const [i, stage] of stages.entries()) {
      await insertStageResult(db, {
        runId: run.id,
        stage,
        status: 'ok',
        result: { stage },
        startedAt: new Date(t0 + i * 10),
        finishedAt: new Date(t0 + i * 10 + 5),
      });
    }
    expect((await listStageResults(db, run.id)).map((r) => r.stage)).toEqual([...stages]);

    // locate output
    await insertCallSites(db, [
      {
        runId: run.id,
        filePath: 'src/customers.ts',
        line: 14,
        column: 23,
        pattern: 'fetch',
        excerpt: 'fetch(`${apiBaseUrl()}/customers/${id}`)',
      },
    ]);
    await insertCoverageEntries(db, [
      { runId: run.id, filePath: 'src/customers.ts', inspected: true },
      {
        runId: run.id,
        filePath: 'src/unsupported/dynamicUrl.ts',
        inspected: false,
        skipReason: 'dynamic URL',
      },
    ]);
    expect(await listCallSites(db, run.id)).toHaveLength(1);
    expect((await listCoverageEntries(db, run.id)).map((c) => c.inspected)).toEqual([true, false]);

    // attempts 1–4 (last one passes; one earlier attempt is not cheating, so no guard)
    await updateRunProgress(db, run.id, { stageReached: 'repair', modelId: 'test-model' });
    for (const n of [1, 2, 3]) await insertAttempt(db, attemptValues(run.id, n));
    await insertAttempt(db, { ...attemptValues(run.id, 4), outcome: 'pass' });
    const stored = await listAttempts(db, run.id);
    expect(stored.map((a) => a.attemptNumber)).toEqual([1, 2, 3, 4]);
    expect(stored.every((a) => a.guardName === null)).toBe(true);

    const finished = await finishRun(db, run.id, {
      status: 'repaired',
      stageReached: 'deliver',
      attemptCount: 4,
      tokensIn: 4000,
      tokensOut: 800,
      costUsd: '0.016800',
      prUrl: 'https://github.com/acme/consumer/pull/1',
    });
    expect(finished.status).toBe('repaired');
    expect(finished.costUsd).toBe('0.016800');

    // evaluation result
    const label = `eval-${uid()}`;
    const result = await insertEvaluationResult(db, {
      evalLabel: label,
      scenarioId: 'S01-field-renamed',
      baseline: 'B3',
      outcome: 'repaired',
      attemptsUsed: 4,
      costUsd: '0.016800',
      durationMs: 42_000,
      modelMs: 12_000,
      containerMs: 25_000,
    });
    expect(result.reviewVerdict).toBe('not_reviewed');
    expect(result.excluded).toBe(false);
    expect(await listEvaluationResults(db, label)).toHaveLength(1);
  });

  it('accepts a cheating attempt that names its guard (DR-04)', async () => {
    const { run } = await seedChain(client);
    const attempt = await insertAttempt(client.db, {
      ...attemptValues(run.id, 1),
      outcome: 'cheating',
      guardName: 'test_file_changed',
    });
    expect(attempt.guardName).toBe('test_file_changed');
  });
});

describe('reanalysis', () => {
  it('creates a new run linked by parent_run_id and leaves the original untouched', async () => {
    const { db } = client;
    const { change, repository, run: seededRun } = await seedChain(client);
    const original = await insertRun(db, {
      changeId: change.id,
      repositoryId: repository.id,
      commitSha: randomCommitSha(),
      stageReached: 'locate',
    });
    const frozen = await finishRun(db, original.id, { status: 'needs_review' });

    const reanalysis = await insertRun(db, {
      changeId: change.id,
      repositoryId: repository.id,
      commitSha: randomCommitSha(),
      stageReached: 'ingest',
      parentRunId: original.id,
    });

    expect(reanalysis.parentRunId).toBe(original.id);
    expect((await listChildRuns(db, original.id)).map((r) => r.id)).toEqual([reanalysis.id]);
    expect((await listRunsForChange(db, change.id)).map((r) => r.id)).toEqual([
      seededRun.id,
      original.id,
      reanalysis.id,
    ]);
    expect(await getRunById(db, original.id)).toEqual(frozen);
  });
});
