import { execFile } from 'node:child_process';
import { access, readFile } from 'node:fs/promises';
import { cpus, totalmem } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createInterface } from 'node:readline/promises';
import { promisify, parseArgs } from 'node:util';
import { BASELINES, EvaluationStudySchema, type EvaluationStudy } from '@sma/core';
import { createDbClient } from '../apps/server/src/infra/db/client.js';
import { loadRootEnv } from '../apps/server/src/infra/db/env.js';
import { saveEvaluationStudy } from '../apps/server/src/infra/db/evaluationStudyRepo.js';
import { VALIDATOR_IMAGE } from '../apps/server/src/infra/validator/image.js';
import { OASDIFF_VERSION } from '../apps/server/src/infra/oasdiff/version.js';
import { knownSecrets, scrubText } from '../apps/server/src/pipeline/run-detail.js';
import { LLM_EFFORT } from '../apps/server/src/infra/llm/adapter.js';
import { readManifest, assertFrozen } from '../scenarios/integrity.js';
import { admit, runTrial } from './runtime.js';
import { evaluate } from './engine.js';
import { lockStudy, readStudy, saveStudy, studyDirectory } from './store.js';
import { writeReport } from './report.js';
const exec = promisify(execFile);
/**
 * Output-token limit for every evaluation model call: the largest value that is safe for a
 * non-streaming request (larger values need streaming to avoid HTTP timeouts).
 */
export const EVAL_MAX_OUTPUT_TOKENS = 16_000;
/** Default hard spending limit for one evaluation, USD (`--max-cost`). */
export const DEFAULT_MAX_COST_USD = 50;
/** Assumed input tokens per call for the printed upper-bound estimate (prompts vary). */
export const ESTIMATE_INPUT_TOKENS = 8000;
/**
 * Upper-bound model cost for `calls` calls at the configured output limit.
 * @param calls - Maximum number of model calls.
 * @param pricing - USD per million input/output tokens.
 * @param maxOutputTokens - The configured per-call output limit.
 */
export function estimateMaxCost(
  calls: number,
  pricing: { input: number; output: number },
  maxOutputTokens: number,
): number {
  return (
    (calls * (ESTIMATE_INPUT_TOKENS * pricing.input + maxOutputTokens * pricing.output)) / 1_000_000
  );
}
/** Strict CLI parsing; malformed selectors or limits never silently become defaults. */
export function parseEvaluationArgs(args: string[]) {
  const { values } = parseArgs({
    args,
    options: {
      label: { type: 'string' },
      baselines: { type: 'string' },
      scenarios: { type: 'string' },
      repeat: { type: 'string' },
      'max-cost': { type: 'string' },
      yes: { type: 'boolean' },
      resume: { type: 'boolean' },
      fake: { type: 'boolean' },
    },
    strict: true,
  });
  if (!values.label) throw new Error('--label is required');
  studyDirectory('.', values.label);
  const baselines = (values.baselines ?? 'B1,B2,B3').split(',');
  if (
    new Set(baselines).size !== baselines.length ||
    baselines.some((b) => !BASELINES.includes(b as (typeof BASELINES)[number]))
  )
    throw new Error('Invalid baselines');
  const repeat = Number(values.repeat ?? 1),
    maxCost = Number(values['max-cost'] ?? DEFAULT_MAX_COST_USD);
  if (
    ![1, 3].includes(repeat) ||
    !Number.isFinite(maxCost) ||
    maxCost < 0 ||
    values['max-cost'] === ''
  )
    throw new Error('Invalid repeat or max-cost');
  return {
    label: values.label,
    baselines: baselines as (typeof BASELINES)[number][],
    scenarios: values.scenarios ?? 'all',
    repeat: repeat as 1 | 3,
    maxCost,
    yes: values.yes ?? false,
    resume: values.resume ?? false,
    fake: values.fake ?? false,
    supplied: values,
  };
}
/** CLI entry; paid calls require an estimate and explicit confirmation (or --yes). */
export async function main(args = process.argv.slice(2)): Promise<void> {
  loadRootEnv();
  const options = parseEvaluationArgs(args);
  const repoRoot = fileURLToPath(new URL('..', import.meta.url));
  const root = join(repoRoot, 'scenarios'),
    results = join(repoRoot, 'eval/results');
  const manifest = await readManifest(root);
  const ids =
    options.scenarios === 'all'
      ? manifest.scenarios.map((e) => e.id)
      : options.scenarios.split(',');
  if (
    new Set(ids).size !== ids.length ||
    ids.some((id) => !manifest.scenarios.some((e) => e.id === id))
  )
    throw new Error('Unknown or duplicate scenario');
  const unlock = await lockStudy(results, options.label);
  let close: (() => Promise<void>) | undefined;
  try {
    let study: EvaluationStudy;
    const gitCommit = (await exec('git', ['rev-parse', 'HEAD'], { cwd: repoRoot })).stdout.trim();
    if (options.resume) {
      study = await readStudy(results, options.label);
      if (
        JSON.stringify(study.manifest) !== JSON.stringify(manifest.scenarios) ||
        study.environment.image !== VALIDATOR_IMAGE ||
        study.environment.oasdiff !== OASDIFF_VERSION ||
        study.environment.gitCommit !== gitCommit ||
        study.environment.node !== process.version
      )
        throw new Error('Resume requires the original manifest, commit, Node, oasdiff and image');
      if (
        (options.supplied.baselines &&
          JSON.stringify(options.baselines) !== JSON.stringify(study.config.baselines)) ||
        (options.supplied.scenarios &&
          JSON.stringify(ids) !== JSON.stringify(study.config.scenarioIds)) ||
        (options.supplied.repeat && options.repeat !== study.config.repeat) ||
        (options.supplied.fake && !study.fake)
      )
        throw new Error('Resume cannot change the evaluation matrix or model mode');
      if (!study.fake && study.environment.modelId !== process.env.LLM_MODEL?.trim())
        throw new Error('Resume requires the original model');
      if (!study.fake) {
        const pricing = JSON.parse(
          await readFile(join(repoRoot, 'config/llm-pricing.json'), 'utf8'),
        ) as {
          models: Record<
            string,
            { inputUsdPerMillionTokens: number; outputUsdPerMillionTokens: number }
          >;
        };
        const current = pricing.models[study.environment.modelId];
        if (
          !current ||
          current.inputUsdPerMillionTokens !== study.environment.pricing.input ||
          current.outputUsdPerMillionTokens !== study.environment.pricing.output
        )
          throw new Error('Resume requires the original pricing configuration');
      }
      if (options.supplied['max-cost']) study.config.maxCost = options.maxCost;
    } else {
      try {
        await access(join(studyDirectory(results, options.label), 'results.json'));
        throw new Error('Label already exists; use --resume or a new label');
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e;
      }
      const modelId = options.fake ? 'FakeLlmAdapter' : process.env.LLM_MODEL?.trim();
      if (!modelId) throw new Error('Set an exact LLM_MODEL, or use --fake');
      const prices = JSON.parse(
        await readFile(join(repoRoot, 'config/llm-pricing.json'), 'utf8'),
      ) as {
        models: Record<
          string,
          { inputUsdPerMillionTokens: number; outputUsdPerMillionTokens: number }
        >;
      };
      const price = options.fake
        ? { inputUsdPerMillionTokens: 0, outputUsdPerMillionTokens: 0 }
        : prices.models[modelId];
      if (!price) throw new Error('Model has no pinned pricing entry');
      const now = new Date().toISOString();
      study = EvaluationStudySchema.parse({
        schemaVersion: 1,
        label: options.label,
        startedAt: now,
        updatedAt: now,
        status: 'partial',
        stopReason: 'Not started',
        fake: options.fake,
        config: {
          baselines: options.baselines,
          scenarioIds: ids,
          repeat: options.repeat,
          maxCost: options.maxCost,
        },
        environment: {
          gitCommit,
          modelId,
          image: VALIDATOR_IMAGE,
          oasdiff: OASDIFF_VERSION,
          node: process.version,
          platform: process.platform,
          arch: process.arch,
          cpuCores: cpus().length,
          ramBytes: totalmem(),
          pricing: {
            input: price.inputUsdPerMillionTokens,
            output: price.outputUsdPerMillionTokens,
          },
          maxOutputTokens: EVAL_MAX_OUTPUT_TOKENS,
          effort: options.fake ? 'n/a (fake model)' : LLM_EFFORT,
        },
        manifest: manifest.scenarios,
        admissions: [],
        trials: [],
        inFlight: null,
        spentUsd: 0,
        reservedUsd: 0,
        modelCalls: { total: 0, maxTokensStops: 0, stopReasons: {} },
      });
    }
    const calls =
      study.config.scenarioIds.length *
      study.config.repeat *
      study.config.baselines.reduce((n, b) => n + (b === 'B3' ? 4 : b === 'B2' ? 1 : 0), 0);
    const maxOut = study.environment.maxOutputTokens;
    const estimated = estimateMaxCost(calls, study.environment.pricing, maxOut);
    console.log(
      `Estimated model cost: $0–$${estimated.toFixed(2)} (${calls} maximum calls, assuming ${ESTIMATE_INPUT_TOKENS} input/${maxOut} output tokens each at effort ${study.environment.effort}; actual prompts vary). Hard budget: $${study.config.maxCost.toFixed(2)}. Existing billed/reserved: $${(study.spentUsd + study.reservedUsd).toFixed(6)}.`,
    );
    if (!study.fake && calls && !options.yes) {
      if (!process.stdin.isTTY)
        throw new Error('Live run requires interactive confirmation or --yes');
      const rl = createInterface({ input: process.stdin, output: process.stdout });
      try {
        if ((await rl.question('Authorize paid model calls? Type yes: ')).trim() !== 'yes')
          throw new Error('Live run not authorized');
      } finally {
        rl.close();
      }
    }
    const client = createDbClient();
    close = client.close;
    let interrupted = false;
    const signal = () => {
      interrupted = true;
    };
    process.on('SIGINT', signal);
    process.on('SIGTERM', signal);
    const save = async () => {
      study.updatedAt = new Date().toISOString();
      if (study.stopReason)
        study.stopReason = scrubText(study.stopReason, knownSecrets(process.env));
      await saveStudy(results, study, (s) => saveEvaluationStudy(client.db, s));
    };
    try {
      await evaluate(study, {
        assertFrozen: (e) => assertFrozen(root, e),
        admit: (e) => admit(root, e),
        trial: async (entry, baseline, repeat) => {
          console.log(`${entry.id} ${baseline} repeat ${repeat}`);
          return runTrial({
            db: client.db,
            root,
            entry,
            baseline,
            repeat,
            study,
            save,
            interrupted: () => interrupted,
          });
        },
        save,
        interrupted: () => interrupted,
      });
      await writeReport(results, study.label);
      console.log(
        `${study.status}: ${study.trials.filter((t) => t.completed).length} completed trials, ${study.admissions.filter((a) => !a.admissible).length} exclusions. ${study.stopReason ?? ''}`,
      );
      if (study.status === 'partial') process.exitCode = 1;
    } finally {
      process.off('SIGINT', signal);
      process.off('SIGTERM', signal);
    }
  } finally {
    await close?.();
    await unlock();
  }
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url))
  main().catch((error) => {
    console.error(
      scrubText(
        error instanceof Error ? error.message : 'Evaluation failed',
        knownSecrets(process.env),
      ),
    );
    process.exitCode = 1;
  });
