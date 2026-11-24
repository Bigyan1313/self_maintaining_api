import { readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  CLASSIFICATIONS,
  evaluationFailures,
  evaluationVariations,
  ratio,
  reviewedRepair,
  isPartialEvaluation,
  summarizeEvaluation,
  type EvaluationStudy,
} from '@sma/core';
import { readStudy, studyDirectory } from './store.js';
const cell = (x: unknown) =>
  String(x ?? 'n/a')
    .replaceAll('|', '\\|')
    .replaceAll('\n', ' ');
const table = (headers: string[], rows: unknown[][]) =>
  `| ${headers.join(' | ')} |\n| ${headers.map(() => '---').join(' | ')} |\n${rows.map((row) => `| ${row.map(cell).join(' | ')} |`).join('\n')}\n`;
const rate = (value: number | null) => (value === null ? 'n/a' : `${(value * 100).toFixed(1)}%`);
/** Generate all Section 6.4 tables strictly from the saved artifact, with explicit denominators. */
export function renderEvaluationReport(study: EvaluationStudy, limitations: string): string {
  const output = [
    `# Evaluation: ${study.label}`,
    isPartialEvaluation(study)
      ? `**PARTIAL RESULTS** — ${study.stopReason ?? 'Selected subset; the full twenty-scenario, three-baseline study was not requested'}`
      : 'Completed selected evaluation matrix.',
    study.fake
      ? '**FAKE MODEL DRY TEST — infrastructure evidence only; not model performance.**'
      : `Model: ${study.environment.modelId}`,
    `Selected scenarios: ${study.config.scenarioIds.length}/20; baselines: ${study.config.baselines.join(', ')}; repeats: ${study.config.repeat}.`,
    `Git: ${study.environment.gitCommit}; Node: ${study.environment.node}; oasdiff: ${study.environment.oasdiff}; image: ${study.environment.image}.`,
    `Recorded model spend: $${study.spentUsd.toFixed(6)}; uncertain/reserved spend: $${study.reservedUsd.toFixed(6)}.`,
    `Model request settings: maxOutputTokens ${study.environment.maxOutputTokens}; effort ${study.environment.effort}.`,
    `Model calls: ${study.modelCalls.total}; stopped at max_tokens (truncated): **${study.modelCalls.maxTokensStops}**; stop reasons: ${
      Object.entries(study.modelCalls.stopReasons)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([reason, n]) => `${reason} ${n}`)
        .join(', ') || 'none'
    }.`,
    'Repair rate (SRS 6.4) is counted only over scenarios that expect a repair (17 of 20): a trial counts when it passed validation AND its scenario expects a repair. A "repaired" refusal scenario is a wrong action: it fails refusal correctness and is listed under failures. B1 makes no decision, so its refusal correctness is n/a. Cost/time per repair divide by counted repairs.',
    'Repair rate (SRS 6.4) means passed validation, not semantic correctness. Correct repair requires human review. Unreviewed passes remain pending. Cost/time per validation pass include all completed trials, including failures. Container time includes dependency installation and validator orchestration; admission time is outside trial timing.',
  ];
  const excluded = study.admissions.filter((a) => !a.admissible);
  output.push(
    '## Excluded scenarios',
    excluded.length
      ? table(
          ['Scenario', 'Reason'],
          excluded.map((a) => [a.id, a.reason]),
        )
      : 'None.',
  );
  for (const baseline of study.config.baselines) {
    const summary = summarizeEvaluation(study, baseline);
    const trials = study.trials.filter((t) => t.baseline === baseline && t.completed);
    const passed = trials.filter((t) => t.outcome === 'repaired');
    const reviewed = passed.filter((t) => t.review);
    const detection = CLASSIFICATIONS.map((c) => {
      const counts = trials.flatMap((t) => (t.detection ? [t.detection[c]] : []));
      const tp = counts.reduce((s, x) => s + x.tp, 0),
        fp = counts.reduce((s, x) => s + x.fp, 0),
        fn = counts.reduce((s, x) => s + x.fn, 0);
      return [c, tp, fp, fn, rate(ratio(tp, tp + fp)), rate(ratio(tp, tp + fn))];
    });
    output.push(
      `## ${baseline}`,
      '### Detection (B1 does not run detection)',
      table(['Class', 'TP', 'FP', 'FN', 'Precision', 'Recall'], detection),
    );
    output.push(
      '### Repair and refusal',
      table(
        ['Metric', 'Value'],
        [
          ['Completed trials', trials.length],
          [
            'Validation passes (not correctness)',
            `${passed.length}/${trials.length} completed trials`,
          ],
          [
            'Repair rate (passed validation, expected-repair scenarios)',
            `${rate(summary.repairRate)} (${summary.repairCounts.repaired}/${summary.repairCounts.eligible})`,
          ],
          ['Human-reviewed correct repairs', trials.filter(reviewedRepair).length],
          [
            'Refusal correctness',
            summary.refusalCounts === null
              ? 'n/a (B1 makes no decision)'
              : `${rate(summary.refusalCorrectness)} (${summary.refusalCounts.correct}/${summary.refusalCounts.total})`,
          ],
          ['Wrong actions (repaired a refusal scenario)', summary.wrongActions],
          [
            'False confidence: incorrect validation passes',
            reviewed.filter((t) => t.review?.verdict === 'incorrect').length,
          ],
          [
            'Review coverage',
            `${reviewed.length}/${passed.length}; ${passed.length - reviewed.length} not yet reviewed`,
          ],
          [
            'False-confidence rate',
            summary.falseConfidence === null
              ? 'not yet reviewed / no validation passes'
              : rate(summary.falseConfidence),
          ],
        ],
      ),
      table(
        ['Category', 'Repair rate (passed validation)'],
        summary.repairRateByCategory.map((x) => [
          x.category,
          `${rate(x.rate)} (${x.repaired}/${x.eligible})`,
        ]),
      ),
    );
    output.push(
      '### Attempts for validation passes',
      table(
        ['Attempts', 'Count'],
        summary.attemptsDistribution.map((x) => [x.attempts, x.count]),
      ),
    );
    output.push(
      '### Cheat attempts caught, by guard',
      table(
        ['Guard', 'Count'],
        summary.cheatRejections.map((g) => [g.guard, g.count]),
      ),
      '### Cheat attempts caught, by change category and guard',
      table(
        ['Category', 'Guard', 'Count'],
        summary.cheatRejectionsByCategory.map((g) => [g.category, g.guard, g.count]),
      ),
    );
    const truncated = trials.filter((t) => t.stopReasons.includes('max_tokens'));
    output.push(
      '### Model stop reasons',
      table(
        ['Metric', 'Value'],
        [
          ['Model calls', trials.reduce((n, t) => n + t.stopReasons.length, 0)],
          [
            'Answers stopped at max_tokens (truncated)',
            trials.reduce((n, t) => n + t.stopReasons.filter((r) => r === 'max_tokens').length, 0),
          ],
          [
            'Trials with a truncated answer',
            truncated.map((t) => `${t.scenarioId} r${t.repeat}`).join(', ') || 'none',
          ],
        ],
      ),
    );
    output.push(
      '### Cost and time',
      table(
        ['Metric', 'Value'],
        [
          [
            'Input/output tokens',
            `${trials.reduce((s, t) => s + t.tokensIn, 0)}/${trials.reduce((s, t) => s + t.tokensOut, 0)}`,
          ],
          ['Total cost USD', trials.reduce((s, t) => s + t.costUsd, 0).toFixed(6)],
          [
            'Input tokens per validation pass',
            ratio(
              trials.reduce((s, t) => s + t.tokensIn, 0),
              passed.length,
            ),
          ],
          [
            'Output tokens per validation pass',
            ratio(
              trials.reduce((s, t) => s + t.tokensOut, 0),
              passed.length,
            ),
          ],
          ['Total wall ms', trials.reduce((s, t) => s + t.durationMs, 0)],
          ['Total model ms', trials.reduce((s, t) => s + t.modelMs, 0)],
          ['Total container ms', trials.reduce((s, t) => s + t.containerMs, 0)],
          ['USD per validation pass', summary.costPerRepairUsd],
          ['Wall ms per validation pass', summary.timePerRepairMs],
          ['Model ms per validation pass', summary.modelTimePerRepairMs],
          ['Container ms per validation pass', summary.containerTimePerRepairMs],
        ],
      ),
    );
    const categories = summary.repairRateByCategory.filter((x) => x.rate !== null);
    const worst = Math.min(...categories.map((x) => x.rate!));
    output.push(
      `Worst categories by validation pass rate: ${
        categories
          .filter((x) => x.rate === worst)
          .map((x) => x.category)
          .join(', ') || 'n/a'
      }.`,
    );
  }
  output.push(
    '## Failures and pending reviews',
    table(
      ['Scenario', 'Baseline', 'Repeat', 'Category', 'Reason'],
      evaluationFailures(study).map((f) => [
        f.scenarioId,
        f.baseline,
        f.repeat,
        f.category,
        f.reason,
      ]),
    ),
  );
  output.push(
    '## Repeat variability',
    table(
      ['Scenario/baseline', 'Observed outcomes'],
      evaluationVariations(study).map((x) => [x.trial, x.outcomes.join(', ')]),
    ),
  );
  output.push('## Limitations', limitations.trim());
  return output.join('\n\n') + '\n';
}
/** Read JSON first so report regeneration cannot use unpersisted in-memory results. */
export async function writeReport(root: string, label: string): Promise<void> {
  const study = await readStudy(root, label);
  const limitations = await readFile(new URL('./limitations.md', import.meta.url), 'utf8');
  await writeFile(
    join(studyDirectory(root, label), 'report.md'),
    renderEvaluationReport(study, limitations),
  );
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  if (args.length !== 2 || args[0] !== '--label')
    throw new Error('Usage: eval:report -- --label NAME');
  await writeReport(fileURLToPath(new URL('./results', import.meta.url)), args[1]!);
}
