/**
 * Shared domain enums: one source of truth for the database (pgEnums), the pipeline and the UI.
 *
 * Every enum is an `as const` array, a derived union type, and a text-label map. The UI must
 * show these labels, never colour alone (FR-42, UI-02).
 */

/** Change categories in scope (C-01), plus `other` for anything outside them. */
export const CHANGE_CATEGORIES = [
  'field_renamed',
  'field_type_changed',
  'required_param_added',
  'endpoint_removed',
  'other',
] as const;
/** One of {@link CHANGE_CATEGORIES}. */
export type ChangeCategory = (typeof CHANGE_CATEGORIES)[number];
/** Text labels for {@link ChangeCategory}. */
export const CHANGE_CATEGORY_LABELS: Readonly<Record<ChangeCategory, string>> = {
  field_renamed: 'Field renamed',
  field_type_changed: 'Field type changed',
  required_param_added: 'Required parameter added',
  endpoint_removed: 'Endpoint removed',
  other: 'Other change',
};

/** Classification of one spec difference (FR-07). */
export const CLASSIFICATIONS = ['breaking', 'safe', 'unknown'] as const;
/** One of {@link CLASSIFICATIONS}. */
export type Classification = (typeof CLASSIFICATIONS)[number];
/** Text labels for {@link Classification}. */
export const CLASSIFICATION_LABELS: Readonly<Record<Classification, string>> = {
  breaking: 'Breaking',
  safe: 'Safe',
  unknown: 'Unknown',
};

/** Whether an old→new mapping is confirmed (FR-10, BR-04). */
export const MAPPING_STATUSES = ['confirmed', 'unconfirmed'] as const;
/** One of {@link MAPPING_STATUSES}. */
export type MappingStatus = (typeof MAPPING_STATUSES)[number];
/** Text labels for {@link MappingStatus}. */
export const MAPPING_STATUS_LABELS: Readonly<Record<MappingStatus, string>> = {
  confirmed: 'Mapping confirmed',
  unconfirmed: 'Mapping unconfirmed',
};

/** Who confirmed a mapping. A mapping is never confirmed by name resemblance (BR-04). */
export const MAPPING_SOURCES = ['migration_note', 'human'] as const;
/** One of {@link MAPPING_SOURCES}. */
export type MappingSource = (typeof MAPPING_SOURCES)[number];
/** Text labels for {@link MappingSource}. */
export const MAPPING_SOURCE_LABELS: Readonly<Record<MappingSource, string>> = {
  migration_note: 'Confirmed by migration note',
  human: 'Confirmed by a human',
};

/** How a spec version was obtained (SRS 3.9). */
export const SOURCE_MODES = ['retrieved', 'uploaded', 'fixture'] as const;
/** One of {@link SOURCE_MODES}. */
export type SourceMode = (typeof SOURCE_MODES)[number];
/** Text labels for {@link SourceMode}. */
export const SOURCE_MODE_LABELS: Readonly<Record<SourceMode, string>> = {
  retrieved: 'Retrieved from URL',
  uploaded: 'Uploaded',
  fixture: 'Fixture (demonstration)',
};

/** The seven pipeline stages, in order (SRS 2.4). */
export const STAGES = [
  'ingest',
  'detect',
  'classify',
  'locate',
  'repair',
  'validate',
  'deliver',
] as const;
/** One of {@link STAGES}. */
export type Stage = (typeof STAGES)[number];
/** Text labels for {@link Stage}. */
export const STAGE_LABELS: Readonly<Record<Stage, string>> = {
  ingest: 'Ingest',
  detect: 'Detect',
  classify: 'Classify',
  locate: 'Locate',
  repair: 'Repair',
  validate: 'Validate',
  deliver: 'Deliver',
};

/** Result of one stage within a run (FR-38). */
export const STAGE_RESULT_STATUSES = ['ok', 'failed', 'skipped'] as const;
/** One of {@link STAGE_RESULT_STATUSES}. */
export type StageResultStatus = (typeof STAGE_RESULT_STATUSES)[number];
/** Text labels for {@link StageResultStatus}. */
export const STAGE_RESULT_STATUS_LABELS: Readonly<Record<StageResultStatus, string>> = {
  ok: 'OK',
  failed: 'Failed',
  skipped: 'Skipped',
};

/** Overall status of a run. */
export const RUN_STATUSES = [
  'running',
  'not_affected',
  'needs_review',
  'flagged',
  'repaired',
  'failed',
  'aborted',
  'cheating_rejected',
  'stage_failure',
] as const;
/** One of {@link RUN_STATUSES}. */
export type RunStatus = (typeof RUN_STATUSES)[number];
/** Text labels for {@link RunStatus}. */
export const RUN_STATUS_LABELS: Readonly<Record<RunStatus, string>> = {
  running: 'Running',
  not_affected: 'Not affected within supported scope',
  needs_review: 'Needs review',
  flagged: 'Flagged',
  repaired: 'Repaired (awaiting review)',
  failed: 'Repair failed',
  aborted: 'Aborted',
  cheating_rejected: 'Cheating rejected',
  stage_failure: 'Stage failure',
};

/** Outcome of one repair attempt after validation. */
export const ATTEMPT_OUTCOMES = ['pass', 'fail', 'cheating', 'error', 'timeout'] as const;
/** One of {@link ATTEMPT_OUTCOMES}. */
export type AttemptOutcome = (typeof ATTEMPT_OUTCOMES)[number];
/** Text labels for {@link AttemptOutcome}. */
export const ATTEMPT_OUTCOME_LABELS: Readonly<Record<AttemptOutcome, string>> = {
  pass: 'Passed validation',
  fail: 'Failed validation',
  cheating: 'Cheating detected',
  error: 'Error',
  timeout: 'Timed out',
};

/** Cheat guards (FR-27 to FR-31). A cheating outcome names exactly one (DR-04). */
export const GUARD_NAMES = [
  'test_file_changed',
  'test_count_changed',
  'type_suppression',
  'config_changed',
] as const;
/** One of {@link GUARD_NAMES}. */
export type GuardName = (typeof GUARD_NAMES)[number];
/** Text labels for {@link GuardName}. */
export const GUARD_NAME_LABELS: Readonly<Record<GuardName, string>> = {
  test_file_changed: 'Test file changed',
  test_count_changed: 'Test count changed',
  type_suppression: 'Type check suppressed',
  config_changed: 'Configuration changed',
};

/** Supported call patterns (C-01, SRS 5.2). */
export const CALL_PATTERNS = [
  'fetch',
  'axios_instance',
  'axios_static',
  'generated_client',
] as const;
/** One of {@link CALL_PATTERNS}. */
export type CallPattern = (typeof CALL_PATTERNS)[number];
/** Text labels for {@link CallPattern}. */
export const CALL_PATTERN_LABELS: Readonly<Record<CallPattern, string>> = {
  fetch: 'fetch',
  axios_instance: 'axios (configured instance)',
  axios_static: 'axios (static import)',
  generated_client: 'Generated client',
};

/** Outcome of one spec check. A failed check is never "no change" (FR-11). */
export const SPEC_CHECK_OUTCOMES = [
  'baseline_established',
  'no_change',
  'changed',
  'failed',
] as const;
/** One of {@link SPEC_CHECK_OUTCOMES}. */
export type SpecCheckOutcome = (typeof SPEC_CHECK_OUTCOMES)[number];
/** Text labels for {@link SpecCheckOutcome}. */
export const SPEC_CHECK_OUTCOME_LABELS: Readonly<Record<SpecCheckOutcome, string>> = {
  baseline_established: 'Baseline established',
  no_change: 'No change',
  changed: 'Changed',
  failed: 'Check failed',
};

/** Evaluation baselines (SRS 6): B1 do nothing, B2 single LLM call, B3 full pipeline. */
export const BASELINES = ['B1', 'B2', 'B3'] as const;
/** One of {@link BASELINES}. */
export type Baseline = (typeof BASELINES)[number];
/** Text labels for {@link Baseline}. */
export const BASELINE_LABELS: Readonly<Record<Baseline, string>> = {
  B1: 'B1: no repair',
  B2: 'B2: single model call',
  B3: 'B3: full pipeline',
};

/** Human review verdict on an evaluation result (EV-07). */
export const REVIEW_VERDICTS = ['correct', 'incorrect', 'not_reviewed'] as const;
/** One of {@link REVIEW_VERDICTS}. */
export type ReviewVerdict = (typeof REVIEW_VERDICTS)[number];
/** Text labels for {@link ReviewVerdict}. */
export const REVIEW_VERDICT_LABELS: Readonly<Record<ReviewVerdict, string>> = {
  correct: 'Reviewed: correct',
  incorrect: 'Reviewed: incorrect',
  not_reviewed: 'Not reviewed',
};

/** Registry of every domain enum with its values and labels (for tests and UI tooling). */
export const DOMAIN_ENUMS = {
  ChangeCategory: { values: CHANGE_CATEGORIES, labels: CHANGE_CATEGORY_LABELS },
  Classification: { values: CLASSIFICATIONS, labels: CLASSIFICATION_LABELS },
  MappingStatus: { values: MAPPING_STATUSES, labels: MAPPING_STATUS_LABELS },
  MappingSource: { values: MAPPING_SOURCES, labels: MAPPING_SOURCE_LABELS },
  SourceMode: { values: SOURCE_MODES, labels: SOURCE_MODE_LABELS },
  Stage: { values: STAGES, labels: STAGE_LABELS },
  StageResultStatus: { values: STAGE_RESULT_STATUSES, labels: STAGE_RESULT_STATUS_LABELS },
  RunStatus: { values: RUN_STATUSES, labels: RUN_STATUS_LABELS },
  AttemptOutcome: { values: ATTEMPT_OUTCOMES, labels: ATTEMPT_OUTCOME_LABELS },
  GuardName: { values: GUARD_NAMES, labels: GUARD_NAME_LABELS },
  CallPattern: { values: CALL_PATTERNS, labels: CALL_PATTERN_LABELS },
  SpecCheckOutcome: { values: SPEC_CHECK_OUTCOMES, labels: SPEC_CHECK_OUTCOME_LABELS },
  Baseline: { values: BASELINES, labels: BASELINE_LABELS },
  ReviewVerdict: { values: REVIEW_VERDICTS, labels: REVIEW_VERDICT_LABELS },
} as const;

/** Name of a registered domain enum. */
export type DomainEnumName = keyof typeof DOMAIN_ENUMS;

/**
 * Text label for any domain enum value, e.g. `labelOf('RunStatus', 'cheating_rejected')`
 * → `"Cheating rejected"`.
 *
 * @param enumName - The enum the value belongs to.
 * @param value - The enum value.
 */
export function labelOf<N extends DomainEnumName>(
  enumName: N,
  value: (typeof DOMAIN_ENUMS)[N]['values'][number],
): string {
  return (DOMAIN_ENUMS[enumName].labels as Record<string, string>)[value] ?? value;
}
