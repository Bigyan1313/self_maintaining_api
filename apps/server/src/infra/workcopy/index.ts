import { randomUUID } from 'node:crypto';
import { appendFile, cp, mkdir, realpath, rm } from 'node:fs/promises';
import { basename, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { err, inspectPatch, ok, type PatchFile, type Result } from '@sma/core';
import { runProcess } from '../process.js';

/** Typed working-copy failures. */
export type WorkcopyErrorCode = 'workcopy_failed' | 'patch_invalid';

/** A working-copy failure. */
export interface WorkcopyError {
  code: WorkcopyErrorCode;
  message: string;
}

/** An isolated working copy under `.work/<uuid>/`. */
export interface WorkingCopy {
  /** Absolute path of the copy. */
  path: string;
  /**
   * Commit checked out in the copy. For a git clone, the developer's commit. For a plain copy,
   * the baseline commit made in the copy itself.
   */
  commit: string;
  /** `git-clone` when the source is a git repository root, otherwise `copy`. */
  source: 'git-clone' | 'copy';
}

/** Where working copies live: `<project root>/.work` (gitignored). */
export const DEFAULT_WORK_ROOT = fileURLToPath(new URL('../../../../../.work', import.meta.url));

/** Options for working-copy functions. */
export interface WorkcopyOptions {
  /** Parent directory of working copies. Default {@link DEFAULT_WORK_ROOT}. */
  workRoot?: string;
}

/** Never copied into a plain working copy: installed deps, VCS data, our own scratch dirs. */
const SKIP_NAMES = new Set(['node_modules', '.git', '.work', '.sma']);

/** Ignored inside every working copy, so inc09 guards see only real source changes. */
const EXCLUDES = ['node_modules/', '.sma/'];

const COMMIT_SHA = /^[0-9a-f]{7,40}$/i;

/**
 * Environment for host git commands: no user or system config (so no hooks, filters, aliases
 * or credential helpers from the developer's setup), no prompts, and nothing else.
 */
function gitEnv(): Record<string, string> {
  return {
    PATH: process.env.PATH ?? '',
    GIT_CONFIG_NOSYSTEM: '1',
    GIT_CONFIG_GLOBAL: '/dev/null',
    GIT_TERMINAL_PROMPT: '0',
    LC_ALL: 'C',
  };
}

const GIT_SAFE = ['-c', 'core.hooksPath=/dev/null', '-c', 'core.symlinks=true'];

async function git(cwd: string, args: string[], input?: string) {
  return runProcess('git', [...GIT_SAFE, ...args], {
    cwd,
    env: gitEnv(),
    timeoutMs: 120_000,
    ...(input !== undefined ? { input } : {}),
  });
}

function fail(message: string): Result<never, WorkcopyError> {
  return err({ code: 'workcopy_failed', message });
}

/**
 * Resolves a path that must be a working copy directly inside the work root.
 * @param workDir - Candidate path.
 * @param options - Work root.
 * @returns The resolved path, or `null` if it is not a working copy.
 */
async function insideWorkRoot(workDir: string, options: WorkcopyOptions): Promise<string | null> {
  const root = resolve(options.workRoot ?? DEFAULT_WORK_ROOT);
  const target = resolve(workDir);
  if (!target.startsWith(root + sep) || target.slice(root.length + 1).includes(sep)) return null;
  try {
    const [realRoot, realTarget] = await Promise.all([realpath(root), realpath(target)]);
    return realTarget === join(realRoot, basename(realTarget)) ? target : null;
  } catch {
    return null;
  }
}

/**
 * Creates an isolated working copy in `.work/<uuid>/` (FR-20). The developer's repository is
 * only read, never written.
 *
 * - Source is a git repository root: `git clone --no-hardlinks`, then a detached checkout of
 *   `commitSha` (default: its `HEAD`), then the `origin` remote is removed.
 * - Otherwise (for example `demo/consumer`, a folder inside our own repo): a plain copy without
 *   `node_modules`, `.git`, `.work`, `.sma`, then `git init` and one baseline commit in the copy,
 *   so patches apply against a known state.
 *
 * Host git runs without user/system config and with hooks disabled.
 * @param repoPath - The developer's repository (or project folder).
 * @param commitSha - Commit to check out (git sources only).
 * @param options - Work root.
 * @returns The working copy, or a typed error.
 */
export async function createWorkingCopy(
  repoPath: string,
  commitSha?: string,
  options: WorkcopyOptions = {},
): Promise<Result<WorkingCopy, WorkcopyError>> {
  if (commitSha !== undefined && !COMMIT_SHA.test(commitSha))
    return fail('commitSha must be 7–40 hexadecimal characters');
  let source: string;
  try {
    source = await realpath(repoPath);
  } catch {
    return fail('the repository path does not exist');
  }
  const workRoot = resolve(options.workRoot ?? DEFAULT_WORK_ROOT);
  await mkdir(workRoot, { recursive: true });
  const dest = join(workRoot, randomUUID());

  const top = await git(source, ['rev-parse', '--show-toplevel']);
  const isGitRoot =
    top.exitCode === 0 && (await realpath(top.output.trim()).catch(() => '')) === source;

  try {
    if (isGitRoot) {
      const clone = await git(workRoot, [
        'clone',
        '--no-hardlinks',
        '--no-checkout',
        '--quiet',
        '--',
        source,
        dest,
      ]);
      if (clone.exitCode !== 0) throw new Error('git clone failed');
      const target = commitSha ?? 'HEAD';
      const verify = await git(dest, ['rev-parse', '--verify', '--quiet', `${target}^{commit}`]);
      if (verify.exitCode !== 0) throw new Error(`commit ${target} is not in the repository`);
      const sha = verify.output.trim();
      const checkout = await git(dest, [
        '-c',
        'advice.detachedHead=false',
        'checkout',
        '--quiet',
        '--detach',
        sha,
      ]);
      if (checkout.exitCode !== 0) throw new Error('git checkout failed');
      await git(dest, ['remote', 'remove', 'origin']);
      await appendFile(join(dest, '.git', 'info', 'exclude'), `\n${EXCLUDES.join('\n')}\n`);
      return ok({ path: dest, commit: sha, source: 'git-clone' });
    }
    if (commitSha !== undefined) throw new Error('commitSha needs a git repository root');
    await cp(source, dest, {
      recursive: true,
      verbatimSymlinks: true,
      errorOnExist: true,
      filter: (src) => !SKIP_NAMES.has(basename(src)) || src === source,
    });
    const init = await git(dest, ['init', '--quiet', '--initial-branch=sma-baseline']);
    if (init.exitCode !== 0) throw new Error('git init failed');
    await appendFile(join(dest, '.git', 'info', 'exclude'), `\n${EXCLUDES.join('\n')}\n`);
    const add = await git(dest, ['add', '--all']);
    if (add.exitCode !== 0) throw new Error('git add failed');
    const commit = await git(dest, [
      '-c',
      'user.name=sma-validator',
      '-c',
      'user.email=validator@sma.invalid',
      'commit',
      '--quiet',
      '--no-gpg-sign',
      '--no-verify',
      '--allow-empty',
      '-m',
      'sma: baseline copy',
    ]);
    if (commit.exitCode !== 0) throw new Error('baseline commit failed');
    const head = await git(dest, ['rev-parse', 'HEAD']);
    return ok({ path: dest, commit: head.output.trim(), source: 'copy' });
  } catch (e) {
    await rm(dest, { recursive: true, force: true });
    return fail(e instanceof Error ? e.message : 'cannot create the working copy');
  }
}

/**
 * Applies a unified diff to a working copy: {@link inspectPatch} first (no `..`, no absolute
 * paths, nothing under `.git`, no binary, symlink or submodule entries), then
 * `git apply --check`, then `git apply`. Any rejection is `patch_invalid`.
 * @param workDir - A working copy from {@link createWorkingCopy}.
 * @param unifiedDiff - The patch text.
 * @param options - Work root.
 * @returns The files the patch touched, or a typed error.
 */
export async function applyPatch(
  workDir: string,
  unifiedDiff: string,
  options: WorkcopyOptions = {},
): Promise<Result<PatchFile[], WorkcopyError>> {
  const inspected = inspectPatch(unifiedDiff);
  if (!inspected.ok) return err({ code: 'patch_invalid', message: inspected.error.reason });
  const dir = await insideWorkRoot(workDir, options);
  if (!dir) return fail('not a working copy under the work root');
  const input = unifiedDiff.endsWith('\n') ? unifiedDiff : `${unifiedDiff}\n`;
  const check = await git(dir, ['apply', '--check', '--whitespace=nowarn', '-'], input);
  if (check.exitCode !== 0)
    return err({ code: 'patch_invalid', message: 'git apply --check rejected the patch' });
  const apply = await git(dir, ['apply', '--whitespace=nowarn', '-'], input);
  if (apply.exitCode !== 0) return err({ code: 'patch_invalid', message: 'git apply failed' });
  return ok(inspected.value);
}

/**
 * Deletes a working copy. Refuses any path that is not directly inside the work root.
 * @param workDir - A working copy from {@link createWorkingCopy}.
 * @param options - Work root.
 * @returns `true` if it was deleted (or was already gone).
 */
export async function disposeWorkingCopy(
  workDir: string,
  options: WorkcopyOptions = {},
): Promise<boolean> {
  const dir = await insideWorkRoot(workDir, options);
  if (!dir) return false;
  await rm(dir, { recursive: true, force: true });
  return true;
}
