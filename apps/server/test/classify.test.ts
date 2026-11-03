import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { afterAll, describe, expect, it } from 'vitest';
import {
  ChangesSchema,
  ChangeSchema,
  MigrationNoteSchema,
  normalizeSpec,
  hashSpec,
  parseSpec,
  parseMigrationNote,
} from '@sma/core';
import { buildApp } from '../src/app.js';
import { detectAndClassify } from '../src/pipeline/classify.js';
import {
  insertApi,
  insertSpecVersion,
  insertMigrationNote,
  listChangesForVersions,
} from '../src/infra/db/index.js';
import { openTestDb, uid } from './db-helpers.js';
import type { OasdiffRunner } from '../src/infra/oasdiff/runner.js';

const client = openTestDb();
const app = buildApp({}, { db: client.db, polling: false });
afterAll(async () => {
  await app.close();
  await client.close();
});
const root = new URL('../../../', import.meta.url);
const read = (p: string) => readFile(new URL(p, root), 'utf8');
const fixture: unknown = JSON.parse(
  await read('packages/core/test/fixtures/oasdiff-demo-v1-v2.json'),
);
const rawYaml = await read('demo/api/migration-notes/v1-to-v2.yaml');
const runner: OasdiffRunner = async () => ({ ok: true, value: fixture });
const note = parseMigrationNote(rawYaml);
if (!note.ok) throw new Error('Invalid fixture note');
const mappings = note.value.mappings;

async function seed() {
  const api = await insertApi(client.db, { name: `classify-${uid()}` });
  const versions = [];
  for (const v of ['v1', 'v2']) {
    const parsed = await parseSpec(await read(`demo/api/specs/${v}.yaml`));
    if (!parsed.ok) throw new Error('Invalid demo spec');
    const canonical = normalizeSpec(parsed.value);
    versions.push(
      await insertSpecVersion(client.db, {
        apiId: api.id,
        sourceMode: 'fixture',
        sourceIdentifier: v,
        contentSha256: hashSpec(canonical),
        normalized: parsed.value,
      }),
    );
  }
  const fromVersionId = versions[0]!.id;
  const toVersionId = versions[1]!.id;
  return { api, fromVersionId, toVersionId };
}
async function classified(withNote = false) {
  const pair = await seed();
  if (withNote) {
    const response = await app.inject({
      method: 'POST',
      url: `/api/apis/${pair.api.id}/migration-notes`,
      payload: { fromVersionId: pair.fromVersionId, toVersionId: pair.toVersionId, rawYaml },
    });
    expect(response.statusCode).toBe(201);
    expect(MigrationNoteSchema.safeParse(response.json()).success).toBe(true);
  }
  const result = await detectAndClassify(
    client.db,
    pair.api.id,
    pair.fromVersionId,
    pair.toVersionId,
    { runner },
  );
  if (!result.ok) throw new Error('Classification failed');
  return { ...pair, rows: result.value };
}

describe('detectAndClassify persistence', () => {
  it('stores all nine verdicts and four note confirmations with their evidence and note link', async () => {
    const { rows } = await classified(true);
    expect(rows).toHaveLength(9);
    const confirmed = rows.filter((r) => r.mappingStatus === 'confirmed');
    expect(confirmed).toHaveLength(4);
    expect(
      confirmed.every(
        (r) => r.mappingSource === 'migration_note' && r.migrationNoteId && r.mapping,
      ),
    ).toBe(true);
    expect(rows.find((r) => r.method === 'DELETE')).toMatchObject({
      classification: 'breaking',
      mappingStatus: 'unconfirmed',
      mapping: null,
    });
    expect(rows.find((r) => r.category === 'field_type_changed')).toMatchObject({
      evidenceBefore: { type: 'number' },
      evidenceAfter: { type: 'string' },
    });
  });
  it('without a note all five breaking changes are unconfirmed', async () => {
    const { rows } = await classified();
    expect(rows.filter((r) => r.classification === 'breaking')).toHaveLength(5);
    expect(rows.every((r) => r.mappingStatus === 'unconfirmed')).toBe(true);
  });
  it('concurrent and repeated classifications insert only one set', async () => {
    const p = await seed();
    const call = () =>
      detectAndClassify(client.db, p.api.id, p.fromVersionId, p.toVersionId, { runner });
    const [a, b] = await Promise.all([call(), call()]);
    expect(a.ok && b.ok).toBe(true);
    expect(await listChangesForVersions(client.db, p.fromVersionId, p.toVersionId)).toHaveLength(9);
    const repeat = await detectAndClassify(client.db, p.api.id, p.fromVersionId, p.toVersionId, {
      runner: async () => {
        throw new Error('Must use existing records');
      },
    });
    expect(repeat.ok).toBe(true);
  });
  it('refuses foreign/same versions and surfaces runner errors without writing', async () => {
    const p = await seed();
    const foreign = await seed();
    for (const to of [p.fromVersionId, foreign.toVersionId])
      expect(
        (await detectAndClassify(client.db, p.api.id, p.fromVersionId, to, { runner })).ok,
      ).toBe(false);
    const failed = await detectAndClassify(client.db, p.api.id, p.fromVersionId, p.toVersionId, {
      runner: async () => ({ ok: false, error: { code: 'timeout', message: 'timeout' } }),
    });
    expect(failed).toMatchObject({ ok: false, error: { code: 'timeout' } });
    expect(await listChangesForVersions(client.db, p.fromVersionId, p.toVersionId)).toEqual([]);
  });
  it('fails safely on an invalid legacy stored note', async () => {
    const p = await seed();
    await insertMigrationNote(client.db, {
      apiId: p.api.id,
      fromVersionId: p.fromVersionId,
      toVersionId: p.toVersionId,
      rawYaml: 'bad: [',
      parsed: {},
    });
    expect(
      await detectAndClassify(client.db, p.api.id, p.fromVersionId, p.toVersionId, { runner }),
    ).toMatchObject({ ok: false, error: { code: 'invalid_note' } });
  });
});

describe('migration-note upload and change list', () => {
  it('returns field errors for bad YAML, wrong versions, foreign versions, and oversized notes', async () => {
    const p = await seed();
    const other = await seed();
    for (const payload of [
      { fromVersionId: p.fromVersionId, toVersionId: p.toVersionId, rawYaml: 'mappings: [' },
      {
        fromVersionId: p.fromVersionId,
        toVersionId: p.toVersionId,
        rawYaml: rawYaml.replace("'1.0.0'", "'wrong'"),
      },
      { fromVersionId: p.fromVersionId, toVersionId: other.toVersionId, rawYaml },
      { fromVersionId: p.fromVersionId, toVersionId: p.fromVersionId, rawYaml },
      {
        fromVersionId: p.fromVersionId,
        toVersionId: p.toVersionId,
        rawYaml: 'a'.repeat(256 * 1024 + 1),
      },
    ]) {
      const res = await app.inject({
        method: 'POST',
        url: `/api/apis/${p.api.id}/migration-notes`,
        payload,
      });
      expect(res.statusCode).toBe(400);
      expect(res.json()[0]).toHaveProperty('field');
    }
  });
  it('validates IDs and returns 404 for nonexistent APIs', async () => {
    for (const [id, status] of [
      ['invalid', 400],
      [randomUUID(), 404],
    ] as const) {
      expect((await app.inject({ url: `/api/changes?apiId=${id}` })).statusCode).toBe(status);
      expect(
        (
          await app.inject({
            method: 'POST',
            url: `/api/apis/${id}/migration-notes`,
            payload: { fromVersionId: randomUUID(), toVersionId: randomUUID(), rawYaml },
          })
        ).statusCode,
      ).toBe(status);
    }
  });
  it('lists only the requested API with correct text labels', async () => {
    const p = await classified(true);
    const other = await seed();
    const response = await app.inject({ url: `/api/changes?apiId=${p.api.id}` });
    const rows = ChangesSchema.parse(response.json());
    expect(rows).toHaveLength(9);
    expect(rows.every((r) => r.apiId === p.api.id && r.mappingStatus.label.length > 0)).toBe(true);
    expect((await app.inject({ url: `/api/changes?apiId=${other.api.id}` })).json()).toEqual([]);
  });
});

describe('explicit human confirmation', () => {
  it('validates all four mapping kinds and retains confirmation across reanalysis', async () => {
    const p = await classified();
    for (const mapping of mappings) {
      const row = p.rows.find(
        (r) =>
          r.category === mapping.kind && r.path === mapping.path && r.method === mapping.method,
      )!;
      const response = await app.inject({
        method: 'POST',
        url: `/api/changes/${row.id}/confirm-mapping`,
        payload: { mapping, confirmedBy: 'reviewer' },
      });
      expect(response.statusCode).toBe(200);
      expect(ChangeSchema.parse(response.json())).toMatchObject({
        mappingStatus: { value: 'confirmed' },
        mappingSource: { value: 'human' },
        confirmedBy: 'reviewer',
      });
      expect(response.json().confirmedAt).not.toBeNull();
    }
    const again = await detectAndClassify(client.db, p.api.id, p.fromVersionId, p.toVersionId, {
      runner,
    });
    expect(again.ok && again.value.filter((r) => r.mappingSource === 'human').length).toBe(4);
  });
  it('rejects nonexistent fields/targets, missing confirmer, wrong category and duplicate confirmation', async () => {
    const p = await classified();
    const row = p.rows.find((r) => r.category === 'field_renamed')!;
    const mapping = mappings.find((m) => m.kind === 'field_renamed')!;
    const send = (body: unknown) =>
      app.inject({
        method: 'POST',
        url: `/api/changes/${row.id}/confirm-mapping`,
        payload: JSON.stringify(body),
        headers: { 'content-type': 'application/json' },
      });
    expect(
      (await send({ mapping: { ...mapping, new: 'missing' }, confirmedBy: 'reviewer' })).statusCode,
    ).toBe(400);
    expect((await send({ mapping, confirmedBy: '  ' })).statusCode).toBe(400);
    expect((await send({ mapping: mappings[1], confirmedBy: 'reviewer' })).statusCode).toBe(400);
    expect((await send({ mapping, confirmedBy: 'reviewer' })).statusCode).toBe(200);
    expect((await send({ mapping, confirmedBy: 'another' })).statusCode).toBe(409);
    const deleted = p.rows.find((r) => r.method === 'DELETE')!;
    expect(
      (
        await app.inject({
          method: 'POST',
          url: `/api/changes/${deleted.id}/confirm-mapping`,
          payload: {
            mapping: { kind: 'endpoint_removed', method: 'DELETE', path: deleted.path },
            confirmedBy: 'reviewer',
          },
        })
      ).statusCode,
    ).toBe(400);
  });
  it('allows exactly one concurrent confirmation and refuses note-confirmed changes', async () => {
    const p = await classified();
    const row = p.rows.find((r) => r.category === 'field_renamed')!;
    const payload = { mapping: mappings[0], confirmedBy: 'reviewer' };
    const responses = await Promise.all(
      [1, 2].map(() =>
        app.inject({ method: 'POST', url: `/api/changes/${row.id}/confirm-mapping`, payload }),
      ),
    );
    expect(responses.map((r) => r.statusCode).sort()).toEqual([200, 409]);
    const noted = await classified(true);
    const confirmed = noted.rows.find((r) => r.category === 'field_renamed')!;
    expect(
      (
        await app.inject({
          method: 'POST',
          url: `/api/changes/${confirmed.id}/confirm-mapping`,
          payload,
        })
      ).statusCode,
    ).toBe(409);
  });
  it('returns field errors for invalid/missing change IDs and mapping shapes', async () => {
    for (const [id, status] of [
      ['invalid', 400],
      [randomUUID(), 404],
    ] as const)
      expect(
        (
          await app.inject({
            method: 'POST',
            url: `/api/changes/${id}/confirm-mapping`,
            payload: { mapping: mappings[0], confirmedBy: 'reviewer' },
          })
        ).statusCode,
      ).toBe(status);
    expect(
      (
        await app.inject({
          method: 'POST',
          url: `/api/changes/${randomUUID()}/confirm-mapping`,
          payload: { mapping: { kind: 'unknown' }, confirmedBy: 'reviewer' },
        })
      ).statusCode,
    ).toBe(400);
  });
});
