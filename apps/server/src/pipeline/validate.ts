import {
  err,
  inspectPatch,
  ok,
  type PatchFile,
  type Result,
  type ValidationResult,
} from '@sma/core';
import { dockerServerVersion, type DockerOptions } from '../infra/validator/docker.js';
import {
  checkSandboxEnv,
  installDependencies,
  runChecks,
  type SandboxErrorCode,
  type SandboxLimits,
} from '../infra/validator/sandbox.js';
import {
  applyPatch,
  createWorkingCopy,
  disposeWorkingCopy,
  type WorkcopyErrorCode,
  type WorkcopyOptions,
} from '../infra/workcopy/index.js';

/** Input to {@link validate}. */
export interface ValidateInput {
  /** The developer's repository. Only read, never written (FR-20). */
  repoPath: string;
  /** Commit to validate (git repository roots only). Default: `HEAD`. */
  commitSha?: string;
  /** Unified diff to apply before validating. Without it, the unpatched copy is validated. */
  patch?: string;
  /** Variables for the validate container; only allow-listed keys are accepted. */
  env?: Record<string, string>;
  /** Also validate the unpatched copy first (the pre-patch baseline for inc09/inc11). */
  runBaseline?: boolean;
  /** Resource limits and timeouts. */
  limits?: SandboxLimits;
  /** Docker CLI options (tests use them to simulate a stopped daemon). */
  docker?: DockerOptions;
  /** Working-copy location. */
  workcopy?: WorkcopyOptions;
  /** Delete the working copy before returning. Default `false`: inc09 guards inspect it. */
  dispose?: boolean;
}

/** Phase timings, in ms. */
export interface ValidateTimings {
  installMs: number;
  baselineMs?: number;
  validateMs: number;
}

/** Output of {@link validate}. */
export interface ValidateOutput {
  /** The working copy. The caller disposes it unless `dispose` was set. */
  workDir: string;
  /** Commit the working copy was made from. */
  commit: string;
  /** Pre-patch result, when `runBaseline` was set. */
  baseline?: ValidationResult;
  /** Result for the patched (or, without a patch, unpatched) copy. */
  result: ValidationResult;
  /** Files the patch touched (empty without a patch). */
  patchFiles: PatchFile[];
  timings: ValidateTimings;
}

/** Typed failures of the validate stage (NFR-02 reports them as a stage failure). */
export interface ValidateError {
  code: SandboxErrorCode | WorkcopyErrorCode;
  message: string;
  /** Output of the command that failed, if one ran (FR-26). */
  rawOutput?: string;
}

/**
 * Validate stage (FR-20, FR-25, FR-26, FR-32, NFR-03): copy the repository into an isolated
 * working copy, install its dependencies in a container (network on, scripts off, before the
 * patch), optionally run the pre-patch baseline, apply the patch, then run the repo's own type
 * check and tests in a `--network none` container.
 *
 * Nothing from the target repository runs on the host: install, type check and tests all run
 * inside the pinned container. The host only copies files, runs `git apply`, and reads the
 * JSON report.
 * @param input - Repository, optional commit and patch, env, options.
 * @returns The results and the working copy, or a typed error. A timeout is a result with
 *   `status: 'timeout'`, not an error.
 */
export async function validate(
  input: ValidateInput,
): Promise<Result<ValidateOutput, ValidateError>> {
  const env = input.env ?? {};
  const envError = checkSandboxEnv(env);
  if (envError) return err(envError);
  const patchFiles = input.patch === undefined ? null : inspectPatch(input.patch);
  if (patchFiles && !patchFiles.ok)
    return err({ code: 'patch_invalid', message: patchFiles.error.reason });
  if ((await dockerServerVersion(input.docker)) === null)
    return err({
      code: 'container_unavailable',
      message: 'Docker is not installed or the daemon is not running',
    });

  const copy = await createWorkingCopy(input.repoPath, input.commitSha, input.workcopy);
  if (!copy.ok) return copy;
  const workDir = copy.value.path;
  const failWith = async (e: ValidateError) => {
    await disposeWorkingCopy(workDir, input.workcopy);
    return err(e);
  };

  const install = await installDependencies(workDir, {
    limits: input.limits,
    docker: input.docker,
  });
  if (!install.ok) return failWith(install.error);

  let baseline: ValidationResult | undefined;
  if (input.runBaseline) {
    const run = await runChecks(workDir, { env, limits: input.limits, docker: input.docker });
    if (!run.ok) return failWith(run.error);
    baseline = run.value;
  }

  let applied: PatchFile[] = [];
  if (input.patch !== undefined) {
    const patched = await applyPatch(workDir, input.patch, input.workcopy);
    if (!patched.ok) return failWith(patched.error);
    applied = patched.value;
  }

  const run = await runChecks(workDir, { env, limits: input.limits, docker: input.docker });
  if (!run.ok) return failWith(run.error);
  if (input.dispose) await disposeWorkingCopy(workDir, input.workcopy);
  return ok({
    workDir,
    commit: copy.value.commit,
    ...(baseline ? { baseline } : {}),
    result: run.value,
    patchFiles: applied,
    timings: {
      installMs: install.value.durationMs,
      ...(baseline ? { baselineMs: baseline.durationMs } : {}),
      validateMs: run.value.durationMs,
    },
  });
}
