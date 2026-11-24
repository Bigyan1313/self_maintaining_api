/**
 * Recording helpers for `npm run acceptance`. A {@link Recorder} collects the real output of one
 * acceptance check and decides its result from what actually ran. Nothing is ever marked PASS by
 * hand.
 *
 * @packageDocumentation
 */

/** Result of one acceptance check. */
export type Verdict = 'PASS' | 'PARTIAL' | 'FAIL';

/** One assertion that ran, with what was observed. */
export interface CheckLine {
  name: string;
  ok: boolean;
  actual?: string;
}

/** A required part that could not run yet, and why (for example "needs inc 13"). */
export interface NotRun {
  item: string;
  reason: string;
}

/** Static description of a check (from SRS Appendix A). */
export interface CheckInfo {
  id: string;
  title: string;
  requirements: string;
  /** What the check is fed, in plain words. */
  inputs: string[];
}

/** Longest value printed in a transcript, in lines. */
export const MAX_VALUE_LINES = 40;

/**
 * Formats a value for the transcript: strings as-is, everything else as indented JSON, cut to
 * {@link MAX_VALUE_LINES} lines.
 * @param value - Any value.
 */
export function formatValue(value: unknown): string {
  const text = typeof value === 'string' ? value : (JSON.stringify(value, null, 2) ?? 'undefined');
  const lines = text.split('\n');
  if (lines.length <= MAX_VALUE_LINES) return text;
  return [
    ...lines.slice(0, MAX_VALUE_LINES),
    `… (${lines.length - MAX_VALUE_LINES} more lines)`,
  ].join('\n');
}

/**
 * Replaces each secret value with `[REDACTED]` and every path prefix with its short name.
 * @param text - Transcript text.
 * @param secrets - Secret values that must never be written (values shorter than 8 are ignored).
 * @param paths - Absolute path → short name, e.g. the temp folder → `<tmp>`.
 * @returns The scrubbed text and how many secret values were found.
 */
export function scrub(
  text: string,
  secrets: readonly string[],
  paths: Readonly<Record<string, string>> = {},
): { text: string; secretsFound: number } {
  let out = text;
  let secretsFound = 0;
  for (const s of secrets) {
    if (s.length < 8 || !out.includes(s)) continue;
    secretsFound += out.split(s).length - 1;
    out = out.split(s).join('[REDACTED]');
  }
  for (const [from, to] of Object.entries(paths).sort((a, b) => b[0].length - a[0].length))
    if (from) out = out.split(from).join(to);
  return { text: out, secretsFound };
}

/** Collects the transcript and results of one acceptance check. */
export class Recorder {
  readonly lines: string[] = [];
  readonly checks: CheckLine[] = [];
  readonly notRun: NotRun[] = [];
  readonly steps: string[] = [];
  private blockedReason: string | null = null;

  constructor(readonly info: CheckInfo) {
    this.lines.push(`# ${info.id} ${info.title}  (${info.requirements})`);
  }

  /** Starts a step: printed like a shell prompt and listed under "Steps actually run". */
  step(text: string): void {
    this.steps.push(text);
    this.lines.push('', `$ ${text}`);
  }

  /** Prints an observed value under the current step. */
  show(label: string, value: unknown): void {
    const body = formatValue(value);
    this.lines.push(body.includes('\n') ? `${label}:\n${indent(body)}` : `${label}: ${body}`);
  }

  /**
   * Records one assertion.
   * @param name - What is being verified.
   * @param ok - Whether it held.
   * @param actual - The observed value, printed next to the result.
   */
  check(name: string, ok: boolean, actual?: unknown): boolean {
    const shown = actual === undefined ? undefined : formatValue(actual).split('\n').join(' ');
    this.checks.push({ name, ok, ...(shown === undefined ? {} : { actual: shown }) });
    this.lines.push(`  ${ok ? '✓' : '✗'} ${name}${shown === undefined ? '' : `  → ${shown}`}`);
    return ok;
  }

  /** Records a required part that cannot run on this build. */
  skip(item: string, reason: string): void {
    this.notRun.push({ item, reason });
    this.lines.push(`  – NOT RUN: ${item} (${reason})`);
  }

  /** Records an unexpected error: the check fails. */
  error(error: unknown): void {
    const message = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
    this.check(`no unexpected error`, false, message);
  }

  /** Marks the whole check as unable to run (for example, Docker is not running). */
  block(reason: string): void {
    this.blockedReason = reason;
    this.lines.push(`  ✗ BLOCKED: ${reason}`);
  }

  /** FAIL if anything failed, nothing ran, or the check was blocked; PARTIAL if a part could not run. */
  verdict(): Verdict {
    if (this.blockedReason || this.checks.length === 0 || this.checks.some((c) => !c.ok))
      return 'FAIL';
    return this.notRun.length ? 'PARTIAL' : 'PASS';
  }

  /** One-sentence reason for {@link verdict}. */
  reason(): string {
    const failed = this.checks.filter((c) => !c.ok);
    const passed = this.checks.length - failed.length;
    if (this.blockedReason) return `Blocked: ${this.blockedReason}.`;
    if (this.checks.length === 0) return 'No assertion ran.';
    if (failed.length)
      return `${failed.length} of ${this.checks.length} assertions failed: ${failed
        .map((f) => f.name)
        .join('; ')}.`;
    if (this.notRun.length)
      return `All ${passed} assertions that can run on this build passed; ${this.notRun.length} required part(s) remain unexecuted: ${this.notRun
        .map((n) => `${n.item} (${n.reason})`)
        .join('; ')}.`;
    return `All ${passed} assertions passed.`;
  }

  /** The full transcript, ending with the result line. */
  transcript(): string {
    return [
      ...this.lines,
      '',
      `RESULT ${this.info.id}: ${this.verdict()} — ${this.reason()}`,
      '',
    ].join('\n');
  }
}

function indent(text: string): string {
  return text
    .split('\n')
    .map((l) => `    ${l}`)
    .join('\n');
}
