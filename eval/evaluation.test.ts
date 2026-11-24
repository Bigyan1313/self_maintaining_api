import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { type RepairContext } from '@sma/core';
import { FakeLlmAdapter } from '../apps/server/src/infra/llm/fake.js';
import { evaluate, type EvaluationPorts } from './engine.js';
import { BudgetAdapter, maximumCallCost } from './budget.js';
import { readStudy, saveStudy, lockStudy, studyDirectory } from './store.js';
import { renderEvaluationReport, writeReport } from './report.js';
import {
  DEFAULT_MAX_COST_USD,
  EVAL_MAX_OUTPUT_TOKENS,
  estimateMaxCost,
  parseEvaluationArgs,
} from './run.js';
import { sampleStudy, sampleTrial } from './test-helpers.js';
const temps: string[] = [];
afterEach(async () => {
  vi.unstubAllEnvs();
  await Promise.all(temps.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});
const ports = (): EvaluationPorts => ({
  assertFrozen: vi.fn(async () => {}),
  admit: vi.fn(async () => ({
    id: 'x',
    admissible: true,
    beforePassed: 2,
    beforeTotal: 2,
    afterPassed: 1,
    afterTotal: 2,
  })),
  trial: vi.fn(async (_e, baseline, repeat) => sampleTrial({ baseline, repeat })),
  save: vi.fn(async () => {}),
  interrupted: () => false,
});
const context = { system: 'system', user: 'user' } as RepairContext;
describe('evaluation orchestration and artifacts', () => {
  it('scrubs credential values before the file and database mirror', async () => {
    const root = await mkdtemp(join(tmpdir(), 'eval-redact-'));
    temps.push(root);
    vi.stubEnv('EVALUATION_TEST_SECRET', 'only-a-test-secret-value');
    const study = sampleStudy();
    study.stopReason = 'failure only-a-test-secret-value';
    const mirror = vi.fn(async () => {});
    await saveStudy(root, study, mirror);
    expect((await readStudy(root, 'test')).stopReason).not.toContain('only-a-test-secret-value');
    expect(JSON.stringify(mirror.mock.calls)).not.toContain('only-a-test-secret-value');
  });

  it('runs identical matrices three times and checkpoints while still partial', async () => {
    const study = sampleStudy();
    study.config.repeat = 3;
    const p = ports();
    const snapshots: string[] = [];
    p.save = async () => {
      snapshots.push(study.status);
    };
    await evaluate(study, p);
    expect(study.trials).toHaveLength(9);
    expect(study.status).toBe('complete');
    expect(snapshots.slice(0, -1).every((s) => s === 'partial')).toBe(true);
    expect(p.assertFrozen).toHaveBeenCalledTimes(10);
  });
  it('retains work after a killed trial and resumes without rerunning completed trials', async () => {
    const study = sampleStudy(),
      p = ports();
    let calls = 0;
    p.trial = async (_e, b, r) => {
      if (++calls === 2) throw new Error('Provider outage');
      return sampleTrial({ baseline: b, repeat: r });
    };
    await evaluate(study, p);
    expect(study.status).toBe('partial');
    expect(study.trials).toHaveLength(1);
    expect(study.inFlight?.baseline).toBe('B2');
    const resumed = ports();
    await evaluate(study, resumed);
    expect(resumed.trial).toHaveBeenCalledTimes(2);
    expect(study.trials).toHaveLength(3);
    expect(study.status).toBe('complete');
  });
  it('records exclusion reasons and never runs excluded inputs', async () => {
    const study = sampleStudy(),
      p = ports();
    p.assertFrozen = async () => {
      throw new Error('hash mismatch');
    };
    p.admit = async () => ({
      id: 'x',
      admissible: false,
      reason: 'modified after freezing',
      beforePassed: 0,
      beforeTotal: 0,
      afterPassed: 0,
      afterTotal: 0,
    });
    await evaluate(study, p);
    expect(p.trial).not.toHaveBeenCalled();
    expect(renderEvaluationReport(study, 'Limits')).toContain('modified after freezing');
  });
  it('stops on signals or container errors and preserves incomplete trial evidence', async () => {
    const study = sampleStudy(),
      p = ports();
    p.trial = async () =>
      sampleTrial({ completed: false, outcome: 'stage_failure', reason: 'Container unavailable' });
    await evaluate(study, p);
    expect(study.trials).toHaveLength(1);
    expect(study.stopReason).toBe('Container unavailable');
    p.interrupted = () => true;
    await evaluate(study, p);
    expect(study.stopReason).toBe('Interrupted by signal');
  });
  it('refuses changed inputs on resume even when their trial is already complete', async () => {
    const study = sampleStudy();
    study.trials.push(sampleTrial());
    const p = ports();
    p.assertFrozen = async () => {
      throw new Error('hash');
    };
    await evaluate(study, p);
    expect(study.stopReason).toContain('changed after trials');
    expect(p.trial).not.toHaveBeenCalled();
  });
  it('writes the file before a failing mirror; reload and report use exactly that snapshot', async () => {
    const root = await mkdtemp(join(tmpdir(), 'eval-test-'));
    temps.push(root);
    const study = sampleStudy();
    study.trials.push(sampleTrial());
    await expect(
      saveStudy(root, study, async () => {
        throw new Error('db down');
      }),
    ).rejects.toThrow('db down');
    expect(await readStudy(root, 'test')).toEqual(study);
    await writeReport(root, 'test');
    expect(await readFile(join(root, 'test/report.md'), 'utf8')).toContain('PARTIAL RESULTS');
    const unlock = await lockStudy(root, 'test');
    await expect(lockStudy(root, 'test')).rejects.toThrow('active writer');
    await unlock();
    expect(() => studyDirectory(root, '../escape')).toThrow();
  });
  it('prints unreviewed passes as pending, then updates false confidence on review', () => {
    const study = sampleStudy();
    study.trials.push(sampleTrial({ baseline: 'B2', outcome: 'repaired', patch: 'diff' }));
    expect(renderEvaluationReport(study, 'Known limits')).toContain('1 not yet reviewed');
    study.trials[0]!.review = {
      verdict: 'incorrect',
      name: 'R',
      note: 'wrong semantics',
      at: study.startedAt,
    };
    expect(renderEvaluationReport(study, 'Known limits')).toContain('100.0%');
    expect(renderEvaluationReport(study, 'Known limits')).toContain('wrong semantics');
  });
  it('shows repair-rate denominators, B1 refusal n/a, wrong actions, cheats by category and stop reasons', () => {
    const study = sampleStudy();
    study.trials.push(
      sampleTrial({ baseline: 'B1', expected: 'refuse', category: 'endpoint_removed' }),
      sampleTrial({
        baseline: 'B3',
        outcome: 'repaired',
        patch: 'diff',
        stopReasons: ['end_turn'],
      }),
      sampleTrial({
        baseline: 'B3',
        scenarioId: 'y',
        outcome: 'failed',
        stopReasons: ['max_tokens', 'end_turn'],
      }),
      sampleTrial({
        baseline: 'B3',
        scenarioId: 'z',
        expected: 'refuse',
        category: 'endpoint_removed',
        outcome: 'repaired',
        patch: 'diff',
      }),
      sampleTrial({
        baseline: 'B3',
        scenarioId: 'c',
        category: 'field_type_changed',
        outcome: 'cheating_rejected',
        guard: 'type_suppression',
      }),
    );
    study.modelCalls = { total: 4, maxTokensStops: 1, stopReasons: { end_turn: 3, max_tokens: 1 } };
    const report = renderEvaluationReport(study, 'Known limits');
    expect(report).toContain(
      '| Repair rate (passed validation, expected-repair scenarios) | 33.3% (1/3) |',
    );
    expect(report).toContain('| Refusal correctness | n/a (B1 makes no decision) |');
    expect(report).toContain('| Refusal correctness | 0.0% (0/1) |');
    expect(report).toContain('| Wrong actions (repaired a refusal scenario) | 1 |');
    expect(report).toContain('| field_type_changed | type_suppression | 1 |');
    expect(report).toContain('Wrong action: repaired a refusal scenario');
    expect(report).toContain('maxOutputTokens 16000; effort high');
    expect(report).toContain('stopped at max_tokens (truncated): **1**');
    expect(report).toContain('| Trials with a truncated answer | y r1 |');
    study.trials[2]!.calls = [
      {
        stopReason: 'max_tokens',
        tokensIn: 900,
        tokensOut: 16000,
        costUsd: 0.1618,
        durationMs: 98765.4,
      },
    ];
    expect(renderEvaluationReport(study, 'Known limits')).toContain(
      '| y | 1 | 1 | max_tokens | 900 | 16000 | 98765 | 0.161800 |',
    );
  });
  it('defaults to a $50 budget and estimates with the configured output limit', () => {
    expect(DEFAULT_MAX_COST_USD).toBe(50);
    expect(parseEvaluationArgs(['--label', 'x']).maxCost).toBe(50);
    expect(EVAL_MAX_OUTPUT_TOKENS).toBe(16000);
    expect(estimateMaxCost(10, { input: 2, output: 10 }, 16000)).toBeCloseTo(
      (10 * (8000 * 2 + 16000 * 10)) / 1e6,
    );
    expect(estimateMaxCost(1, { input: 0, output: 10 }, 16000)).toBeGreaterThan(
      estimateMaxCost(1, { input: 0, output: 10 }, 4096),
    );
  });
  it('validates CLI choices and never implies paid authorization', () => {
    expect(parseEvaluationArgs(['--label', 'x']).yes).toBe(false);
    expect(parseEvaluationArgs(['--label', 'x', '--repeat', '3', '--max-cost', '0']).repeat).toBe(
      3,
    );
    for (const args of [
      [],
      ['--label', '../x'],
      ['--label', 'x', '--baselines', 'B2,B2'],
      ['--label', 'x', '--max-cost', 'NaN'],
      ['--label', 'x', '--repeat', '2'],
    ])
      expect(() => parseEvaluationArgs(args)).toThrow();
  });
});
describe('cost guard', () => {
  const opts = { maxOutputTokens: 100, timeoutMs: 1000 };
  it('bounds bytes plus protocol allowance and output tokens', () => {
    expect(maximumCallCost(context, opts, { input: 2, output: 10 })).toBe((8202 * 2 + 1000) / 1e6);
  });
  it('blocks before a provider call that could exceed the budget', async () => {
    const study = sampleStudy();
    study.fake = false;
    study.config.maxCost = 0;
    const inner = new FakeLlmAdapter([]),
      save = vi.fn(async () => {});
    const adapter = new BudgetAdapter(inner, study, save, () => false);
    expect((await adapter.generatePatch(context, opts)).kind).toBe('error');
    expect(inner.calls).toHaveLength(0);
    expect(adapter.stopped).toContain('Cost limit');
  });
  it('reserves before calling and settles known usage while retaining uncertain requests', async () => {
    const study = sampleStudy();
    study.fake = false;
    const saves: number[] = [];
    const inner = new FakeLlmAdapter([
      {
        kind: 'refusal',
        reason: 'no',
        tokensIn: 10,
        tokensOut: 2,
        costUsd: 0.001,
        modelId: 'fake',
        durationMs: 50,
      },
      { kind: 'error', errorKind: 'timeout', message: 'timeout', durationMs: 100 },
    ]);
    const adapter = new BudgetAdapter(
      inner,
      study,
      async () => {
        saves.push(study.reservedUsd);
      },
      () => false,
    );
    await adapter.generatePatch(context, opts);
    expect(saves[0]).toBeGreaterThan(0);
    expect(study.spentUsd).toBe(0.001);
    expect(study.reservedUsd).toBe(0);
    await adapter.generatePatch(context, opts);
    expect(study.reservedUsd).toBeGreaterThan(0);
    expect(adapter.modelMs).toBe(150);
  });
  it('counts every call by stop reason and max_tokens stops separately', async () => {
    const study = sampleStudy();
    const usage = { tokensIn: 1, tokensOut: 1, costUsd: 0, modelId: 'm' };
    const reasons: string[] = [];
    const adapter = new BudgetAdapter(
      new FakeLlmAdapter([
        { kind: 'patch', patch: 'p', ...usage, durationMs: 1, stopReason: 'end_turn' },
        {
          kind: 'error',
          errorKind: 'invalid_output',
          message: 'truncated',
          durationMs: 1,
          usage,
          stopReason: 'max_tokens',
        },
        { kind: 'error', errorKind: 'timeout', message: 't', durationMs: 1 },
      ]),
      study,
      async () => {},
      () => false,
      (r) => reasons.push(r.kind),
    );
    for (let i = 0; i < 3; i++) await adapter.generatePatch(context, opts);
    expect(study.modelCalls).toEqual({
      total: 3,
      maxTokensStops: 1,
      stopReasons: { end_turn: 1, max_tokens: 1, no_response: 1 },
    });
    expect(reasons).toHaveLength(3);
  });
});
