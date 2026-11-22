import type { LocateResult } from '../locate/types.js';
import type { ValidationResult } from '../validate/types.js';
import type { RepairContextInput } from './context.js';

/** Maximum repair attempts per run (FR-21, DR-03). */
export const MAX_REPAIR_ATTEMPTS = 4;

/** Plain reason recorded when four attempts did not pass validation (FR-22). */
export const FOUR_ATTEMPTS_REASON =
  '4 attempts used without passing validation; flagged for a human.';

/** Final status of the repair stage for one run. A subset of the run statuses. */
export type RepairStatus =
  'repaired' | 'failed' | 'aborted' | 'cheating_rejected' | 'flagged' | 'stage_failure';

/**
 * Checks the FR-18 precondition: repair runs only for a change that is breaking, has a mapping
 * confirmed by a migration note or a human (BR-04), and has at least one located call site.
 * @param change - The change to repair.
 * @param locate - The locate stage result for this run.
 * @returns `null` when repair may run, otherwise the plain reason it is flagged instead.
 */
export function repairPreconditionReason(
  change: RepairContextInput['change'],
  locate: Pick<LocateResult, 'callSites'>,
): string | null {
  if (change.classification !== 'breaking')
    return `Change is classified ${change.classification}, not breaking: reported, not repaired.`;
  if (
    change.mappingStatus !== 'confirmed' ||
    !change.mapping ||
    (change.mappingSource !== 'migration_note' && change.mappingSource !== 'human')
  )
    return 'No confirmed mapping: reported, not repaired.';
  if (locate.callSites.length === 0) return 'No located call sites: reported, not repaired.';
  return null;
}

/**
 * Whether the next model call could take the run over its token ceiling (FR-24, NFR-07).
 * @param usedTokens - Input + output tokens already recorded for this run.
 * @param approxInputTokens - Estimated input tokens of the next context.
 * @param maxOutputTokens - Output-token limit of the next call.
 * @param ceiling - The run's token ceiling.
 */
export function exceedsTokenCeiling(
  usedTokens: number,
  approxInputTokens: number,
  maxOutputTokens: number,
  ceiling: number,
): boolean {
  return usedTokens + approxInputTokens + maxOutputTokens > ceiling;
}

const USEFUL_LINE = /\berror TS\d+|AssertionError|Expected|Received|expected .* to /;
/** Most raw-output lines kept per attempt in the feedback. */
const MAX_RAW_LINES = 40;

/**
 * Summarizes a validation result as error feedback for the next attempt (FR-21): status,
 * counts, every failing test as `FAIL <file> > <name>`, and the compiler and assertion lines
 * from the raw output. The context builder redacts and caps it (inc10).
 * @param attempt - Number of the attempt that produced the result.
 * @param result - Its validation result.
 */
export function validatorFeedback(attempt: number, result: ValidationResult): string {
  const lines = [
    `Attempt ${attempt} validation ${result.status}: ${result.compileErrors} compile error(s), ` +
      `${result.testsPassed}/${result.testsTotal} tests passed.`,
  ];
  if (result.errorReason) lines.push(`Error: ${result.errorReason}`);
  for (const t of result.testResults)
    if (t.status === 'failed') lines.push(`FAIL ${t.file} > ${t.name}`);
  const seen = new Set<string>();
  for (const raw of result.rawOutput.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || seen.has(line) || !USEFUL_LINE.test(line)) continue;
    seen.add(line);
    lines.push(line);
    if (seen.size >= MAX_RAW_LINES) break;
  }
  return lines.join('\n');
}

/**
 * Feedback for an attempt whose output never reached validation (an invalid model answer or a
 * patch that does not apply).
 * @param attempt - Attempt number.
 * @param reason - Why the patch was not validated.
 */
export function unvalidatedFeedback(attempt: number, reason: string): string {
  return `Attempt ${attempt} patch rejected before validation. Error: ${reason}`;
}
