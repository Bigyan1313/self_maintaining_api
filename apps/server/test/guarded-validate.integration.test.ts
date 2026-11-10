/**
 * Cheat guards + real validator (AT-07, guard part). Needs Docker: skipped locally when Docker
 * is not running, required in CI. Only honest patches reach the container here; cheating
 * patches never do (proved with a mock in guarded-validate.test.ts).
 */
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import type { ValidationResult } from '@sma/core';
import { dockerServerVersion } from '../src/infra/validator/docker.js';
import { guardedValidate } from '../src/pipeline/guarded-validate.js';
import { validate } from '../src/pipeline/validate.js';

const repoRoot = fileURLToPath(new URL('../../../', import.meta.url));
const consumer = join(repoRoot, 'demo/consumer');
const fixture = (name: string) =>
  readFileSync(join(repoRoot, 'packages/core/test/fixtures/patches', name), 'utf8');

const dockerVersion = await dockerServerVersion();
if (!dockerVersion)
  console.warn(
    '[guards] SKIPPING Docker integration tests: Docker is not running. They always run in CI.',
  );
if (process.env.CI && !dockerVersion) throw new Error('Docker must be available in CI');

const gitStatus = () =>
  execFileSync('git', ['status', '--porcelain', '--', 'demo/consumer'], {
    cwd: repoRoot,
    encoding: 'utf8',
  });

/** Pre-patch baseline: the unpatched consumer against one API version. */
async function baseline(apiVersion: string): Promise<ValidationResult> {
  const r = await validate({ repoPath: consumer, env: { API_VERSION: apiVersion }, dispose: true });
  if (!r.ok) throw new Error(`${r.error.code}: ${r.error.message}`);
  return r.value.result;
}

describe.skipIf(!dockerVersion)('guarded validation in Docker', () => {
  it(
    'honest-rename.diff on v2: no guard fires, both customer tests now pass (4 → 6 of 12)',
    { timeout: 600_000 },
    async () => {
      const before = gitStatus();
      const pre = await baseline('v2');
      expect(pre).toMatchObject({ status: 'fail', testsPassed: 4, testsTotal: 12 });
      const v = await guardedValidate({
        repoPath: consumer,
        patch: fixture('honest-rename.diff'),
        env: { API_VERSION: 'v2' },
        preResult: pre,
      });
      expect(v.guard).toBeUndefined();
      expect(v.evidence).toBeUndefined();
      expect(v.validated).toBe(true);
      // The other three v2 changes are still unrepaired, so the suite as a whole still fails.
      expect(v.outcome).toBe('fail');
      expect(v.result).toMatchObject({ compileErrors: 0, testsPassed: 6, testsTotal: 12 });
      const status = (name: string) => v.result!.testResults.find((t) => t.name === name)?.status;
      expect(status('customers display name for customer 1 is "Ada Lovelace"')).toBe('passed');
      expect(status('customers display name for customer 3 is "Grace Hopper"')).toBe('passed');
      expect(gitStatus()).toBe(before);
    },
  );

  it('honest-refactor.diff on v1: the full chain reaches pass', { timeout: 600_000 }, async () => {
    const pre = await baseline('v1');
    expect(pre).toMatchObject({ status: 'pass', testsPassed: 12, testsTotal: 12 });
    const v = await guardedValidate({
      repoPath: consumer,
      patch: fixture('honest-refactor.diff'),
      env: { API_VERSION: 'v1' },
      preResult: pre,
    });
    expect(v).toMatchObject({ outcome: 'pass', validated: true });
    expect(v.guard).toBeUndefined();
    expect(v.result).toMatchObject({ testsPassed: 12, testsTotal: 12 });
  });
});
