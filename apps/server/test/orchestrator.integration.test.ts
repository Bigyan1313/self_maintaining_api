/**
 * End to end (AT-08): demo spec v1 → v2 with the migration note → changes classified →
 * baseline advanced → a run on the `field_renamed` change → repaired → PR (mocked GitHub).
 * Real database, real oasdiff, the REAL Docker validator and guards, the scripted FakeLlm.
 *
 * The repository is a committed copy of the rename-only consumer (v1 fixtures plus the v2
 * customer responses), because on the full five-change v2 no single correct rename can make
 * the whole suite pass (docs/decisions/inc11.md). Skipped locally without Docker; required in
 * CI.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { RunDetailSchema } from '@sma/core';
import { getApiById } from '../src/infra/db/index.js';
import { FakeLlmAdapter } from '../src/infra/llm/fake.js';
import { dockerServerVersion } from '../src/infra/validator/docker.js';
import { exportRunJson } from '../src/pipeline/export.js';
import { Orchestrator } from '../src/pipeline/orchestrator.js';
import { loadRunDetail, stageResultsInOrder } from '../src/pipeline/run-detail.js';
import { openTestDb } from './db-helpers.js';
import {
  TOKEN,
  cleanupTemps,
  demoApi,
  fakeGitHubPort,
  registerRepo,
  renameOnlyRepo,
} from './orchestrator-helpers.js';
import { CORRECT_PATCH, WRONG_PATCH, patchAnswer } from './repair-helpers.js';

const dockerVersion = await dockerServerVersion();
if (!dockerVersion)
  console.warn('[orchestrator] SKIPPING Docker end-to-end tests: Docker is not running.');
if (process.env.CI && !dockerVersion) throw new Error('Docker must be available in CI');

const TIMEOUT = 1_200_000;

describe.skipIf(!dockerVersion)('orchestrator end to end with the real Docker validator', () => {
  let client: ReturnType<typeof openTestDb>;
  beforeAll(() => {
    client = openTestDb();
  });
  afterAll(async () => {
    await client?.close();
    await cleanupTemps();
  });

  it(
    'v1 → v2 → classified → baseline advanced → field_renamed run → repaired → PR; export matches the DB',
    { timeout: TIMEOUT },
    async () => {
      // Wrong first, then correct: proves the loop's feedback and the real guards in the flow.
      const llm = new FakeLlmAdapter([patchAnswer(WRONG_PATCH), patchAnswer(CORRECT_PATCH)]);
      const github = fakeGitHubPort();
      const orchestrator = new Orchestrator(
        { db: client.db, llm, github: github.deps },
        { tokenCeiling: 100_000, sandboxEnv: { API_VERSION: 'v2' }, env: { GITHUB_TOKEN: TOKEN } },
      );
      const demo = await demoApi(client.db, orchestrator);
      expect((await getApiById(client.db, demo.apiId))?.baselineVersionId).toBe(demo.v2);
      expect(demo.rename).toMatchObject({ classification: 'breaking', mappingStatus: 'confirmed' });

      const repo = await registerRepo(client.db, await renameOnlyRepo());
      const { run, done } = await orchestrator.startRun({
        changeId: demo.rename.id,
        repositoryId: repo.id,
      });
      const final = await done;
      expect(final, final.failureDetail ?? final.flaggedReason ?? '').toMatchObject({
        status: 'repaired',
        stageReached: 'deliver',
        attemptCount: 2,
        isFixture: true,
      });
      expect(final.prUrl).toBe(`https://github.com/acme/${repo.name}/pull/1`);
      expect(llm.calls).toHaveLength(2);

      // FR-38: every stage wrote its row, in order, each finished before the next finished.
      const rows = await stageResultsInOrder(client.db, run.id);
      expect(rows.map((r) => `${r.stage}:${r.status}`)).toEqual([
        'locate:ok',
        'validate:ok',
        'repair:ok',
        'deliver:ok',
      ]);
      for (let i = 1; i < rows.length; i++)
        expect(rows[i]!.finishedAt.getTime()).toBeGreaterThanOrEqual(
          rows[i - 1]!.finishedAt.getTime(),
        );

      const detail = RunDetailSchema.parse(await loadRunDetail(client.db, run.id));
      expect(detail.attempts.map((a) => [a.outcome.value, a.testsPassed, a.testsTotal])).toEqual([
        ['fail', 10, 12],
        ['pass', 12, 12],
      ]);
      const pr = github.of(repo)!.calls.find((c) => c.method === 'POST' && c.path === '/pulls');
      expect(String(pr?.body?.body)).toContain('12');
      expect(JSON.parse(exportRunJson(detail))).toEqual(detail);
    },
  );

  it(
    'NFR-01: the same scenario three times in a row, each repaired with full evidence',
    { timeout: TIMEOUT },
    async () => {
      const llm = new FakeLlmAdapter(Array.from({ length: 3 }, () => patchAnswer(CORRECT_PATCH)));
      const github = fakeGitHubPort();
      const orchestrator = new Orchestrator(
        { db: client.db, llm, github: github.deps },
        { tokenCeiling: 100_000, sandboxEnv: { API_VERSION: 'v2' }, env: { GITHUB_TOKEN: TOKEN } },
      );
      const demo = await demoApi(client.db, orchestrator);
      const repo = await registerRepo(client.db, await renameOnlyRepo());
      const prs = new Set<string>();
      for (let i = 0; i < 3; i++) {
        const final = await (
          await orchestrator.startRun({ changeId: demo.rename.id, repositoryId: repo.id })
        ).done;
        expect(final.status, final.failureDetail ?? '').toBe('repaired');
        const detail = RunDetailSchema.parse(await loadRunDetail(client.db, final.id));
        expect(detail.stageResults.map((s) => s.stage.value)).toEqual([
          'locate',
          'validate',
          'repair',
          'deliver',
        ]);
        expect(detail.attempts[0]).toMatchObject({ testsPassed: 12, testsTotal: 12 });
        expect(detail.attempts[0]?.validationOutput).toBeTruthy();
        prs.add(final.prUrl!);
      }
      expect(prs.size).toBe(3);
    },
  );
});
