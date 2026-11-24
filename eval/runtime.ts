import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { cp, mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { parse } from 'yaml';
import { z } from 'zod';
import {
  CHANGE_CATEGORIES,
  parseOasdiffChangelog,
  type SpecDifference,
  DetectionLabelSchema,
  scoreDetection,
  type EvaluationStudy,
  type EvaluationTrial,
  type DetectionLabel,
  type Baseline,
} from '@sma/core';
import {
  insertApi,
  insertRepository,
  getChangeById,
  listAttempts,
  type Db,
  type Change,
} from '../apps/server/src/infra/db/index.js';
import { Orchestrator } from '../apps/server/src/pipeline/orchestrator.js';
import { validate } from '../apps/server/src/pipeline/validate.js';
import { guardedValidate } from '../apps/server/src/pipeline/guarded-validate.js';
import { FakeLlmAdapter } from '../apps/server/src/infra/llm/fake.js';
import { AnthropicLlmAdapter } from '../apps/server/src/infra/llm/adapter.js';
import { assertFrozen } from '../scenarios/integrity.js';
import { verifyOne, containerPair } from '../scenarios/verify.js';
import type { ManifestEntry } from '../scenarios/types.js';
import { runOasdiff } from '../apps/server/src/infra/oasdiff/runner.js';
import { BudgetAdapter, stopReasonOf } from './budget.js';
const exec = promisify(execFile);
const metadataSchema = z.object({
  category: z.enum(CHANGE_CATEGORIES),
  expected: z.object({ outcome: z.enum(['repair', 'refuse']) }),
});

/** Admission checks tests/hash/snapshot, without excluding detector mistakes from the study. */
export async function admit(root: string, entry: ManifestEntry) {
  let outage: unknown;
  const result = await verifyOne(
    root,
    entry,
    async (repo) => {
      try {
        const pair = await containerPair(repo);
        if ([pair.before, pair.after].some((r) => r.status === 'error' || r.status === 'timeout'))
          throw new Error('Container did not complete admission checks');
        return pair;
      } catch (e) {
        outage = e;
        throw e;
      }
    },
    async () => ({ detected: 0, located: 0 }),
  );
  if (outage) throw outage;
  return result;
}
/** Normalize actual persisted differences to the frozen hand-label vocabulary. */
export function detectionLabel(change: Change, difference?: SpecDifference): DetectionLabel {
  const d = difference?.details ?? {};
  return {
    method: change.method,
    path: change.path,
    category: change.category,
    classification: change.classification,
    ...(Array.isArray(d.propertyPath)
      ? { field: d.propertyPath.join('/') }
      : typeof d.propertyName === 'string'
        ? { field: d.propertyName }
        : {}),
    ...(typeof d.paramName === 'string' ? { parameter: d.paramName } : {}),
    ...(typeof d.paramIn === 'string' ? { location: d.paramIn } : {}),
  };
}

/** Materialize exactly the deterministic frozen Git commit, not a new timestamped commit. */
export async function committedCopy(source: string, expectedCommit: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'sma-eval-'));
  const env = {
    PATH: process.env.PATH,
    GIT_CONFIG_NOSYSTEM: '1',
    GIT_CONFIG_GLOBAL: '/dev/null',
    GIT_AUTHOR_NAME: 'SMA scenarios',
    GIT_COMMITTER_NAME: 'SMA scenarios',
    GIT_AUTHOR_EMAIL: 'scenarios@example.invalid',
    GIT_COMMITTER_EMAIL: 'scenarios@example.invalid',
    GIT_AUTHOR_DATE: '2000-01-01T00:00:00Z',
    GIT_COMMITTER_DATE: '2000-01-01T00:00:00Z',
  };
  try {
    await cp(source, dir, { recursive: true });
    const git = (...args: string[]) =>
      exec(
        'git',
        ['-C', dir, '-c', 'core.hooksPath=/dev/null', '-c', 'core.autocrlf=false', ...args],
        { env },
      );
    await git('init', '--quiet', '--object-format=sha1', '--initial-branch=main');
    await git('add', '--all');
    await git('commit', '--quiet', '--no-gpg-sign', '-m', 'Frozen scenario consumer v1');
    if ((await git('rev-parse', 'HEAD')).stdout.trim() !== expectedCommit)
      throw new Error('Materialized repository differs from frozen commit');
    return dir;
  } catch (e) {
    await rm(dir, { recursive: true, force: true });
    throw e;
  }
}

async function fakeAdapter(folder: string, id: string) {
  const usage = { tokensIn: 0, tokensOut: 0, costUsd: 0, modelId: 'FakeLlmAdapter', durationMs: 0 };
  if (id === 'rename-shop-flat') {
    const source = await readFile(join(folder, 'repo/src/consumer.ts'), 'utf8');
    const lines = source.trimEnd().split('\n');
    const patch = `diff --git a/src/consumer.ts b/src/consumer.ts\n--- a/src/consumer.ts\n+++ b/src/consumer.ts\n@@ -1,${lines.length} +1,${lines.length} @@\n${lines.map((line) => (line.includes('customer_name') ? `-${line}\n+${line.replaceAll('customer_name', 'full_name')}` : ` ${line}`)).join('\n')}\n`;
    return new FakeLlmAdapter([{ kind: 'patch', patch, ...usage }]);
  }
  if (id === 'param-shop-query') {
    const source = await readFile(join(folder, 'repo/src/consumer.ts'), 'utf8');
    const lines = source.trimEnd().split('\n');
    const patch = `diff --git a/src/consumer.ts b/src/consumer.ts\n--- a/src/consumer.ts\n+++ b/src/consumer.ts\n@@ -1,${lines.length} +1,${lines.length + 1} @@\n+// @ts-nocheck\n${lines.map((line) => ` ${line}`).join('\n')}\n`;
    return new FakeLlmAdapter([{ kind: 'patch', patch, ...usage }]);
  }
  return new FakeLlmAdapter([
    {
      kind: 'refusal',
      reason: 'Scripted dry-test refusal (not model performance evidence)',
      ...usage,
    },
  ]);
}

/** Container errors/timeouts stop evaluation immediately instead of entering B3 retries. */
export function timedValidator(
  trial: EvaluationTrial,
  runner: typeof validate = validate,
): typeof validate {
  return async (input) => {
    const started = performance.now();
    try {
      const result = await runner(input);
      if (result.ok && ['error', 'timeout'].includes(result.value.result.status))
        throw new Error(`Container did not complete validation (${result.value.result.status})`);
      return result;
    } finally {
      trial.containerMs += performance.now() - started;
    }
  };
}

/** Execute B1 directly or B2/B3 through the real persistent pipeline, always in Docker. */
export async function runTrial(input: {
  db: Db;
  root: string;
  entry: ManifestEntry;
  baseline: Baseline;
  repeat: number;
  study: EvaluationStudy;
  save: () => Promise<void>;
  interrupted: () => boolean;
}): Promise<EvaluationTrial> {
  const { db, root, entry, baseline, repeat, study } = input;
  await assertFrozen(root, entry);
  const folder = join(root, entry.id);
  const metadata = metadataSchema.parse(
    parse(await readFile(join(folder, 'scenario.yaml'), 'utf8')),
  );
  const labels = z
    .object({ differences: z.array(DetectionLabelSchema) })
    .parse(parse(await readFile(join(folder, 'labels.yaml'), 'utf8'))).differences;
  let migrationNote = '';
  try {
    migrationNote = await readFile(join(folder, 'migration-note.yaml'), 'utf8');
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e;
  }
  const trial: EvaluationTrial = {
    id: randomUUID(),
    scenarioId: entry.id,
    baseline,
    repeat,
    category: metadata.category,
    expected: metadata.expected.outcome,
    outcome: 'running',
    reason: '',
    attemptsUsed: 0,
    tokensIn: 0,
    tokensOut: 0,
    costUsd: 0,
    durationMs: 0,
    modelMs: 0,
    containerMs: 0,
    guard: null,
    patch: '',
    migrationNote,
    runId: null,
    detection: null,
    detected: [],
    labels,
    review: null,
    completed: false,
    createdAt: new Date().toISOString(),
    stopReasons: [],
  };
  trial.reason = 'Trial in progress';
  study.trials.push(trial);
  await input.save();
  const started = performance.now();
  const repo = await committedCopy(join(folder, 'repo'), entry.repoCommit);
  try {
    const timedValidate = timedValidator(trial);
    if (baseline === 'B1') {
      const out = await timedValidate({
        repoPath: repo,
        env: { API_VERSION: 'v2' },
        dispose: true,
      });
      if (!out.ok || out.value.result.status === 'error' || out.value.result.status === 'timeout') {
        trial.outcome = 'stage_failure';
        trial.reason = 'Container unavailable during B1 scoring';
      } else {
        trial.outcome = out.value.result.status === 'pass' ? 'repaired' : 'failed';
        trial.reason =
          out.value.result.status === 'pass'
            ? 'Unexpected unpatched pass after admission'
            : 'Do nothing: after-state tests failed';
        trial.completed = true;
      }
    } else {
      const adapter = new BudgetAdapter(
        study.fake ? await fakeAdapter(folder, entry.id) : new AnthropicLlmAdapter(),
        study,
        input.save,
        input.interrupted,
        (response) => {
          const usage = response.kind === 'error' ? response.usage : response;
          trial.modelMs += response.durationMs;
          trial.tokensIn += usage?.tokensIn ?? 0;
          trial.tokensOut += usage?.tokensOut ?? 0;
          trial.costUsd += usage?.costUsd ?? 0;
          trial.attemptsUsed++;
          trial.stopReasons.push(stopReasonOf(response));
          if (response.kind === 'patch') trial.patch = response.patch;
        },
      );
      let differences: SpecDifference[] = [];
      const orchestrator = new Orchestrator(
        {
          db,
          llm: adapter,
          oasdiff: async (before, after, options) => {
            const out = await runOasdiff(before, after, options);
            if (out.ok) {
              const parsed = parseOasdiffChangelog(out.value, { before, after });
              if (parsed.ok) differences = parsed.value;
            }
            return out;
          },
          validator: {
            validate: timedValidate,
            guardedValidate: (data) => guardedValidate(data, { validate: timedValidate }),
          },
        },
        {
          dryRunDelivery: true,
          sandboxEnv: { API_VERSION: 'v2' },
          llm: { maxOutputTokens: study.environment.maxOutputTokens },
        },
      );
      const unique = randomUUID();
      const api = await insertApi(db, { name: `eval-${unique}` });
      const before = await orchestrator.checkSpec(api.id, {
        mode: 'uploaded',
        text: await readFile(join(folder, 'specs/before.yaml'), 'utf8'),
      });
      const after = await orchestrator.checkSpec(
        api.id,
        { mode: 'uploaded', text: await readFile(join(folder, 'specs/after.yaml'), 'utf8') },
        migrationNote ? { migrationNote } : {},
      );
      if (before.pipeline.failure || after.pipeline.failure)
        throw new Error('Spec ingest/detection failed during evaluation');
      const changes: Change[] = [];
      for (const id of after.pipeline.changeIds) {
        const c = await getChangeById(db, id);
        if (c) changes.push(c);
      }
      trial.detected = changes.map((c) =>
        detectionLabel(
          c,
          differences.find(
            (d) =>
              d.ruleId === c.oasdiffRuleId &&
              d.path === c.path &&
              d.method === c.method &&
              d.jsonPointer === c.jsonPointer,
          ),
        ),
      );
      trial.detection = scoreDetection(labels, trial.detected);
      // Selection uses the system's classification only, never the ground-truth category.
      const candidates = changes.filter((c) => c.classification === 'breaking');
      if (candidates.length !== 1) {
        trial.outcome = 'needs_review';
        trial.reason = `Expected one actionable detected change; system produced ${candidates.length}`;
        trial.completed = true;
      } else {
        const repository = await insertRepository(db, {
          owner: 'evaluation',
          name: unique,
          localPath: repo,
          defaultBranch: 'main',
          credentialRef: 'GITHUB_TOKEN',
        });
        const handle = await orchestrator.startRun({
          repositoryId: repository.id,
          changeId: candidates[0]!.id,
          mode: baseline === 'B2' ? 'single_shot' : 'full',
        });
        trial.runId = handle.run.id;
        await input.save();
        const run = await handle.done;
        const attempts = await listAttempts(db, run.id);
        trial.outcome = run.status;
        trial.reason = adapter.stopped ?? run.failureDetail ?? run.flaggedReason ?? run.status;
        trial.attemptsUsed = adapter.calls;
        trial.modelMs = adapter.modelMs;
        trial.guard = attempts.find((a) => a.guardName)?.guardName ?? null;
        trial.patch = attempts.filter((a) => a.patch).at(-1)?.patch ?? trial.patch;
        trial.completed =
          run.status !== 'stage_failure' &&
          !adapter.stopped &&
          !attempts.some((a) => ['error', 'timeout'].includes(a.outcome));
        if (trial.expected === 'refuse' && trial.patch)
          trial.review = {
            verdict: 'incorrect',
            name: 'automatic:no-replacement',
            note: 'Should have refused: no replacement is documented',
            at: new Date().toISOString(),
          };
      }
    }
    await assertFrozen(root, entry);
  } catch (e) {
    trial.outcome = 'stage_failure';
    trial.reason = e instanceof Error ? e.message : 'Trial failed';
    throw e;
  } finally {
    trial.durationMs = performance.now() - started;
    await rm(repo, { recursive: true, force: true });
  }
  return trial;
}
