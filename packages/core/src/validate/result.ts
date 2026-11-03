import { parseTscOutput } from './tsc.js';
import type { ValidationResult } from './types.js';
import { parseVitestJson, type VitestReport } from './vitest.js';

/** What one command printed inside the container, and how it ended. */
export interface CommandRun {
  /** The command as shown in the raw output, for example `npm run typecheck`. */
  command: string;
  /** Process exit code, or `null` if it was killed or never started. */
  exitCode: number | null;
  /** Combined stdout and stderr. */
  output: string;
  /** `true` if the wall-clock limit stopped this command. */
  timedOut: boolean;
}

/** Inputs for {@link buildValidationResult}. */
export interface ValidationInputs {
  /** The type-check command, or `null` if it never ran (for example a timeout before it). */
  typecheck: CommandRun | null;
  /** The test command, or `null` if it never ran. */
  test: CommandRun | null;
  /** The parsed JSON report, or `undefined` if the runner wrote none or it was not JSON. */
  vitestJson: unknown;
  /** Wall-clock duration of the validate phase, in ms. */
  durationMs: number;
  /** Repository root inside the container. Default `/work`. */
  rootDir?: string;
}

/**
 * Formats the commands' output as one transcript that is kept with the result (FR-26).
 * @param runs - The commands, in order. `null` entries are skipped.
 */
export function formatRawOutput(runs: (CommandRun | null)[]): string {
  return runs
    .filter((r): r is CommandRun => r !== null)
    .map((r) => {
      const end = r.timedOut
        ? '[killed: wall-clock limit reached]'
        : `[exit code ${r.exitCode ?? 'none'}]`;
      const body = r.output.endsWith('\n') || r.output === '' ? r.output : `${r.output}\n`;
      return `$ ${r.command}\n${body}${end}\n`;
    })
    .join('\n');
}

/**
 * Turns the container's command output into a {@link ValidationResult}.
 *
 * Rules:
 * - Any command stopped by the wall clock gives `timeout`.
 * - The runner failing gives `error`: no JSON report, a report with the wrong shape, or a type
 *   check that exits non-zero without printing a single `error TS` line.
 * - `pass` needs 0 compile errors, a type check that exits 0, at least one test, every test
 *   passed, no suite-level failure, and a test command that exits 0 with `success: true`.
 * - Everything else is `fail`.
 * @param inputs - Command runs, the JSON report and the duration.
 * @returns The structured result, with the raw output always kept.
 */
export function buildValidationResult(inputs: ValidationInputs): ValidationResult {
  const { typecheck, test, vitestJson, durationMs } = inputs;
  const rawOutput = formatRawOutput([typecheck, test]);
  const compileErrors = typecheck ? parseTscOutput(typecheck.output).errorCount : 0;
  const report: VitestReport | null = (() => {
    if (vitestJson === undefined) return null;
    const parsed = parseVitestJson(vitestJson, inputs.rootDir ?? '/work');
    return parsed.ok ? parsed.value : null;
  })();
  const base = {
    compileErrors,
    testsPassed: report?.testsPassed ?? 0,
    testsTotal: report?.testsTotal ?? 0,
    testResults: report?.testResults ?? [],
    testFiles: report?.testFiles ?? [],
    durationMs,
    rawOutput,
  };

  if (typecheck?.timedOut || test?.timedOut)
    return { ...base, status: 'timeout', errorReason: 'the wall-clock limit was reached' };
  if (!typecheck) return { ...base, status: 'error', errorReason: 'the type check did not run' };
  if (typecheck.exitCode !== 0 && compileErrors === 0)
    return {
      ...base,
      status: 'error',
      errorReason: `the type check exited with code ${typecheck.exitCode ?? 'none'} but reported no TypeScript errors`,
    };
  if (!test) return { ...base, status: 'error', errorReason: 'the test suite did not run' };
  if (vitestJson === undefined)
    return { ...base, status: 'error', errorReason: 'the test runner wrote no JSON report' };
  if (!report)
    return {
      ...base,
      status: 'error',
      errorReason: 'the Vitest JSON report does not have the expected shape',
    };

  const pass =
    compileErrors === 0 &&
    typecheck.exitCode === 0 &&
    report.testsTotal > 0 &&
    report.testsPassed === report.testsTotal &&
    report.failedSuites.length === 0 &&
    report.success &&
    test.exitCode === 0;
  return { ...base, status: pass ? 'pass' : 'fail' };
}
