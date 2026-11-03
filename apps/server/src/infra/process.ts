import { spawn } from 'node:child_process';

/** How a child process ended. */
export interface ProcessOutcome {
  /** Exit code, or `null` if the process was killed by a signal or failed to start. */
  exitCode: number | null;
  /** Combined stdout and stderr, in arrival order, capped at `maxOutputBytes`. */
  output: string;
  /** `true` if the output was cut at `maxOutputBytes`. */
  truncated: boolean;
  /** `true` if `timeoutMs` expired and `onTimeout` ran. */
  timedOut: boolean;
  /** Spawn error code, for example `ENOENT` when the binary is missing. */
  spawnError?: string;
  durationMs: number;
}

/** Options for {@link runProcess}. */
export interface RunProcessOptions {
  cwd: string;
  /** The complete environment of the child. Nothing is inherited from this process. */
  env: Record<string, string>;
  /** Written to stdin, which is then closed. */
  input?: string;
  /** Wall-clock limit. Default: none. */
  timeoutMs?: number;
  /**
   * Called once when the timeout expires, before the child itself is killed. The child is
   * killed with SIGKILL after the returned promise settles.
   */
  onTimeout?: () => Promise<void>;
  /** Output cap. Default 10 MiB. */
  maxOutputBytes?: number;
}

const DEFAULT_MAX_OUTPUT = 10 * 1024 * 1024;

/**
 * Runs a binary with an explicit, complete environment (never inherited) and no shell.
 * @param command - Binary name or path.
 * @param args - Arguments, passed as-is (no shell expansion).
 * @param options - Working directory, environment, stdin, timeout, output cap.
 * @returns How the process ended. Never rejects.
 */
export function runProcess(
  command: string,
  args: string[],
  options: RunProcessOptions,
): Promise<ProcessOutcome> {
  const started = Date.now();
  const max = options.maxOutputBytes ?? DEFAULT_MAX_OUTPUT;
  return new Promise((resolve) => {
    const chunks: Buffer[] = [];
    let size = 0;
    let truncated = false;
    let timedOut = false;
    let spawnError: string | undefined;
    let timer: NodeJS.Timeout | undefined;
    const child = spawn(command, args, {
      cwd: options.cwd,
      env: options.env,
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
    });
    const collect = (chunk: Buffer) => {
      if (size >= max) {
        truncated = true;
        return;
      }
      const room = max - size;
      const part = chunk.length > room ? chunk.subarray(0, room) : chunk;
      if (part.length < chunk.length) truncated = true;
      chunks.push(part);
      size += part.length;
    };
    child.stdout.on('data', collect);
    child.stderr.on('data', collect);
    let done = false;
    const finish = (code: number | null) => {
      if (done) return;
      done = true;
      if (timer) clearTimeout(timer);
      let output = Buffer.concat(chunks).toString('utf8');
      if (truncated) output += `\n[output truncated at ${max} bytes]\n`;
      resolve({
        exitCode: code,
        output,
        truncated,
        timedOut,
        durationMs: Date.now() - started,
        ...(spawnError ? { spawnError } : {}),
      });
    };
    child.on('error', (e: NodeJS.ErrnoException) => {
      spawnError = e.code ?? 'spawn_failed';
      // A child that never started emits no reliable 'close'.
      if (child.pid === undefined) finish(null);
    });
    child.stdin.on('error', () => undefined);
    child.stdin.end(options.input ?? '');
    if (options.timeoutMs !== undefined) {
      timer = setTimeout(() => {
        timedOut = true;
        void (options.onTimeout?.() ?? Promise.resolve())
          .catch(() => undefined)
          .finally(() => child.kill('SIGKILL'));
      }, options.timeoutMs);
    }
    child.on('close', (code) => finish(code));
  });
}
