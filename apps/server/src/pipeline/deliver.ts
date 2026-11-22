/**
 * Stage 7, Deliver (FR-33 to FR-37, C-02, BR-03).
 *
 * - {@link deliver}: a validated patch becomes a new `sma/…` branch (built with the Git Data
 *   API on the **analyzed commit**) and a labelled pull request with full evidence. The system
 *   never merges, never enables auto-merge and never writes the default branch: the GitHub
 *   client cannot do any of that.
 * - A delivery failure is its own `stage_failure` (failure stage `deliver`). The validated patch
 *   stays in its attempt row, and {@link retryDelivery} re-delivers it in a new child run.
 * - {@link recordFlaggedFinding}: a refused, failed, cheating or aborted run opens no pull
 *   request; the reason is stored.
 *
 * The token is read from the env var named by `repositories.credential_ref` at call time and
 * never appears in stored results, errors or PR text (NFR-04).
 * @packageDocumentation
 */
import { and, eq } from 'drizzle-orm';
import {
  DELIVERY_LABELS,
  buildPrBody,
  buildPrTitle,
  deliveryBranchName,
  redactForDelivery,
  unsafePathReason,
  type DeliveryEvidence,
  type RunStatus,
} from '@sma/core';
import {
  finishRun,
  getRepositoryById,
  getRunById,
  insertRun,
  insertStageResult,
  listAttempts,
  listChildRuns,
  type Db,
  type Repository,
  type Run,
} from '../infra/db/index.js';
import { runStageResults } from '../infra/db/schema.js';
import {
  createGitHubClient,
  type GitHubClientOptions,
  type SafeGitHubClient,
} from '../infra/github/client.js';
import { patchedFilesFromPatch, type PatchedFile } from '../infra/workcopy/materialize.js';

export type { PatchedFile } from '../infra/workcopy/materialize.js';

/** Statuses a flagged finding may end a run with (FR-36). */
export const FLAGGED_STATUSES = ['flagged', 'failed', 'cheating_rejected', 'aborted'] as const;
/** One of {@link FLAGGED_STATUSES}. */
export type FlaggedStatus = (typeof FLAGGED_STATUSES)[number];

/** Replaceable infrastructure (tests use a mocked GitHub API). */
export interface DeliverDeps {
  /** Where `credential_ref` is looked up. Default `process.env`, read at call time. */
  env?: Record<string, string | undefined>;
  /** Builds the GitHub client. Default {@link createGitHubClient}. */
  createClient?: (options: GitHubClientOptions) => SafeGitHubClient;
  /** Rebuilds patched file contents from a stored patch. Default {@link patchedFilesFromPatch}. */
  materialize?: (
    repoPath: string,
    commitSha: string | undefined,
    patch: string,
  ) => Promise<{ ok: true; value: PatchedFile[] } | { ok: false; error: { message: string } }>;
}

/** Input to {@link deliver}. */
export interface DeliverInput {
  db: Db;
  /** An unfinished run whose latest attempt passed validation with exactly `patch`. */
  runId: string;
  repository: Repository;
  /** The validated unified diff. */
  patch: string;
  /** Contents of the files `patch` changes. Rebuilt from the patch when omitted. */
  patchedFiles?: PatchedFile[];
  evidence: DeliveryEvidence;
}

/** What delivery returns. The run is finished either way. */
export type DeliverOutcome =
  | { status: 'delivered'; runId: string; prUrl: string; prNumber: number; branch: string }
  | { status: 'stage_failure'; runId: string; reason: string };

/** Partial GitHub progress, stored on a failure so a retry resumes instead of duplicating. */
interface DeliveryProgress {
  branch?: string;
  commitSha?: string;
  prNumber?: number;
  prUrl?: string;
}

/** What a failed `deliver` stage row stores for {@link retryDelivery}. */
interface FailedDeliveryResult {
  error: string;
  sourceRunId: string;
  evidence: DeliveryEvidence;
  progress: DeliveryProgress;
}

class DeliveryFailure extends Error {}

/** A copy of JSON data with every string (keys included) passed through redaction. */
function redactDeep<T>(value: T, secrets: readonly string[]): T {
  const walk = (v: unknown): unknown => {
    if (typeof v === 'string') return redactForDelivery(v, secrets);
    if (Array.isArray(v)) return v.map(walk);
    if (v && typeof v === 'object')
      return Object.fromEntries(
        Object.entries(v).map(([k, x]) => [redactForDelivery(k, secrets), walk(x)]),
      );
    return v;
  };
  return walk(value) as T;
}

/** The latest attempt of `sourceRunId`, which must have passed validation. */
async function validatedPatch(db: Db, sourceRunId: string) {
  const rows = await listAttempts(db, sourceRunId);
  const last = rows.at(-1);
  if (!last || last.outcome !== 'pass')
    throw new Error('Only a patch that passed validation can be delivered (FR-33, FR-36)');
  return last;
}

async function assertNoDeliverRow(db: Db, runId: string): Promise<void> {
  const rows = await db
    .select({ id: runStageResults.id })
    .from(runStageResults)
    .where(and(eq(runStageResults.runId, runId), eq(runStageResults.stage, 'deliver')));
  if (rows.length) throw new Error('Run already has a deliver result');
}

interface CoreInput {
  db: Db;
  run: Run;
  sourceRunId: string;
  repository: Repository;
  patch: string;
  patchedFiles?: PatchedFile[];
  evidence: DeliveryEvidence;
  resume?: DeliveryProgress;
  retryOf?: string;
  deps: DeliverDeps;
}

/** Shared by {@link deliver} and {@link retryDelivery}: GitHub calls, stage row, finish. */
async function deliverCore(input: CoreInput): Promise<DeliverOutcome> {
  const { db, run, repository, evidence, deps } = input;
  const started = new Date();
  const env = deps.env ?? process.env;
  const ref = repository.credentialRef;
  const token = ref ? (env[ref] ?? '') : '';
  const secrets = token ? [token] : [];
  const progress: DeliveryProgress = { ...input.resume };
  const stamp = () => new Date(Math.max(Date.now(), started.getTime()));

  try {
    if (!ref) throw new DeliveryFailure('The repository has no credential_ref configured.');
    if (!token) throw new DeliveryFailure(`Environment variable ${ref} is not set.`);
    const client = (deps.createClient ?? createGitHubClient)({
      owner: repository.owner,
      repo: repository.name,
      defaultBranch: repository.defaultBranch,
      token,
    });
    const repoInfo = await client.getRepo();

    // Resume from a branch an earlier attempt created, but only if it is still untouched.
    if (progress.branch && !progress.prNumber) {
      const head = await client.getRef(progress.branch).catch(() => undefined);
      if (!head || head.sha !== progress.commitSha) {
        progress.branch = undefined;
        progress.commitSha = undefined;
      }
    }

    if (!progress.branch) {
      let files = input.patchedFiles;
      if (!files) {
        if (!repository.localPath)
          throw new DeliveryFailure('The repository has no local path to rebuild the patch from.');
        const materialize = deps.materialize ?? patchedFilesFromPatch;
        const built = await materialize(repository.localPath, run.commitSha, input.patch);
        if (!built.ok)
          throw new DeliveryFailure(`Could not rebuild the patched files: ${built.error.message}`);
        files = built.value;
      }
      if (!files.length) throw new DeliveryFailure('The patch changes no files.');
      for (const f of files) {
        const reason = unsafePathReason(f.path);
        if (reason) throw new DeliveryFailure(`Unsafe path in patch: ${reason}`);
      }

      let base;
      try {
        base = await client.getCommit(run.commitSha);
      } catch (e) {
        if ((e as { status?: number }).status === 404 || (e as { status?: number }).status === 422)
          throw new DeliveryFailure(
            `The analyzed commit ${run.commitSha} is not in ${repoInfo.fullName}.`,
          );
        throw e;
      }
      const entries = [];
      for (const f of files)
        entries.push({
          path: f.path,
          mode: f.mode,
          blobSha: f.content === null ? null : (await client.createBlob(f.content)).sha,
        });
      const tree = await client.createTree(base.treeSha, entries);
      const title = buildPrTitle(evidence, secrets);
      const commit = await client.createCommit({
        message: `${title}\n\nMachine-generated by Self-Maintaining APIs (run ${run.id}). Awaiting human review.`,
        treeSha: tree.sha,
        parentSha: base.sha,
      });
      const branch = deliveryBranchName(run.id, evidence.change.category);
      await client.createBranch(branch, commit.sha);
      progress.branch = branch;
      progress.commitSha = commit.sha;
    }

    if (!progress.prNumber) {
      const pr = await client.createPullRequest({
        title: buildPrTitle(evidence, secrets),
        body: buildPrBody(evidence, secrets),
        head: progress.branch,
        base: repository.defaultBranch,
      });
      progress.prNumber = pr.number;
      progress.prUrl = pr.url;
    }

    for (const label of DELIVERY_LABELS) await client.ensureLabel(label);
    await client.addLabels(
      progress.prNumber,
      DELIVERY_LABELS.map((l) => l.name),
    );

    const prUrl = progress.prUrl!;
    await insertStageResult(db, {
      runId: run.id,
      stage: 'deliver',
      status: 'ok',
      result: {
        prUrl,
        prNumber: progress.prNumber,
        branch: progress.branch,
        commitSha: progress.commitSha,
        baseCommitSha: run.commitSha,
        labels: DELIVERY_LABELS.map((l) => l.name),
        sourceRunId: input.sourceRunId,
        ...(input.retryOf ? { retryOf: input.retryOf } : {}),
      },
      startedAt: started,
      finishedAt: stamp(),
    });
    await finishRun(db, run.id, { status: 'repaired', stageReached: 'deliver', prUrl });
    return {
      status: 'delivered',
      runId: run.id,
      prUrl,
      prNumber: progress.prNumber,
      branch: progress.branch!,
    };
  } catch (e) {
    const raw = e instanceof Error ? e.message : 'Delivery failed.';
    const reason = redactForDelivery(raw, secrets);
    const result: FailedDeliveryResult = {
      error: reason,
      sourceRunId: input.sourceRunId,
      // Stored for the retry and later exported: no credential may survive in it (NFR-04).
      evidence: redactDeep(evidence, secrets),
      progress,
    };
    await insertStageResult(db, {
      runId: run.id,
      stage: 'deliver',
      status: 'failed',
      result: { ...result, ...(input.retryOf ? { retryOf: input.retryOf } : {}) },
      startedAt: started,
      finishedAt: stamp(),
    });
    await finishRun(db, run.id, {
      status: 'stage_failure',
      stageReached: 'deliver',
      failureStage: 'deliver',
      failureDetail: `Delivery failed: ${reason} The validated patch is kept; delivery can be retried.`,
      ...(progress.prUrl ? { prUrl: progress.prUrl } : {}),
    });
    return { status: 'stage_failure', runId: run.id, reason };
  }
}

/**
 * Delivers a validated patch (FR-33 to FR-35): creates `sma/run-<runId>-<category>` on the
 * analyzed commit, opens a pull request titled `[SMA] <category>: <METHOD> <path>` with the
 * evidence body, and labels it `machine-generated` and `awaiting-human-review` (creating the
 * labels if missing). On success the run finishes as `repaired` with `pr_url` set. Any failure
 * finishes it as `stage_failure` of `deliver`, keeps the patch, and can be retried with
 * {@link retryDelivery} (FR-37).
 *
 * Throws (without touching GitHub) when the run is finished, already has a deliver result, or
 * its latest attempt did not pass validation with exactly this patch.
 * @param input - Run, repository, validated patch, patched files and evidence.
 * @param deps - Replaceable env, GitHub client and patch rebuilding.
 */
export async function deliver(
  input: DeliverInput,
  deps: DeliverDeps = {},
): Promise<DeliverOutcome> {
  const run = await getRunById(input.db, input.runId);
  if (!run) throw new Error('Run not found');
  if (run.finishedAt) throw new Error('Cannot deliver a finished run');
  if (run.repositoryId !== input.repository.id)
    throw new Error('Repository does not belong to the run');
  const attempt = await validatedPatch(input.db, run.id);
  if (attempt.patch !== input.patch)
    throw new Error('The patch to deliver is not the patch that passed validation');
  await assertNoDeliverRow(input.db, run.id);
  return deliverCore({
    db: input.db,
    run,
    sourceRunId: run.id,
    repository: input.repository,
    patch: input.patch,
    ...(input.patchedFiles ? { patchedFiles: input.patchedFiles } : {}),
    evidence: input.evidence,
    deps,
  });
}

/**
 * Retries a failed delivery (FR-37). The failed run is frozen (FR-39), so the retry is a new
 * child run (`parent_run_id` = the failed run) that delivers the **stored** validated patch and
 * evidence. It resumes from what the failed attempt already created on GitHub: an untouched
 * `sma/…` branch is reused, and a pull request that was opened only needs its labels.
 * @param db - Database handle.
 * @param runId - A run that ended as `stage_failure` of `deliver`.
 * @param deps - Replaceable env, GitHub client and patch rebuilding.
 * @returns The outcome for the new child run.
 */
export async function retryDelivery(
  db: Db,
  runId: string,
  deps: DeliverDeps = {},
): Promise<DeliverOutcome> {
  const failed = await getRunById(db, runId);
  if (!failed) throw new Error('Run not found');
  if (failed.status !== 'stage_failure' || failed.failureStage !== 'deliver')
    throw new Error('Only a run whose delivery failed can be retried');
  const children = await listChildRuns(db, failed.id);
  if (children.some((c) => c.status === 'running' || c.status === 'repaired'))
    throw new Error('This delivery was already retried');
  const row = (
    await db
      .select()
      .from(runStageResults)
      .where(and(eq(runStageResults.runId, failed.id), eq(runStageResults.stage, 'deliver')))
  )[0];
  if (!row || row.status !== 'failed')
    throw new Error('No failed delivery is recorded for this run');
  const stored = row.result as FailedDeliveryResult;
  const attempt = await validatedPatch(db, stored.sourceRunId);
  const repository = await getRepositoryById(db, failed.repositoryId);
  if (!repository) throw new Error('Repository not found');

  const child = await insertRun(db, {
    changeId: failed.changeId,
    repositoryId: failed.repositoryId,
    commitSha: failed.commitSha,
    parentRunId: failed.id,
    stageReached: 'deliver',
    isFixture: failed.isFixture,
  });
  return deliverCore({
    db,
    run: child,
    sourceRunId: stored.sourceRunId,
    repository,
    patch: attempt.patch,
    evidence: stored.evidence,
    resume: stored.progress ?? {},
    retryOf: failed.id,
    deps,
  });
}

/** Input to {@link recordFlaggedFinding}. */
export interface FlaggedFindingInput {
  db: Db;
  runId: string;
  /** Final run status: refused (`flagged`), `failed`, `cheating_rejected` or `aborted`. */
  status: FlaggedStatus;
  /** Plain-language reason, shown to the reviewer. */
  reason: string;
}

/**
 * Records a flagged finding (FR-36): no pull request, **no GitHub call at all** (this function
 * has no client and reads no credential). Writes a `skipped` deliver row with the reason and
 * finishes the run with `flagged_reason` set.
 * @param input - Run, final status and reason.
 */
export async function recordFlaggedFinding(input: FlaggedFindingInput): Promise<Run> {
  const { db, runId, status } = input;
  if (!(FLAGGED_STATUSES as readonly RunStatus[]).includes(status))
    throw new Error(`Not a flagged status: ${status}`);
  const reason = redactForDelivery(input.reason.trim());
  if (!reason) throw new Error('A flagged finding needs a reason');
  const run = await getRunById(db, runId);
  if (!run) throw new Error('Run not found');
  if (run.finishedAt) throw new Error('Cannot flag a finished run');
  await assertNoDeliverRow(db, runId);
  const now = new Date();
  await insertStageResult(db, {
    runId,
    stage: 'deliver',
    status: 'skipped',
    result: { flagged: true, status, reason, pullRequest: null },
    startedAt: now,
    finishedAt: now,
  });
  return finishRun(db, runId, { status, flaggedReason: reason });
}
