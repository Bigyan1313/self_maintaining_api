import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { EvaluationStudy } from '@sma/core';
import { sampleStudy, sampleTrial } from '../../eval/test-helpers.js';
import { Recorder } from './record.js';
import { STUDY_CONDITIONS, inspectStudy, judgeStudy } from './study-evidence.js';

const REVIEW = {
  verdict: 'correct' as const,
  name: 'Bigyan',
  note: 'ok',
  at: '2026-11-28T00:00:00.000Z',
};

/** A study meeting every AT-12 condition: live, complete, 3 repeats, all passes reviewed. */
function goodStudy(): EvaluationStudy {
  const trials = (['B1', 'B2', 'B3'] as const).flatMap((baseline) =>
    ([1, 2, 3] as const).map((repeat) =>
      sampleTrial({
        baseline,
        repeat,
        ...(baseline === 'B1' ? {} : { outcome: 'repaired', patch: 'diff', review: REVIEW }),
      }),
    ),
  );
  return {
    ...sampleStudy(),
    label: 'live-final',
    status: 'complete',
    fake: false,
    config: { baselines: ['B1', 'B2', 'B3'], scenarioIds: ['x'], repeat: 3, maxCost: 5 },
    environment: { ...sampleStudy().environment, modelId: 'claude-opus-5-5' },
    trials,
  };
}

/** Verdict a Recorder gives after recording this evidence the way AT-12 does. */
function verdictOf(evidence: ReturnType<typeof judgeStudy>) {
  const r = new Recorder({ id: 'AT-12', title: 't', requirements: 'r', inputs: [] });
  r.check('suite passed', true);
  for (const m of evidence.met) r.check(m, true);
  for (const g of evidence.missing) r.skip(g.item, g.reason);
  return r.verdict();
}

describe('judgeStudy', () => {
  it('passes a live, complete, 3-repeat study whose passes all have named reviews', () => {
    const result = judgeStudy(goodStudy());
    expect(result.missing).toEqual([]);
    expect(result.met).toEqual(Object.values(STUDY_CONDITIONS));
    expect(verdictOf(result)).toBe('PASS');
  });

  it('reports a fake study as missing live evidence (PARTIAL, not FAIL)', () => {
    const result = judgeStudy({ ...goodStudy(), fake: true });
    expect(result.missing).toEqual([
      { item: STUDY_CONDITIONS.live, reason: expect.stringContaining('fake model adapter') },
    ]);
    expect(verdictOf(result)).toBe('PARTIAL');
  });

  it('reports a partial study with its stop reason', () => {
    const result = judgeStudy({ ...goodStudy(), status: 'partial', stopReason: 'budget reached' });
    expect(result.missing).toHaveLength(1);
    expect(result.missing[0]?.item).toBe(STUDY_CONDITIONS.complete);
    expect(result.missing[0]?.reason).toContain('budget reached');
  });

  it('treats a subset of baselines or an unfinished trial as incomplete', () => {
    const s = goodStudy();
    const subset = judgeStudy({ ...s, config: { ...s.config, baselines: ['B3'] } });
    expect(subset.missing.map((m) => m.item)).toContain(STUDY_CONDITIONS.complete);
    const unfinished = judgeStudy({
      ...s,
      trials: [...s.trials, sampleTrial({ completed: false })],
    });
    expect(unfinished.missing[0]?.reason).toContain('1 trial(s) not completed');
  });

  it('requires 3 repeats configured and present', () => {
    const s = goodStudy();
    const one = judgeStudy({
      ...s,
      config: { ...s.config, repeat: 1 },
      trials: s.trials.filter((t) => t.repeat === 1),
    });
    expect(one.missing).toEqual([
      { item: STUDY_CONDITIONS.repeats, reason: 'configured repeat 1; repeats present: 1' },
    ]);
    const gap = judgeStudy({ ...s, trials: s.trials.filter((t) => t.repeat !== 2) });
    expect(gap.missing.map((m) => m.item)).toEqual([STUDY_CONDITIONS.repeats]);
  });

  it('names every B2/B3 validation pass that lacks a named review; B1 needs none', () => {
    const s = goodStudy();
    const trials = s.trials.map((t) =>
      t.baseline === 'B3' && t.repeat === 2 ? { ...t, review: null } : t,
    );
    const result = judgeStudy({ ...s, trials });
    expect(result.missing).toEqual([
      {
        item: STUDY_CONDITIONS.reviewed,
        reason: '1 of 6 B2/B3 validation passes lack a named review: x/B3/r2',
      },
    ]);
    expect(verdictOf(result)).toBe('PARTIAL');
  });
});

describe('inspectStudy', () => {
  const roots: string[] = [];
  afterEach(() => {
    for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
  });
  function repo(label?: string, content?: string): string {
    const root = mkdtempSync(join(tmpdir(), 'sma-at12-'));
    roots.push(root);
    if (label && content !== undefined) {
      mkdirSync(join(root, 'eval/results', label), { recursive: true });
      writeFileSync(join(root, 'eval/results', label, 'results.json'), content);
    }
    return root;
  }
  const allMissing = (r: ReturnType<typeof inspectStudy>, text: string) => {
    expect(r.met).toEqual([]);
    expect(r.missing).toHaveLength(4);
    for (const m of r.missing) expect(m.reason).toContain(text);
  };

  it('is PARTIAL with a clear reason when SMA_EVAL_LABEL is unset', () => {
    allMissing(inspectStudy(repo(), undefined), 'SMA_EVAL_LABEL is not set');
  });

  it('rejects a traversal label without reading outside eval/results', () => {
    allMissing(inspectStudy(repo(), '../secrets'), 'is not a valid label');
  });

  it('reports a missing, malformed or off-schema results file', () => {
    allMissing(inspectStudy(repo(), 'nope'), 'eval/results/nope/results.json does not exist');
    allMissing(inspectStudy(repo('bad', '{'), 'bad'), 'is not valid JSON');
    allMissing(inspectStudy(repo('odd', '{"x":1}'), 'odd'), 'does not match');
  });

  it('reads the named study and records its provenance', () => {
    const root = repo('live-final', JSON.stringify(goodStudy()));
    const result = inspectStudy(root, 'live-final');
    expect(result.missing).toEqual([]);
    expect(result.source).toMatchObject({
      path: 'eval/results/live-final/results.json',
      modelId: 'claude-opus-5-5',
      sha256: expect.stringMatching(/^[0-9a-f]{64}$/),
    });
  });
});
