/**
 * Repair loop with the scripted FakeLlmAdapter and a mocked validator (no Docker), on the real
 * test database. The same scenarios run against the real Docker validator in
 * repair.integration.test.ts.
 */
import { execFileSync } from 'node:child_process';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { FOUR_ATTEMPTS_REASON, ok, type ValidationResult } from '@sma/core';
import { getRunById, listAttempts, listStageResults } from '../src/infra/db/index.js';
import { FakeLlmAdapter } from '../src/infra/llm/fake.js';
import type { LlmResult } from '../src/infra/llm/types.js';
import type { GuardedValidateInput, GuardedVerdict } from '../src/pipeline/guarded-validate.js';
import { repair, UNAVAILABLE_MODEL_ID, type RepairInput } from '../src/pipeline/repair.js';
import { openTestDb, seedChain } from './db-helpers.js';
import {
  CORRECT_PATCH,
  MODEL,
  PASS,
  WRONG_PATCH,
  consumer,
  patchAnswer,
  patchFixture,
  renameChange,
  renameLocate,
  renameMapping,
  repoRoot,
  result,
} from './repair-helpers.js';

let client: ReturnType<typeof openTestDb>;
beforeAll(() => {
  client = openTestDb();
});
afterAll(async () => {
  await client.close();
});

const consumerStatus = () =>
  execFileSync('git', ['status', '--porcelain', '--', 'demo/consumer'], {
    cwd: repoRoot,
    encoding: 'utf8',
  });
const statusBefore = consumerStatus();

/** A mocked validate(): the baseline, then one scripted result per single-shot call. */
function mockValidate(baseline: ValidationResult | 'down', ...scored: ValidationResult[]) {
  return vi.fn(async (input: { patch?: string }) => {
    if (input.patch === undefined) {
      if (baseline === 'down')
        return {
          ok: false as const,
          error: { code: 'container_unavailable' as const, message: 'Docker is not running' },
        };
      return ok({
        workDir: '/x',
        commit: 'c',
        result: baseline,
        patchFiles: [],
        timings: { installMs: 0, validateMs: 0 },
      });
    }
    const r = scored.shift() ?? PASS();
    return ok({
      workDir: '/x',
      commit: 'c',
      result: r,
      patchFiles: [],
      timings: { installMs: 0, validateMs: 0 },
    });
  });
}
const verdict = (r: ValidationResult): GuardedVerdict => ({
  outcome: r.status,
  result: r,
  validated: true,
});

async function setup(
  script: LlmResult[],
  verdicts: GuardedVerdict[],
  over: Partial<RepairInput> = {},
) {
  const chain = await seedChain(client);
  const adapter = new FakeLlmAdapter(script);
  const guarded = vi.fn(
    async (_input: GuardedValidateInput) => verdicts.shift() ?? verdict(PASS()),
  );
  const validate = over.mode === 'single_shot' ? mockValidate(result()) : mockValidate(result());
  const input: RepairInput = {
    db: client.db,
    runId: chain.run.id,
    change: renameChange(),
    specSectionBefore: { customer_name: { type: 'string' } },
    specSectionAfter: { full_name: { type: 'string' } },
    migrationNoteEntry: renameMapping,
    locateResult: renameLocate,
    repo: { path: consumer },
    env: { API_VERSION: 'v2' },
    adapter,
    tokenCeiling: 100_000,
    mode: 'full',
    ...over,
  };
  return { chain, adapter, guarded, validate, input };
}

describe('repair loop (FakeLlmAdapter + mocked validator)', () => {
  it('correct patch on attempt 1 → repaired, 1 attempt, fully recorded', async () => {
    const { chain, adapter, guarded, validate, input } = await setup(
      [patchAnswer(CORRECT_PATCH)],
      [verdict(PASS())],
    );
    const out = await repair(input, { guardedValidate: guarded, validate });
    expect(out).toMatchObject({ status: 'repaired', attempts: 1, finalPatch: CORRECT_PATCH });
    expect(out.finalResult).toMatchObject({ testsPassed: 12, testsTotal: 12 });
    expect(adapter.calls).toHaveLength(1);
    // The baseline ran once, unpatched, and was passed to the guards (FR-28).
    expect(validate).toHaveBeenCalledTimes(1);
    expect(guarded.mock.calls[0]![0]).toMatchObject({
      patch: CORRECT_PATCH,
      preResult: result(),
      dispose: true,
    });

    const rows = await listAttempts(client.db, chain.run.id);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      attemptNumber: 1,
      patch: CORRECT_PATCH,
      outcome: 'pass',
      guardName: null,
      compileErrors: 0,
      testsPassed: 12,
      testsTotal: 12,
      tokensIn: 1000,
      tokensOut: 200,
      costUsd: '0.004000',
      modelId: MODEL,
      validationOutput: 'all passed',
    });
    expect(rows[0]!.durationMs).toBeGreaterThanOrEqual(0);
    const run = await getRunById(client.db, chain.run.id);
    expect(run).toMatchObject({
      status: 'running',
      attemptCount: 1,
      tokensIn: 1000,
      tokensOut: 200,
      costUsd: '0.004000',
      modelId: MODEL,
      stageReached: 'validate',
      flaggedReason: null,
    });
    const stages = await listStageResults(client.db, chain.run.id);
    expect(stages.map((s) => [s.stage, s.status]).sort()).toEqual([
      ['repair', 'ok'],
      ['validate', 'ok'],
    ]);
    const byStage = (name: string) => stages.find((s) => s.stage === name)!.result;
    expect(byStage('validate')).toMatchObject({ baseline: { testsPassed: 10, testsTotal: 12 } });
    expect(byStage('repair')).toMatchObject({ mode: 'full', status: 'repaired', attempts: 1 });
  });

  it("wrong then correct → repaired in 2; attempt 2's context has attempt 1's failing test", async () => {
    const { chain, adapter, guarded, validate, input } = await setup(
      [patchAnswer(WRONG_PATCH), patchAnswer(CORRECT_PATCH)],
      [verdict(result()), verdict(PASS())],
    );
    const out = await repair(input, { guardedValidate: guarded, validate });
    expect(out).toMatchObject({ status: 'repaired', attempts: 2 });
    expect(adapter.calls).toHaveLength(2);
    expect(adapter.calls[0]!.context.user).not.toContain('untrusted_previous_errors');
    const second = adapter.calls[1]!.context.user;
    expect(second).toContain('untrusted_previous_errors');
    expect(second).toContain(
      'FAIL test/customers.test.ts \\u003e customers display name for customer 1',
    );
    expect(second).toContain('AssertionError');
    // A fresh working copy per attempt: each guarded call gets only its own patch.
    expect(guarded.mock.calls.map((c) => c[0].patch)).toEqual([WRONG_PATCH, CORRECT_PATCH]);
    const rows = await listAttempts(client.db, chain.run.id);
    expect(rows.map((r) => r.outcome)).toEqual(['fail', 'pass']);
    expect((await getRunById(client.db, chain.run.id))!).toMatchObject({
      attemptCount: 2,
      tokensIn: 2000,
      tokensOut: 400,
    });
  });

  it('4 wrong patches → failed, exactly 4 calls and 4 rows, no 5th call', async () => {
    const { chain, adapter, guarded, validate, input } = await setup(
      Array.from({ length: 6 }, () => patchAnswer(WRONG_PATCH)),
      Array.from({ length: 6 }, () => verdict(result())),
    );
    const out = await repair(input, { guardedValidate: guarded, validate });
    expect(out).toMatchObject({ status: 'failed', attempts: 4, reason: FOUR_ATTEMPTS_REASON });
    expect(adapter.calls).toHaveLength(4);
    expect(guarded).toHaveBeenCalledTimes(4);
    // Attempt 4 sees the errors of attempts 1-3, newest first.
    const last = adapter.calls[3]!.context.user;
    expect(last.indexOf('Attempt 3 validation')).toBeLessThan(last.indexOf('Attempt 1 validation'));
    expect(await listAttempts(client.db, chain.run.id)).toHaveLength(4);
    const run = (await getRunById(client.db, chain.run.id))!;
    expect(run).toMatchObject({
      attemptCount: 4,
      flaggedReason: FOUR_ATTEMPTS_REASON,
      status: 'running',
    });
  });

  it('cheating on attempt 2 → cheating_rejected, guard named, no attempt 3', async () => {
    const cheat: GuardedVerdict = {
      outcome: 'cheating',
      guard: 'test_file_changed',
      evidence: ['test/customers.test.ts: deleted'],
      validated: false,
    };
    const { chain, adapter, guarded, validate, input } = await setup(
      [
        patchAnswer(WRONG_PATCH),
        patchAnswer(patchFixture('delete-test.diff')),
        patchAnswer(CORRECT_PATCH),
      ],
      [verdict(result()), cheat, verdict(PASS())],
    );
    const out = await repair(input, { guardedValidate: guarded, validate });
    expect(out.status).toBe('cheating_rejected');
    expect(out.reason).toMatch(/test_file_changed/);
    expect(adapter.calls).toHaveLength(2);
    const rows = await listAttempts(client.db, chain.run.id);
    expect(rows.map((r) => [r.outcome, r.guardName])).toEqual([
      ['fail', null],
      ['cheating', 'test_file_changed'],
    ]);
    expect(rows[1]!.validationOutput).toContain('test/customers.test.ts: deleted');
  });

  it('token ceiling too low for one call → aborted before any call or container run', async () => {
    const { chain, adapter, guarded, validate, input } = await setup(
      [patchAnswer(CORRECT_PATCH)],
      [],
      {
        tokenCeiling: 500,
      },
    );
    const out = await repair(input, { guardedValidate: guarded, validate });
    expect(out).toMatchObject({ status: 'aborted', attempts: 0 });
    expect(out.reason).toMatch(/Token ceiling of 500 would be exceeded by attempt 1/);
    expect(adapter.calls).toHaveLength(0);
    expect(validate).not.toHaveBeenCalled();
    const run = (await getRunById(client.db, chain.run.id))!;
    expect(run.flaggedReason).toMatch(/aborted/);
    const [stage] = await listStageResults(client.db, chain.run.id);
    expect(stage).toMatchObject({
      stage: 'repair',
      status: 'failed',
      result: { status: 'aborted' },
    });
  });

  it('ceiling hit mid-run → aborted (not failed) after the attempts that fit', async () => {
    // Attempt 1 uses 9,000 tokens; attempt 2 cannot fit in a 12,000 ceiling with 4,096 output.
    const { chain, adapter, guarded, validate, input } = await setup(
      [patchAnswer(WRONG_PATCH, 8000, 1000), patchAnswer(CORRECT_PATCH)],
      [verdict(result()), verdict(PASS())],
      { tokenCeiling: 12_000 },
    );
    const out = await repair(input, { guardedValidate: guarded, validate });
    expect(out).toMatchObject({ status: 'aborted', attempts: 1, tokensIn: 8000, tokensOut: 1000 });
    expect(out.reason).toMatch(/attempt 2 \(9000 used/);
    expect(adapter.calls).toHaveLength(1);
    expect((await getRunById(client.db, chain.run.id))!.attemptCount).toBe(1);
  });

  it('unconfirmed change (DELETE /orders/{id}) → flagged, 0 adapter calls, no container', async () => {
    const { chain, adapter, guarded, validate, input } = await setup(
      [patchAnswer(CORRECT_PATCH)],
      [],
      {
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
      },
    );
    const out = await repair(input, { guardedValidate: guarded, validate });
    expect(out).toMatchObject({
      status: 'flagged',
      attempts: 0,
      reason: 'No confirmed mapping: reported, not repaired.',
    });
    expect(adapter.calls).toHaveLength(0);
    expect(validate).not.toHaveBeenCalled();
    expect(guarded).not.toHaveBeenCalled();
    const [stage] = await listStageResults(client.db, chain.run.id);
    expect(stage).toMatchObject({ stage: 'repair', status: 'skipped' });
    expect((await getRunById(client.db, chain.run.id))!).toMatchObject({
      flaggedReason: 'No confirmed mapping: reported, not repaired.',
      stageReached: 'repair',
    });
  });

  it('non-breaking or unlocated changes are flagged without a call', async () => {
    for (const over of [
      { change: renameChange({ classification: 'safe' }) },
      { locateResult: { callSites: [] } },
      // Only a test file was located: no eligible source file for the context.
      {
        locateResult: {
          callSites: [
            {
              filePath: 'test/customers.test.ts',
              line: 1,
              column: 1,
              pattern: 'fetch' as const,
              excerpt: '',
            },
          ],
        },
      },
    ]) {
      const { adapter, guarded, validate, input } = await setup(
        [patchAnswer(CORRECT_PATCH)],
        [],
        over,
      );
      expect((await repair(input, { guardedValidate: guarded, validate })).status).toBe('flagged');
      expect(adapter.calls).toHaveLength(0);
      expect(validate).not.toHaveBeenCalled();
    }
  });

  it('adapter timeout → stage_failure (repair), attempt recorded as timeout', async () => {
    const { chain, input, guarded, validate } = await setup(
      [{ kind: 'error', errorKind: 'timeout', message: 'deadline', durationMs: 120_000 }],
      [],
    );
    const out = await repair(input, { guardedValidate: guarded, validate });
    expect(out).toMatchObject({ status: 'stage_failure', failureStage: 'repair', attempts: 1 });
    expect(guarded).not.toHaveBeenCalled();
    const [row] = await listAttempts(client.db, chain.run.id);
    expect(row).toMatchObject({
      outcome: 'timeout',
      patch: '',
      modelId: UNAVAILABLE_MODEL_ID,
      tokensIn: 0,
    });
    expect((await getRunById(client.db, chain.run.id))!).toMatchObject({
      failureStage: 'repair',
      failureDetail: expect.stringMatching(/Model unavailable \(timeout\)/),
    });
  });

  it('api_error / missing_key → stage_failure (repair), attempt outcome error', async () => {
    for (const errorKind of ['api_error', 'missing_key'] as const) {
      const { chain, input, guarded, validate } = await setup(
        [{ kind: 'error', errorKind, message: 'unavailable', durationMs: 1 }],
        [],
      );
      expect(await repair(input, { guardedValidate: guarded, validate })).toMatchObject({
        status: 'stage_failure',
        failureStage: 'repair',
      });
      expect((await listAttempts(client.db, chain.run.id))[0]!.outcome).toBe('error');
    }
  });

  it('refusal → flagged with the reason, attempt recorded', async () => {
    const { chain, input, guarded, validate } = await setup(
      [
        {
          kind: 'refusal',
          reason: 'mapping is insufficient',
          tokensIn: 900,
          tokensOut: 10,
          costUsd: 0.0019,
          modelId: MODEL,
          durationMs: 3,
        },
      ],
      [],
    );
    const out = await repair(input, { guardedValidate: guarded, validate });
    expect(out).toMatchObject({
      status: 'flagged',
      reason: 'Model refused: mapping is insufficient',
      attempts: 1,
    });
    expect(guarded).not.toHaveBeenCalled();
    const [row] = await listAttempts(client.db, chain.run.id);
    expect(row).toMatchObject({
      outcome: 'fail',
      tokensIn: 900,
      validationOutput: 'Model refused: mapping is insufficient',
    });
  });

  it('invalid output and a patch that does not apply are fed back as errors; usage is counted', async () => {
    const { chain, adapter, input, guarded, validate } = await setup(
      [
        {
          kind: 'error',
          errorKind: 'invalid_output',
          message: 'Expected a complete unified diff',
          durationMs: 2,
          usage: { tokensIn: 700, tokensOut: 300, costUsd: 0.0044, modelId: MODEL },
        },
        patchAnswer(WRONG_PATCH),
        patchAnswer(CORRECT_PATCH),
      ],
      [
        {
          outcome: 'error',
          error: { code: 'patch_invalid', message: 'patch does not apply' },
          validated: false,
        },
        verdict(PASS()),
      ],
    );
    const out = await repair(input, { guardedValidate: guarded, validate });
    expect(out).toMatchObject({ status: 'repaired', attempts: 3, tokensIn: 2700, tokensOut: 700 });
    expect(adapter.calls[1]!.context.user).toContain('Expected a complete unified diff');
    expect(adapter.calls[2]!.context.user).toContain('patch does not apply');
    const rows = await listAttempts(client.db, chain.run.id);
    expect(rows.map((r) => [r.outcome, r.tokensIn])).toEqual([
      ['fail', 700],
      ['fail', 1000],
      ['pass', 1000],
    ]);
  });

  it('a container failure during an attempt → stage_failure (validate), no retry', async () => {
    const { adapter, input, guarded, validate } = await setup(
      [patchAnswer(WRONG_PATCH), patchAnswer(CORRECT_PATCH)],
      [
        {
          outcome: 'error',
          error: { code: 'container_unavailable', message: 'Docker is not running' },
          validated: false,
        },
      ],
    );
    const out = await repair(input, { guardedValidate: guarded, validate });
    expect(out).toMatchObject({ status: 'stage_failure', failureStage: 'validate', attempts: 1 });
    expect(adapter.calls).toHaveLength(1);
  });

  it('a validator timeout result is recorded and the loop continues with the next attempt', async () => {
    const { chain, input, guarded, validate } = await setup(
      [patchAnswer(WRONG_PATCH), patchAnswer(CORRECT_PATCH)],
      [verdict(result({ status: 'timeout', errorReason: 'wall clock' })), verdict(PASS())],
    );
    expect((await repair(input, { guardedValidate: guarded, validate })).status).toBe('repaired');
    expect((await listAttempts(client.db, chain.run.id)).map((r) => r.outcome)).toEqual([
      'timeout',
      'pass',
    ]);
  });

  it('a baseline that cannot run → stage_failure (validate) before any model call', async () => {
    const { chain, adapter, input, guarded } = await setup([patchAnswer(CORRECT_PATCH)], []);
    const out = await repair(input, { guardedValidate: guarded, validate: mockValidate('down') });
    expect(out).toMatchObject({ status: 'stage_failure', failureStage: 'validate', attempts: 0 });
    expect(adapter.calls).toHaveLength(0);
    const stages = await listStageResults(client.db, chain.run.id);
    expect(stages.map((s) => [s.stage, s.status]).sort()).toEqual([
      ['repair', 'failed'],
      ['validate', 'failed'],
    ]);
  });

  it('single_shot: 1 call, no baseline, no guards; a cheating patch is only scored', async () => {
    const { chain, adapter, guarded, input } = await setup(
      [patchAnswer(patchFixture('ts-ignore.diff')), patchAnswer(CORRECT_PATCH)],
      [],
      { mode: 'single_shot' },
    );
    const validate = mockValidate(result(), PASS());
    const out = await repair(input, { guardedValidate: guarded, validate });
    expect(out).toMatchObject({ status: 'repaired', attempts: 1 });
    expect(adapter.calls).toHaveLength(1);
    expect(guarded).not.toHaveBeenCalled();
    expect(validate).toHaveBeenCalledTimes(1);
    expect(validate.mock.calls[0]![0].patch).toBe(patchFixture('ts-ignore.diff'));
    const [row] = await listAttempts(client.db, chain.run.id);
    expect(row).toMatchObject({ outcome: 'pass', guardName: null });
    const stages = await listStageResults(client.db, chain.run.id);
    expect(stages.map((s) => s.stage)).toEqual(['repair']);
    expect(stages[0]!.result).toMatchObject({ mode: 'single_shot', status: 'repaired' });
  });

  it('single_shot: a failing score → failed, still exactly 1 call', async () => {
    const { adapter, guarded, input } = await setup(
      [patchAnswer(WRONG_PATCH), patchAnswer(CORRECT_PATCH)],
      [],
      { mode: 'single_shot' },
    );
    const out = await repair(input, {
      guardedValidate: guarded,
      validate: mockValidate(result(), result()),
    });
    expect(out).toMatchObject({ status: 'failed', attempts: 1 });
    expect(adapter.calls).toHaveLength(1);
  });

  it('refuses to run twice on one run, a finished run, or a bad ceiling', async () => {
    const { input, guarded, validate } = await setup(
      [patchAnswer(CORRECT_PATCH)],
      [verdict(PASS())],
    );
    await repair(input, { guardedValidate: guarded, validate });
    await expect(repair(input, { guardedValidate: guarded, validate })).rejects.toThrow(
      /already has a repair/,
    );
    await expect(repair({ ...input, tokenCeiling: 0 })).rejects.toThrow(/positive integer/);
    await expect(
      repair({ ...input, runId: '00000000-0000-0000-0000-000000000000' }),
    ).rejects.toThrow(/not found/);
  });

  it('never changes demo/consumer', () => {
    expect(consumerStatus()).toBe(statusBefore);
  });
});
