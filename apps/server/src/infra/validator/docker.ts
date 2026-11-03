import { tmpdir } from 'node:os';
import { runProcess, type ProcessOutcome } from '../process.js';

/** How to reach Docker. Defaults suit production; tests override them. */
export interface DockerOptions {
  /** Docker CLI binary. Default: `$DOCKER_BIN` or `docker`. */
  binary?: string;
  /**
   * Overrides for the Docker CLI's own environment, for example
   * `{ DOCKER_HOST: 'unix:///nonexistent.sock' }` to simulate a stopped daemon.
   */
  env?: Record<string, string>;
}

/** Variables the Docker CLI itself needs to find the daemon. None of them reach a container. */
const DOCKER_CLI_ENV = [
  'PATH',
  'HOME',
  'DOCKER_HOST',
  'DOCKER_CONTEXT',
  'DOCKER_CONFIG',
  'DOCKER_CERT_PATH',
  'DOCKER_TLS_VERIFY',
] as const;

/**
 * Builds the Docker CLI's environment from a fixed list. Containers never inherit it: values
 * reach a container only through explicit `-e KEY=VALUE` flags.
 * @param options - Docker options with optional overrides.
 */
export function dockerCliEnv(options: DockerOptions = {}): Record<string, string> {
  const env: Record<string, string> = {};
  for (const key of DOCKER_CLI_ENV) {
    const value = process.env[key];
    if (value !== undefined) env[key] = value;
  }
  return { ...env, ...(options.env ?? {}) };
}

function binary(options: DockerOptions): string {
  return options.binary ?? process.env.DOCKER_BIN ?? 'docker';
}

/**
 * Runs a Docker CLI command (not inside a container).
 * @param args - CLI arguments.
 * @param options - Docker options.
 * @param timeoutMs - Wall-clock limit.
 */
export function docker(
  args: string[],
  options: DockerOptions,
  timeoutMs: number,
): Promise<ProcessOutcome> {
  return runProcess(binary(options), args, {
    cwd: tmpdir(),
    env: dockerCliEnv(options),
    timeoutMs,
  });
}

/**
 * Checks that the Docker CLI exists and the daemon answers.
 * @param options - Docker options.
 * @returns The server version, or `null` if Docker is unavailable.
 */
export async function dockerServerVersion(options: DockerOptions = {}): Promise<string | null> {
  const out = await docker(['version', '--format', '{{.Server.Version}}'], options, 20_000);
  if (out.spawnError || out.timedOut || out.exitCode !== 0) return null;
  const version = out.output.trim();
  return /^\d+\.\d+/.test(version) ? version : null;
}

/**
 * Makes sure the pinned image is present locally, pulling it by digest if needed.
 * @param image - Full reference with `@sha256:` digest.
 * @param options - Docker options.
 * @param timeoutMs - Limit for the pull.
 * @returns `true` if the image is available.
 */
export async function ensureImage(
  image: string,
  options: DockerOptions,
  timeoutMs: number,
): Promise<boolean> {
  const inspect = await docker(['image', 'inspect', '--format', '{{.Id}}', image], options, 20_000);
  if (inspect.exitCode === 0) return true;
  const pull = await docker(['pull', '--quiet', image], options, timeoutMs);
  return pull.exitCode === 0;
}

/**
 * Stops and removes a named container. Errors are ignored: the container may already be gone.
 * @param name - Container name.
 * @param options - Docker options.
 */
export async function killContainer(name: string, options: DockerOptions): Promise<void> {
  await docker(['kill', name], options, 30_000);
  await docker(['rm', '--force', name], options, 30_000);
}

/**
 * Lists containers (running or not) with this exact name.
 * @param name - Container name.
 * @param options - Docker options.
 * @returns Matching container ids.
 */
export async function containersNamed(
  name: string,
  options: DockerOptions = {},
): Promise<string[]> {
  const out = await docker(
    ['ps', '--all', '--quiet', '--filter', `name=^/${name}$`],
    options,
    20_000,
  );
  return out.output.split('\n').filter((l) => l.trim() !== '');
}
