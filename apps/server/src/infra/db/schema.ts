/**
 * Drizzle schema for Self-Maintaining APIs (SRS 2.4, 3.9; DR-01 to DR-04).
 *
 * Data rules are enforced by the database itself (CHECK, UNIQUE, foreign keys, and the
 * append-only triggers in migration `0001_append_only_triggers.sql`), not only by app code.
 *
 * @packageDocumentation
 */
import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  doublePrecision,
  index,
  integer,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
  type AnyPgColumn,
} from 'drizzle-orm/pg-core';
import {
  ATTEMPT_OUTCOMES,
  BASELINES,
  CALL_PATTERNS,
  CHANGE_CATEGORIES,
  CLASSIFICATIONS,
  GUARD_NAMES,
  MAPPING_SOURCES,
  MAPPING_STATUSES,
  REVIEW_VERDICTS,
  RUN_STATUSES,
  SOURCE_MODES,
  SPEC_CHECK_OUTCOMES,
  STAGE_RESULT_STATUSES,
  STAGES,
} from '@sma/core';

// ---------- enums (built from the shared core arrays) ----------

/** pgEnum for `ChangeCategory`. */
export const changeCategoryEnum = pgEnum('change_category', CHANGE_CATEGORIES);
/** pgEnum for `Classification`. */
export const classificationEnum = pgEnum('classification', CLASSIFICATIONS);
/** pgEnum for `MappingStatus`. */
export const mappingStatusEnum = pgEnum('mapping_status', MAPPING_STATUSES);
/** pgEnum for `MappingSource`. */
export const mappingSourceEnum = pgEnum('mapping_source', MAPPING_SOURCES);
/** pgEnum for `SourceMode`. */
export const sourceModeEnum = pgEnum('source_mode', SOURCE_MODES);
/** pgEnum for `Stage`. */
export const stageEnum = pgEnum('stage', STAGES);
/** pgEnum for `StageResultStatus`. */
export const stageResultStatusEnum = pgEnum('stage_result_status', STAGE_RESULT_STATUSES);
/** pgEnum for `RunStatus`. */
export const runStatusEnum = pgEnum('run_status', RUN_STATUSES);
/** pgEnum for `AttemptOutcome`. */
export const attemptOutcomeEnum = pgEnum('attempt_outcome', ATTEMPT_OUTCOMES);
/** pgEnum for `GuardName`. */
export const guardNameEnum = pgEnum('guard_name', GUARD_NAMES);
/** pgEnum for `CallPattern`. */
export const callPatternEnum = pgEnum('call_pattern', CALL_PATTERNS);
/** pgEnum for `SpecCheckOutcome`. */
export const specCheckOutcomeEnum = pgEnum('spec_check_outcome', SPEC_CHECK_OUTCOMES);
/** pgEnum for `Baseline`. */
export const baselineEnum = pgEnum('baseline', BASELINES);
/** pgEnum for `ReviewVerdict`. */
export const reviewVerdictEnum = pgEnum('review_verdict', REVIEW_VERDICTS);

// ---------- column helpers ----------

const id = () => uuid('id').primaryKey().defaultRandom();
const tstz = (name: string) => timestamp(name, { withTimezone: true, mode: 'date' });
const money = (name: string) => numeric(name, { precision: 12, scale: 6 });

// ---------- tables ----------

/** Consumer repositories. `credential_ref` is the NAME of an env var, never a secret (NFR-04). */
export const repositories = pgTable(
  'repositories',
  {
    id: id(),
    owner: text('owner').notNull(),
    name: text('name').notNull(),
    defaultBranch: text('default_branch').notNull(),
    credentialRef: text('credential_ref'),
    localPath: text('local_path'),
    createdAt: tstz('created_at').notNull().defaultNow(),
  },
  (t) => [
    unique('repositories_owner_name_uq').on(t.owner, t.name),
    check(
      'repositories_credential_ref_is_env_var_name',
      sql`${t.credentialRef} IS NULL OR ${t.credentialRef} ~ '^[A-Z_][A-Z0-9_]*$'`,
    ),
  ],
);

/** Monitored APIs and their current baseline version. */
export const apis = pgTable(
  'apis',
  {
    id: id(),
    name: text('name').notNull(),
    specSourceUrl: text('spec_source_url'),
    pollIntervalSeconds: integer('poll_interval_seconds'),
    baselineVersionId: uuid('baseline_version_id').references((): AnyPgColumn => specVersions.id),
    createdAt: tstz('created_at').notNull().defaultNow(),
  },
  (t) => [
    unique('apis_name_uq').on(t.name),
    check(
      'apis_poll_interval_min_60',
      sql`${t.pollIntervalSeconds} IS NULL OR ${t.pollIntervalSeconds} >= 60`,
    ),
    index('apis_baseline_version_id_idx').on(t.baselineVersionId),
  ],
);

/** Distinct spec versions per API (FR-05). Append-only. */
export const specVersions = pgTable(
  'spec_versions',
  {
    id: id(),
    apiId: uuid('api_id')
      .notNull()
      .references(() => apis.id),
    retrievedAt: tstz('retrieved_at').notNull().defaultNow(),
    sourceMode: sourceModeEnum('source_mode').notNull(),
    sourceIdentifier: text('source_identifier').notNull(),
    contentSha256: text('content_sha256').notNull(),
    normalized: jsonb('normalized').$type<unknown>().notNull(),
  },
  (t) => [
    unique('spec_versions_api_hash_uq').on(t.apiId, t.contentSha256),
    check('spec_versions_sha256_format', sql`${t.contentSha256} ~ '^[0-9a-f]{64}$'`),
    index('spec_versions_api_id_idx').on(t.apiId),
  ],
);

/** Every spec check, including failures (FR-11: a failed check is not "no change"). */
export const specChecks = pgTable(
  'spec_checks',
  {
    id: id(),
    apiId: uuid('api_id')
      .notNull()
      .references(() => apis.id),
    startedAt: tstz('started_at').notNull().defaultNow(),
    finishedAt: tstz('finished_at'),
    outcome: specCheckOutcomeEnum('outcome').notNull(),
    specVersionId: uuid('spec_version_id').references(() => specVersions.id),
    errorDetail: text('error_detail'),
    /** Stage that failed (ingest, detect or classify); set exactly when the check failed (UC-02). */
    failureStage: stageEnum('failure_stage'),
  },
  (t) => [
    check(
      'spec_checks_failed_has_error_detail',
      sql`${t.outcome} <> 'failed' OR ${t.errorDetail} IS NOT NULL`,
    ),
    check(
      'spec_checks_failed_iff_failure_stage',
      sql`(${t.outcome} = 'failed') = (${t.failureStage} IS NOT NULL)`,
    ),
    check(
      'spec_checks_failure_stage_in_check',
      sql`${t.failureStage} IS NULL OR ${t.failureStage} IN ('ingest', 'detect', 'classify')`,
    ),
    index('spec_checks_api_id_idx').on(t.apiId),
    index('spec_checks_spec_version_id_idx').on(t.specVersionId),
  ],
);

/** Migration notes for a spec pair (FR-09). */
export const migrationNotes = pgTable(
  'migration_notes',
  {
    id: id(),
    apiId: uuid('api_id')
      .notNull()
      .references(() => apis.id),
    fromVersionId: uuid('from_version_id')
      .notNull()
      .references(() => specVersions.id),
    toVersionId: uuid('to_version_id')
      .notNull()
      .references(() => specVersions.id),
    rawYaml: text('raw_yaml').notNull(),
    parsed: jsonb('parsed').$type<unknown>().notNull(),
    uploadedAt: tstz('uploaded_at').notNull().defaultNow(),
  },
  (t) => [
    index('migration_notes_api_id_idx').on(t.apiId),
    index('migration_notes_from_version_id_idx').on(t.fromVersionId),
    index('migration_notes_to_version_id_idx').on(t.toVersionId),
  ],
);

/** One classified spec difference, linked to its evidence (FR-06 to FR-10, DR-02). */
export const changes = pgTable(
  'changes',
  {
    id: id(),
    apiId: uuid('api_id')
      .notNull()
      .references(() => apis.id),
    fromVersionId: uuid('from_version_id')
      .notNull()
      .references(() => specVersions.id),
    toVersionId: uuid('to_version_id')
      .notNull()
      .references(() => specVersions.id),
    category: changeCategoryEnum('category').notNull(),
    oasdiffRuleId: text('oasdiff_rule_id').notNull(),
    classification: classificationEnum('classification').notNull(),
    confidence: doublePrecision('confidence').notNull(),
    path: text('path').notNull(),
    method: text('method'),
    jsonPointer: text('json_pointer').notNull(),
    evidenceBefore: jsonb('evidence_before').$type<unknown>(),
    evidenceAfter: jsonb('evidence_after').$type<unknown>(),
    mappingStatus: mappingStatusEnum('mapping_status').notNull().default('unconfirmed'),
    mappingSource: mappingSourceEnum('mapping_source'),
    mapping: jsonb('mapping').$type<unknown>(),
    migrationNoteId: uuid('migration_note_id').references(() => migrationNotes.id),
    confirmedBy: text('confirmed_by'),
    confirmedAt: tstz('confirmed_at'),
    createdAt: tstz('created_at').notNull().defaultNow(),
  },
  (t) => [
    check('changes_confidence_0_1', sql`${t.confidence} >= 0 AND ${t.confidence} <= 1`),
    check(
      'changes_confirmed_iff_source',
      sql`(${t.mappingStatus} = 'confirmed') = (${t.mappingSource} IS NOT NULL)`,
    ),
    check(
      'changes_human_source_has_confirmer',
      sql`${t.mappingSource} IS DISTINCT FROM 'human' OR (${t.confirmedBy} IS NOT NULL AND ${t.confirmedAt} IS NOT NULL)`,
    ),
    check('changes_versions_differ', sql`${t.fromVersionId} <> ${t.toVersionId}`),
    index('changes_api_id_idx').on(t.apiId),
    index('changes_from_version_id_idx').on(t.fromVersionId),
    index('changes_to_version_id_idx').on(t.toVersionId),
    index('changes_migration_note_id_idx').on(t.migrationNoteId),
  ],
);

/** One analysis of one change against one repository commit (DR-02). Frozen once finished (FR-39). */
export const runs = pgTable(
  'runs',
  {
    id: id(),
    changeId: uuid('change_id')
      .notNull()
      .references(() => changes.id),
    repositoryId: uuid('repository_id')
      .notNull()
      .references(() => repositories.id),
    commitSha: text('commit_sha').notNull(),
    parentRunId: uuid('parent_run_id').references((): AnyPgColumn => runs.id),
    stageReached: stageEnum('stage_reached').notNull(),
    status: runStatusEnum('status').notNull().default('running'),
    failureStage: stageEnum('failure_stage'),
    failureDetail: text('failure_detail'),
    flaggedReason: text('flagged_reason'),
    attemptCount: integer('attempt_count').notNull().default(0),
    tokensIn: integer('tokens_in').notNull().default(0),
    tokensOut: integer('tokens_out').notNull().default(0),
    costUsd: money('cost_usd').notNull().default('0'),
    modelId: text('model_id'),
    isFixture: boolean('is_fixture').notNull().default(false),
    prUrl: text('pr_url'),
    startedAt: tstz('started_at').notNull().defaultNow(),
    finishedAt: tstz('finished_at'),
  },
  (t) => [
    check('runs_attempt_count_0_4', sql`${t.attemptCount} BETWEEN 0 AND 4`),
    check(
      'runs_stage_failure_has_stage',
      sql`${t.status} <> 'stage_failure' OR ${t.failureStage} IS NOT NULL`,
    ),
    check(
      'runs_running_iff_unfinished',
      sql`(${t.status} = 'running') = (${t.finishedAt} IS NULL)`,
    ),
    check(
      'runs_finished_after_start',
      sql`${t.finishedAt} IS NULL OR ${t.finishedAt} >= ${t.startedAt}`,
    ),
    check('runs_commit_sha_format', sql`${t.commitSha} ~ '^[0-9a-f]{40}([0-9a-f]{24})?$'`),
    check(
      'runs_usage_non_negative',
      sql`${t.tokensIn} >= 0 AND ${t.tokensOut} >= 0 AND ${t.costUsd} >= 0`,
    ),
    check('runs_not_own_parent', sql`${t.parentRunId} IS NULL OR ${t.parentRunId} <> ${t.id}`),
    index('runs_change_id_idx').on(t.changeId),
    index('runs_repository_id_idx').on(t.repositoryId),
    index('runs_parent_run_id_idx').on(t.parentRunId),
  ],
);

/** The result each stage wrote before the next began (FR-38). Append-only. */
export const runStageResults = pgTable(
  'run_stage_results',
  {
    id: id(),
    runId: uuid('run_id')
      .notNull()
      .references(() => runs.id),
    stage: stageEnum('stage').notNull(),
    status: stageResultStatusEnum('status').notNull(),
    result: jsonb('result').$type<unknown>().notNull(),
    startedAt: tstz('started_at').notNull(),
    finishedAt: tstz('finished_at').notNull(),
  },
  (t) => [
    unique('run_stage_results_run_stage_uq').on(t.runId, t.stage),
    check('run_stage_results_finished_after_start', sql`${t.finishedAt} >= ${t.startedAt}`),
  ],
);

/** Located call sites (FR-14). Append-only. */
export const callSites = pgTable(
  'call_sites',
  {
    id: id(),
    runId: uuid('run_id')
      .notNull()
      .references(() => runs.id),
    filePath: text('file_path').notNull(),
    line: integer('line').notNull(),
    column: integer('column').notNull(),
    pattern: callPatternEnum('pattern').notNull(),
    excerpt: text('excerpt').notNull(),
  },
  (t) => [
    check('call_sites_position_positive', sql`${t.line} >= 1 AND ${t.column} >= 1`),
    index('call_sites_run_id_idx').on(t.runId),
  ],
);

/** Which files were inspected or skipped, and why (FR-15). Append-only. */
export const coverageEntries = pgTable(
  'coverage_entries',
  {
    id: id(),
    runId: uuid('run_id')
      .notNull()
      .references(() => runs.id),
    filePath: text('file_path').notNull(),
    inspected: boolean('inspected').notNull(),
    skipReason: text('skip_reason'),
  },
  (t) => [
    check(
      'coverage_entries_skipped_has_reason',
      sql`${t.inspected} OR ${t.skipReason} IS NOT NULL`,
    ),
    index('coverage_entries_run_id_idx').on(t.runId),
  ],
);

/** Repair attempts: at most 4 per run (DR-03); cheating names its guard (DR-04). Append-only. */
export const attempts = pgTable(
  'attempts',
  {
    id: id(),
    runId: uuid('run_id')
      .notNull()
      .references(() => runs.id),
    attemptNumber: integer('attempt_number').notNull(),
    patch: text('patch').notNull(),
    validationOutput: text('validation_output'),
    compileErrors: integer('compile_errors'),
    testsPassed: integer('tests_passed'),
    testsTotal: integer('tests_total'),
    outcome: attemptOutcomeEnum('outcome').notNull(),
    guardName: guardNameEnum('guard_name'),
    tokensIn: integer('tokens_in').notNull(),
    tokensOut: integer('tokens_out').notNull(),
    costUsd: money('cost_usd').notNull(),
    modelId: text('model_id').notNull(),
    durationMs: integer('duration_ms').notNull(),
    createdAt: tstz('created_at').notNull().defaultNow(),
  },
  (t) => [
    unique('attempts_run_attempt_uq').on(t.runId, t.attemptNumber),
    check('attempts_number_1_4', sql`${t.attemptNumber} BETWEEN 1 AND 4`),
    check(
      'attempts_cheating_iff_guard',
      sql`(${t.outcome} = 'cheating') = (${t.guardName} IS NOT NULL)`,
    ),
    check(
      'attempts_tests_consistent',
      sql`(${t.testsPassed} IS NULL OR ${t.testsPassed} >= 0) AND (${t.testsTotal} IS NULL OR ${t.testsTotal} >= 0) AND (${t.testsPassed} IS NULL OR ${t.testsTotal} IS NULL OR ${t.testsPassed} <= ${t.testsTotal})`,
    ),
    check(
      'attempts_usage_non_negative',
      sql`${t.tokensIn} >= 0 AND ${t.tokensOut} >= 0 AND ${t.costUsd} >= 0 AND ${t.durationMs} >= 0 AND (${t.compileErrors} IS NULL OR ${t.compileErrors} >= 0)`,
    ),
  ],
);

/** Evaluation results per scenario and baseline (SRS 6, EV-07, EV-08). */
export const evaluationResults = pgTable(
  'evaluation_results',
  {
    id: id(),
    evalLabel: text('eval_label').notNull(),
    scenarioId: text('scenario_id').notNull(),
    baseline: baselineEnum('baseline').notNull(),
    outcome: runStatusEnum('outcome').notNull(),
    attemptsUsed: integer('attempts_used').notNull(),
    costUsd: money('cost_usd').notNull(),
    durationMs: integer('duration_ms').notNull(),
    modelMs: integer('model_ms'),
    containerMs: integer('container_ms'),
    reviewVerdict: reviewVerdictEnum('review_verdict').notNull().default('not_reviewed'),
    excluded: boolean('excluded').notNull().default(false),
    exclusionReason: text('exclusion_reason'),
    isPartial: boolean('is_partial').notNull().default(false),
    createdAt: tstz('created_at').notNull().defaultNow(),
  },
  (t) => [
    unique('evaluation_results_label_scenario_baseline_uq').on(
      t.evalLabel,
      t.scenarioId,
      t.baseline,
    ),
    check(
      'evaluation_results_excluded_has_reason',
      sql`NOT ${t.excluded} OR ${t.exclusionReason} IS NOT NULL`,
    ),
    check('evaluation_results_attempts_0_4', sql`${t.attemptsUsed} BETWEEN 0 AND 4`),
    check(
      'evaluation_results_non_negative',
      sql`${t.costUsd} >= 0 AND ${t.durationMs} >= 0 AND (${t.modelMs} IS NULL OR ${t.modelMs} >= 0) AND (${t.containerMs} IS NULL OR ${t.containerMs} >= 0)`,
    ),
  ],
);
