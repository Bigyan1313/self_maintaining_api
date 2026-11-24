import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { ResultsSchema, type EvaluationStudy } from '@sma/core';
import { buildApp } from '../src/app.js';
import { saveEvaluationStudy, loadEvaluationStudy } from '../src/infra/db/evaluationStudyRepo.js';
import { listEvaluationResults } from '../src/infra/db/evaluationResultsRepo.js';
import { openTestDb } from './db-helpers.js';
let client: ReturnType<typeof openTestDb>;
beforeAll(() => {
  client = openTestDb();
});
afterAll(async () => {
  await client.close();
});
function sample(): EvaluationStudy {
  const now = new Date().toISOString();
  return {
    schemaVersion: 1,
    label: randomUUID(),
    startedAt: now,
    updatedAt: now,
    status: 'partial',
    stopReason: 'testing',
    fake: true,
    config: { baselines: ['B2'], scenarioIds: ['x', 'excluded'], repeat: 3, maxCost: 5 },
    environment: {
      gitCommit: 'sha',
      modelId: 'fake',
      image: 'digest',
      oasdiff: '1.35.0',
      node: '22',
      platform: 'linux',
      arch: 'x64',
      cpuCores: 2,
      ramBytes: 100,
      pricing: { input: 0, output: 0 },
      maxOutputTokens: 16000,
      effort: 'high',
    },
    manifest: [],
    admissions: [
      {
        id: 'excluded',
        admissible: false,
        reason: 'modified after freezing',
        beforePassed: 0,
        beforeTotal: 0,
        afterPassed: 0,
        afterTotal: 0,
      },
    ],
    trials: [
      {
        id: randomUUID(),
        scenarioId: 'x',
        baseline: 'B2',
        repeat: 1,
        category: 'field_renamed',
        expected: 'repair',
        outcome: 'repaired',
        reason: 'passed validation',
        attemptsUsed: 1,
        tokensIn: 10,
        tokensOut: 2,
        costUsd: 0.1,
        durationMs: 100,
        modelMs: 10,
        containerMs: 80,
        guard: null,
        patch: 'diff',
        migrationNote: 'note',
        runId: null,
        detection: null,
        detected: [],
        labels: [],
        review: null,
        completed: true,
        createdAt: now,
        stopReasons: ['end_turn'],
        calls: [],
      },
    ],
    inFlight: null,
    spentUsd: 0.1,
    reservedUsd: 0,
    modelCalls: { total: 1, maxTokensStops: 0, stopReasons: { end_turn: 1 } },
  };
}
describe('evaluation persistence and HTTP', () => {
  it('roundtrips snapshot, repetitions, exclusions and updated reviews idempotently', async () => {
    const study = sample();
    study.trials.push({ ...study.trials[0]!, id: randomUUID(), repeat: 2 });
    await saveEvaluationStudy(client.db, study);
    await saveEvaluationStudy(client.db, study);
    expect(await loadEvaluationStudy(client.db, study.label)).toEqual(study);
    expect(await listEvaluationResults(client.db, study.label)).toHaveLength(3);
    study.trials[0]!.review = {
      verdict: 'incorrect',
      name: 'R',
      note: 'wrong meaning',
      at: study.startedAt,
    };
    study.status = 'complete';
    await saveEvaluationStudy(client.db, study);
    const rows = await listEvaluationResults(client.db, study.label);
    expect(rows.find((r) => r.scenarioId === 'x' && r.repeat === 1)?.reviewVerdict).toBe(
      'incorrect',
    );
    expect(rows.every((r) => r.isPartial)).toBe(true); // Completed selected subset remains partial study evidence.
  });
  it('returns label-specific metrics from exactly the stored snapshot and explicit failures', async () => {
    const study = sample();
    await saveEvaluationStudy(client.db, study);
    const app = buildApp({}, { db: client.db });
    try {
      const response = await app.inject(`/api/results?label=${study.label}`);
      expect(response.statusCode).toBe(200);
      const body = ResultsSchema.parse(response.json());
      expect(body.label).toBe(study.label);
      expect(body.results).toHaveLength(2);
      expect(body.summaries?.[0]?.falseConfidence).toBeNull();
      expect(body.failures?.[0]?.reason).toContain('not yet reviewed');
      expect(response.json().study).toEqual(study);
      expect((await app.inject('/api/results?label[]=x')).statusCode).toBe(200);
      const missing = await app.inject('/api/results?label=missing-evaluation-label');
      expect(missing.json().label).toBeNull();
    } finally {
      await app.close();
    }
  });
  it('without a label returns the latest NON-fake study; a fake study only by its label (SRS 6.6)', async () => {
    const real = { ...sample(), fake: false, updatedAt: '2099-06-01T00:00:00.000Z' };
    const fake = { ...sample(), fake: true, updatedAt: '2099-12-31T00:00:00.000Z' };
    await saveEvaluationStudy(client.db, real);
    await saveEvaluationStudy(client.db, fake);
    expect((await loadEvaluationStudy(client.db))?.label).toBe(real.label);
    const app = buildApp({}, { db: client.db });
    try {
      const latest = ResultsSchema.parse((await app.inject('/api/results')).json());
      expect(latest).toMatchObject({ label: real.label, fake: false });
      const named = ResultsSchema.parse(
        (await app.inject(`/api/results?label=${fake.label}`)).json(),
      );
      expect(named).toMatchObject({ label: fake.label, fake: true });
    } finally {
      await app.close();
    }
  });
  it('selects latest by persisted update time and rejects invalid snapshots before writes', async () => {
    const study = { ...sample(), fake: false };
    study.updatedAt = '2100-01-01T00:00:00.000Z';
    await saveEvaluationStudy(client.db, study);
    expect((await loadEvaluationStudy(client.db, study.label))?.label).toBe(study.label);
    await expect(saveEvaluationStudy(client.db, { ...study, spentUsd: -1 })).rejects.toThrow();
  });
});
