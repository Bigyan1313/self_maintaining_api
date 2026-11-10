import { lstat, readFile, realpath } from 'node:fs/promises';
import { join, relative, sep } from 'node:path';
import {
  err,
  inspectPatch,
  isTypeScriptPath,
  ok,
  parseUnifiedDiff,
  runCountGuard,
  runStaticGuards,
  type AttemptOutcome,
  type DiffFile,
  type GuardName,
  type PostPatchFiles,
  type Result,
  type ValidationResult,
} from '@sma/core';
import type { SandboxLimits } from '../infra/validator/sandbox.js';
import type { DockerOptions } from '../infra/validator/docker.js';
import {
  applyPatch,
  createWorkingCopy,
  disposeWorkingCopy,
  type WorkcopyOptions,
} from '../infra/workcopy/index.js';
import {
  validate,
  type ValidateError,
  type ValidateInput,
  type ValidateOutput,
} from './validate.js';

/** Largest post-patch file the guards read, in bytes. */
export const MAX_GUARD_FILE_BYTES = 2 * 1024 * 1024;

/** Input to {@link guardedValidate}. */
export interface GuardedValidateInput {
  /** The developer's repository. Never written. */
  repoPath: string;
  /** Commit to validate (git repository roots only). */
  commit?: string;
  /** The candidate patch (unified diff). */
  patch: string;
  /** Allow-listed env for the validate container (for example `API_VERSION`). */
  env?: Record<string, string>;
  /** The pre-patch baseline the count guard compares with (FR-28). */
  preResult: ValidationResult;
  limits?: SandboxLimits;
  docker?: DockerOptions;
  workcopy?: WorkcopyOptions;
  /** Delete the validator's working copy before returning. Default `true`. */
  dispose?: boolean;
}

/** Replaceable steps, so tests can prove the validator is never called for a cheat. */
export interface GuardedValidateDeps {
  validate?: (input: ValidateInput) => Promise<Result<ValidateOutput, ValidateError>>;
  readPostPatchFiles?: typeof readPostPatchFiles;
}

/**
 * The verdict for one candidate patch. `guard` and `evidence` are set exactly when
 * `outcome` is `cheating` (DR-04). `result` is set whenever validation ran. `error` is set for a
 * typed failure (an unsafe or malformed patch, Docker down, …).
 */
export interface GuardedVerdict {
  outcome: AttemptOutcome;
  guard?: GuardName;
  evidence?: string[];
  result?: ValidationResult;
  error?: ValidateError;
  /** Whether the container ran for this patch. Always `false` after a static guard rejection. */
  validated: boolean;
}

const insideDir = (dir: string, path: string) => {
  const rel = relative(dir, path);
  return rel !== '' && !rel.startsWith('..') && !rel.startsWith(sep);
};

/**
 * Reads the post-patch text of the TypeScript files a patch changes, for the
 * `type_suppression` syntax-tree checks. Host-side only. It makes a throwaway working copy,
 * applies the patch with `git apply` (the same step the validator runs next), reads the files,
 * and deletes the copy. No target-repository code runs.
 *
 * A file is read only if it is a regular file (never through a symlink), resolves inside the
 * copy, and is at most {@link MAX_GUARD_FILE_BYTES}. Files that fail these checks are left out,
 * and the guard then falls back to text matching (it never treats them as clean).
 * @param repoPath - The developer's repository.
 * @param commit - Commit (git repository roots only).
 * @param patch - The patch text.
 * @param files - The parsed patch.
 * @param options - Work root.
 * @returns Path → post-patch text, or a typed error (for example `patch_invalid`).
 */
export async function readPostPatchFiles(
  repoPath: string,
  commit: string | undefined,
  patch: string,
  files: readonly DiffFile[],
  options: WorkcopyOptions = {},
): Promise<Result<PostPatchFiles, ValidateError>> {
  const wanted = files
    .map((f) => f.newPath)
    .filter((p): p is string => p !== null && isTypeScriptPath(p));
  if (wanted.length === 0) return ok({});
  const copy = await createWorkingCopy(repoPath, commit, options);
  if (!copy.ok) return copy;
  try {
    const applied = await applyPatch(copy.value.path, patch, options);
    if (!applied.ok) return applied;
    const root = await realpath(copy.value.path);
    const out: Record<string, string> = {};
    for (const p of wanted) {
      const abs = join(root, p);
      try {
        const st = await lstat(abs);
        if (!st.isFile() || st.size > MAX_GUARD_FILE_BYTES) continue;
        if (!insideDir(root, await realpath(abs))) continue;
        out[p] = await readFile(abs, 'utf8');
      } catch {
        continue; // missing or unreadable: the guard falls back to text matching
      }
    }
    return ok(out);
  } finally {
    await disposeWorkingCopy(copy.value.path, options);
  }
}

/**
 * Validates one candidate patch behind the cheat guards (FR-27 to FR-31):
 *
 * 1. Path safety (`inspectPatch`) and a strict diff parse. Failure → outcome `error`.
 * 2. Static guards in their fixed order: `test_file_changed`, `config_changed`,
 *    `type_suppression`. Failure → `cheating`, and **the container never runs**.
 * 3. The inc08 validator on the patched copy. A typed failure → `error`; `error`/`timeout`
 *    results keep their status.
 * 4. The count guard against `preResult` (for `pass` and `fail` results). Failure → `cheating`.
 *
 * A `cheating` outcome ends the run (FR-31, see `cheatingEndsRun`).
 * @param input - Repository, patch, env and the pre-patch baseline.
 * @param deps - Replaceable steps (tests only).
 */
export async function guardedValidate(
  input: GuardedValidateInput,
  deps: GuardedValidateDeps = {},
): Promise<GuardedVerdict> {
  const runValidate = deps.validate ?? validate;
  const readPost = deps.readPostPatchFiles ?? readPostPatchFiles;
  const fail = (error: ValidateError): GuardedVerdict => ({
    outcome: 'error',
    error,
    validated: false,
  });

  const safe = inspectPatch(input.patch);
  if (!safe.ok) return fail({ code: 'patch_invalid', message: safe.error.reason });
  const parsed = parseUnifiedDiff(input.patch);
  if (!parsed.ok)
    return fail({ code: 'patch_invalid', message: `malformed diff: ${parsed.error}` });

  const post = await readPost(
    input.repoPath,
    input.commit,
    input.patch,
    parsed.value,
    input.workcopy,
  );
  if (!post.ok) return fail(post.error);
  const staticVerdict = runStaticGuards(parsed.value, post.value);
  if (!staticVerdict.ok)
    return {
      outcome: 'cheating',
      guard: staticVerdict.guard,
      evidence: staticVerdict.evidence,
      validated: false,
    };

  const run = await runValidate({
    repoPath: input.repoPath,
    ...(input.commit !== undefined ? { commitSha: input.commit } : {}),
    patch: input.patch,
    ...(input.env ? { env: input.env } : {}),
    ...(input.limits ? { limits: input.limits } : {}),
    ...(input.docker ? { docker: input.docker } : {}),
    ...(input.workcopy ? { workcopy: input.workcopy } : {}),
    dispose: input.dispose ?? true,
  });
  if (!run.ok) return fail(run.error);
  const result = run.value.result;
  if (result.status === 'error' || result.status === 'timeout')
    return { outcome: result.status, result, validated: true };

  const countVerdict = runCountGuard(input.preResult, result);
  if (!countVerdict.ok)
    return {
      outcome: 'cheating',
      guard: countVerdict.guard,
      evidence: countVerdict.evidence,
      result,
      validated: true,
    };
  return { outcome: result.status, result, validated: true };
}

/** The `attempts` columns a verdict fills (the repair loop adds tokens, cost, model, …). */
export interface AttemptVerdictFields {
  outcome: AttemptOutcome;
  guardName: GuardName | null;
  compileErrors: number | null;
  testsPassed: number | null;
  testsTotal: number | null;
  validationOutput: string | null;
}

/**
 * Maps a verdict to its `attempts` columns. The guard name is set only for `cheating`, which
 * is exactly what the `attempts_cheating_iff_guard` constraint enforces (DR-04). The guard
 * evidence is prepended to the stored validation output, so the run record says why.
 * @param verdict - A verdict from {@link guardedValidate}.
 */
export function attemptFieldsFromVerdict(verdict: GuardedVerdict): AttemptVerdictFields {
  const r = verdict.result;
  const parts = [
    verdict.evidence?.length ? `Cheat guard ${verdict.guard}:\n${verdict.evidence.join('\n')}` : '',
    verdict.error ? `${verdict.error.code}: ${verdict.error.message}` : '',
    r?.rawOutput ?? verdict.error?.rawOutput ?? '',
  ].filter(Boolean);
  return {
    outcome: verdict.outcome,
    guardName: verdict.outcome === 'cheating' ? (verdict.guard ?? null) : null,
    compileErrors: r?.compileErrors ?? null,
    testsPassed: r?.testsPassed ?? null,
    testsTotal: r?.testsTotal ?? null,
    validationOutput: parts.length ? parts.join('\n\n') : null,
  };
}
