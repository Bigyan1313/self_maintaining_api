import { execFile, type ExecFileException } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { err, ok, type Result } from '@sma/core';
import { OASDIFF_VERSION } from './version.js';

/** Typed runner failures; callers never see a raw child-process exception. */
export type OasdiffErrorCode = 'binary_missing' | 'version_mismatch' | 'timeout' | 'bad_output';

/** A runner failure with a human-readable message (never contains spec content). */
export interface OasdiffError {
  code: OasdiffErrorCode;
  message: string;
}

/** Runner options; defaults suit production. */
export interface OasdiffRunnerOptions {
  /** Binary path or name on PATH. Default: `$OASDIFF_BIN` or `oasdiff`. */
  binary?: string;
  /** Wall-clock limit per oasdiff invocation, ms. Default 30 000. */
  timeoutMs?: number;
  /** Required version. Default {@link OASDIFF_VERSION}. */
  expectedVersion?: string;
}

/** Runs oasdiff on two spec documents and returns its parsed JSON changelog. */
export type OasdiffRunner = (
  base: unknown,
  revision: unknown,
  options?: OasdiffRunnerOptions,
) => Promise<Result<unknown, OasdiffError>>;

const DEFAULT_TIMEOUT_MS = 30_000;
const MAX_OUTPUT_BYTES = 64 * 1024 * 1024;

interface ExecOutcome {
  ok: boolean;
  stdout: string;
  stderr: string;
  error?: ExecFileException;
}

function run(binary: string, args: string[], cwd: string, timeoutMs: number): Promise<ExecOutcome> {
  return new Promise((resolve) => {
    execFile(
      binary,
      args,
      {
        cwd,
        timeout: timeoutMs,
        killSignal: 'SIGKILL',
        maxBuffer: MAX_OUTPUT_BYTES,
        encoding: 'utf8',
        // Minimal environment: no credentials reach the child (NFR-04), and no OASDIFF_CONFIG.
        env: { PATH: process.env.PATH ?? '' },
        windowsHide: true,
      },
      (error, stdout, stderr) => resolve({ ok: !error, stdout, stderr, error: error ?? undefined }),
    );
  });
}

function failure(outcome: ExecOutcome, binary: string, timeoutMs: number): OasdiffError {
  const e = outcome.error;
  if (e?.code === 'ENOENT' || e?.code === 'EACCES')
    return {
      code: 'binary_missing',
      message: `oasdiff binary "${binary}" not found or not executable; install oasdiff ${OASDIFF_VERSION} (see README)`,
    };
  if (e?.killed || e?.signal === 'SIGKILL')
    return { code: 'timeout', message: `oasdiff did not finish within ${timeoutMs} ms` };
  const exit = typeof e?.code === 'number' ? e.code : 'unknown';
  // stderr can contain untrusted spec values, URLs and credentials; never return it.
  return { code: 'bad_output', message: `oasdiff exited with code ${exit}` };
}

/**
 * Reads `oasdiff --version` and checks it equals the pinned version.
 * @param options - Binary, timeout and expected version.
 * @returns The installed version, or a typed error.
 */
export async function checkOasdiffVersion(
  options: OasdiffRunnerOptions = {},
): Promise<Result<string, OasdiffError>> {
  const binary = options.binary ?? process.env.OASDIFF_BIN ?? 'oasdiff';
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const expected = options.expectedVersion ?? OASDIFF_VERSION;
  const outcome = await run(binary, ['--version'], tmpdir(), timeoutMs);
  if (!outcome.ok) return err(failure(outcome, binary, timeoutMs));
  const found = /(\d+\.\d+\.\d+)/.exec(outcome.stdout)?.[1];
  if (!found)
    return err({ code: 'bad_output', message: 'Cannot read the version from `oasdiff --version`' });
  if (found !== expected)
    return err({
      code: 'version_mismatch',
      message: `oasdiff ${found} is installed but ${expected} is pinned; install oasdiff ${expected} (see README)`,
    });
  return ok(found);
}

/**
 * Runs `oasdiff changelog <base> <revision> --format json` on two spec documents.
 *
 * Both documents are written as JSON to a fresh temp directory (removed afterwards); oasdiff is
 * started with `execFile` (no shell), a timeout, a minimal environment, and external `$ref`s
 * disabled. The installed version must equal {@link OASDIFF_VERSION}.
 * @param base - BEFORE spec (normalized JSON document).
 * @param revision - AFTER spec.
 * @param options - Binary, timeout and expected version.
 * @returns oasdiff's parsed JSON (an array; `[]` for no differences), or a typed error.
 */
export const runOasdiff: OasdiffRunner = async (base, revision, options = {}) => {
  const version = await checkOasdiffVersion(options);
  if (!version.ok) return version;
  const binary = options.binary ?? process.env.OASDIFF_BIN ?? 'oasdiff';
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const dir = await mkdtemp(join(tmpdir(), 'sma-oasdiff-'));
  try {
    await writeFile(join(dir, 'base.json'), JSON.stringify(base), 'utf8');
    await writeFile(join(dir, 'revision.json'), JSON.stringify(revision), 'utf8');
    const outcome = await run(
      binary,
      [
        'changelog',
        'base.json',
        'revision.json',
        '--format',
        'json',
        '--allow-external-refs=false',
      ],
      dir,
      timeoutMs,
    );
    if (!outcome.ok) return err(failure(outcome, binary, timeoutMs));
    const text = outcome.stdout.trim();
    if (text === '' || text === 'null') return ok([]);
    try {
      return ok(JSON.parse(text) as unknown);
    } catch {
      return err({ code: 'bad_output', message: 'oasdiff printed output that is not JSON' });
    }
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
};
