import { createInterface } from 'node:readline/promises';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { reviewTrial } from '@sma/core';
import { createDbClient } from '../apps/server/src/infra/db/client.js';
import { loadRootEnv } from '../apps/server/src/infra/db/env.js';
import { saveEvaluationStudy } from '../apps/server/src/infra/db/evaluationStudyRepo.js';
import { lockStudy, readStudy, saveStudy } from './store.js';
import { writeReport } from './report.js';
const { values } = parseArgs({ options: { label: { type: 'string' }, name: { type: 'string' } } });
if (!values.label || !values.name?.trim())
  throw new Error('Usage: eval:review -- --label NAME --name REVIEWER');
loadRootEnv();
const root = fileURLToPath(new URL('./results', import.meta.url));
const unlock = await lockStudy(root, values.label);
const client = createDbClient();
const rl = createInterface({ input: process.stdin, output: process.stdout });
try {
  const study = await readStudy(root, values.label);
  for (const [index, trial] of study.trials.entries()) {
    if (
      !trial.completed ||
      trial.baseline === 'B1' ||
      trial.outcome !== 'repaired' ||
      !trial.patch ||
      trial.review
    )
      continue;
    console.log(
      `\n${trial.scenarioId} / ${trial.baseline} / repeat ${trial.repeat}\nMigration note:\n${trial.migrationNote || '(none)'}\n${trial.patch}`,
    );
    const verdict = (await rl.question('Verdict (correct / incorrect / quit): ')).trim();
    if (verdict === 'quit') break;
    if (!['correct', 'incorrect'].includes(verdict))
      throw new Error('Invalid verdict; no review recorded');
    const note = await rl.question('Review note: ');
    study.trials[index] = reviewTrial(
      trial,
      verdict as 'correct' | 'incorrect',
      values.name,
      note,
      new Date().toISOString(),
    );
    study.updatedAt = new Date().toISOString();
    await saveStudy(root, study, (s) => saveEvaluationStudy(client.db, s));
    await writeReport(root, study.label);
  }
  await saveStudy(root, study, (s) => saveEvaluationStudy(client.db, s));
  await writeReport(root, study.label);
} finally {
  rl.close();
  await client.close();
  await unlock();
}
