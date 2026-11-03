import { randomUUID } from 'node:crypto';
import { lstat, mkdir, readFile, realpath, rm } from 'node:fs/promises';
import { basename, join, sep } from 'node:path';
import {
  buildValidationResult,
  err,
  ok,
  type CommandRun,
  type Result,
  type ValidationResult,
} from '@sma/core';
import { docker, ensureImage, killContainer, type DockerOptions } from './docker.js';
import { VALIDATOR_IMAGE } from './image.js';

/** Typed sandbox failures. The validation outcome itself is a {@link ValidationResult}. */
export type SandboxErrorCode =
  'container_unavailable' | 'install_failed' | 'install_timeout' | 'env_not_allowed';

/** A sandbox failure. `rawOutput` is kept when a command ran (FR-26). */
export interface SandboxError {
  code: SandboxErrorCode;
  message: string;
  rawOutput?: string;
}

/**
 * Variables a caller may pass into the validate container. Everything else is refused, so
 * no host credential can reach target-repo code (FR-25, NFR-03, NFR-04).
 */
export const SANDBOX_ENV_ALLOWLIST: readonly string[] = ['API_VERSION', 'NODE_ENV', 'TZ'];

/** Set by the sandbox in every container; callers cannot override them. */
const FIXED_ENV: Record<string, string> = {
  CI: 'true',
  HOME: '/tmp',
  npm_config_cache: '/tmp/.npm',
  npm_config_update_notifier: 'false',
  npm_config_fund: 'false',
  npm_config_audit: 'false',
  // Plain text in the raw output (it feeds the repair context in inc11).
  NO_COLOR: '1',
  FORCE_COLOR: '0',
};

/** Resource limits and timeouts. Defaults are the SRS values. */
export interface SandboxLimits {
  /** `--memory` (and `--memory-swap`, so no swap). Default `2g`. */
  memory?: string;
  /** `--cpus`. Default `2`. */
  cpus?: string;
  /** `--pids-limit`. Default `256`. */
  pidsLimit?: number;
  /** Wall clock for the whole validate phase (type check + tests). Default 10 min (NFR-06). */
  timeoutMs?: number;
  /** Wall clock for the install phase. Default 10 min. */
  installTimeoutMs?: number;
}

/** Default wall clock: 10 minutes (NFR-03, NFR-06). */
export const DEFAULT_VALIDATE_TIMEOUT_MS = 10 * 60 * 1000;

/** Repository root inside the container. */
export const CONTAINER_WORKDIR = '/work';

/** Output directory for reports, inside the working copy (ignored by git there). */
export const REPORT_DIR = '.sma';

const TEST_COMMAND = [
  'npm',
  'test',
  '--',
  '--reporter=default',
  '--reporter=json',
  `--outputFile.json=${CONTAINER_WORKDIR}/${REPORT_DIR}/vitest.json`,
];
const MAX_REPORT_BYTES = 50 * 1024 * 1024;
const ENV_VALUE = /^[\x20-\x7e]*$/;

/**
 * Checks caller-supplied variables against {@link SANDBOX_ENV_ALLOWLIST}.
 * @param env - Variables the caller wants inside the validate container.
 * @returns An error naming the refused key, or `null` if all are allowed.
 */
export function checkSandboxEnv(env: Record<string, string>): SandboxError | null {
  for (const [key, value] of Object.entries(env)) {
    if (!SANDBOX_ENV_ALLOWLIST.includes(key))
      return {
        code: 'env_not_allowed',
        message: `environment variable "${key}" is not on the sandbox allow-list (${SANDBOX_ENV_ALLOWLIST.join(', ')})`,
      };
    if (!ENV_VALUE.test(value))
      return {
        code: 'env_not_allowed',
        message: `environment variable "${key}" has a value with non-printable characters`,
      };
  }
  return null;
}

/**
 * The non-root user the container runs as: the host user (so files in the bind mount stay
 * owned by the developer), or `1000:1000` if the host process is root. Never `0`.
 */
export function sandboxUser(): string {
  const uid = process.getuid?.();
  const gid = process.getgid?.();
  if (uid === undefined || gid === undefined || uid === 0) return '1000:1000';
  return `${uid}:${gid === 0 ? 1000 : gid}`;
}

/**
 * Builds the `docker run` arguments for one sandboxed command.
 *
 * Both phases: `--rm`, a unique name, non-root `--user`, `--memory`/`--memory-swap`, `--cpus`,
 * `--pids-limit`, `--cap-drop ALL`, `no-new-privileges`, a read-only root filesystem, a tmpfs
 * `/tmp`, only `<workDir>:/work` mounted, and only the given env vars. The validate phase adds
 * `--network none`.
 * @param p - Phase, container name, working copy, env and limits.
 * @returns The arguments after `docker`.
 */
export function buildRunArgs(p: {
  phase: 'install' | 'validate';
  name: string;
  workDir: string;
  env: Record<string, string>;
  limits?: SandboxLimits;
  image?: string;
  command: string[];
}): string[] {
  const limits = p.limits ?? {};
  const memory = limits.memory ?? '2g';
  const env = { ...p.env, ...FIXED_ENV };
  return [
    'run',
    '--rm',
    '--name',
    p.name,
    '--label',
    'sma.validator=1',
    '--label',
    `sma.workcopy=${basename(p.workDir)}`,
    '--network',
    p.phase === 'install' ? 'bridge' : 'none',
    '--user',
    sandboxUser(),
    '--memory',
    memory,
    '--memory-swap',
    memory,
    '--cpus',
    limits.cpus ?? '2',
    '--pids-limit',
    String(limits.pidsLimit ?? 256),
    '--cap-drop',
    'ALL',
    '--security-opt',
    'no-new-privileges',
    '--read-only',
    '--tmpfs',
    `/tmp:rw,nosuid,nodev,size=${p.phase === 'install' ? '1g' : '512m'}`,
    '--volume',
    `${p.workDir}:${CONTAINER_WORKDIR}`,
    '--workdir',
    CONTAINER_WORKDIR,
    ...Object.entries(env).flatMap(([k, v]) => ['--env', `${k}=${v}`]),
    p.image ?? VALIDATOR_IMAGE,
    ...p.command,
  ];
}

interface ContainerRun extends CommandRun {
  /** `true` if `docker run` itself failed (exit 125, or the CLI could not start). */
  dockerFailed: boolean;
}

async function runInContainer(p: {
  phase: 'install' | 'validate';
  workDir: string;
  env: Record<string, string>;
  limits?: SandboxLimits;
  command: string[];
  timeoutMs: number;
  docker: DockerOptions;
}): Promise<ContainerRun> {
  const name = `sma-${p.phase}-${randomUUID()}`;
  const args = buildRunArgs({ ...p, name });
  const out = await docker(args, p.docker, Math.max(1, p.timeoutMs));
  // The CLI was killed on timeout; make sure the container is gone too (no retry, NFR-06).
  if (out.timedOut) await killContainer(name, p.docker);
  return {
    command: p.command.join(' '),
    exitCode: out.exitCode,
    output: out.output,
    timedOut: out.timedOut,
    dockerFailed: out.spawnError !== undefined || out.exitCode === 125,
  };
}

/**
 * Install phase (before any patch): `npm ci --ignore-scripts` on the unpatched lockfile, in a
 * container **with** network, writing `node_modules` into the working copy. Lifecycle scripts
 * are disabled, the user is non-root, the same limits apply, and no host env var is passed.
 * @param workDir - Working copy on the host.
 * @param options - Limits and Docker options.
 * @returns The install transcript, or a typed error.
 */
export async function installDependencies(
  workDir: string,
  options: { limits?: SandboxLimits; docker?: DockerOptions } = {},
): Promise<Result<{ rawOutput: string; durationMs: number }, SandboxError>> {
  const dockerOptions = options.docker ?? {};
  const timeoutMs = options.limits?.installTimeoutMs ?? DEFAULT_VALIDATE_TIMEOUT_MS;
  const started = Date.now();
  if (!(await ensureImage(VALIDATOR_IMAGE, dockerOptions, timeoutMs)))
    return err({
      code: 'container_unavailable',
      message: `cannot pull the validator image ${VALIDATOR_IMAGE}`,
    });
  const run = await runInContainer({
    phase: 'install',
    workDir,
    env: {},
    limits: options.limits,
    command: ['npm', 'ci', '--ignore-scripts', '--no-audit', '--no-fund'],
    timeoutMs: timeoutMs - (Date.now() - started),
    docker: dockerOptions,
  });
  const rawOutput = `$ ${run.command}\n${run.output}`;
  if (run.timedOut)
    return err({
      code: 'install_timeout',
      message: 'dependency install reached the wall-clock limit',
      rawOutput,
    });
  if (run.dockerFailed)
    return err({
      code: 'container_unavailable',
      message: 'docker could not start the install container',
      rawOutput,
    });
  if (run.exitCode !== 0)
    return err({
      code: 'install_failed',
      message: `npm ci exited with code ${run.exitCode ?? 'none'}`,
      rawOutput,
    });
  return ok({ rawOutput, durationMs: Date.now() - started });
}

/**
 * Reads the JSON report the test runner wrote, defensively: it was written by target-repo
 * code, so it must be a regular file (not a symlink), inside the working copy, and not huge.
 * @param workDir - Working copy on the host.
 * @returns The parsed JSON, or `undefined` if there is no usable report.
 */
export async function readReport(workDir: string): Promise<unknown> {
  const file = join(workDir, REPORT_DIR, 'vitest.json');
  try {
    const info = await lstat(file);
    if (!info.isFile() || info.size > MAX_REPORT_BYTES) return undefined;
    const real = await realpath(file);
    const root = await realpath(workDir);
    if (!real.startsWith(root + sep)) return undefined;
    return JSON.parse(await readFile(real, 'utf8')) as unknown;
  } catch {
    return undefined;
  }
}

/**
 * Validate phase: runs the repo's own `npm run typecheck`, then
 * `npm test -- --reporter=default --reporter=json --outputFile.json=/work/.sma/vitest.json`,
 * each in a fresh `--network none` container. One wall clock covers both commands; when it
 * expires the container is killed and the result is `timeout`.
 * @param workDir - Working copy on the host, with dependencies installed.
 * @param options - Allowed env vars, limits and Docker options.
 * @returns The structured result, or a typed error if Docker itself failed.
 */
export async function runChecks(
  workDir: string,
  options: { env?: Record<string, string>; limits?: SandboxLimits; docker?: DockerOptions } = {},
): Promise<Result<ValidationResult, SandboxError>> {
  const env = options.env ?? {};
  const envError = checkSandboxEnv(env);
  if (envError) return err(envError);
  const dockerOptions = options.docker ?? {};
  const timeoutMs = options.limits?.timeoutMs ?? DEFAULT_VALIDATE_TIMEOUT_MS;
  // Fresh report directory: a stale report must never be read as this run's result.
  await rm(join(workDir, REPORT_DIR), { recursive: true, force: true });
  await mkdir(join(workDir, REPORT_DIR), { recursive: true });
  const started = Date.now();
  const remaining = () => timeoutMs - (Date.now() - started);
  const common = {
    phase: 'validate' as const,
    workDir,
    env,
    limits: options.limits,
    docker: dockerOptions,
  };

  const typecheck = await runInContainer({
    ...common,
    command: ['npm', 'run', 'typecheck'],
    timeoutMs: remaining(),
  });
  if (typecheck.dockerFailed)
    return err({
      code: 'container_unavailable',
      message: 'docker could not start the validate container',
      rawOutput: typecheck.output,
    });
  let test: ContainerRun | null = null;
  if (!typecheck.timedOut) {
    if (remaining() <= 0) {
      test = {
        command: TEST_COMMAND.join(' '),
        exitCode: null,
        output: '',
        timedOut: true,
        dockerFailed: false,
      };
    } else {
      test = await runInContainer({ ...common, command: TEST_COMMAND, timeoutMs: remaining() });
      if (test.dockerFailed)
        return err({
          code: 'container_unavailable',
          message: 'docker could not start the validate container',
          rawOutput: test.output,
        });
    }
  }
  const vitestJson = test && !test.timedOut ? await readReport(workDir) : undefined;
  return ok(
    buildValidationResult({
      typecheck,
      test,
      vitestJson,
      durationMs: Date.now() - started,
      rootDir: CONTAINER_WORKDIR,
    }),
  );
}
