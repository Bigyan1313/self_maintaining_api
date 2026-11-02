import { afterAll, describe, expect, it } from 'vitest';
import { readFile, mkdtemp, mkdir, writeFile, symlink, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { Writable } from 'node:stream';
import { eq, count } from 'drizzle-orm';
import { parse } from 'yaml';
import {
  IngestResponseSchema,
  MAX_SPEC_BYTES,
  countRepoSize,
  ApiSchema,
  SpecChecksSchema,
} from '@sma/core';
import { buildApp } from '../src/app.js';
import { openTestDb } from './db-helpers.js';
import { listSpecVersions, getApiById } from '../src/infra/db/index.js';
import { apis, runs, specChecks, repositories } from '../src/infra/db/schema.js';
import { advanceBaseline, ingest } from '../src/pipeline/ingest.js';
import { validateRepository } from '../src/pipeline/config-validate.js';
import { fileSystemRepoReader } from '../src/infra/repo/reader.js';
import type { FastifyInstance } from 'fastify';
// Runtime import keeps the separate demo workspace outside the server compilation root.
const demoModulePath = new URL('../../../demo/api/src/app.ts', import.meta.url).href;
const { buildDemoApp } = (await import(demoModulePath)) as {
  buildDemoApp: (version: 'v2') => FastifyInstance;
};

const client = openTestDb();
const app = buildApp({}, { db: client.db, polling: false });
const v1 = await readFile(new URL('../../../demo/api/specs/v1.yaml', import.meta.url), 'utf8');
const v2 = await readFile(new URL('../../../demo/api/specs/v2.yaml', import.meta.url), 'utf8');
const dirs: string[] = [];
afterAll(async () => {
  await app.close();
  await client.close();
  await Promise.all(dirs.map((path) => rm(path, { recursive: true, force: true })));
});
async function newApi() {
  const response = await app.inject({
    method: 'POST',
    url: '/api/apis',
    payload: { name: randomUUID(), specSourceUrl: 'http://127.0.0.1:1/spec' },
  });
  expect(response.statusCode).toBe(201);
  return response.json<{ id: string }>().id;
}
async function upload(id: string, text: string, contentType = 'application/yaml') {
  return app.inject({
    method: 'POST',
    url: `/api/apis/${id}/specs`,
    headers: { 'content-type': contentType },
    payload: text,
  });
}
async function repo() {
  const path = await mkdtemp(join(tmpdir(), 'sma-inc04-'));
  dirs.push(path);
  execFileSync('git', ['init', '-b', 'main', path], { stdio: 'ignore' });
  execFileSync(
    'git',
    [
      '-C',
      path,
      '-c',
      'user.name=Test',
      '-c',
      'user.email=test@example.com',
      'commit',
      '--allow-empty',
      '-m',
      'fixture',
    ],
    { stdio: 'ignore' },
  );
  await mkdir(join(path, 'src'));
  await writeFile(join(path, 'src', 'app.ts'), 'export const value = 1;\n');
  return path;
}
describe('ingestion persistence and HTTP acceptance', () => {
  it('establishes baseline, deduplicates JSON, records v2 without advancing; histories survive app restart', async () => {
    const id = await newApi();
    const first = IngestResponseSchema.parse((await upload(id, v1)).json());
    expect(first.check.outcome.label).toBe('Baseline established');
    expect(first.baselineVersionId).toBe(first.check.specVersionId);
    const same = IngestResponseSchema.parse(
      (await upload(id, JSON.stringify(parse(v1)), 'application/json')).json(),
    );
    expect(same.check.outcome.value).toBe('no_change');
    expect(await listSpecVersions(client.db, id)).toHaveLength(1);
    const next = IngestResponseSchema.parse((await upload(id, v2)).json());
    expect(next.check.outcome.value).toBe('changed');
    expect(next.baselineVersionId).toBe(first.baselineVersionId);
    expect(await listSpecVersions(client.db, id)).toHaveLength(2);
    const reopened = buildApp({}, { db: client.db, polling: false });
    const history = await reopened.inject(`/api/apis/${id}/checks`);
    expect(SpecChecksSchema.parse(history.json())).toHaveLength(3);
    await reopened.close();
    await advanceBaseline(client.db, id, next.check.specVersionId!);
    expect((await getApiById(client.db, id))?.baselineVersionId).toBe(next.check.specVersionId);
    await expect(
      advanceBaseline(client.db, await newApi(), next.check.specVersionId!),
    ).rejects.toThrow('belong');
  });
  it('serializes concurrent initial uploads to one baseline and one version', async () => {
    const id = await newApi();
    const results = await Promise.all(
      Array.from({ length: 5 }, () => ingest(client.db, id, { mode: 'uploaded', text: v1 })),
    );
    expect(results.filter((r) => r.check.outcome.value === 'baseline_established')).toHaveLength(1);
    expect(results.filter((r) => r.check.outcome.value === 'no_change')).toHaveLength(4);
    expect(await listSpecVersions(client.db, id)).toHaveLength(1);
  });
  it('records invalid JSON and oversized uploads as failed checks while preserving the baseline', async () => {
    const id = await newApi();
    const first = (await upload(id, v1)).json();
    for (const [text, type, status] of [
      ['{bad', 'application/json', 422],
      ['x'.repeat(MAX_SPEC_BYTES + 1), 'text/plain', 413],
    ] as const) {
      const response = await upload(id, text, type);
      expect(response.statusCode).toBe(status);
      expect(response.json()).toMatchObject({
        baselineVersionId: first.baselineVersionId,
        check: { outcome: { value: 'failed' } },
      });
    }
    expect(await listSpecVersions(client.db, id)).toHaveLength(1);
    expect((await app.inject(`/api/apis/${id}/checks`)).json()).toHaveLength(3);
  });
  it('records retrieval failure then succeeds against the actual demo API', async () => {
    const id = await newApi();
    const baseline = (await upload(id, v1)).json().baselineVersionId;
    const failed = await app.inject({ method: 'POST', url: `/api/apis/${id}/check` });
    expect(failed.statusCode).toBe(422);
    expect(failed.json()).toMatchObject({
      baselineVersionId: baseline,
      check: { outcome: { value: 'failed' } },
    });
    const demo = buildDemoApp('v2');
    demo.get('/openapi.yaml', async (_req, reply) => reply.type('application/yaml').send(v2));
    await demo.listen({ host: '127.0.0.1', port: 0 });
    try {
      const address = demo.server.address();
      if (!address || typeof address === 'string') throw new Error('Missing demo port');
      await client.db
        .update(apis)
        .set({ specSourceUrl: `http://127.0.0.1:${address.port}/openapi.yaml` })
        .where(eq(apis.id, id));
      const retry = await app.inject({ method: 'POST', url: `/api/apis/${id}/check` });
      expect(retry.statusCode).toBe(200);
      expect(retry.json()).toMatchObject({
        baselineVersionId: baseline,
        check: { outcome: { value: 'changed' } },
        sourceMode: { value: 'retrieved' },
      });
    } finally {
      await demo.close();
    }
  });
  it('labels trusted demo fixture ingestion distinctly', async () => {
    const id = await newApi();
    expect(await ingest(client.db, id, { mode: 'fixture', version: 'v1' })).toMatchObject({
      sourceMode: { value: 'fixture' },
    });
    expect((await listSpecVersions(client.db, id))[0]?.sourceIdentifier).toBe(
      'demo/api/specs/v1.yaml',
    );
  });
  it('validates an uploaded API before registration and establishes its baseline atomically', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/apis',
      payload: { name: randomUUID(), specText: v1 },
    });
    expect(response.statusCode).toBe(201);
    const api = ApiSchema.parse(response.json());
    expect(api.baselineVersionId).not.toBeNull();
    expect(await listSpecVersions(client.db, api.id)).toHaveLength(1);
  });
  it('reports missing, unreachable, bad-spec and oversized configuration without creating checks or runs', async () => {
    await client.db.transaction(
      async (tx) => {
        const isolated = buildApp({}, { db: tx, polling: false });
        try {
          const before = {
            checks: await tx.select({ count: count() }).from(specChecks),
            runs: await tx.select({ count: count() }).from(runs),
          };
          const name = randomUUID();
          for (const payload of [
            {},
            { name, specSourceUrl: 'ftp://bad' },
            { name, specText: '{bad' },
            { name, specSourceUrl: 'https://example.com', pollIntervalSeconds: 59 },
          ]) {
            const response = await isolated.inject({ method: 'POST', url: '/api/apis', payload });
            expect(response.statusCode).toBe(400);
            expect(response.json()).toEqual(
              expect.arrayContaining([
                expect.objectContaining({ field: expect.any(String), message: expect.any(String) }),
              ]),
            );
          }
          const path = await repo();
          await Promise.all(
            Array.from({ length: 200 }, (_, i) => writeFile(join(path, 'src', `${i}.ts`), 'x\n')),
          );
          for (const payload of [
            {},
            { owner: 'acme', name, defaultBranch: 'absent', localPath: '/does/not/exist' },
            { owner: 'acme', name, defaultBranch: 'main', localPath: path },
          ]) {
            expect(
              (await isolated.inject({ method: 'POST', url: '/api/repositories', payload }))
                .statusCode,
            ).toBe(400);
          }
          expect(await tx.select().from(apis).where(eq(apis.name, name))).toHaveLength(0);
          expect(
            await tx.select().from(repositories).where(eq(repositories.name, name)),
          ).toHaveLength(0);
          expect(await tx.select({ count: count() }).from(specChecks)).toEqual(before.checks);
          expect(await tx.select({ count: count() }).from(runs)).toEqual(before.runs);
        } finally {
          await isolated.close();
        }
      },
      { isolationLevel: 'repeatable read' },
    );
  });
  it('registers valid repositories and reloads them; duplicate registration is a conflict', async () => {
    const config = {
      owner: 'acme',
      name: randomUUID(),
      defaultBranch: 'main',
      localPath: await repo(),
    };
    const first = await app.inject({ method: 'POST', url: '/api/repositories', payload: config });
    expect(first.statusCode, first.body).toBe(201);
    expect((await app.inject('/api/repositories')).json()).toEqual(
      expect.arrayContaining([expect.objectContaining({ id: first.json().id })]),
    );
    expect(
      (await app.inject({ method: 'POST', url: '/api/repositories', payload: config })).statusCode,
    ).toBe(409);
    expect((await validateRepository({ ...config, defaultBranch: 'absent' })).ok).toBe(false);
  });
  it('never reads symlinked or excluded source from a real filesystem', async () => {
    const path = await repo();
    await mkdir(join(path, 'node_modules'));
    await writeFile(join(path, 'node_modules', 'a.ts'), 'x\n'.repeat(20001));
    await writeFile(join(path, '.env.ts'), 'not source');
    await symlink(join(path, 'node_modules'), join(path, 'src', 'linked-dir'));
    await symlink(join(path, 'node_modules', 'a.ts'), join(path, 'src', 'linked.ts'));
    const size = await countRepoSize(path, fileSystemRepoReader);
    expect(size).toMatchObject({ files: 1, lines: 1, exceeded: false });
    expect(size.skipped.filter((s) => s.reason === 'symbolic link not followed')).toHaveLength(2);
  });
  it('rejects credentials before storage and never emits them in responses or logs', async () => {
    const original = process.env.GITHUB_TOKEN;
    process.env.GITHUB_TOKEN = 'ghp_FAKE123';
    let logs = '';
    const stream = new Writable({
      write(chunk, _encoding, callback) {
        logs += String(chunk);
        callback();
      },
    });
    const secured = buildApp(
      { logger: { stream } },
      {
        db: client.db,
        polling: false,
        probeRepository: async () => {
          throw new Error('ghp_FAKE123');
        },
      },
    );
    try {
      const name = randomUUID();
      const response = await secured.inject({
        method: 'POST',
        url: '/api/repositories',
        payload: {
          owner: 'acme',
          name,
          defaultBranch: 'main',
          localPath: await repo(),
          credentialRef: 'GITHUB_TOKEN',
        },
      });
      expect(response.statusCode).toBe(400);
      const id = await newApi();
      const rejected = await secured.inject({
        method: 'POST',
        url: `/api/apis/${id}/specs`,
        headers: { 'content-type': 'text/plain' },
        payload: `${v1}\nx-token: ghp_FAKE123`,
      });
      expect(rejected.statusCode).toBe(422);
      const escaped = await secured.inject({
        method: 'POST',
        url: `/api/apis/${id}/specs`,
        headers: { 'content-type': 'application/json' },
        payload: JSON.stringify({
          openapi: '3.0.3',
          info: { title: 'Test', version: '1' },
          paths: {},
          'x-token': 'ghp_FAKE123',
        }).replace('FAKE', '\\u0046AKE'),
      });
      expect(escaped.statusCode).toBe(422);
      const notFound = await secured.inject('/missing?token=ghp_FAKE123');
      expect(notFound.body).not.toContain('ghp_FAKE123');
      const records = await listSpecVersions(client.db, id);
      expect(records).toHaveLength(0);
      const checks = (await secured.inject(`/api/apis/${id}/checks`)).json();
      expect(
        JSON.stringify([response.json(), rejected.json(), records, checks]) + logs,
      ).not.toContain('ghp_FAKE123');
    } finally {
      await secured.close();
      if (original === undefined) delete process.env.GITHUB_TOKEN;
      else process.env.GITHUB_TOKEN = original;
    }
  });
  it('rejects malformed IDs, missing APIs, extra check fields, and leaves future routes unimplemented', async () => {
    expect((await app.inject('/api/apis/bad/checks')).statusCode).toBe(400);
    expect((await upload(randomUUID(), v1)).statusCode).toBe(404);
    expect(
      (
        await app.inject({
          method: 'POST',
          url: `/api/apis/${await newApi()}/check`,
          payload: { token: 'no' },
        })
      ).statusCode,
    ).toBe(400);
    expect((await app.inject('/api/runs')).statusCode).toBe(404);
  });
});
