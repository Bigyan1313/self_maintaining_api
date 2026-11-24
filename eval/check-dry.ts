import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { readStudy } from './store.js';
const label = process.argv[2];
if (!label) throw new Error('Usage: tsx eval/check-dry.ts LABEL');
const study = await readStudy(fileURLToPath(new URL('./results', import.meta.url)), label);
assert.equal(study.fake, true);
assert.equal(study.status, 'complete');
assert.equal(study.admissions.length, 20);
assert.equal(
  study.admissions.every((a) => a.admissible),
  true,
);
const completed = study.trials.filter((t) => t.completed);
assert.equal(completed.length, 60 * study.config.repeat);
assert.equal(
  completed.filter((t) => t.baseline === 'B1').every((t) => t.outcome === 'failed'),
  true,
);
for (const baseline of ['B2', 'B3'])
  assert.equal(
    completed.find((t) => t.scenarioId === 'rename-shop-flat' && t.baseline === baseline)?.outcome,
    'repaired',
  );
assert.equal(
  completed.find((t) => t.scenarioId === 'param-shop-query' && t.baseline === 'B3')?.guard,
  'type_suppression',
);
assert.equal(study.spentUsd, 0);
console.log(
  'FakeLlm acceptance: 20 admitted, all B1 fail, scripted B2/B3 pass, B3 cheat caught, zero paid usage.',
);
