/** Acceptance evidence from real regression suites, with external boundaries stated explicitly. */
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { CheckDef } from './checks.js';
import type { Recorder } from './record.js';
import { EVAL_LABEL_ENV, inspectStudy } from './study-evidence.js';

/**
 * What a suite records beyond its tests: either a fixed statement of the end-to-end evidence it
 * cannot produce (always a NOT RUN item), or a function that checks real evidence.
 */
type Beyond = string | ((r: Recorder, root: string) => void);

function suite(
  id: string,
  title: string,
  requirements: string,
  group: string,
  paths: string[],
  beyond: Beyond,
  extraInputs: string[] = [],
): CheckDef {
  return {
    info: {
      id,
      title,
      requirements,
      procedure:
        'Execute the named regression suites and inspect assertion results; record unexecuted end-to-end requirements separately.',
      inputs: [
        group,
        ...paths,
        'Scripted LLM responses and controlled GitHub ports; no paid model call or live PR is implied.',
        ...extraInputs,
      ],
    },
    async run(r, ctx) {
      const output = join(ctx.tmp, `${id}-vitest.json`);
      const args = ['run', ...paths, '--reporter=json', `--outputFile=${output}`];
      r.step(`vitest ${args.join(' ')} (cwd ${group})`);
      const result = spawnSync(join(ctx.root, 'node_modules/.bin/vitest'), args, {
        cwd: join(ctx.root, group),
        encoding: 'utf8',
        maxBuffer: 16 * 1024 * 1024,
        env: process.env,
      });
      r.show('stdout', result.stdout);
      r.show('stderr', result.stderr);
      r.check('test process exited successfully', result.status === 0, result.status);
      const report = JSON.parse(readFileSync(output, 'utf8')) as {
        numPassedTests: number;
        numTotalTests: number;
        numPendingTests: number;
        testResults: { name: string; assertionResults: { fullName: string; status: string }[] }[];
      };
      r.check(
        'at least one test assertion passed',
        report.numPassedTests > 0,
        report.numPassedTests,
      );
      for (const file of report.testResults)
        for (const assertion of file.assertionResults) {
          if (
            assertion.status === 'pending' ||
            assertion.status === 'skipped' ||
            assertion.status === 'todo'
          )
            r.skip(assertion.fullName, 'Vitest did not execute this check in this environment');
          else r.check(assertion.fullName, assertion.status === 'passed', assertion.status);
        }
      if (typeof beyond === 'string') r.skip('Full Appendix A end-to-end evidence', beyond);
      else beyond(r, ctx.root);
    },
  };
}

/**
 * AT-12's end-to-end part: inspects the study named by `SMA_EVAL_LABEL`. Each condition that holds
 * is a passed assertion; each one that does not is NOT RUN with exactly what is missing, so the
 * check is PARTIAL rather than FAIL or PASS.
 */
function recordStudyEvidence(r: Recorder, root: string): void {
  const label = process.env[EVAL_LABEL_ENV];
  r.step(`inspect evaluation study ${EVAL_LABEL_ENV}=${label ?? '(unset)'}`);
  const evidence = inspectStudy(root, label);
  if (evidence.source) r.show('study', evidence.source);
  for (const name of evidence.met) r.check(name, true);
  for (const gap of evidence.missing) r.skip(gap.item, gap.reason);
}

/** Additional checks introduced once repair, delivery and orchestration are implemented. */
export const ADDITIONAL_CHECKS: readonly CheckDef[] = [
  suite(
    'AT-06',
    'Repair loop',
    'FR-18 to FR-23, FR-25, FR-26',
    'apps/server',
    ['test/repair.test.ts', 'test/repair.integration.test.ts'],
    'The real Docker rename workflow uses scripted model answers. Live model effectiveness and dashboard review are separate evidence.',
  ),
  suite(
    'AT-08',
    'Records, delivery and export',
    'FR-33 to FR-35, FR-38 to FR-42; DR-01 to DR-03',
    'apps/server',
    ['test/orchestrator.test.ts', 'test/export.test.ts', 'test/deliver.test.ts'],
    'GitHub delivery uses a controlled port in these suites. Inspect the live PR smoke record and dashboard screenshots separately; no new live PR was created by this check.',
  ),
  suite(
    'AT-10',
    'Context and data protection',
    'FR-19; NFR-04, NFR-08',
    'apps/server',
    [
      'test/llm.test.ts',
      'test/llm-boundary.test.ts',
      'test/repair.test.ts',
      'test/deliver.test.ts',
      'test/export.test.ts',
    ],
    'These assertions exercise planted inputs and adapter boundaries; they do not establish end-to-end resistance to arbitrary prompt injection by a live provider.',
  ),
  suite(
    'AT-12',
    'Evaluation readiness',
    'EV-01 to EV-09; NFR-01, NFR-05, NFR-07, NFR-09',
    'eval',
    [],
    recordStudyEvidence,
    [
      `The evaluation study named by ${EVAL_LABEL_ENV} (eval/results/<label>/results.json): live, complete, 3 repeats, every B2/B3 validation pass reviewed by a named person.`,
    ],
  ),
];
