/**
 * Pipeline orchestrator (FR-38, FR-39, NFR-01, NFR-02, BR-06).
 *
 * - **Spec-check flow** (per API, UC-02): ingest → if the ingested version is not the baseline:
 *   detect + classify → **then** advance the baseline. A failed detect/classify is recorded as a
 *   failed spec check naming its stage, and the baseline is left alone.
 * - **Run flow** (per change × repository): create the run → locate → repair (validation runs
 *   inside) → deliver, or record a flagged finding → finish. Every stage writes its result row
 *   before the next stage starts. A thrown or typed failure becomes a `failed` stage row and a
 *   `stage_failure` run naming that stage, with a scrubbed detail; never a success.
 * - **One run at a time** (SRS 2.3): a second request while a run is in flight gets
 *   {@link RunBusyError} (HTTP 409). Runs are append-only; reanalysis is a new run with
 *   `parent_run_id` (FR-39).
 *
 * All infrastructure arrives through {@link OrchestratorPorts}, so tests swap in fakes.
 * @packageDocumentation
 */
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { and, eq } from 'drizzle-orm';
import {
  STAGE_LABELS,
  SPEC_CHECK_OUTCOME_LABELS,
  parseMigrationNote,
  type IngestResponse,
  type SpecPipeline,
  type Stage,
} from '@sma/core';
import {
  finishRun,
  getChangeById,
  getRepositoryById,
  getRunById,
  getSpecVersionById,
  insertMigrationNote,
  insertRun,
  insertStageResult,
  listAttempts,
  listCallSites,
  type Change,
  type Db,
  type Repository,
  type Run,
} from '../infra/db/index.js';
import { migrationNotes, runStageResults, runs, specChecks } from '../infra/db/schema.js';
import type { LlmAdapter, LlmOptions } from '../infra/llm/types.js';
import { runOasdiff, type OasdiffRunner } from '../infra/oasdiff/runner.js';
import { retrieveSpec, type SpecRetriever } from '../infra/spec-source/retrieve.js';
import type { DockerOptions } from '../infra/validator/docker.js';
import type { SandboxLimits } from '../infra/validator/sandbox.js';
import type { WorkcopyOptions } from '../infra/workcopy/index.js';
import { detectAndClassify } from './classify.js';
import {
  deliver,
  recordFlaggedFinding,
  retryDelivery as retryDeliveryStage,
  type DeliverDeps,
} from './deliver.js';
import { advanceBaseline, ingest, type IngestSource } from './ingest.js';
import { locate, type LocateDependencies } from './locate.js';
import { CheckQueue } from './poller.js';
import { repair, type RepairDeps, type RepairMode } from './repair.js';
import { knownSecrets, scrubText } from './run-detail.js';
import {
  buildDeliveryEvidence,
  locateTarget,
  migrationNoteEntry,
  repairChange,
} from './run-inputs.js';

const exec = promisify(execFile);

/** Default per-run token ceiling when none is configured (FR-24). */
export const DEFAULT_TOKEN_CEILING = 200_000;

/** Infrastructure the orchestrator talks to. Production passes the real ones; tests fakes. */
export interface OrchestratorPorts {
  db: Db;
  /** Spec retrieval for URL checks. Default: the real HTTP retriever. */
  specSource?: SpecRetriever;
  /** oasdiff runner. Default: the real binary. */
  oasdiff?: OasdiffRunner;
  /** The only route to a model (C-06). */
  llm: LlmAdapter;
  /** Validation steps (default: the real Docker validator and guards). */
  validator?: Pick<RepairDeps, 'validate' | 'guardedValidate'>;
  /** GitHub access for delivery (env, client factory, patch rebuilding). */
  github?: DeliverDeps;
  /** Repository reading for Locate. */
  locate?: LocateDependencies;
  /** Time source for the stage rows the orchestrator writes itself. Default `new Date()`. */
  clock?: () => Date;
}

/** Run settings. */
export interface OrchestratorOptions {
  /** Evaluation only: record would-open-PR without accessing GitHub. */
  dryRunDelivery?: boolean;
  /** Most input + output tokens one run may use (FR-24). Default {@link DEFAULT_TOKEN_CEILING}. */
  tokenCeiling?: number;
  /** Per-call model limits. */
  llm?: Partial<LlmOptions>;
  /** Allow-listed variables for the validation container (for example `API_VERSION`). */
  sandboxEnv?: Record<string, string>;
  limits?: SandboxLimits;
  docker?: DockerOptions;
  workcopy?: WorkcopyOptions;
  /** Where secrets are looked up for scrubbing. Default `process.env`. */
  env?: Record<string, string | undefined>;
}

/** A run request was refused because another run is in flight (SRS 2.3). HTTP 409. */
export class RunBusyError extends Error {
  readonly statusCode = 409;
  constructor() {
    super('Another run is in progress; only one run runs at a time. Retry when it finishes.');
    this.name = 'RunBusyError';
  }
}

/** A run request that cannot start (unknown ids, unreadable repository, wrong state). */
export class RunInputError extends Error {
  constructor(
    readonly statusCode: 400 | 404 | 409 | 422,
    readonly field: string,
    message: string,
  ) {
    super(message);
    this.name = 'RunInputError';
  }
}

/** A started run: its row (status `running`) and a promise for the finished row. */
export interface RunHandle {
  run: Run;
  /** Resolves with the finished run. Rejects only if even the failure could not be stored. */
  done: Promise<Run>;
}

/** Request to start a run. */
export interface StartRunInput {
  changeId: string;
  repositoryId: string;
  /** `full` (B3, default) or `single_shot` (B2, evaluation only; never delivered). */
  mode?: RepairMode;
}

/** Options for the spec-check flow. */
export interface CheckSpecOptions {
  /**
   * Migration-note YAML for the (baseline → new version) pair, stored before classification so
   * it can confirm mappings (UC-01 step 3, FR-09).
   */
  migrationNote?: string;
}

/** Spec-check result: the ingest response plus what the rest of the flow did. */
export type SpecCheckResult = IngestResponse & { pipeline: SpecPipeline };

/** Reason recorded when the single-shot baseline (B2) finishes: it is scored, not delivered. */
export const SINGLE_SHOT_NOT_DELIVERED =
  'Single-shot evaluation run (B2): the patch was scored, not delivered.';

/** Reason recorded on a run that was still running when the server stopped. */
export const INTERRUPTED_REASON =
  'The server stopped while this stage was running; nothing after it ran. Start a reanalysis.';

function message(cause: unknown): string {
  if (cause instanceof Error && cause.message) return cause.message;
  return 'Unexpected error';
}

/** Commit at HEAD of a git repository root, or `null` when it cannot be read. */
async function headCommit(repoPath: string): Promise<string | null> {
  try {
    const { stdout } = await exec('git', ['-C', repoPath, 'rev-parse', '--verify', 'HEAD'], {
      timeout: 5000,
      env: { PATH: process.env.PATH ?? '', GIT_CONFIG_NOSYSTEM: '1', GIT_TERMINAL_PROMPT: '0' },
    });
    const sha = stdout.trim();
    return /^[0-9a-f]{40}([0-9a-f]{24})?$/.test(sha) ? sha : null;
  } catch {
    return null;
  }
}

function specVersionLabel(doc: unknown): string | undefined {
  if (!doc || typeof doc !== 'object' || !('info' in doc)) return undefined;
  const info = (doc as { info?: unknown }).info;
  if (!info || typeof info !== 'object' || !('version' in info)) return undefined;
  const v = (info as { version?: unknown }).version;
  return typeof v === 'string' ? v : undefined;
}

/** The pipeline orchestrator. Create one per process; it holds the one-run-at-a-time lock. */
export class Orchestrator {
  private busy = false;
  private inFlight: Promise<unknown> = Promise.resolve();
  private readonly checks = new CheckQueue();
  private readonly db: Db;
  private readonly clock: () => Date;

  constructor(
    private readonly ports: OrchestratorPorts,
    private readonly options: OrchestratorOptions = {},
  ) {
    this.db = ports.db;
    this.clock = ports.clock ?? (() => new Date());
    const ceiling = options.tokenCeiling ?? DEFAULT_TOKEN_CEILING;
    if (!Number.isSafeInteger(ceiling) || ceiling < 1)
      throw new Error('tokenCeiling must be a positive integer');
  }

  /** Whether a run (or delivery retry) is in flight. */
  get isBusy(): boolean {
    return this.busy;
  }

  /** Resolves once the run in flight (if any) has finished. Used on shutdown. */
  async idle(): Promise<void> {
    await this.inFlight.catch(() => undefined);
  }

  private secrets(extra: readonly string[] = []): string[] {
    return knownSecrets(this.options.env ?? process.env, extra);
  }

  private scrub(text: string, extra: readonly string[] = []): string {
    return scrubText(text, this.secrets(extra)).slice(0, 4000);
  }

  // ---------------------------------------------------------------- spec-check flow (UC-02)

  /**
   * Spec-check flow for one API: ingest; when the ingested version differs from the baseline,
   * detect and classify the (baseline → new) pair, and only then advance the baseline. A failed
   * ingest, detect or classify is a failed spec check naming the stage; the baseline is not
   * advanced (NFR-02). Re-checking after a failure retries detection, because the trigger is
   * "ingested version ≠ baseline", not "new hash".
   * @param apiId - API to check.
   * @param source - Uploaded text, URL retrieval, or a demo fixture.
   * @param opts - Optional migration note for the pair.
   * @throws ApiNotFoundError when the API does not exist.
   */
  async checkSpec(
    apiId: string,
    source: IngestSource,
    opts: CheckSpecOptions = {},
  ): Promise<SpecCheckResult> {
    return this.checks.run(async () => {
      const response = await ingest(this.db, apiId, source, this.ports.specSource ?? retrieveSpec);
      if (response.check.outcome.value === 'failed')
        return {
          ...response,
          pipeline: {
            changeIds: [],
            baselineAdvanced: false,
            failure: {
              stage: { value: 'ingest', label: STAGE_LABELS.ingest },
              detail: response.check.errorDetail ?? 'Ingest failed.',
            },
          },
        };
      const to = response.check.specVersionId;
      const from = response.baselineVersionId;
      if (!to || !from || to === from)
        return { ...response, pipeline: { changeIds: [], baselineAdvanced: false, failure: null } };

      let stage: 'detect' | 'classify' = 'classify';
      let runnerFinished = false;
      try {
        if (opts.migrationNote !== undefined)
          await this.storeMigrationNote(apiId, from, to, opts.migrationNote);
        stage = 'detect';
        const oasdiff = this.ports.oasdiff ?? runOasdiff;
        const runner: OasdiffRunner = async (base, revision, o) => {
          const out = await oasdiff(base, revision, o);
          runnerFinished = true;
          return out;
        };
        const result = await detectAndClassify(this.db, apiId, from, to, { runner });
        if (!result.ok) {
          const error = result.error;
          if (error.code === 'invalid_note')
            return this.failCheck(
              response,
              'classify',
              `Migration note is invalid: ${error.errors.map((f) => `${f.field}: ${f.message}`).join('; ')}`,
            );
          return this.failCheck(response, 'detect', `${error.code}: ${error.message}`);
        }
        stage = 'classify';
        await advanceBaseline(this.db, apiId, to);
        return {
          ...response,
          baselineVersionId: to,
          pipeline: {
            changeIds: result.value.map((c) => c.id),
            baselineAdvanced: true,
            failure: null,
          },
        };
      } catch (cause) {
        const failed = stage === 'detect' && runnerFinished ? 'classify' : stage;
        return this.failCheck(response, failed, message(cause));
      }
    });
  }

  private async storeMigrationNote(apiId: string, from: string, to: string, rawYaml: string) {
    const parsed = parseMigrationNote(rawYaml);
    if (!parsed.ok)
      throw new Error(
        `Migration note is invalid: ${parsed.error.map((f) => `${f.field}: ${f.message}`).join('; ')}`,
      );
    const before = await getSpecVersionById(this.db, from);
    const after = await getSpecVersionById(this.db, to);
    if (
      parsed.value.from !== specVersionLabel(before?.normalized) ||
      parsed.value.to !== specVersionLabel(after?.normalized)
    )
      throw new Error('Migration note versions do not match the baseline and the new version');
    const existing = await this.db
      .select({ id: migrationNotes.id, rawYaml: migrationNotes.rawYaml })
      .from(migrationNotes)
      .where(and(eq(migrationNotes.fromVersionId, from), eq(migrationNotes.toVersionId, to)));
    if (existing.some((n) => n.rawYaml === rawYaml)) return;
    await insertMigrationNote(this.db, {
      apiId,
      fromVersionId: from,
      toVersionId: to,
      rawYaml,
      parsed: parsed.value,
    });
  }

  /** Records a failed spec check naming `stage`; the baseline stays where it was. */
  private async failCheck(
    response: IngestResponse,
    stage: 'detect' | 'classify',
    detail: string,
  ): Promise<SpecCheckResult> {
    const text = this.scrub(`${STAGE_LABELS[stage]} failed: ${detail}`);
    const now = this.clock();
    const [row] = await this.db
      .insert(specChecks)
      .values({
        apiId: response.check.apiId,
        outcome: 'failed',
        specVersionId: response.check.specVersionId,
        errorDetail: text,
        failureStage: stage,
        startedAt: now,
        finishedAt: now,
      })
      .returning();
    if (!row) throw new Error('Could not record the failed check');
    return {
      ...response,
      check: {
        id: row.id,
        apiId: row.apiId,
        startedAt: row.startedAt.toISOString(),
        finishedAt: row.finishedAt?.toISOString() ?? null,
        outcome: { value: 'failed', label: SPEC_CHECK_OUTCOME_LABELS.failed },
        specVersionId: row.specVersionId,
        errorDetail: row.errorDetail,
        failureStage: { value: stage, label: STAGE_LABELS[stage] },
      },
      pipeline: {
        changeIds: [],
        baselineAdvanced: false,
        failure: { stage: { value: stage, label: STAGE_LABELS[stage] }, detail: text },
      },
    };
  }

  // ---------------------------------------------------------------- run flow (UC-03, UC-04)

  /** Takes the one-run lock or throws {@link RunBusyError}. */
  private acquire(): () => void {
    if (this.busy) throw new RunBusyError();
    this.busy = true;
    let released = false;
    return () => {
      if (!released) {
        released = true;
        this.busy = false;
      }
    };
  }

  /**
   * Starts one run for a change against a repository. The run row is created (status
   * `running`, the repository's current commit, `is_fixture` when the change's spec versions
   * are fixtures, BR-06) before this returns; the stages continue in the background.
   * @throws RunBusyError when another run is in flight.
   * @throws RunInputError for an unknown change/repository or an unreadable repository.
   */
  async startRun(input: StartRunInput): Promise<RunHandle> {
    return this.begin(input, null);
  }

  /**
   * Reanalysis (FR-39): a **new** run for the same change and repository at the repository's
   * current commit, linked by `parent_run_id`. The earlier run is never touched.
   * @param runId - A finished run.
   * @param mode - Repair mode (default: full).
   */
  async reanalyze(runId: string, mode?: RepairMode): Promise<RunHandle> {
    const parent = await getRunById(this.db, runId);
    if (!parent) throw new RunInputError(404, 'id', 'Run not found');
    if (!parent.finishedAt)
      throw new RunInputError(409, 'id', 'The run is still running; reanalyze it once finished');
    return this.begin(
      {
        changeId: parent.changeId,
        repositoryId: parent.repositoryId,
        ...(mode ? { mode } : {}),
      },
      parent.id,
    );
  }

  private async begin(input: StartRunInput, parentRunId: string | null): Promise<RunHandle> {
    const release = this.acquire();
    let run: Run;
    let change: Change;
    let repository: Repository;
    try {
      const c = await getChangeById(this.db, input.changeId);
      if (!c) throw new RunInputError(404, 'changeId', 'Change not found');
      const r = await getRepositoryById(this.db, input.repositoryId);
      if (!r) throw new RunInputError(404, 'repositoryId', 'Repository not found');
      if (!r.localPath)
        throw new RunInputError(422, 'repositoryId', 'Repository has no local path to analyze');
      const commitSha = await headCommit(r.localPath);
      if (!commitSha)
        throw new RunInputError(
          422,
          'repositoryId',
          'Repository is unreadable: its local path is not a git repository with a commit',
        );
      const from = await getSpecVersionById(this.db, c.fromVersionId);
      const to = await getSpecVersionById(this.db, c.toVersionId);
      change = c;
      repository = r;
      run = await insertRun(this.db, {
        changeId: c.id,
        repositoryId: r.id,
        commitSha,
        parentRunId,
        stageReached: 'locate',
        isFixture: from?.sourceMode === 'fixture' || to?.sourceMode === 'fixture',
      });
    } catch (cause) {
      release();
      throw cause;
    }
    const done = this.execute(run, change, repository, input.mode ?? 'full').finally(release);
    this.inFlight = done;
    return { run, done };
  }

  /** Locate → repair → deliver / flag, each stage recorded before the next. */
  private async execute(
    run: Run,
    change: Change,
    repository: Repository,
    mode: RepairMode,
  ): Promise<Run> {
    const db = this.db;
    let stage: Stage = 'locate';
    try {
      const target = locateTarget(change);
      if (!target) {
        const reason =
          'The change is not tied to one HTTP operation, so its call sites cannot be located: needs review.';
        const now = this.clock();
        await insertStageResult(db, {
          runId: run.id,
          stage: 'locate',
          status: 'skipped',
          result: { reason },
          startedAt: now,
          finishedAt: now,
        });
        return await finishRun(db, run.id, { status: 'needs_review', flaggedReason: reason });
      }
      const located = await locate(
        db,
        run.id,
        repository.localPath!,
        target,
        this.ports.locate ?? {},
      );
      if (located.outcome !== 'affected')
        return await finishRun(db, run.id, {
          status: located.outcome,
          flaggedReason: this.scrub(located.reason),
        });

      stage = 'repair';
      const analyzed = (await getRunById(db, run.id))!;
      const o = this.options;
      const outcome = await repair(
        {
          db,
          runId: run.id,
          change: repairChange(change),
          specSectionBefore: change.evidenceBefore ?? null,
          specSectionAfter: change.evidenceAfter ?? null,
          migrationNoteEntry: migrationNoteEntry(change),
          locateResult: located,
          repo: { path: repository.localPath!, commit: analyzed.commitSha },
          ...(o.sandboxEnv ? { env: o.sandboxEnv } : {}),
          adapter: this.ports.llm,
          tokenCeiling: o.tokenCeiling ?? DEFAULT_TOKEN_CEILING,
          mode,
          ...(o.llm ? { llm: o.llm } : {}),
          ...(o.limits ? { limits: o.limits } : {}),
          ...(o.docker ? { docker: o.docker } : {}),
          ...(o.workcopy ? { workcopy: o.workcopy } : {}),
        },
        this.ports.validator ?? {},
      );

      if (outcome.status === 'stage_failure') {
        return await finishRun(db, run.id, {
          status: 'stage_failure',
          failureStage: outcome.failureStage ?? 'repair',
          failureDetail: this.scrub(outcome.reason),
        });
      }
      if (outcome.status !== 'repaired')
        return await recordFlaggedFinding({
          db,
          runId: run.id,
          status: outcome.status,
          reason: this.scrub(outcome.reason),
        });

      stage = 'deliver';
      if (mode === 'single_shot' || this.options.dryRunDelivery) {
        const reason =
          mode === 'single_shot'
            ? SINGLE_SHOT_NOT_DELIVERED
            : 'Dry-run delivery: would open PR; no GitHub request made.';
        const now = this.clock();
        await insertStageResult(db, {
          runId: run.id,
          stage: 'deliver',
          status: 'skipped',
          result: { reason, pullRequest: null, wouldOpenPr: mode === 'full' },
          startedAt: now,
          finishedAt: now,
        });
        return await finishRun(db, run.id, {
          status: 'repaired',
          flaggedReason: reason,
        });
      }
      const patch = outcome.finalPatch;
      if (patch === undefined) throw new Error('Repair reported success without a patch');
      const note = change.migrationNoteId
        ? ((
            await db
              .select()
              .from(migrationNotes)
              .where(eq(migrationNotes.id, change.migrationNoteId))
          )[0] ?? null)
        : null;
      const evidence = buildDeliveryEvidence({
        runId: run.id,
        isFixture: run.isFixture,
        change,
        note,
        callSites: await listCallSites(db, run.id),
        attempts: await listAttempts(db, run.id),
        patch,
      });
      await deliver({ db, runId: run.id, repository, patch, evidence }, this.ports.github ?? {});
      return (await getRunById(db, run.id))!;
    } catch (cause) {
      return this.recordStageFailure(run.id, stage, cause, repository);
    }
  }

  /**
   * Turns a thrown failure into a `failed` stage row (unless the stage already wrote one) and a
   * `stage_failure` run naming that stage, with a scrubbed detail (NFR-02, NFR-04).
   */
  private async recordStageFailure(
    runId: string,
    stage: Stage,
    cause: unknown,
    repository?: Repository,
  ): Promise<Run> {
    const extra = repository?.credentialRef ? [repository.credentialRef] : [];
    const detail = this.scrub(`${STAGE_LABELS[stage]} failed: ${message(cause)}`, extra);
    const run = await getRunById(this.db, runId);
    if (!run) throw new Error('Run not found');
    if (run.finishedAt) return run;
    const existing = await this.db
      .select({ id: runStageResults.id })
      .from(runStageResults)
      .where(and(eq(runStageResults.runId, runId), eq(runStageResults.stage, stage)));
    if (!existing.length) {
      const now = this.clock();
      await insertStageResult(this.db, {
        runId,
        stage,
        status: 'failed',
        result: { error: detail },
        startedAt: now,
        finishedAt: now,
      });
    }
    return finishRun(this.db, runId, {
      status: 'stage_failure',
      stageReached: stage,
      failureStage: stage,
      failureDetail: detail,
    });
  }

  /**
   * Retries a failed delivery (FR-37) as a new child run that re-delivers the stored validated
   * patch. Shares the one-run lock.
   * @param runId - A run that ended as `stage_failure` of `deliver`.
   * @returns The finished child run.
   */
  async retryDelivery(runId: string): Promise<Run> {
    const failed = await getRunById(this.db, runId);
    if (!failed) throw new RunInputError(404, 'id', 'Run not found');
    if (failed.status !== 'stage_failure' || failed.failureStage !== 'deliver')
      throw new RunInputError(409, 'id', 'Only a run whose delivery failed can be retried');
    const release = this.acquire();
    const work = (async () => {
      try {
        const out = await retryDeliveryStage(this.db, runId, this.ports.github ?? {});
        return (await getRunById(this.db, out.runId))!;
      } catch (cause) {
        throw new RunInputError(409, 'id', this.scrub(message(cause)));
      } finally {
        release();
      }
    })();
    this.inFlight = work;
    return work;
  }

  /**
   * Finishes runs left `running` by a stopped server (DR-01, NFR-02): each gets a `failed` row
   * for the stage it had reached (unless one exists) and ends as `stage_failure` of that stage.
   * Call once at startup, before any new run starts.
   * @param scope - Limit recovery to one repository (tests, or a deployment that shares one
   *   database between servers). Default: every running run.
   * @returns The ids of the runs that were finished.
   */
  async recoverInterruptedRuns(scope: { repositoryId?: string } = {}): Promise<string[]> {
    if (this.busy) throw new RunBusyError();
    const stale = await this.db
      .select()
      .from(runs)
      .where(
        scope.repositoryId
          ? and(eq(runs.status, 'running'), eq(runs.repositoryId, scope.repositoryId))
          : eq(runs.status, 'running'),
      );
    for (const run of stale)
      await this.recordStageFailure(run.id, run.stageReached, new Error(INTERRUPTED_REASON));
    return stale.map((r) => r.id);
  }
}
