/**
 * Validator integration tests (AT-11, parts of AT-06/07). They need Docker: skipped locally
 * when Docker is not running, and required in CI.
 *
 * Every check runs in its own container. Each isolation property is asserted on its own named
 * probe test, so one failure never hides another.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, describe, expect, it } from 'vitest';
import type { TestCaseResult } from '@sma/core';
import { dockerServerVersion } from '../src/infra/validator/docker.js';
import { disposeWorkingCopy } from '../src/infra/workcopy/index.js';
import { validate } from '../src/pipeline/validate.js';

const repoRoot = fileURLToPath(new URL('../../../', import.meta.url));
const consumer = join(repoRoot, 'demo/consumer');
const fixtures = fileURLToPath(new URL('./fixtures/validator/', import.meta.url));

const dockerVersion = await dockerServerVersion();
if (!dockerVersion)
  console.warn(
    '[validator] SKIPPING Docker integration tests: Docker is not running. They always run in CI.',
  );
if (process.env.CI && !dockerVersion) throw new Error('Docker must be available in CI');

/** inc02's report: the 8 tests that fail against v2. */
const V2_FAILING = [
  'admin cancelling order 2 succeeds',
  'customers display name for customer 1 is "Ada Lovelace"',
  'customers display name for customer 3 is "Grace Hopper"',
  'invoices amount due on order 1 is 19.99',
  'invoices invoice label for order 2 is "INV-0002 (due 0.00)"',
  'orders open orders are 1 and 3',
  'orders order 1 total with shipping is 24.99',
  'orders order 4 total with shipping is 105',
].sort();

const toDispose: string[] = [];
afterAll(async () => {
  for (const dir of toDispose) await disposeWorkingCopy(dir);
});

const gitStatus = (path: string) =>
  execFileSync('git', ['status', '--porcelain', '--', path], { cwd: repoRoot, encoding: 'utf8' });

const statusOf = (results: TestCaseResult[], name: string) =>
  results.find((t) => t.name === name)?.status ?? 'missing';

const timings: Record<string, unknown> = {};
afterAll(() => {
  if (Object.keys(timings).length)
    console.log('[validator] timings (ms):', JSON.stringify(timings));
});

describe.skipIf(!dockerVersion)('validator in Docker', () => {
  it(
    'consumer v1 → pass 12/12; a type-error patch → fail with 1 compile error; host repo untouched',
    { timeout: 600_000 },
    async () => {
      const before = gitStatus('demo/consumer');
      const patch = readFileSync(join(fixtures, 'consumer-type-error.patch'), 'utf8');
      const r = await validate({
        repoPath: consumer,
        env: { API_VERSION: 'v1' },
        patch,
        runBaseline: true,
      });
      if (!r.ok) throw new Error(`${r.error.code}: ${r.error.message}`);
      toDispose.push(r.value.workDir);
      timings.consumerV1 = r.value.timings;
      expect(r.value.baseline).toMatchObject({
        status: 'pass',
        compileErrors: 0,
        testsPassed: 12,
        testsTotal: 12,
      });
      expect(r.value.result).toMatchObject({ status: 'fail', compileErrors: 1, testsTotal: 12 });
      expect(r.value.result.rawOutput).toContain('error TS2322');
      expect(r.value.patchFiles).toEqual([
        { oldPath: 'src/orders.ts', newPath: 'src/orders.ts', change: 'modified' },
      ]);
      // The patch landed in the copy only.
      expect(readFileSync(join(r.value.workDir, 'src/orders.ts'), 'utf8')).toContain(
        "SHIPPING_FEE: number = '5'",
      );
      expect(readFileSync(join(consumer, 'src/orders.ts'), 'utf8')).toContain('SHIPPING_FEE = 5;');
      expect(gitStatus('demo/consumer')).toBe(before);
      // Green threshold: install + validate < 5 min.
      expect(r.value.timings.installMs + r.value.timings.validateMs).toBeLessThan(5 * 60_000);
    },
  );

  it('consumer v2 → fail 4/12, failing names match inc02', { timeout: 600_000 }, async () => {
    const before = gitStatus('demo/consumer');
    const r = await validate({ repoPath: consumer, env: { API_VERSION: 'v2' }, dispose: true });
    if (!r.ok) throw new Error(`${r.error.code}: ${r.error.message}`);
    timings.consumerV2 = r.value.timings;
    const { result } = r.value;
    expect(result).toMatchObject({
      status: 'fail',
      compileErrors: 0,
      testsPassed: 4,
      testsTotal: 12,
    });
    expect(
      result.testResults
        .filter((t) => t.status === 'failed')
        .map((t) => t.name)
        .sort(),
    ).toEqual(V2_FAILING);
    expect(result.testFiles).toHaveLength(5);
    expect(result.rawOutput).toContain('8 failed');
    expect(existsSync(r.value.workDir)).toBe(false);
    expect(gitStatus('demo/consumer')).toBe(before);
  });

  describe('isolation probes (one throwaway repo, one named test per property)', () => {
    let results: TestCaseResult[] = [];
    let raw = '';
    let workDir = '';

    it('runs the probe repo with fake host credentials set', { timeout: 600_000 }, async () => {
      const probe = join(fixtures, 'probe-repo');
      const before = gitStatus('apps/server/test/fixtures/validator');
      process.env.GITHUB_TOKEN = 'ghp_FAKE';
      process.env.ANTHROPIC_API_KEY = 'sk-ant-FAKE';
      try {
        const r = await validate({ repoPath: probe, env: { API_VERSION: 'probe' } });
        if (!r.ok) throw new Error(`${r.error.code}: ${r.error.message}`);
        toDispose.push(r.value.workDir);
        timings.probe = r.value.timings;
        results = r.value.result.testResults;
        raw = r.value.result.rawOutput;
        workDir = r.value.workDir;
        expect(r.value.result.testsTotal).toBe(7);
      } finally {
        delete process.env.GITHUB_TOKEN;
        delete process.env.ANTHROPIC_API_KEY;
      }
      expect(gitStatus('apps/server/test/fixtures/validator')).toBe(before);
    });

    it('no network: fetch(https://example.com) fails with a network error', () => {
      expect(statusOf(results, 'network probe: fetch https://example.com')).toBe('failed');
      expect(raw).toMatch(/fetch failed|EAI_AGAIN|ENOTFOUND|ENETUNREACH|ECONNREFUSED/);
      expect(statusOf(results, 'network probe: fetch by IP http://1.1.1.1')).toBe('failed');
      expect(raw).toMatch(/ENETUNREACH|EHOSTUNREACH|ECONNREFUSED|TimeoutError|aborted/);
    });

    it('not root: process.getuid() !== 0', () => {
      expect(statusOf(results, 'user probe: not running as root')).toBe('passed');
      expect(raw).toMatch(/SMA_UID=\d+/);
      expect(raw).not.toMatch(/SMA_UID=0\b/);
    });

    it('no secrets: the printed container env has neither fake host credential', () => {
      expect(statusOf(results, 'env probe: prints the container environment')).toBe('passed');
      const dump = /SMA_ENV_DUMP (\{.*\})/.exec(raw)?.[1];
      expect(dump).toBeDefined();
      const env = JSON.parse(dump!) as Record<string, string>;
      expect(env.API_VERSION).toBe('probe');
      expect(env.CI).toBe('true');
      expect(raw).not.toContain('ghp_FAKE');
      expect(raw).not.toContain('sk-ant-FAKE');
      expect(Object.keys(env).some((k) => /TOKEN|API_KEY|SECRET|PASSWORD/i.test(k))).toBe(false);
    });

    it('host untouched: writes to /etc/hosts and outside /work fail; writes in /work stay in the copy', () => {
      expect(statusOf(results, 'fs probe: cannot write /etc/hosts')).toBe('passed');
      expect(statusOf(results, 'fs probe: cannot write outside /work and /tmp')).toBe('passed');
      expect(statusOf(results, 'fs probe: can write inside /work')).toBe('passed');
      expect(existsSync(join(workDir, 'probe-wrote-this.txt'))).toBe(true);
      expect(existsSync(join(fixtures, 'probe-repo', 'probe-wrote-this.txt'))).toBe(false);
      expect(readFileSync('/etc/hosts', 'utf8')).not.toContain('sma-probe');
    });
  });

  it(
    'timeout: an infinite-loop test with a 20 s limit → timeout, and the container is gone',
    { timeout: 600_000 },
    async () => {
      const started = Date.now();
      const r = await validate({
        repoPath: join(fixtures, 'timeout-repo'),
        limits: { timeoutMs: 20_000 },
      });
      if (!r.ok) throw new Error(`${r.error.code}: ${r.error.message}`);
      toDispose.push(r.value.workDir);
      expect(r.value.result.status).toBe('timeout');
      expect(r.value.result.errorReason).toMatch(/wall-clock/);
      expect(r.value.result.rawOutput).toContain('[killed: wall-clock limit reached]');
      expect(r.value.result.durationMs).toBeGreaterThanOrEqual(20_000);
      expect(r.value.result.durationMs).toBeLessThan(80_000);
      expect(Date.now() - started).toBeLessThan(300_000);
      const left = execFileSync(
        'docker',
        ['ps', '--all', '--quiet', '--filter', `label=sma.workcopy=${basename(r.value.workDir)}`],
        { encoding: 'utf8' },
      ).trim();
      expect(left).toBe('');
    },
  );
});
