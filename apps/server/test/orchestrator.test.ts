/**
 * Orchestrator (FR-38, FR-39, NFR-01, NFR-02, BR-06) on the real test database with the real
 * oasdiff binary, the scripted FakeLlmAdapter, a mocked validator (no Docker) and a mocked
 * GitHub API. The same happy path runs against the real Docker validator in
 * orchestrator.integration.test.ts.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import { RunDetailSchema, ok } from '@sma/core';
import {
  getApiById,
  getRunById,
  listAttempts,
  listChildRuns,
  listSpecChecks,
} from '../src/infra/db/index.js';
import { runs } from '../src/infra/db/schema.js';
import { runOasdiff } from '../src/infra/oasdiff/runner.js';
import {
  INTERRUPTED_REASON,
  Orchestrator,
  RunBusyError,
  RunInputError,
  SINGLE_SHOT_NOT_DELIVERED,
} from '../src/pipeline/orchestrator.js';
import { loadRunDetail, stageResultsInOrder } from '../src/pipeline/run-detail.js';
import { FakeLlmAdapter } from '../src/infra/llm/fake.js';
import { insertApi, insertRun, insertSpecCheck } from '../src/infra/db/index.js';
import { PG, expectDbRejects, openTestDb, randomCommitSha, uid } from './db-helpers.js';
import {
  NOTE_YAML,
  TOKEN,
  cleanupTemps,
  consumerRepo,
  demoApi,
  fakeValidator,
  gitRepo,
  makeOrchestrator,
  registerRepo,
  verdictOf,
  type DemoApi,
} from './orchestrator-helpers.js';
import { CORRECT_PATCH, WRONG_PATCH, patchAnswer, patchFixture, result } from './repair-helpers.js';

let client: ReturnType<typeof openTestDb>;
let demo: DemoApi;
let consumerPath: string;

beforeAll(async () => {
  client = openTestDb();
  const { orchestrator } = makeOrchestrator(client.db);
  demo = await demoApi(client.db, orchestrator);
  consumerPath = await consumerRepo();
});
afterAll(async () => {
  await client?.close();
  await cleanupTemps();
});

const stagesOf = async (runId: string) =>
  (await stageResultsInOrder(client.db, runId)).map((r) => `${r.stage}:${r.status}`);

describe('spec-check flow (UC-02)', () => {
  it('v1 establishes the baseline; v2 is detected, classified with the note, then the baseline advances', async () => {
    const { orchestrator } = makeOrchestrator(client.db);
    const api = await insertApi(client.db, { name: `flow-${uid()}` });
    const first = await orchestrator.checkSpec(api.id, { mode: 'fixture', version: 'v1' });
    expect(first.check.outcome.value).toBe('baseline_established');
    expect(first.pipeline).toEqual({ changeIds: [], baselineAdvanced: false, failure: null });

    const second = await orchestrator.checkSpec(
      api.id,
      { mode: 'fixture', version: 'v2' },
      { migrationNote: NOTE_YAML },
    );
    expect(second.check.outcome.value).toBe('changed');
    expect(second.pipeline.failure).toBeNull();
    expect(second.pipeline.baselineAdvanced).toBe(true);
    expect(second.pipeline.changeIds.length).toBeGreaterThanOrEqual(5);
    expect(second.baselineVersionId).toBe(second.check.specVersionId);
    expect((await getApiById(client.db, api.id))?.baselineVersionId).toBe(
      second.check.specVersionId,
    );
    expect(demo.rename).toMatchObject({
      classification: 'breaking',
      mappingStatus: 'confirmed',
      mappingSource: 'migration_note',
    });
    expect(demo.deleteOrder.mappingStatus).toBe('unconfirmed');

    // Same spec again: nothing new, the baseline stays on v2.
    const third = await orchestrator.checkSpec(api.id, { mode: 'fixture', version: 'v2' });
    expect(third.check.outcome.value).toBe('no_change');
    expect(third.pipeline.baselineAdvanced).toBe(false);
  });

  it('spec source down → failed check at ingest, baseline unchanged (FR-11)', async () => {
    const { orchestrator } = makeOrchestrator(client.db, [], {
      specSource: async () => ({ ok: false, error: { code: 'unreachable', message: 'HTTP 503' } }),
    });
    const api = await insertApi(client.db, {
      name: `down-${uid()}`,
      specSourceUrl: 'https://specs.example.test/openapi.yaml',
    });
    await orchestrator.checkSpec(api.id, { mode: 'fixture', version: 'v1' });
    const baseline = (await getApiById(client.db, api.id))!.baselineVersionId;
    const out = await orchestrator.checkSpec(api.id, { mode: 'retrieved' });
    expect(out.check.outcome.value).toBe('failed');
    expect(out.check.failureStage).toEqual({ value: 'ingest', label: 'Ingest' });
    expect(out.pipeline.failure?.stage.value).toBe('ingest');
    expect((await getApiById(client.db, api.id))!.baselineVersionId).toBe(baseline);
  });

  it('oasdiff missing → failed check at detect, baseline unchanged; a later check retries and succeeds', async () => {
    const broken = makeOrchestrator(client.db, [], {
      oasdiff: (a, b) => runOasdiff(a, b, { binary: '/nonexistent/oasdiff' }),
    }).orchestrator;
    const api = await insertApi(client.db, { name: `nodiff-${uid()}` });
    await broken.checkSpec(api.id, { mode: 'fixture', version: 'v1' });
    const baseline = (await getApiById(client.db, api.id))!.baselineVersionId;
    const out = await broken.checkSpec(api.id, { mode: 'fixture', version: 'v2' });
    expect(out.check.outcome.value).toBe('failed');
    expect(out.check.failureStage?.value).toBe('detect');
    expect(out.check.errorDetail).toMatch(/^Detect failed: binary_missing/);
    expect(out.pipeline).toMatchObject({ baselineAdvanced: false, changeIds: [] });
    expect((await getApiById(client.db, api.id))!.baselineVersionId).toBe(baseline);
    const checks = await listSpecChecks(client.db, api.id);
    expect(checks.map((c) => [c.outcome, c.failureStage])).toEqual(
      expect.arrayContaining([
        ['changed', null],
        ['failed', 'detect'],
      ]),
    );

    // FR-11 retry: the same spec again, with oasdiff available, is detected now.
    const { orchestrator } = makeOrchestrator(client.db);
    const retry = await orchestrator.checkSpec(api.id, { mode: 'fixture', version: 'v2' });
    expect(retry.check.outcome.value).toBe('no_change');
    expect(retry.pipeline.baselineAdvanced).toBe(true);
    expect(retry.pipeline.changeIds.length).toBeGreaterThanOrEqual(5);
  });

  it('invalid migration note → failed check at classify, baseline unchanged, no changes stored', async () => {
    const { orchestrator } = makeOrchestrator(client.db);
    const api = await insertApi(client.db, { name: `badnote-${uid()}` });
    await orchestrator.checkSpec(api.id, { mode: 'fixture', version: 'v1' });
    const baseline = (await getApiById(client.db, api.id))!.baselineVersionId;
    const out = await orchestrator.checkSpec(
      api.id,
      { mode: 'fixture', version: 'v2' },
      { migrationNote: NOTE_YAML.replace("from: '1.0.0'", "from: '9.9.9'") },
    );
    expect(out.check.failureStage?.value).toBe('classify');
    expect(out.pipeline.changeIds).toEqual([]);
    expect((await getApiById(client.db, api.id))!.baselineVersionId).toBe(baseline);
  });
});

describe('spec_checks.failure_stage constraints (migration 0002)', () => {
  it('rejects a failed check without a stage, a stage on a non-failed check, and a run stage', async () => {
    const api = await insertApi(client.db, { name: `constraint-${uid()}` });
    await expectDbRejects(
      insertSpecCheck(client.db, { apiId: api.id, outcome: 'failed', errorDetail: 'x' }),
      { code: PG.checkViolation, constraint: 'spec_checks_failed_iff_failure_stage' },
    );
    await expectDbRejects(
      insertSpecCheck(client.db, { apiId: api.id, outcome: 'no_change', failureStage: 'detect' }),
      { code: PG.checkViolation, constraint: 'spec_checks_failed_iff_failure_stage' },
    );
    await expectDbRejects(
      insertSpecCheck(client.db, {
        apiId: api.id,
        outcome: 'failed',
        errorDetail: 'x',
        failureStage: 'repair',
      }),
      { code: PG.checkViolation, constraint: 'spec_checks_failure_stage_in_check' },
    );
  });
});

describe('run flow (UC-03, UC-04)', () => {
  it('field_renamed → repaired → PR (mocked); every stage wrote a row, in order (FR-38)', async () => {
    const repo = await registerRepo(client.db, consumerPath);
    const { orchestrator, llm, github } = makeOrchestrator(client.db, [patchAnswer(CORRECT_PATCH)]);
    const { run, done } = await orchestrator.startRun({
      changeId: demo.rename.id,
      repositoryId: repo.id,
    });
    expect(run).toMatchObject({ status: 'running', isFixture: true, parentRunId: null });
    const final = await done;
    expect(final).toMatchObject({ status: 'repaired', stageReached: 'deliver', attemptCount: 1 });
    expect(final.prUrl).toBe(`https://github.com/acme/${repo.name}/pull/1`);
    expect(final.finishedAt).not.toBeNull();
    expect(llm.calls).toHaveLength(1);
    expect(await stagesOf(run.id)).toEqual(['locate:ok', 'validate:ok', 'repair:ok', 'deliver:ok']);
    const gh = github.of(repo)!;
    expect(gh.sequence()).toContain('POST /pulls');
    const pr = gh.calls.find((c) => c.path === '/pulls')!;
    expect(pr.body?.head).toBe(`sma/run-${run.id}-field_renamed`);
    expect(String(pr.body?.body)).toContain('Migration note');
    expect(String(pr.body?.body)).not.toContain(TOKEN);
    const detail = RunDetailSchema.parse(await loadRunDetail(client.db, run.id));
    expect(detail.callSites.map((s) => s.filePath)).toContain('src/customers.ts');
    expect(detail.migrationNote?.rawYaml).toBe(NOTE_YAML);
  });

  it('DELETE /orders/{id} (no confirmed mapping) → flagged, no model call, no GitHub call (BR-04, FR-36)', async () => {
    const repo = await registerRepo(client.db, consumerPath);
    const { orchestrator, llm, github } = makeOrchestrator(client.db, [patchAnswer(CORRECT_PATCH)]);
    const final = await (
      await orchestrator.startRun({ changeId: demo.deleteOrder.id, repositoryId: repo.id })
    ).done;
    expect(final.status).toBe('flagged');
    expect(final.flaggedReason).toMatch(/No confirmed mapping/);
    expect(final.prUrl).toBeNull();
    expect(llm.calls).toHaveLength(0);
    expect(github.of(repo)).toBeUndefined();
    expect(await stagesOf(final.id)).toEqual(['locate:ok', 'repair:skipped', 'deliver:skipped']);
  });

  it('a clean repository with no call sites → not_affected', async () => {
    const path = await gitRepo({ 'src/index.ts': 'export const answer = 42;\n' });
    const repo = await registerRepo(client.db, path);
    const { orchestrator, llm } = makeOrchestrator(client.db);
    const final = await (
      await orchestrator.startRun({ changeId: demo.rename.id, repositoryId: repo.id })
    ).done;
    expect(final.status).toBe('not_affected');
    expect(llm.calls).toHaveLength(0);
    expect(await stagesOf(final.id)).toEqual(['locate:ok']);
  });

  it('a dynamic URL → needs_review, not not_affected', async () => {
    const path = await gitRepo({
      'src/client.ts': 'export const go = (u: string) => fetch(u);\n',
    });
    const repo = await registerRepo(client.db, path);
    const { orchestrator } = makeOrchestrator(client.db);
    const final = await (
      await orchestrator.startRun({ changeId: demo.rename.id, repositoryId: repo.id })
    ).done;
    expect(final.status).toBe('needs_review');
    expect(final.flaggedReason).toBeTruthy();
  });

  it('cheating attempt → cheating_rejected, guard named, flagged finding, no PR', async () => {
    const repo = await registerRepo(client.db, consumerPath);
    const { orchestrator, github } = makeOrchestrator(
      client.db,
      [patchAnswer(patchFixture('delete-test.diff'))],
      {
        validator: fakeValidator([
          { outcome: 'cheating', guard: 'test_file_changed', evidence: ['x'], validated: false },
        ]),
      },
    );
    const final = await (
      await orchestrator.startRun({ changeId: demo.rename.id, repositoryId: repo.id })
    ).done;
    expect(final.status).toBe('cheating_rejected');
    expect((await listAttempts(client.db, final.id))[0]?.guardName).toBe('test_file_changed');
    expect(github.of(repo)).toBeUndefined();
  });

  it('single_shot (B2) → scored, never delivered', async () => {
    const repo = await registerRepo(client.db, consumerPath);
    const { orchestrator, github } = makeOrchestrator(client.db, [patchAnswer(CORRECT_PATCH)], {
      validator: {
        ...fakeValidator(),
        validate: vi.fn(async (input: { patch?: string }) =>
          ok({
            workDir: '/x',
            commit: 'c',
            result: input.patch ? result({ status: 'pass', testsPassed: 12 }) : result(),
            patchFiles: [],
            timings: { installMs: 0, validateMs: 0 },
          }),
        ),
      },
    });
    const final = await (
      await orchestrator.startRun({
        changeId: demo.rename.id,
        repositoryId: repo.id,
        mode: 'single_shot',
      })
    ).done;
    expect(final).toMatchObject({ status: 'repaired', flaggedReason: SINGLE_SHOT_NOT_DELIVERED });
    expect(final.prUrl).toBeNull();
    expect(github.of(repo)).toBeUndefined();
  });
});

describe('failure injection: each failure names its stage, never a success (NFR-02)', () => {
  it('model timeout → stage_failure at repair', async () => {
    const repo = await registerRepo(client.db, consumerPath);
    const { orchestrator, github } = makeOrchestrator(client.db, [
      { kind: 'error', errorKind: 'timeout', message: 'no answer in 120 s', durationMs: 120_000 },
    ]);
    const final = await (
      await orchestrator.startRun({ changeId: demo.rename.id, repositoryId: repo.id })
    ).done;
    expect(final).toMatchObject({ status: 'stage_failure', failureStage: 'repair', prUrl: null });
    expect(final.failureDetail).toMatch(/timeout/);
    expect((await listAttempts(client.db, final.id))[0]?.outcome).toBe('timeout');
    expect(github.of(repo)).toBeUndefined();
  });

  it('Docker down (real validator) → stage_failure at validate, no model call', async () => {
    const repo = await registerRepo(client.db, consumerPath);
    const llm = new FakeLlmAdapter([patchAnswer(CORRECT_PATCH)]);
    const orchestrator = new Orchestrator(
      { db: client.db, llm },
      {
        tokenCeiling: 100_000,
        docker: { env: { DOCKER_HOST: 'unix:///nonexistent/sma-docker.sock' } },
      },
    );
    const final = await (
      await orchestrator.startRun({ changeId: demo.rename.id, repositoryId: repo.id })
    ).done;
    expect(final).toMatchObject({ status: 'stage_failure', failureStage: 'validate' });
    expect(llm.calls).toHaveLength(0);
    expect(await stagesOf(final.id)).toEqual(['locate:ok', 'validate:failed', 'repair:failed']);
  }, 60_000);

  it('GitHub 500 → stage_failure at deliver, patch kept; retry delivers in a child run (FR-37)', async () => {
    const repo = await registerRepo(client.db, consumerPath);
    const { orchestrator, github } = makeOrchestrator(client.db, [patchAnswer(CORRECT_PATCH)]);
    // The first delivery hits a scripted 500 on PR creation.
    const original = github.deps.createClient!;
    let first = true;
    github.deps.createClient = (o) => {
      const c = original(o);
      if (first) {
        first = false;
        github.of(repo)!.fail({ method: 'POST', path: /^\/pulls$/, status: 500 });
      }
      return c;
    };
    const failed = await (
      await orchestrator.startRun({ changeId: demo.rename.id, repositoryId: repo.id })
    ).done;
    expect(failed).toMatchObject({ status: 'stage_failure', failureStage: 'deliver', prUrl: null });
    expect(failed.failureDetail).toMatch(/validated patch is kept/);
    expect((await listAttempts(client.db, failed.id)).at(-1)).toMatchObject({
      outcome: 'pass',
      patch: CORRECT_PATCH,
    });
    expect(failed.failureDetail).not.toContain(TOKEN);

    const child = await orchestrator.retryDelivery(failed.id);
    expect(child).toMatchObject({ status: 'repaired', parentRunId: failed.id });
    expect(child.prUrl).toMatch(/\/pull\/1$/);
    expect((await getRunById(client.db, failed.id))?.status).toBe('stage_failure');
    await expect(orchestrator.retryDelivery(child.id)).rejects.toBeInstanceOf(RunInputError);
  });

  it('token ceiling → aborted (not failed), no model call, flagged finding', async () => {
    const repo = await registerRepo(client.db, consumerPath);
    const { orchestrator, llm } = makeOrchestrator(
      client.db,
      [patchAnswer(CORRECT_PATCH)],
      {},
      { tokenCeiling: 1000 },
    );
    const final = await (
      await orchestrator.startRun({ changeId: demo.rename.id, repositoryId: repo.id })
    ).done;
    expect(final.status).toBe('aborted');
    expect(final.flaggedReason).toMatch(/Token ceiling/);
    expect(llm.calls).toHaveLength(0);
  });

  it('four failed attempts → failed, flagged for a human', async () => {
    const repo = await registerRepo(client.db, consumerPath);
    const fail = () => verdictOf(result());
    const { orchestrator, llm } = makeOrchestrator(
      client.db,
      Array.from({ length: 5 }, () => patchAnswer(WRONG_PATCH)),
      { validator: fakeValidator([fail(), fail(), fail(), fail()]) },
    );
    const final = await (
      await orchestrator.startRun({ changeId: demo.rename.id, repositoryId: repo.id })
    ).done;
    expect(final).toMatchObject({ status: 'failed', attemptCount: 4 });
    expect(llm.calls).toHaveLength(4);
  });

  it('a dirty (unreadable) repository → stage_failure at locate', async () => {
    const path = await gitRepo({ 'src/a.ts': 'export {};\n' });
    const { writeFile } = await import('node:fs/promises');
    await writeFile(`${path}/src/uncommitted.ts`, 'export const x = 1;\n');
    const repo = await registerRepo(client.db, path);
    const { orchestrator } = makeOrchestrator(client.db);
    const final = await (
      await orchestrator.startRun({ changeId: demo.rename.id, repositoryId: repo.id })
    ).done;
    expect(final).toMatchObject({ status: 'stage_failure', failureStage: 'locate' });
    expect(await stagesOf(final.id)).toEqual(['locate:failed']);
  });

  it('an unexpected throw is a stage failure with a scrubbed detail (NFR-04)', async () => {
    const repo = await registerRepo(client.db, consumerPath);
    const { orchestrator } = makeOrchestrator(client.db, [patchAnswer(CORRECT_PATCH)], {
      validator: {
        ...fakeValidator(),
        guardedValidate: vi.fn(async () => {
          throw new Error(`boom with ${TOKEN} and ${'ghp' + '_abcdefghijklmnop1234'}`);
        }),
      },
    });
    const final = await (
      await orchestrator.startRun({ changeId: demo.rename.id, repositoryId: repo.id })
    ).done;
    expect(final).toMatchObject({ status: 'stage_failure', failureStage: 'repair' });
    expect(final.failureDetail).toContain('[REDACTED]');
    expect(final.failureDetail).not.toContain(TOKEN);
    expect(final.failureDetail).not.toContain('ghp' + '_abcdefghijklmnop1234');
  });

  it('an unknown change, an unknown repository or a non-git path → refused before any run exists', async () => {
    const repo = await registerRepo(client.db, consumerPath);
    const { orchestrator } = makeOrchestrator(client.db);
    const missing = '00000000-0000-4000-8000-000000000000';
    await expect(
      orchestrator.startRun({ changeId: missing, repositoryId: repo.id }),
    ).rejects.toMatchObject({ statusCode: 404, field: 'changeId' });
    await expect(
      orchestrator.startRun({ changeId: demo.rename.id, repositoryId: missing }),
    ).rejects.toMatchObject({ statusCode: 404, field: 'repositoryId' });
    const notGit = await registerRepo(client.db, '/nonexistent/sma-repo');
    await expect(
      orchestrator.startRun({ changeId: demo.rename.id, repositoryId: notGit.id }),
    ).rejects.toMatchObject({ statusCode: 422 });
    expect(orchestrator.isBusy).toBe(false);
  });
});

describe('append-only runs, reanalysis, one run at a time', () => {
  it('reanalysis → a new run with parent_run_id; the old run is unchanged and the DB rejects an UPDATE (FR-39)', async () => {
    const repo = await registerRepo(client.db, consumerPath);
    const { orchestrator } = makeOrchestrator(client.db, [
      patchAnswer(CORRECT_PATCH),
      patchAnswer(CORRECT_PATCH),
    ]);
    const first = await (
      await orchestrator.startRun({ changeId: demo.rename.id, repositoryId: repo.id })
    ).done;
    const before = await loadRunDetail(client.db, first.id);
    const second = await (await orchestrator.reanalyze(first.id)).done;
    expect(second.id).not.toBe(first.id);
    expect(second).toMatchObject({
      parentRunId: first.id,
      changeId: first.changeId,
      repositoryId: first.repositoryId,
      commitSha: first.commitSha,
      status: 'repaired',
    });
    expect(await loadRunDetail(client.db, first.id)).toEqual(before);
    expect((await listChildRuns(client.db, first.id)).map((r) => r.id)).toEqual([second.id]);
    await expectDbRejects(
      client.db.update(runs).set({ status: 'failed' }).where(eq(runs.id, first.id)),
      { code: PG.raiseException, message: /append-only/ },
    );
  });

  it('a second run while one is in flight → RunBusyError; the lock is released afterwards', async () => {
    const repo = await registerRepo(client.db, consumerPath);
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const validator = fakeValidator();
    const slow = vi.fn(async () => {
      await gate;
      return validator.validate();
    });
    const { orchestrator } = makeOrchestrator(client.db, [patchAnswer(CORRECT_PATCH)], {
      validator: { ...validator, validate: slow },
    });
    const handle = await orchestrator.startRun({
      changeId: demo.rename.id,
      repositoryId: repo.id,
    });
    expect(orchestrator.isBusy).toBe(true);
    await expect(
      orchestrator.startRun({ changeId: demo.rename.id, repositoryId: repo.id }),
    ).rejects.toBeInstanceOf(RunBusyError);
    await expect(orchestrator.reanalyze(handle.run.id)).rejects.toMatchObject({ statusCode: 409 });
    release();
    expect((await handle.done).status).toBe('repaired');
    expect(orchestrator.isBusy).toBe(false);
  });

  it('a run left running by a stopped server is recorded as a stage failure at startup', async () => {
    const repo = await registerRepo(client.db, consumerPath);
    const stale = await insertRun(client.db, {
      changeId: demo.rename.id,
      repositoryId: repo.id,
      commitSha: randomCommitSha(),
      stageReached: 'repair',
      isFixture: true,
    });
    const { orchestrator } = makeOrchestrator(client.db);
    expect(await orchestrator.recoverInterruptedRuns({ repositoryId: repo.id })).toEqual([
      stale.id,
    ]);
    const after = await getRunById(client.db, stale.id);
    expect(after).toMatchObject({ status: 'stage_failure', failureStage: 'repair' });
    expect(after?.failureDetail).toContain(INTERRUPTED_REASON);
    expect(await stagesOf(stale.id)).toEqual(['repair:failed']);
  });
});

describe('NFR-01 and DR-01', () => {
  it('the same demo scenario three times in a row: no unhandled error, full evidence each time', async () => {
    const repo = await registerRepo(client.db, consumerPath);
    const { orchestrator } = makeOrchestrator(
      client.db,
      Array.from({ length: 3 }, () => patchAnswer(CORRECT_PATCH)),
    );
    const ids: string[] = [];
    for (let i = 0; i < 3; i++) {
      const final = await (
        await orchestrator.startRun({ changeId: demo.rename.id, repositoryId: repo.id })
      ).done;
      expect(final.status).toBe('repaired');
      ids.push(final.id);
    }
    for (const id of ids) {
      const detail = RunDetailSchema.parse(await loadRunDetail(client.db, id));
      expect(detail.stageResults.map((s) => s.stage.value)).toEqual([
        'locate',
        'validate',
        'repair',
        'deliver',
      ]);
      expect(detail.callSites.length).toBeGreaterThan(0);
      expect(detail.coverage.length).toBeGreaterThan(0);
      expect(detail.attempts).toHaveLength(1);
      expect(detail.run.prUrl).toMatch(/\/pull\/\d+$/);
    }
    expect(new Set(ids).size).toBe(3);
  });

  it('run records survive a server restart (new pool, new orchestrator)', async () => {
    const repo = await registerRepo(client.db, consumerPath);
    const { orchestrator } = makeOrchestrator(client.db, [patchAnswer(CORRECT_PATCH)]);
    const final = await (
      await orchestrator.startRun({ changeId: demo.rename.id, repositoryId: repo.id })
    ).done;
    const before = await loadRunDetail(client.db, final.id);
    const fresh = openTestDb();
    try {
      expect(await loadRunDetail(fresh.db, final.id)).toEqual(before);
    } finally {
      await fresh.close();
    }
  });
});
