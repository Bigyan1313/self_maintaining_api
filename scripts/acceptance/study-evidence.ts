/**
 * AT-12 evaluation-study evidence. Reads the study named by `SMA_EVAL_LABEL` from
 * `eval/results/<label>/results.json` and decides, from that file alone, whether it is the
 * reviewed live study Appendix A asks for. Every unmet condition is reported as missing evidence
 * (PARTIAL), never silently passed.
 *
 * @packageDocumentation
 */
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { EvaluationStudySchema, isPartialEvaluation, type EvaluationStudy } from '@sma/core';
import type { NotRun } from './record.js';

/** Environment variable naming the evaluation study AT-12 inspects. */
export const EVAL_LABEL_ENV = 'SMA_EVAL_LABEL';

/** Same label rule as the study schema; also rules out path traversal. */
const LABEL = /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,79}$/;

/** Outcome of inspecting one study: conditions that held and conditions that did not. */
export interface StudyEvidence {
  /** Conditions that held, in check order. */
  met: string[];
  /** Conditions that did not hold, each with exactly what is missing. */
  missing: NotRun[];
  /** Provenance of the inspected file, when one was read. */
  source?: { path: string; sha256: string; gitCommit: string; modelId: string };
}

/** The condition names, so the transcript and the tests use the same wording. */
export const STUDY_CONDITIONS = {
  live: 'evaluation study used a live model (not the fake adapter)',
  complete: 'evaluation study is complete (all scenarios and baselines B1, B2, B3)',
  repeats: 'evaluation study ran 3 repeats',
  reviewed: 'every B2/B3 validation pass has a named human review',
} as const;

/**
 * Judges a parsed study against the AT-12 conditions. Pure: no file or network access.
 * @param study - A study already validated by {@link EvaluationStudySchema}.
 * @returns The conditions met and missing.
 */
export function judgeStudy(study: EvaluationStudy): Pick<StudyEvidence, 'met' | 'missing'> {
  const met: string[] = [];
  const missing: NotRun[] = [];
  const need = (name: string, ok: boolean, reason: string) =>
    ok ? met.push(name) : missing.push({ item: name, reason });

  need(
    STUDY_CONDITIONS.live,
    !study.fake,
    `study "${study.label}" was produced by the fake model adapter`,
  );

  const incomplete: string[] = [];
  if (study.status !== 'complete')
    incomplete.push(
      `status is "${study.status}"${study.stopReason ? ` (${study.stopReason})` : ''}`,
    );
  if (isPartialEvaluation(study))
    incomplete.push(
      `${study.config.scenarioIds.length}/${study.manifest.length} scenarios and baselines ${study.config.baselines.join(', ')} selected`,
    );
  const unfinished = study.trials.filter((t) => !t.completed).length;
  if (unfinished) incomplete.push(`${unfinished} trial(s) not completed`);
  if (study.inFlight) incomplete.push('a trial is still in flight');
  need(STUDY_CONDITIONS.complete, incomplete.length === 0, incomplete.join('; '));

  const seen = new Set(study.trials.map((t) => t.repeat));
  const allRepeats = study.config.repeat === 3 && [1, 2, 3].every((n) => seen.has(n));
  need(
    STUDY_CONDITIONS.repeats,
    allRepeats,
    `configured repeat ${study.config.repeat}; repeats present: ${[...seen].sort().join(', ') || 'none'}`,
  );

  const passes = study.trials.filter(
    (t) => t.baseline !== 'B1' && t.completed && t.outcome === 'repaired',
  );
  const unreviewed = passes.filter((t) => !t.review || !t.review.name.trim());
  need(
    STUDY_CONDITIONS.reviewed,
    unreviewed.length === 0,
    `${unreviewed.length} of ${passes.length} B2/B3 validation passes lack a named review: ${unreviewed
      .map((t) => `${t.scenarioId}/${t.baseline}/r${t.repeat}`)
      .join(', ')}`,
  );
  return { met, missing };
}

/**
 * Reads and judges the study named by {@link EVAL_LABEL_ENV}.
 * @param root - Repository root.
 * @param label - Value of `SMA_EVAL_LABEL` (may be unset).
 * @returns What held, what is missing, and the file's provenance.
 */
export function inspectStudy(root: string, label: string | undefined): StudyEvidence {
  const all = Object.values(STUDY_CONDITIONS);
  const missingAll = (reason: string): StudyEvidence => ({
    met: [],
    missing: all.map((item) => ({ item, reason })),
  });
  if (!label) return missingAll(`${EVAL_LABEL_ENV} is not set; no evaluation study was named`);
  if (!LABEL.test(label)) return missingAll(`${EVAL_LABEL_ENV}="${label}" is not a valid label`);
  const rel = `eval/results/${label}/results.json`;
  const path = join(root, rel);
  if (!existsSync(path)) return missingAll(`${rel} does not exist`);
  const bytes = readFileSync(path);
  let parsed: ReturnType<typeof EvaluationStudySchema.safeParse>;
  try {
    parsed = EvaluationStudySchema.safeParse(JSON.parse(bytes.toString('utf8')));
  } catch {
    return missingAll(`${rel} is not valid JSON`);
  }
  if (!parsed.success) return missingAll(`${rel} does not match the evaluation study schema`);
  return {
    ...judgeStudy(parsed.data),
    source: {
      path: rel,
      sha256: createHash('sha256').update(bytes).digest('hex'),
      gitCommit: parsed.data.environment.gitCommit,
      modelId: parsed.data.environment.modelId,
    },
  };
}
