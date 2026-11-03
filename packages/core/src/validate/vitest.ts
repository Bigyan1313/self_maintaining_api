import { z } from 'zod';
import { err, ok, type Result } from '../result.js';
import type { TestCaseResult, TestCaseStatus } from './types.js';

/** Test results read from a Vitest `--reporter=json` report. */
export interface VitestReport {
  testResults: TestCaseResult[];
  /** Test files in the report, relative to the repository root, sorted and unique. */
  testFiles: string[];
  testsPassed: number;
  testsTotal: number;
  /** Files whose suite failed as a whole (for example an import error), relative paths. */
  failedSuites: string[];
  /** The report's own `success` flag. */
  success: boolean;
}

// Only the fields we use are checked. The report is written by code from the target repo,
// so it is untrusted input: unknown fields are ignored and wrong shapes are rejected.
const assertionSchema = z.object({
  fullName: z.string().optional(),
  title: z.string(),
  ancestorTitles: z.array(z.string()).optional(),
  status: z.string(),
});
const fileSchema = z.object({
  name: z.string(),
  status: z.string(),
  assertionResults: z.array(assertionSchema),
});
const reportSchema = z.object({
  success: z.boolean(),
  testResults: z.array(fileSchema),
});

/** Vitest statuses: passed, failed, skipped, pending, todo, disabled. */
function normaliseStatus(status: string): TestCaseStatus {
  switch (status) {
    case 'passed':
    case 'failed':
    case 'skipped':
    case 'todo':
      return status;
    case 'pending':
    case 'disabled':
      return 'skipped';
    default:
      // An unknown status is never counted as a pass.
      return 'failed';
  }
}

/**
 * Makes a report path relative to the repository root.
 * @param file - Path from the report (absolute inside the container).
 * @param rootDir - Repository root inside the container, for example `/work`.
 */
export function relativeToRoot(file: string, rootDir: string): string {
  const unix = file.replace(/\\/g, '/');
  const root = rootDir.replace(/\\/g, '/').replace(/\/+$/, '');
  return unix.startsWith(`${root}/`) ? unix.slice(root.length + 1) : unix;
}

/**
 * Parses a Vitest JSON report (`--reporter=json`).
 *
 * Counts are derived from the individual test cases, not from the report's `num*` summary
 * fields, so `testsTotal` always equals `testResults.length`.
 * @param json - The parsed JSON report.
 * @param rootDir - Repository root inside the container. Default `/work`.
 * @returns The normalised test results, or an error message if the report has the wrong shape.
 */
export function parseVitestJson(json: unknown, rootDir = '/work'): Result<VitestReport, string> {
  const parsed = reportSchema.safeParse(json);
  if (!parsed.success) return err('the Vitest JSON report does not have the expected shape');
  const testResults: TestCaseResult[] = [];
  const failedSuites: string[] = [];
  const files = new Set<string>();
  for (const file of parsed.data.testResults) {
    const rel = relativeToRoot(file.name, rootDir);
    files.add(rel);
    const fileFailed = normaliseStatus(file.status) === 'failed';
    const anyCaseFailed = file.assertionResults.some((a) => normaliseStatus(a.status) === 'failed');
    if (fileFailed && !anyCaseFailed) failedSuites.push(rel);
    for (const a of file.assertionResults)
      testResults.push({
        file: rel,
        name: a.fullName ?? [...(a.ancestorTitles ?? []), a.title].join(' '),
        status: normaliseStatus(a.status),
      });
  }
  return ok({
    testResults,
    testFiles: [...files].sort(),
    testsPassed: testResults.filter((t) => t.status === 'passed').length,
    testsTotal: testResults.length,
    failedSuites: failedSuites.sort(),
    success: parsed.data.success,
  });
}
