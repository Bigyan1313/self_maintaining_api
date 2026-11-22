/**
 * Repair loop with the scripted FakeLlmAdapter and the REAL Docker validator (AT-06, AT-07
 * ceiling part). Needs Docker and PostgreSQL: skipped locally when Docker is not running,
 * required in CI.
 *
 * Most checks use a **rename-only** copy of demo/consumer, built in a temp dir: the v1 response
 * fixtures plus the v2 `GET /customers/*` fixtures, so the one confirmed change in play is the
 * field rename. On the real v2 (five changes at once, one of them unconfirmed) a correct rename
 * cannot make the whole suite pass; the last test proves the loop does not call that repaired.
 * See docs/decisions/inc11.md.
 */
import { execFileSync } from 'node:child_process';
import { rm } from 'node:fs/promises';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { FOUR_ATTEMPTS_REASON } from '@sma/core';
import { listAttempts } from '../src/infra/db/index.js';
import { FakeLlmAdapter } from '../src/infra/llm/fake.js';
import type { LlmResult } from '../src/infra/llm/types.js';
import { dockerServerVersion } from '../src/infra/validator/docker.js';
import { repair, type RepairInput } from '../src/pipeline/repair.js';
import { openTestDb, seedChain } from './db-helpers.js';
import {
  CORRECT_PATCH,
  MODEL,
  WRONG_PATCH,
  consumer,
  patchAnswer,
  patchFixture,
  renameChange,
  renameLocate,
  renameMapping,
  renameOnlyConsumer,
  repoRoot,
  snapshot,
} from './repair-helpers.js';

const dockerVersion = await dockerServerVersion();
if (!dockerVersion)
  console.warn(
    '[repair] SKIPPING Docker integration tests: Docker is not running. They always run in CI.',
  );
if (process.env.CI && !dockerVersion) throw new Error('Docker must be available in CI');

const TIMEOUT = 1_200_000;
const consumerStatus = () =>
  execFileSync('git', ['status', '--porcelain', '--', 'demo/consumer'], {
    cwd: repoRoot,
    encoding: 'utf8',
  });

describe.skipIf(!dockerVersion)('repair loop with the real Docker validator', () => {
  let client: ReturnType<typeof openTestDb>;
  let renameOnly: string;
  let renameOnlyHash: string;
  const consumerBefore = consumerStatus();

  beforeAll(async () => {
    client = openTestDb();
    renameOnly = await renameOnlyConsumer();
    renameOnlyHash = await snapshot(renameOnly);
  });
  afterAll(async () => {
    await client?.close();
    if (renameOnly) await rm(renameOnly, { recursive: true, force: true });
  });

  async function run(script: LlmResult[], over: Partial<RepairInput> = {}) {
    const chain = await seedChain(client);
    const adapter = new FakeLlmAdapter(script);
    const out = await repair({
      db: client.db,
      runId: chain.run.id,
      change: renameChange(),
      specSectionBefore: { customer_name: { type: 'string' } },
      specSectionAfter: { full_name: { type: 'string' } },
      migrationNoteEntry: renameMapping,
      locateResult: renameLocate,
      repo: { path: renameOnly },
      env: { API_VERSION: 'v2' },
      adapter,
      tokenCeiling: 100_000,
      mode: 'full',
      ...over,
    });
    return { out, adapter, rows: await listAttempts(client.db, chain.run.id) };
  }

  it(
    'correct patch on attempt 1 → repaired, 1 attempt, tests 12/12',
    { timeout: TIMEOUT },
    async () => {
      const { out, adapter, rows } = await run([patchAnswer(CORRECT_PATCH)]);
      expect(out).toMatchObject({ status: 'repaired', attempts: 1 });
      expect(out.finalResult).toMatchObject({
        status: 'pass',
        compileErrors: 0,
        testsPassed: 12,
        testsTotal: 12,
      });
      expect(adapter.calls).toHaveLength(1);
      expect(rows[0]).toMatchObject({
        outcome: 'pass',
        testsPassed: 12,
        testsTotal: 12,
        modelId: MODEL,
      });
    },
  );

  it(
    "wrong then correct → repaired in 2; attempt 2's context names attempt 1's failing tests",
    { timeout: TIMEOUT },
    async () => {
      const { out, adapter, rows } = await run([
        patchAnswer(WRONG_PATCH),
        patchAnswer(CORRECT_PATCH),
      ]);
      expect(out).toMatchObject({ status: 'repaired', attempts: 2 });
      expect(rows.map((r) => [r.outcome, r.testsPassed, r.testsTotal])).toEqual([
        ['fail', 10, 12],
        ['pass', 12, 12],
      ]);
      const second = adapter.calls[1]!.context.user;
      expect(second).toContain('customers display name for customer 1 is');
      expect(second).toContain('customers display name for customer 3 is');
      expect(second).toContain('FAIL test/customers.test.ts');
    },
  );

  it(
    '4 wrong patches → failed, exactly 4 adapter calls and 4 attempt rows',
    { timeout: TIMEOUT },
    async () => {
      const { out, adapter, rows } = await run(
        Array.from({ length: 5 }, () => patchAnswer(WRONG_PATCH)),
      );
      expect(out).toMatchObject({ status: 'failed', attempts: 4, reason: FOUR_ATTEMPTS_REASON });
      expect(adapter.calls).toHaveLength(4);
      expect(rows.map((r) => r.attemptNumber)).toEqual([1, 2, 3, 4]);
      expect(rows.every((r) => r.outcome === 'fail')).toBe(true);
    },
  );

  it(
    'cheating patch on attempt 2 → cheating_rejected, guard named, no attempt 3',
    { timeout: TIMEOUT },
    async () => {
      const { out, adapter, rows } = await run([
        patchAnswer(WRONG_PATCH),
        patchAnswer(patchFixture('delete-test.diff')),
        patchAnswer(CORRECT_PATCH),
      ]);
      expect(out.status).toBe('cheating_rejected');
      expect(adapter.calls).toHaveLength(2);
      expect(rows.map((r) => [r.outcome, r.guardName])).toEqual([
        ['fail', null],
        ['cheating', 'test_file_changed'],
      ]);
    },
  );

  it(
    'single_shot → 1 call, no guards: a @ts-ignore patch is scored, not rejected',
    { timeout: TIMEOUT },
    async () => {
      const { out, adapter, rows } = await run(
        [patchAnswer(patchFixture('ts-ignore.diff')), patchAnswer(CORRECT_PATCH)],
        { mode: 'single_shot' },
      );
      expect(adapter.calls).toHaveLength(1);
      expect(out).toMatchObject({ status: 'repaired', attempts: 1 });
      expect(rows[0]).toMatchObject({ outcome: 'pass', guardName: null, testsPassed: 12 });
    },
  );

  it('token ceiling too low → aborted before the first call', { timeout: TIMEOUT }, async () => {
    const { out, adapter, rows } = await run([patchAnswer(CORRECT_PATCH)], { tokenCeiling: 1000 });
    expect(out.status).toBe('aborted');
    expect(adapter.calls).toHaveLength(0);
    expect(rows).toHaveLength(0);
  });

  it('ceiling hit mid-run → aborted, not failed', { timeout: TIMEOUT }, async () => {
    const { out, adapter } = await run(
      [patchAnswer(WRONG_PATCH, 8000, 1000), patchAnswer(CORRECT_PATCH)],
      {
        tokenCeiling: 12_000,
      },
    );
    expect(out).toMatchObject({ status: 'aborted', attempts: 1 });
    expect(adapter.calls).toHaveLength(1);
  });

  it(
    'unconfirmed DELETE /orders/{id} → flagged, 0 adapter calls',
    { timeout: TIMEOUT },
    async () => {
      const { out, adapter } = await run([patchAnswer(CORRECT_PATCH)], {
        change: renameChange({
          category: 'endpoint_removed',
          mappingStatus: 'unconfirmed',
          mappingSource: null,
          mapping: null,
        }),
        migrationNoteEntry: null,
        locateResult: {
          callSites: [
            { filePath: 'src/admin.ts', line: 6, column: 21, pattern: 'axios_static', excerpt: '' },
          ],
        },
      });
      expect(out.status).toBe('flagged');
      expect(adapter.calls).toHaveLength(0);
    },
  );

  it(
    'adapter timeout → stage_failure (repair); refusal → flagged',
    { timeout: TIMEOUT },
    async () => {
      const timeout = await run([
        { kind: 'error', errorKind: 'timeout', message: 'deadline', durationMs: 120_000 },
      ]);
      expect(timeout.out).toMatchObject({ status: 'stage_failure', failureStage: 'repair' });
      const refusal = await run([
        {
          kind: 'refusal',
          reason: 'insufficient',
          tokensIn: 1,
          tokensOut: 1,
          costUsd: 0,
          modelId: MODEL,
          durationMs: 1,
        },
      ]);
      expect(refusal.out).toMatchObject({
        status: 'flagged',
        reason: 'Model refused: insufficient',
      });
    },
  );

  it(
    'real five-change v2: the correct rename alone is NOT reported repaired (6/12)',
    { timeout: TIMEOUT },
    async () => {
      const { out, rows } = await run(
        [
          patchAnswer(CORRECT_PATCH),
          {
            kind: 'refusal',
            reason: 'stop',
            tokensIn: 1,
            tokensOut: 1,
            costUsd: 0,
            modelId: MODEL,
            durationMs: 1,
          },
        ],
        { repo: { path: consumer } },
      );
      expect(rows[0]).toMatchObject({ outcome: 'fail', testsPassed: 6, testsTotal: 12 });
      expect(out.status).toBe('flagged');
    },
  );

  it('neither demo/consumer nor the rename-only repo changed', async () => {
    expect(consumerStatus()).toBe(consumerBefore);
    expect(await snapshot(renameOnly)).toBe(renameOnlyHash);
  });
});
