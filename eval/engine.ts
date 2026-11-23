import type { EvaluationStudy, EvaluationTrial, Baseline } from '@sma/core';
import type { ManifestEntry } from '../scenarios/types.js';
/** Injectable boundaries make crash, outage, budget and resume behavior testable offline. */
export interface EvaluationPorts {
  assertFrozen(entry: ManifestEntry): Promise<void>;
  admit(entry: ManifestEntry): Promise<EvaluationStudy['admissions'][number]>;
  trial(entry: ManifestEntry, baseline: Baseline, repeat: number): Promise<EvaluationTrial>;
  save(): Promise<void>;
  interrupted(): boolean;
}
/** Checkpoint before every trial and after every result; partial is the default until all finish. */
export async function evaluate(study: EvaluationStudy, ports: EvaluationPorts): Promise<void> {
  study.status = 'partial';
  study.stopReason = 'Evaluation in progress';
  await ports.save();
  try {
    for (const entry of study.manifest) {
      if (!study.config.scenarioIds.includes(entry.id)) continue;
      // On resume, even already-completed cases are rechecked for tampering.
      try {
        await ports.assertFrozen(entry);
      } catch {
        if (study.trials.some((t) => t.scenarioId === entry.id))
          throw new Error(`${entry.id}: frozen input changed after trials were recorded`);
      }
      if (!study.admissions.some((a) => a.id === entry.id)) {
        if (ports.interrupted()) throw new Error('Interrupted by signal');
        study.admissions.push(await ports.admit(entry));
        await ports.save();
      }
    }
    for (let repeat = 1; repeat <= study.config.repeat; repeat++) {
      for (const entry of study.manifest.filter(
        (e) =>
          study.config.scenarioIds.includes(e.id) &&
          study.admissions.some((a) => a.id === e.id && a.admissible),
      )) {
        for (const baseline of study.config.baselines) {
          if (
            study.trials.some(
              (t) =>
                t.scenarioId === entry.id &&
                t.baseline === baseline &&
                t.repeat === repeat &&
                t.completed,
            )
          )
            continue;
          if (ports.interrupted()) throw new Error('Interrupted by signal');
          await ports.assertFrozen(entry);
          study.inFlight = { scenarioId: entry.id, baseline, repeat };
          await ports.save();
          const trial = await ports.trial(entry, baseline, repeat);
          const recorded = study.trials.findIndex((t) => t.id === trial.id);
          if (recorded < 0) study.trials.push(trial);
          else study.trials[recorded] = trial;
          study.inFlight = null;
          await ports.save();
          if (!trial.completed) throw new Error(trial.reason);
        }
      }
    }
    study.inFlight = null;
    study.status = 'complete';
    study.stopReason = null;
  } catch (e) {
    study.stopReason = e instanceof Error ? e.message : 'Evaluation interrupted';
  }
  await ports.save();
}
