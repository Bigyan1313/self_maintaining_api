/** Outcome of one validation run (FR-26). */
export type ValidationStatus = 'pass' | 'fail' | 'error' | 'timeout';

/** Status of a single test case, normalised from the test runner's report. */
export type TestCaseStatus = 'passed' | 'failed' | 'skipped' | 'todo';

/** One test case from the test runner's report. */
export interface TestCaseResult {
  /** Test file path relative to the repository root, using `/` separators. */
  file: string;
  /** Full test name (describe blocks plus title). */
  name: string;
  status: TestCaseStatus;
}

/**
 * Structured result of running a repository's own type check and test suite inside the
 * validation container (FR-25, FR-26).
 */
export interface ValidationResult {
  /**
   * - `pass`: 0 compile errors, every test passed, and at least one test ran.
   * - `fail`: the checks ran, but something failed.
   * - `error`: the runner itself failed, for example no usable JSON report.
   * - `timeout`: the wall-clock limit was hit (NFR-06).
   */
  status: ValidationStatus;
  /** Number of `error TS\d+` lines in the type-check output. */
  compileErrors: number;
  testsPassed: number;
  /** All test cases in the report, whatever their status. */
  testsTotal: number;
  testResults: TestCaseResult[];
  /** Test files in the report, relative to the repository root, sorted. */
  testFiles: string[];
  /** Wall-clock duration of the validate phase, in ms. */
  durationMs: number;
  /** Full stdout and stderr of every command, always kept (FR-26). */
  rawOutput: string;
  /** Why the status is `error` or `timeout`, in plain words. Absent for `pass`/`fail`. */
  errorReason?: string;
}
