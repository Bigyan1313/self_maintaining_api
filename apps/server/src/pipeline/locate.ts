import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { realpath } from 'node:fs/promises';
import { and, eq, sql } from 'drizzle-orm';
import { locateCallSites, type LocateResult, type LocateTarget, type RepoReader } from '@sma/core';
import {
  type Db,
  insertCallSites,
  insertCoverageEntries,
  insertStageResult,
} from '../infra/db/index.js';
import { repositories, runs, runStageResults } from '../infra/db/schema.js';
import { fileSystemRepoReader } from '../infra/repo/reader.js';

const exec = promisify(execFile);
/** Optional read adapter for deterministic failure/concurrency tests. */
export interface LocateDependencies {
  reader?: RepoReader;
}

async function commit(repoPath: string): Promise<string> {
  const { stdout } = await exec('git', ['-C', repoPath, 'rev-parse', '--verify', 'HEAD'], {
    timeout: 5000,
  });
  const sha = stdout.trim();
  if (!/^[0-9a-f]{40}([0-9a-f]{24})?$/.test(sha))
    throw new Error('Repository has no valid HEAD commit');
  return sha;
}
async function requireClean(repoPath: string): Promise<void> {
  const { stdout } = await exec(
    'git',
    [
      '-c',
      'core.fsmonitor=false',
      '-C',
      repoPath,
      'status',
      '--porcelain',
      '--untracked-files=all',
      '--ignore-submodules=all',
    ],
    { timeout: 5000 },
  );
  if (stdout.trim()) throw new Error('Commit or remove repository changes before analysis');
}

/**
 * Locate one operation and atomically persist commit, call sites, coverage and full stage result.
 * Requires an unfinished run for this repository. Repeated calls return its immutable result.
 * Target repositories must be clean so recorded source locations describe the recorded commit.
 */
export async function locate(
  db: Db,
  runId: string,
  repoPath: string,
  target: LocateTarget,
  deps: LocateDependencies = {},
): Promise<LocateResult> {
  return db.transaction(async (tx) => {
    const [run] = await tx.select().from(runs).where(eq(runs.id, runId)).for('update');
    if (!run) throw new Error('Run not found');
    if (run.finishedAt) throw new Error('Cannot locate for a finished run');
    const [repo] = await tx
      .select()
      .from(repositories)
      .where(eq(repositories.id, run.repositoryId));
    if (!repo?.localPath || (await realpath(repo.localPath)) !== (await realpath(repoPath)))
      throw new Error('Repository path does not belong to the run');
    const [previous] = await tx
      .select()
      .from(runStageResults)
      .where(and(eq(runStageResults.runId, runId), eq(runStageResults.stage, 'locate')));
    if (previous) {
      const stored = previous.result as { target: LocateTarget; locate: LocateResult };
      if (
        stored.target.method !== target.method ||
        stored.target.path !== target.path ||
        stored.target.operationId !== target.operationId ||
        stored.target.field !== target.field
      )
        throw new Error('Run already located a different target; create a new run');
      return stored.locate;
    }
    const start = (
      await tx
        .select({ time: sql`clock_timestamp()`.mapWith((s: string) => new Date(s)) })
        .from(runs)
        .where(eq(runs.id, runId))
    )[0]!;
    await requireClean(repoPath);
    const sha = await commit(repoPath);
    const result = await locateCallSites(repoPath, target, deps.reader ?? fileSystemRepoReader);
    await requireClean(repoPath);
    if ((await commit(repoPath)) !== sha)
      throw new Error('Repository commit changed during analysis');
    await tx.update(runs).set({ commitSha: sha, stageReached: 'locate' }).where(eq(runs.id, runId));
    await insertCallSites(
      tx,
      result.callSites.map((site) => ({ ...site, runId })),
    );
    await insertCoverageEntries(
      tx,
      result.coverage.map((entry) => ({ ...entry, runId })),
    );
    const finish = (
      await tx
        .select({ time: sql`clock_timestamp()`.mapWith((s: string) => new Date(s)) })
        .from(runs)
        .where(eq(runs.id, runId))
    )[0]!;
    await insertStageResult(tx, {
      runId,
      stage: 'locate',
      status: 'ok',
      result: { target, commitSha: sha, locate: result },
      startedAt: start.time,
      finishedAt: finish.time,
    });
    return result;
  });
}
