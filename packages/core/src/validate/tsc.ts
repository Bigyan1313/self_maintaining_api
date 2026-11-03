/** One TypeScript diagnostic parsed from `tsc` output. */
export interface TscDiagnostic {
  /** File as printed by tsc, or `null` for a global diagnostic. */
  file: string | null;
  line: number | null;
  column: number | null;
  /** For example `TS2322`. */
  code: string;
  message: string;
}

/** Parsed `tsc` output. */
export interface TscOutput {
  /** Number of `error TS\d+` lines. */
  errorCount: number;
  diagnostics: TscDiagnostic[];
}

// tsc's non-pretty format: `src/a.ts(3,5): error TS2322: message`, or `error TS5083: message`.
const LOCATED = /^(.+?)\((\d+),(\d+)\): error (TS\d+): (.*)$/;
const GLOBAL = /^error (TS\d+): (.*)$/;
const ANY_ERROR = /error TS\d+/;

/**
 * Parses `tsc --noEmit` output (the non-pretty format tsc uses when stdout is not a TTY).
 *
 * Every line that contains `error TS\d+` is counted, so `errorCount` never under-counts, even
 * when a line has an unusual shape. Located and global diagnostics are also returned in
 * structured form for the repair context.
 * @param output - Combined stdout and stderr of the type-check command.
 * @returns The error count and the diagnostics that could be parsed.
 */
export function parseTscOutput(output: string): TscOutput {
  const diagnostics: TscDiagnostic[] = [];
  let errorCount = 0;
  for (const rawLine of output.split(/\r?\n/)) {
    const line = rawLine.trimEnd();
    if (!ANY_ERROR.test(line)) continue;
    errorCount += 1;
    const located = LOCATED.exec(line.trimStart());
    if (located) {
      diagnostics.push({
        file: located[1]!,
        line: Number(located[2]),
        column: Number(located[3]),
        code: located[4]!,
        message: located[5]!,
      });
      continue;
    }
    const global = GLOBAL.exec(line.trimStart());
    if (global)
      diagnostics.push({
        file: null,
        line: null,
        column: null,
        code: global[1]!,
        message: global[2]!,
      });
  }
  return { errorCount, diagnostics };
}
