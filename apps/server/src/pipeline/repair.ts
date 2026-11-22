import { and, eq } from 'drizzle-orm';
import {
  FOUR_ATTEMPTS_REASON,
  MAX_REPAIR_ATTEMPTS,
  buildRepairContext,
  exceedsTokenCeiling,
  isRepairSourcePath,
  repairPreconditionReason,
  unvalidatedFeedback,
  validatorFeedback,
  type AttemptOutcome,
  type GuardName,
  type LocateResult,
  type MigrationMapping,
  type RepairContext,
  type RepairContextInput,
  type RepairStatus,
  type Stage,
  type StageResultStatus,
  type ValidationResult,
} from '@sma/core';
import {
  getRunById,
  insertAttempt,
  insertStageResult,
  updateRunProgress,
  type Db,
} from '../infra/db/index.js';
import { attempts, runStageResults } from '../infra/db/schema.js';
import type { LlmAdapter, LlmOptions, LlmResult } from '../infra/llm/types.js';
import { MAX_LLM_TIMEOUT_MS } from '../infra/llm/adapter.js';
import { fileSystemRepoReader } from '../infra/repo/reader.js';
import type { DockerOptions } from '../infra/validator/docker.js';
import type { SandboxLimits } from '../infra/validator/sandbox.js';
import type { WorkcopyOptions } from '../infra/workcopy/index.js';
import {
  attemptFieldsFromVerdict,
  guardedValidate,
  type AttemptVerdictFields,
  type GuardedValidateInput,
  type GuardedVerdict,
} from './guarded-validate.js';
import {
  validate,
  type ValidateError,
  type ValidateInput,
  type ValidateOutput,
} from './validate.js';
import type { Result } from '@sma/core';

/** Default output-token limit for one model call. */
export const DEFAULT_MAX_OUTPUT_TOKENS = 4096;

/** `model_id` stored on an attempt row when the model never answered (the column is NOT NULL). */
export const UNAVAILABLE_MODEL_ID = 'unavailable';

/**
 * `full`: the guarded loop (B3). `single_shot`: one model call, no guards, no retries, no
 * feedback; validation only scores the result (evaluation baseline B2).
 */
export type RepairMode = 'full' | 'single_shot';

/** Input to {@link repair}. */
export interface RepairInput {
  db: Db;
  /** An unfinished run with no attempts yet. */
  runId: string;
  /** The change, in the shape the context builder takes. */
  change: RepairContextInput['change'];
  /** The changed specification section before and after (FR-19). */
  specSectionBefore: unknown;
  specSectionAfter: unknown;
  /** The migration-note entry that confirmed the mapping, or `null` for a human confirmation. */
  migrationNoteEntry: MigrationMapping | null;
  /** The locate stage's result for this run. */
  locateResult: Pick<LocateResult, 'callSites'>;
  /** The developer's repository. Read, never written (FR-20). */
  repo: { path: string; commit?: string };
  /** Allow-listed env for the validation container (for example `API_VERSION`). */
  env?: Record<string, string>;
  adapter: LlmAdapter;
  /** Most input + output tokens the run may use (FR-24). */
  tokenCeiling: number;
  mode: RepairMode;
  /** Per-call model limits. Default: {@link DEFAULT_MAX_OUTPUT_TOKENS}, 120 s. */
  llm?: Partial<LlmOptions>;
  limits?: SandboxLimits;
  docker?: DockerOptions;
  workcopy?: WorkcopyOptions;
}

/** Replaceable steps, so unit tests can run without Docker. */
export interface RepairDeps {
  guardedValidate?: (input: GuardedValidateInput) => Promise<GuardedVerdict>;
  validate?: (input: ValidateInput) => Promise<Result<ValidateOutput, ValidateError>>;
  readSource?: (repoPath: string, path: string) => Promise<string>;
}

/** What {@link repair} returns. The run itself stays unfinished; the orchestrator finishes it. */
export interface RepairOutcome {
  status: RepairStatus;
  /** The last patch the model produced, if any. */
  finalPatch?: string;
  /** The last validation result, if validation ran. */
  finalResult?: ValidationResult;
  /** Attempt rows written. */
  attempts: number;
  /** Plain-language reason, recorded on the run. */
  reason: string;
  /** Stage that failed, set only for `stage_failure`. */
  failureStage?: Stage;
  tokensIn: number;
  tokensOut: number;
  costUsd: number;
}

interface Usage {
  tokensIn: number;
  tokensOut: number;
  costUsd: number;
  modelId: string;
}
const NO_USAGE: Usage = { tokensIn: 0, tokensOut: 0, costUsd: 0, modelId: UNAVAILABLE_MODEL_ID };

const unvalidated = (output: string, outcome: AttemptOutcome = 'fail'): AttemptVerdictFields => ({
  outcome,
  guardName: null,
  compileErrors: null,
  testsPassed: null,
  testsTotal: null,
  validationOutput: output,
});

const fromResult = (result: ValidationResult): AttemptVerdictFields => ({
  outcome: result.status,
  guardName: null,
  compileErrors: result.compileErrors,
  testsPassed: result.testsPassed,
  testsTotal: result.testsTotal,
  validationOutput: result.rawOutput,
});

/**
 * Repair stage (FR-18 to FR-24, NFR-07) for one run: generate a patch → apply it to a fresh
 * isolated copy → cheat guards → validate → feed the errors back, for at most four attempts.
 *
 * - Runs only for a breaking change with a confirmed mapping and ≥ 1 call site; anything else
 *   is `flagged` with **no model call** (FR-18, BR-04).
 * - Validates the unpatched copy once first: the baseline the count guard needs (FR-28).
 * - Before every model call, a call that could take the run over `tokenCeiling` ends it as
 *   `aborted`, never `failed` (FR-24).
 * - Cheating ends the run at once (FR-31). A refusal is `flagged`. A model timeout or error is
 *   a `stage_failure` of `repair` (UC-04).
 * - After four failed attempts: `failed`, flagged for a human (FR-22). There is no fifth call.
 * - Every attempt row records patch, validation output, counts, outcome, guard, tokens, cost,
 *   model and duration (wall clock of the model call plus validation) (FR-23).
 *
 * The developer's repository is only read (FR-20); every patch goes to its own new working copy.
 * @param input - Run, change, located sites, repository, adapter, ceiling and mode.
 * @param deps - Replaceable validation and file reading (tests only).
 */
export async function repair(input: RepairInput, deps: RepairDeps = {}): Promise<RepairOutcome> {
  const { db, runId } = input;
  if (!Number.isSafeInteger(input.tokenCeiling) || input.tokenCeiling < 1)
    throw new Error('tokenCeiling must be a positive integer');
  const run = await getRunById(db, runId);
  if (!run) throw new Error('Run not found');
  if (run.finishedAt) throw new Error('Cannot repair a finished run');
  const earlier = await db
    .select({ id: attempts.id })
    .from(attempts)
    .where(eq(attempts.runId, runId));
  const repairRow = await db
    .select({ id: runStageResults.id })
    .from(runStageResults)
    .where(and(eq(runStageResults.runId, runId), eq(runStageResults.stage, 'repair')));
  if (earlier.length || repairRow.length)
    throw new Error('Run already has a repair; start a new run to repair again');

  const runGuarded = deps.guardedValidate ?? guardedValidate;
  const runValidate = deps.validate ?? validate;
  const readSource = deps.readSource ?? ((repo, path) => fileSystemRepoReader.read(repo, path));
  const opts: LlmOptions = {
    maxOutputTokens: input.llm?.maxOutputTokens ?? DEFAULT_MAX_OUTPUT_TOKENS,
    timeoutMs: input.llm?.timeoutMs ?? MAX_LLM_TIMEOUT_MS,
  };
  const sandbox = {
    repoPath: input.repo.path,
    ...(input.env ? { env: input.env } : {}),
    ...(input.limits ? { limits: input.limits } : {}),
    ...(input.docker ? { docker: input.docker } : {}),
    ...(input.workcopy ? { workcopy: input.workcopy } : {}),
  };
  const started = new Date();
  const totals = { tokensIn: 0, tokensOut: 0, costUsd: 0, modelId: null as string | null };
  let attemptCount = 0;
  let finalPatch: string | undefined;
  let finalResult: ValidationResult | undefined;

  /** Writes one attempt row and the run's running totals. */
  async function record(
    patch: string,
    fields: AttemptVerdictFields,
    usage: Usage,
    durationMs: number,
  ): Promise<void> {
    attemptCount++;
    await insertAttempt(db, {
      runId,
      attemptNumber: attemptCount,
      patch,
      ...fields,
      tokensIn: usage.tokensIn,
      tokensOut: usage.tokensOut,
      costUsd: usage.costUsd.toFixed(6),
      modelId: usage.modelId,
      durationMs: Math.max(0, Math.round(durationMs)),
    });
    totals.tokensIn += usage.tokensIn;
    totals.tokensOut += usage.tokensOut;
    totals.costUsd += usage.costUsd;
    if (usage.modelId !== UNAVAILABLE_MODEL_ID) totals.modelId = usage.modelId;
    await updateRunProgress(db, runId, {
      stageReached:
        fields.compileErrors === null && fields.testsTotal === null ? 'repair' : 'validate',
      attemptCount,
      tokensIn: totals.tokensIn,
      tokensOut: totals.tokensOut,
      costUsd: totals.costUsd.toFixed(6),
      modelId: totals.modelId,
    });
  }

  /** Writes the `repair` stage row and the run's reason columns, and builds the outcome. */
  async function finish(
    status: RepairStatus,
    reason: string,
    failureStage?: Stage,
  ): Promise<RepairOutcome> {
    const stageStatus: StageResultStatus =
      status === 'repaired'
        ? 'ok'
        : status === 'flagged' && attemptCount === 0
          ? 'skipped'
          : 'failed';
    await insertStageResult(db, {
      runId,
      stage: 'repair',
      status: stageStatus,
      result: {
        mode: input.mode,
        status,
        reason,
        attempts: attemptCount,
        tokenCeiling: input.tokenCeiling,
        tokensIn: totals.tokensIn,
        tokensOut: totals.tokensOut,
        costUsd: Number(totals.costUsd.toFixed(6)),
        modelId: totals.modelId,
        ...(failureStage ? { failureStage } : {}),
      },
      startedAt: started,
      finishedAt: new Date(Math.max(Date.now(), started.getTime())),
    });
    const progress = {
      ...(attemptCount === 0 ? { stageReached: 'repair' as const } : {}),
      ...(status === 'stage_failure'
        ? { failureStage: failureStage ?? 'repair', failureDetail: reason }
        : status === 'repaired'
          ? {}
          : { flaggedReason: reason }),
    };
    if (Object.keys(progress).length) await updateRunProgress(db, runId, progress);
    return {
      status,
      reason,
      attempts: attemptCount,
      ...(failureStage ? { failureStage } : {}),
      ...(finalPatch !== undefined ? { finalPatch } : {}),
      ...(finalResult ? { finalResult } : {}),
      tokensIn: totals.tokensIn,
      tokensOut: totals.tokensOut,
      costUsd: totals.costUsd,
    };
  }

  // 1. FR-18 precondition. No model call, no container.
  const precondition = repairPreconditionReason(input.change, input.locateResult);
  if (precondition) return finish('flagged', precondition);

  // Only the files that contain located call sites, and only eligible source paths (FR-19).
  const paths = [...new Set(input.locateResult.callSites.map((s) => s.filePath))].filter(
    isRepairSourcePath,
  );
  const callSiteFiles: { path: string; content: string }[] = [];
  try {
    for (const path of paths)
      callSiteFiles.push({ path, content: await readSource(input.repo.path, path) });
  } catch {
    return finish(
      'stage_failure',
      'Could not read a located source file from the repository.',
      'repair',
    );
  }
  const context = (previousErrors: string[]): RepairContext =>
    buildRepairContext({
      change: input.change,
      specSectionBefore: input.specSectionBefore,
      specSectionAfter: input.specSectionAfter,
      migrationNoteEntry: input.migrationNoteEntry,
      callSiteFiles,
      previousErrors,
    });
  let firstContext: RepairContext;
  try {
    firstContext = context([]);
  } catch (cause) {
    return finish('flagged', `Repair context could not be built: ${(cause as Error).message}.`);
  }
  const ceilingReason = (attempt: number, ctx: RepairContext) => {
    const used = totals.tokensIn + totals.tokensOut;
    return (
      `Token ceiling of ${input.tokenCeiling} would be exceeded by attempt ${attempt} ` +
      `(${used} used, up to ${ctx.approxTokens + opts.maxOutputTokens} more): aborted.`
    );
  };
  if (exceedsTokenCeiling(0, firstContext.approxTokens, opts.maxOutputTokens, input.tokenCeiling))
    return finish('aborted', ceilingReason(1, firstContext));

  // 2. Pre-patch baseline (full mode only): the count guard compares with it (FR-28).
  let baseline: ValidationResult | undefined;
  if (input.mode === 'full') {
    const baselineStarted = new Date();
    const pre = await runValidate({
      ...sandbox,
      ...(input.repo.commit !== undefined ? { commitSha: input.repo.commit } : {}),
      dispose: true,
    });
    const preResult = pre.ok ? pre.value.result : undefined;
    const usable = preResult && (preResult.status === 'pass' || preResult.status === 'fail');
    await insertStageResult(db, {
      runId,
      stage: 'validate',
      status: usable ? 'ok' : 'failed',
      result: pre.ok ? { baseline: pre.value.result } : { baseline: null, error: pre.error },
      startedAt: baselineStarted,
      finishedAt: new Date(Math.max(Date.now(), baselineStarted.getTime())),
    });
    if (!pre.ok)
      return finish(
        'stage_failure',
        `Pre-patch baseline validation failed: ${pre.error.code}: ${pre.error.message}`,
        'validate',
      );
    if (!usable)
      return finish(
        'stage_failure',
        `Pre-patch baseline validation did not complete (${preResult!.status}` +
          `${preResult!.errorReason ? `: ${preResult!.errorReason}` : ''}).`,
        'validate',
      );
    baseline = preResult;
  }

  // 3. The loop. Single-shot: exactly one call.
  const maxAttempts = input.mode === 'full' ? MAX_REPAIR_ATTEMPTS : 1;
  const feedback: string[] = [];
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    // Newest errors first, so the context builder's 4,000-character cap keeps them.
    const ctx = attempt === 1 ? firstContext : context([...feedback].reverse());
    if (
      exceedsTokenCeiling(
        totals.tokensIn + totals.tokensOut,
        ctx.approxTokens,
        opts.maxOutputTokens,
        input.tokenCeiling,
      )
    )
      return finish('aborted', ceilingReason(attempt, ctx));

    const t0 = performance.now();
    const answer: LlmResult = await input.adapter.generatePatch(ctx, opts);
    const elapsed = () => performance.now() - t0;

    if (answer.kind === 'refusal') {
      const reason = `Model refused: ${answer.reason}`;
      await record('', unvalidated(reason), answer, elapsed());
      return finish('flagged', reason);
    }
    if (answer.kind === 'error') {
      const usage: Usage = answer.usage ?? NO_USAGE;
      if (answer.errorKind === 'invalid_output') {
        await record('', unvalidated(`invalid_output: ${answer.message}`), usage, elapsed());
        if (input.mode === 'single_shot')
          return finish('failed', `Single-shot answer was not a usable patch: ${answer.message}`);
        feedback.push(unvalidatedFeedback(attempt, answer.message));
        continue;
      }
      const outcome: AttemptOutcome = answer.errorKind === 'timeout' ? 'timeout' : 'error';
      await record(
        '',
        unvalidated(`${answer.errorKind}: ${answer.message}`, outcome),
        usage,
        elapsed(),
      );
      return finish(
        'stage_failure',
        `Model unavailable (${answer.errorKind}): ${answer.message}`,
        'repair',
      );
    }

    const usage: Usage = answer;
    finalPatch = answer.patch;
    const commit = input.repo.commit !== undefined ? { commit: input.repo.commit } : {};

    if (input.mode === 'single_shot') {
      // B2: no guards. Validation only scores the patch.
      const scored = await runValidate({
        ...sandbox,
        ...(input.repo.commit !== undefined ? { commitSha: input.repo.commit } : {}),
        patch: answer.patch,
        dispose: true,
      });
      if (!scored.ok) {
        if (scored.error.code === 'patch_invalid') {
          await record(
            answer.patch,
            unvalidated(`patch_invalid: ${scored.error.message}`),
            usage,
            elapsed(),
          );
          return finish('failed', `Single-shot patch did not apply: ${scored.error.message}`);
        }
        await record(
          answer.patch,
          unvalidated(`${scored.error.code}: ${scored.error.message}`, 'error'),
          usage,
          elapsed(),
        );
        return finish('stage_failure', `Validation failed: ${scored.error.message}`, 'validate');
      }
      finalResult = scored.value.result;
      await record(answer.patch, fromResult(finalResult), usage, elapsed());
      return finalResult.status === 'pass'
        ? finish('repaired', 'Single-shot patch passed validation (unguarded, B2).')
        : finish('failed', `Single-shot patch did not pass validation (${finalResult.status}).`);
    }

    // Full mode: a fresh working copy for this attempt, guards, then validation.
    const verdict = await runGuarded({
      ...sandbox,
      ...commit,
      patch: answer.patch,
      preResult: baseline!,
      dispose: true,
    });
    if (verdict.result) finalResult = verdict.result;
    if (verdict.error && !verdict.result) {
      if (verdict.error.code === 'patch_invalid') {
        const fields = { ...attemptFieldsFromVerdict(verdict), outcome: 'fail' as const };
        await record(answer.patch, fields, usage, elapsed());
        feedback.push(unvalidatedFeedback(attempt, verdict.error.message));
        continue;
      }
      await record(answer.patch, attemptFieldsFromVerdict(verdict), usage, elapsed());
      return finish(
        'stage_failure',
        `Validation failed: ${verdict.error.code}: ${verdict.error.message}`,
        'validate',
      );
    }
    await record(answer.patch, attemptFieldsFromVerdict(verdict), usage, elapsed());
    if (verdict.outcome === 'cheating') {
      const guard = verdict.guard as GuardName;
      return finish(
        'cheating_rejected',
        `Cheat guard ${guard} rejected attempt ${attempt}; the run stopped.`,
      );
    }
    if (verdict.outcome === 'pass')
      return finish('repaired', `Patch passed validation on attempt ${attempt}.`);
    feedback.push(
      verdict.result
        ? validatorFeedback(attempt, verdict.result)
        : unvalidatedFeedback(attempt, `validation ${verdict.outcome}`),
    );
  }
  // 4. Four failures. There is no fifth call (FR-22, DR-03).
  return finish('failed', FOUR_ATTEMPTS_REASON);
}
