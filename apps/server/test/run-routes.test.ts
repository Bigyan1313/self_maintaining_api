/**
 * Run endpoints (inc13 contract) through `app.inject()` on the real test database, with the
 * orchestrator's fakes (no Docker, mocked GitHub). Also checks that spec uploads run the full
 * spec-check flow when the app has an orchestrator.
 */
import { chmod, mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import {
  IngestResponseSchema,
  RunDetailSchema,
  RunSchema,
  RunsSchema,
  SavedExportSchema,
} from '@sma/core';
import { buildApp } from '../src/app.js';
import { getApiById, insertApi, listAttempts, listCallSites } from '../src/infra/db/index.js';
import { FIXTURE_BANNER } from '../src/pipeline/export.js';
import { loadRunDetail } from '../src/pipeline/run-detail.js';
import { openTestDb, uid } from './db-helpers.js';
import {
  TOKEN,
  cleanupTemps,
  consumerRepo,
  demoApi,
  fakeValidator,
  makeOrchestrator,
  registerRepo,
  type DemoApi,
} from './orchestrator-helpers.js';
import { CORRECT_PATCH, patchAnswer, repoRoot } from './repair-helpers.js';

let client: ReturnType<typeof openTestDb>;
let demo: DemoApi;
let consumerPath: string;
let exportDir: string;

beforeAll(async () => {
  client = openTestDb();
  demo = await demoApi(client.db, makeOrchestrator(client.db).orchestrator);
  consumerPath = await consumerRepo();
  exportDir = await mkdtemp(join(tmpdir(), 'sma-inc13-exports-'));
});
afterAll(async () => {
  await client?.close();
  await cleanupTemps();
  await chmod(exportDir, 0o700).catch(() => undefined);
  await rm(exportDir, { recursive: true, force: true });
});

function appWith(
  script = [patchAnswer(CORRECT_PATCH)],
  over: Parameters<typeof makeOrchestrator>[2] = {},
) {
  const made = makeOrchestrator(client.db, script, over);
  const app = buildApp(
    {},
    {
      db: client.db,
      polling: false,
      orchestrator: made.orchestrator,
      exportDir,
      env: { GITHUB_TOKEN: TOKEN },
    },
  );
  return { app, ...made };
}

/** Starts a run over HTTP and waits for it to finish. */
async function finishedRun() {
  const repo = await registerRepo(client.db, consumerPath);
  const { app, orchestrator } = appWith();
  const res = await app.inject({
    method: 'POST',
    url: '/api/runs',
    payload: { changeId: demo.rename.id, repositoryId: repo.id },
  });
  expect(res.statusCode).toBe(202);
  const run = RunSchema.parse(res.json());
  await orchestrator.idle();
  return { app, orchestrator, run, repo };
}

describe('POST /api/runs', () => {
  it('202 with the running run (text labels), then the run finishes as repaired', async () => {
    const { app, run } = await finishedRun();
    expect(run.status).toEqual({ value: 'running', label: 'Running' });
    expect(run.isFixture).toBe(true);
    const detail = RunDetailSchema.parse(
      (await app.inject({ method: 'GET', url: `/api/runs/${run.id}` })).json(),
    );
    expect(detail.run.status).toEqual({ value: 'repaired', label: 'Repaired (awaiting review)' });
    expect(detail.run.prUrl).toMatch(/\/pull\/1$/);
    expect(detail.attempts[0]?.outcome.label).toBe('Passed validation');
    await app.close();
  });

  it('400 for a bad body, 404 for an unknown change, 422 for a non-git repository', async () => {
    const { app } = appWith();
    const repo = await registerRepo(client.db, consumerPath);
    const bad = await app.inject({ method: 'POST', url: '/api/runs', payload: { changeId: 'x' } });
    expect(bad.statusCode).toBe(400);
    const extra = await app.inject({
      method: 'POST',
      url: '/api/runs',
      payload: { changeId: demo.rename.id, repositoryId: repo.id, sneaky: true },
    });
    expect(extra.statusCode).toBe(400);
    const missing = await app.inject({
      method: 'POST',
      url: '/api/runs',
      payload: { changeId: '00000000-0000-4000-8000-000000000000', repositoryId: repo.id },
    });
    expect(missing.statusCode).toBe(404);
    expect(missing.json()).toEqual([{ field: 'changeId', message: 'Change not found' }]);
    const notGit = await registerRepo(client.db, '/nonexistent/sma-repo');
    const unreadable = await app.inject({
      method: 'POST',
      url: '/api/runs',
      payload: { changeId: demo.rename.id, repositoryId: notGit.id },
    });
    expect(unreadable.statusCode).toBe(422);
    await app.close();
  });

  it('409 while another run is in flight (one run at a time)', async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const v = fakeValidator();
    const { app, orchestrator } = appWith(undefined, {
      validator: {
        ...v,
        validate: vi.fn(async () => {
          await gate;
          return v.validate();
        }),
      },
    });
    const repo = await registerRepo(client.db, consumerPath);
    const payload = { changeId: demo.rename.id, repositoryId: repo.id };
    expect((await app.inject({ method: 'POST', url: '/api/runs', payload })).statusCode).toBe(202);
    const busy = await app.inject({ method: 'POST', url: '/api/runs', payload });
    expect(busy.statusCode).toBe(409);
    release();
    await orchestrator.idle();
    await app.close();
  });
});

describe('GET /api/runs and /api/runs/:id', () => {
  it('lists runs newest first and returns the full detail', async () => {
    const { app, run } = await finishedRun();
    const list = RunsSchema.parse((await app.inject({ method: 'GET', url: '/api/runs' })).json());
    // Other test files add runs concurrently: check membership and order, not position.
    expect(list.map((r) => r.id)).toContain(run.id);
    const starts = list.map((r) => Date.parse(r.startedAt));
    expect(starts).toEqual([...starts].sort((a, b) => b - a));
    const res = await app.inject({ method: 'GET', url: `/api/runs/${run.id}` });
    expect(res.json()).toEqual(await loadRunDetail(client.db, run.id));
    expect((await app.inject({ method: 'GET', url: '/api/runs/nope' })).statusCode).toBe(400);
    expect(
      (await app.inject({ method: 'GET', url: '/api/runs/00000000-0000-4000-8000-000000000000' }))
        .statusCode,
    ).toBe(404);
    await app.close();
  });
});

describe('reanalyze and retry-delivery', () => {
  it('reanalyze → 202, a new child run; the parent is unchanged', async () => {
    const { app, orchestrator, run } = await finishedRun();
    const before = await loadRunDetail(client.db, run.id);
    const res = await app.inject({ method: 'POST', url: `/api/runs/${run.id}/reanalyze` });
    expect(res.statusCode).toBe(202);
    const child = RunSchema.parse(res.json());
    expect(child.parentRunId).toBe(run.id);
    await orchestrator.idle();
    expect(await loadRunDetail(client.db, run.id)).toEqual(before);
    await app.close();
  });

  it('retry-delivery on a run whose delivery did not fail → 409', async () => {
    const { app, run } = await finishedRun();
    const res = await app.inject({ method: 'POST', url: `/api/runs/${run.id}/retry-delivery` });
    expect(res.statusCode).toBe(409);
    await app.close();
  });
});

describe('export (FR-41, DR-05)', () => {
  it('JSON export matches the stored record (deep compare)', async () => {
    const { app, run } = await finishedRun();
    const res = await app.inject({ method: 'GET', url: `/api/runs/${run.id}/export?format=json` });
    expect(res.headers['content-type']).toMatch(/^application\/json/);
    const exported = RunDetailSchema.parse(res.json());
    expect(exported).toEqual(await loadRunDetail(client.db, run.id));
    // And against the raw rows.
    const attempts = await listAttempts(client.db, run.id);
    expect(exported.attempts.map((a) => [a.patch, a.validationOutput, a.tokensIn])).toEqual(
      attempts.map((a) => [a.patch, a.validationOutput, a.tokensIn]),
    );
    expect(exported.callSites.map((s) => s.filePath)).toEqual(
      (await listCallSites(client.db, run.id)).map((s) => s.filePath),
    );
    await app.close();
  });

  it('HTML export: text/html with a CSP, no script, the fixture banner', async () => {
    const { app, run } = await finishedRun();
    const res = await app.inject({ method: 'GET', url: `/api/runs/${run.id}/export?format=html` });
    expect(res.headers['content-type']).toMatch(/^text\/html/);
    expect(res.headers['content-security-policy']).toBe(
      "default-src 'none'; style-src 'unsafe-inline'",
    );
    expect(res.body).not.toMatch(/<script/i);
    expect(res.body).toContain(FIXTURE_BANNER);
    expect(res.body).not.toContain(TOKEN);
    const bad = await app.inject({ method: 'GET', url: `/api/runs/${run.id}/export?format=xml` });
    expect(bad.statusCode).toBe(400);
    await app.close();
  });

  it('POST export writes both files; a read-only folder → 500 and nothing marked saved', async () => {
    const { app, run } = await finishedRun();
    const res = await app.inject({ method: 'POST', url: `/api/runs/${run.id}/export` });
    expect(res.statusCode).toBe(201);
    const saved = SavedExportSchema.parse(res.json());
    expect(saved).toEqual({ saved: true, json: `run-${run.id}.json`, html: `run-${run.id}.html` });
    expect(JSON.parse(await readFile(join(exportDir, saved.json), 'utf8'))).toEqual(
      await loadRunDetail(client.db, run.id),
    );

    const before = await readdir(exportDir);
    await chmod(exportDir, 0o500);
    try {
      const { app: app2, run: run2 } = await finishedRun();
      const fail = await app2.inject({ method: 'POST', url: `/api/runs/${run2.id}/export` });
      expect(fail.statusCode).toBe(500);
      expect(fail.json()).toEqual([
        { field: 'export', message: expect.stringMatching(/was not saved/) },
      ]);
      expect(JSON.stringify(fail.json())).not.toContain('"saved":true');
      await app2.close();
    } finally {
      await chmod(exportDir, 0o700);
    }
    expect(await readdir(exportDir)).toEqual(before);
    await app.close();
  });
});

describe('spec uploads run the spec-check flow when the app has an orchestrator', () => {
  it('v1 then v2 upload → changes classified and the baseline advanced', async () => {
    const { app } = appWith();
    const api = await insertApi(client.db, { name: `upload-${uid()}` });
    const upload = async (v: string) =>
      app.inject({
        method: 'POST',
        url: `/api/apis/${api.id}/specs`,
        headers: { 'content-type': 'application/yaml' },
        payload: await readFile(join(repoRoot, `demo/api/specs/${v}.yaml`), 'utf8'),
      });
    expect((await upload('v1')).statusCode).toBe(200);
    const res = await upload('v2');
    expect(res.statusCode).toBe(200);
    const body = IngestResponseSchema.parse(res.json());
    expect(body.pipeline?.baselineAdvanced).toBe(true);
    expect(body.pipeline?.changeIds.length).toBeGreaterThanOrEqual(5);
    expect((await getApiById(client.db, api.id))?.baselineVersionId).toBe(body.check.specVersionId);
    await app.close();
  });
});
