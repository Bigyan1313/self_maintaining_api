import { readFile } from 'node:fs/promises';
import { afterAll, describe, expect, it } from 'vitest';
import { hashSpec, normalizeSpec, parseSpec, type SpecDifference } from '@sma/core';
import { insertApi, insertSpecVersion, listChangesForVersions } from '../src/infra/db/index.js';
import type { OasdiffRunner } from '../src/infra/oasdiff/runner.js';
import { detectChanges, persistClassifiedChanges } from '../src/pipeline/detect.js';
import { openTestDb, uid } from './db-helpers.js';

const root = new URL('../../../', import.meta.url);
const client = openTestDb();
afterAll(() => client.close());

const fixture = JSON.parse(
  await readFile(new URL('packages/core/test/fixtures/oasdiff-demo-v1-v2.json', root), 'utf8'),
) as unknown;
/** Replays the recorded oasdiff output: no binary needed. */
const fixtureRunner: OasdiffRunner = async () => ({ ok: true, value: fixture });

async function seedPair() {
  const api = await insertApi(client.db, { name: `detect-${uid()}` });
  const versions = [];
  for (const v of ['v1', 'v2'] as const) {
    const parsed = await parseSpec(
      await readFile(new URL(`demo/api/specs/${v}.yaml`, root), 'utf8'),
    );
    if (!parsed.ok) throw new Error(parsed.error.message);
    const canonical = normalizeSpec(parsed.value);
    versions.push(
      await insertSpecVersion(client.db, {
        apiId: api.id,
        sourceMode: 'fixture',
        sourceIdentifier: `demo/api/specs/${v}.yaml`,
        contentSha256: hashSpec(canonical),
        normalized: JSON.parse(canonical) as unknown,
      }),
    );
  }
  return { api, v1: versions[0]!, v2: versions[1]! };
}

describe('detectChanges', () => {
  it('returns differences with pointers and evidence from the stored versions', async () => {
    const { api, v1, v2 } = await seedPair();
    const result = await detectChanges(client.db, api.id, v1.id, v2.id, { runner: fixtureRunner });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toHaveLength(9);
    const total = result.value.find((d) => d.ruleId === 'response-property-type-changed')!;
    expect(total.evidenceBefore).toEqual({ type: 'number' });
    expect(total.evidenceAfter).toMatchObject({ type: 'string' });
    // Detection writes nothing.
    expect(await listChangesForVersions(client.db, v1.id, v2.id)).toEqual([]);
  });

  it('passes the normalized BEFORE/AFTER documents to the runner', async () => {
    const { api, v1, v2 } = await seedPair();
    const seen: unknown[] = [];
    await detectChanges(client.db, api.id, v1.id, v2.id, {
      runner: async (a, b) => {
        seen.push(a, b);
        return { ok: true, value: [] };
      },
    });
    expect(seen).toEqual([v1.normalized, v2.normalized]);
  });

  it('rejects the same version, unknown versions, and versions of another API', async () => {
    const { api, v1, v2 } = await seedPair();
    const other = await seedPair();
    const run = (from: string, to: string, apiId = api.id) =>
      detectChanges(client.db, apiId, from, to, { runner: fixtureRunner });
    expect(await run(v1.id, v1.id)).toMatchObject({ ok: false, error: { code: 'same_version' } });
    expect(await run(v1.id, other.v2.id)).toMatchObject({
      ok: false,
      error: { code: 'version_not_found' },
    });
    expect(await run(v1.id, v2.id, other.api.id)).toMatchObject({
      ok: false,
      error: { code: 'version_not_found' },
    });
  });

  it('surfaces runner and parser failures as typed errors', async () => {
    const { api, v1, v2 } = await seedPair();
    expect(
      await detectChanges(client.db, api.id, v1.id, v2.id, {
        runner: async () => ({ ok: false, error: { code: 'binary_missing', message: 'x' } }),
      }),
    ).toMatchObject({ ok: false, error: { code: 'binary_missing' } });
    expect(
      await detectChanges(client.db, api.id, v1.id, v2.id, {
        runner: async () => ({ ok: true, value: { not: 'an array' } }),
      }),
    ).toMatchObject({ ok: false, error: { code: 'bad_output' } });
  });
});

describe('persistClassifiedChanges', () => {
  async function detected() {
    const pair = await seedPair();
    const result = await detectChanges(client.db, pair.api.id, pair.v1.id, pair.v2.id, {
      runner: fixtureRunner,
    });
    if (!result.ok) throw new Error(result.error.message);
    return { ...pair, diffs: result.value };
  }
  const classify = (d: SpecDifference) => ({
    difference: d,
    category: 'other' as const,
    classification: 'unknown' as const,
    confidence: 0.5,
  });

  it('stores path, method, pointer and evidence for every difference', async () => {
    const { api, v1, v2, diffs } = await detected();
    const rows = await persistClassifiedChanges(
      client.db,
      api.id,
      v1.id,
      v2.id,
      diffs.map(classify),
    );
    expect(rows).toHaveLength(diffs.length);
    for (const [i, row] of rows.entries()) {
      const d = diffs[i]!;
      expect(row).toMatchObject({
        oasdiffRuleId: d.ruleId,
        path: d.path,
        method: d.method,
        jsonPointer: d.jsonPointer,
        evidenceBefore: d.evidenceBefore,
        evidenceAfter: d.evidenceAfter,
        mappingStatus: 'unconfirmed',
        mappingSource: null,
      });
    }
  });

  it('is idempotent per version pair', async () => {
    const { api, v1, v2, diffs } = await detected();
    const first = await persistClassifiedChanges(
      client.db,
      api.id,
      v1.id,
      v2.id,
      diffs.map(classify),
    );
    const second = await persistClassifiedChanges(
      client.db,
      api.id,
      v1.id,
      v2.id,
      diffs.map(classify),
    );
    expect(second.map((r) => r.id).sort()).toEqual(first.map((r) => r.id).sort());
    expect(await listChangesForVersions(client.db, v1.id, v2.id)).toHaveLength(diffs.length);
  });

  it('stores a migration-note confirmation when classification supplies one', async () => {
    const { api, v1, v2, diffs } = await detected();
    const [row] = await persistClassifiedChanges(client.db, api.id, v1.id, v2.id, [
      {
        ...classify(diffs[0]!),
        confirmation: { source: 'migration_note', mapping: { old: 'a', new: 'b' } },
      },
    ]);
    expect(row).toMatchObject({ mappingStatus: 'confirmed', mappingSource: 'migration_note' });
  });

  it('refuses versions that do not belong to the API', async () => {
    const { api, v1 } = await detected();
    const other = await seedPair();
    await expect(
      persistClassifiedChanges(client.db, api.id, v1.id, other.v2.id, []),
    ).rejects.toThrow(/belong/);
  });
});
