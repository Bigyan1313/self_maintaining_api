import { cp, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { parse } from 'yaml';
import type { ValidationResult } from '@sma/core';
import { assertFrozen, hashFolder, readManifest } from './integrity.js';
import { assess, verifyOne } from './verify.js';
import { fixtures, specification } from './build.js';
import { snapshotCommit } from './snapshot.js';
import rename from './definitions/rename-shop-flat.js';
import param from './definitions/param-library-header.js';
import removed from './definitions/removed-weather-refuse.js';

const root = fileURLToPath(new URL('.', import.meta.url));
const temps: string[] = [];
afterEach(async () => {
  for (const dir of temps.splice(0)) await rm(dir, { recursive: true, force: true });
});
async function temp(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'sma-scenario-test-'));
  temps.push(dir);
  return dir;
}
const result = (failed = false): ValidationResult => ({
  status: failed ? 'fail' : 'pass',
  compileErrors: 0,
  testsPassed: failed ? 0 : 1,
  testsTotal: 1,
  testResults: [{ file: 'test/a.test.ts', name: 'contract', status: failed ? 'failed' : 'passed' }],
  testFiles: ['test/a.test.ts'],
  durationMs: 1,
  rawOutput: '',
});
describe('admission, not just nonzero exit', () => {
  it('admits a real before-pass/after-fail pair', () =>
    expect(assess('case', { before: result(), after: result(true) }).admissible).toBe(true));
  it('rejects after-pass', () =>
    expect(assess('case', { before: result(), after: result() }).admissible).toBe(false));
  it.each(['error', 'timeout'] as const)('rejects after %s', (status) =>
    expect(
      assess('case', { before: result(), after: { ...result(true), status } }).admissible,
    ).toBe(false),
  );
  it('rejects compile-only failures', () =>
    expect(
      assess('case', { before: result(), after: { ...result(true), compileErrors: 1 } }).admissible,
    ).toBe(false));
  it('rejects failing before', () =>
    expect(assess('case', { before: result(true), after: result(true) }).admissible).toBe(false));
  it('rejects empty before suite', () =>
    expect(
      assess('case', {
        before: { ...result(), testsTotal: 0, testsPassed: 0 },
        after: result(true),
      }).admissible,
    ).toBe(false));
  it('rejects changed test identity', () =>
    expect(
      assess('case', {
        before: result(),
        after: {
          ...result(true),
          testResults: [{ file: 'test/other.ts', name: 'other', status: 'failed' }],
        },
      }).admissible,
    ).toBe(false));
  it('rejects skip-only failure', () =>
    expect(
      assess('case', {
        before: result(),
        after: {
          ...result(true),
          testResults: [{ file: 'test/a.test.ts', name: 'contract', status: 'skipped' }],
        },
      }).admissible,
    ).toBe(false));
});
describe('frozen cohort', () => {
  it('contains 20 intact cases, five per category, seventeen repairs and three refusals', async () => {
    const manifest = await readManifest(root);
    const counts: Record<string, number> = {};
    let refused = 0;
    const patterns = new Set<string>();
    for (const entry of manifest.scenarios) {
      await assertFrozen(root, entry);
      const meta = parse(await readFile(join(root, entry.id, 'scenario.yaml'), 'utf8'));
      const labels = parse(await readFile(join(root, entry.id, 'labels.yaml'), 'utf8'));
      expect(labels.id).toBe(entry.id);
      expect(labels.expectedOutcome).toBe(meta.expected.outcome);
      expect(
        labels.differences.some(
          (d: { category: string; classification: string }) =>
            d.category === meta.category && d.classification === 'breaking',
        ),
      ).toBe(true);
      counts[meta.category] = (counts[meta.category] ?? 0) + 1;
      meta.callPatterns.forEach((p: string) => patterns.add(p));
      if (meta.expected.outcome === 'refuse') {
        refused++;
        await expect(readFile(join(root, entry.id, 'migration-note.yaml'))).rejects.toThrow();
      }
    }
    expect(Object.values(counts)).toEqual([5, 5, 5, 5]);
    expect(refused).toBe(3);
    expect([...patterns].sort()).toEqual([
      'axios_instance',
      'axios_static',
      'fetch',
      'generated_client',
    ]);
  });
  it('reports mutation before invoking detector or consumer and preserves the original', async () => {
    const dir = await temp();
    const entry = (await readManifest(root)).scenarios[0]!;
    await cp(join(root, entry.id), join(dir, entry.id), { recursive: true });
    await writeFile(join(dir, entry.id, 'repo/src/consumer.ts'), '// changed\n');
    const runner = vi.fn();
    const audit = vi.fn();
    const report = await verifyOne(dir, entry, runner, audit);
    expect(report.admissible).toBe(false);
    expect(report.reason).toContain('modified after freezing');
    expect(runner).not.toHaveBeenCalled();
    expect(audit).not.toHaveBeenCalled();
    await assertFrozen(root, entry);
  });
  it('hashes paths as well as contents and includes extra files', async () => {
    const dir = await temp();
    await writeFile(join(dir, 'a'), 'same');
    const initial = await hashFolder(dir);
    await rm(join(dir, 'a'));
    await writeFile(join(dir, 'b'), 'same');
    expect(await hashFolder(dir)).not.toBe(initial);
    const next = await hashFolder(dir);
    await writeFile(join(dir, 'extra'), '');
    expect(await hashFolder(dir)).not.toBe(next);
  });
  it('reconstructs the pinned standalone Git commit reproducibly', async () => {
    const entry = (await readManifest(root)).scenarios[0]!;
    expect(await snapshotCommit(join(root, entry.id, 'repo'))).toBe(entry.repoCommit);
    expect(await snapshotCommit(join(root, entry.id, 'repo'))).toBe(entry.repoCommit);
  });
  it('rejects a shortened manifest', async () => {
    const dir = await temp();
    await writeFile(
      join(dir, 'manifest.json'),
      JSON.stringify({ schemaVersion: 1, scenarios: [] }),
    );
    await expect(readManifest(dir)).rejects.toThrow('exactly 20');
  });
});
describe('spec-derived fixtures', () => {
  it('extracts before/after examples, not handcrafted response copies', () => {
    expect(fixtures(specification(rename, false))[0]).toMatchObject({
      body: { customer_name: 'Ada' },
    });
    expect(fixtures(specification(rename, true))[0]).toMatchObject({ body: { full_name: 'Ada' } });
  });
  it('extracts required header constraints only after the change', () => {
    expect(fixtures(specification(param, false))[0]).toMatchObject({ parameters: [] });
    expect(fixtures(specification(param, true))[0]).toMatchObject({
      parameters: [{ name: 'x-library', in: 'header', required: true }],
    });
  });
  it('omits removed operations but preserves the unrelated control operation', () => {
    expect(fixtures(specification(removed, true))).toHaveLength(1);
    expect(fixtures(specification(removed, true))[0]).toMatchObject({ path: '/health' });
  });
});
