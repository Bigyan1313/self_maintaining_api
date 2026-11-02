import { z } from 'zod';
import * as enums from '../domain/enums.js';

const id = z.uuid();
const date = z.iso.datetime({ offset: true });
const text = z.string().trim().min(1).max(512);
const json = z.unknown();
function labeled<T extends readonly [string, ...string[]]>(
  values: T,
  labels: Readonly<Record<T[number], string>>,
) {
  return z
    .object({ value: z.enum(values), label: z.string() })
    .refine((v) => v.label === labels[v.value as T[number]], 'Outcome label must match its value');
}
/** Field-level error response for all endpoints. @implementedIn inc04 */
export const FieldErrorsSchema = z.array(z.object({ field: z.string(), message: z.string() }));
/** Structured validation errors. */
export type FieldErrors = z.infer<typeof FieldErrorsSchema>;
/** Repository registration. Only an environment variable name may reference credentials. @implementedIn inc04 */
export const RegisterRepositorySchema = z
  .object({
    owner: text.regex(/^[A-Za-z0-9][A-Za-z0-9-]*$/),
    name: text.regex(/^[A-Za-z0-9_.-]+$/),
    defaultBranch: text,
    localPath: text,
    credentialRef: z
      .string()
      .regex(/^[A-Z_][A-Z0-9_]*$/)
      .nullable()
      .optional(),
  })
  .strict();
/** Repository configuration returned by GET/POST /api/repositories. @implementedIn inc04 */
export const RepositorySchema = RegisterRepositorySchema.extend({
  id,
  credentialRef: z.string().nullable(),
  createdAt: date,
});
/** Repository list. @implementedIn inc04 */
export const RepositoriesSchema = z.array(RepositorySchema);
/** Repository registration request. */
export type RegisterRepository = z.infer<typeof RegisterRepositorySchema>;
/** API registration accepts a URL or a specification; validation occurs before persistence. @implementedIn inc04 */
export const RegisterApiSchema = z
  .object({
    name: text,
    specSourceUrl: z.string().max(2048).nullable().optional(),
    specText: z.string().optional(),
    filename: text.optional(),
    pollIntervalSeconds: z.number().int().min(60).max(2_147_483_647).nullable().optional(),
  })
  .strict()
  .refine((v) => Boolean(v.specSourceUrl) || v.specText !== undefined, {
    path: ['specSourceUrl'],
    message: 'Supply a specification URL or uploaded specification',
  });
/** API configuration response. @implementedIn inc04 */
export const ApiSchema = z.object({
  id,
  name: text,
  specSourceUrl: z.string().nullable(),
  pollIntervalSeconds: z.number().nullable(),
  baselineVersionId: id.nullable(),
  createdAt: date,
});
/** API list. @implementedIn inc04 */
export const ApisSchema = z.array(ApiSchema);
/** API registration request. */
export type RegisterApi = z.infer<typeof RegisterApiSchema>;
/** Raw UTF-8 JSON/YAML upload body for POST /api/apis/:id/specs. @implementedIn inc04 */
export const SpecUploadSchema = z.string();
/** Empty request for URL retrieval. @implementedIn inc04 */
export const CheckRequestSchema = z.object({}).strict();
/** UUID path parameters for API/change/run routes. @implementedIn inc04 */
export const IdParamsSchema = z.object({ id });
/** A persisted check includes a labeled outcome and safe failure detail. @implementedIn inc04 */
export const SpecCheckSchema = z.object({
  id,
  apiId: id,
  startedAt: date,
  finishedAt: date.nullable(),
  outcome: labeled(enums.SPEC_CHECK_OUTCOMES, enums.SPEC_CHECK_OUTCOME_LABELS),
  specVersionId: id.nullable(),
  errorDetail: z.string().nullable(),
});
/** Check history returned by GET /api/apis/:id/checks. @implementedIn inc04 */
export const SpecChecksSchema = z.array(SpecCheckSchema);
/** Upload/check response. @implementedIn inc04 */
export const IngestResponseSchema = z.object({
  check: SpecCheckSchema,
  baselineVersionId: id.nullable(),
  sourceMode: labeled(enums.SOURCE_MODES, enums.SOURCE_MODE_LABELS),
});
/** Serialized ingestion response. */
export type IngestResponse = z.infer<typeof IngestResponseSchema>;
/** Structured migration-note upload. @implementedIn inc06 */
export const MigrationNoteRequestSchema = z
  .object({ fromVersionId: id, toVersionId: id, rawYaml: z.string().min(1) })
  .strict();
/** Stored migration note. @implementedIn inc06 */
export const MigrationNoteSchema = MigrationNoteRequestSchema.extend({
  id,
  apiId: id,
  parsed: json,
  uploadedAt: date,
});
/** Change filtering. @implementedIn inc06 */
export const ChangesQuerySchema = z.object({ apiId: id });
/** Change evidence and labeled classification/mapping. @implementedIn inc06 */
export const ChangeSchema = z.object({
  id,
  apiId: id,
  fromVersionId: id,
  toVersionId: id,
  category: labeled(enums.CHANGE_CATEGORIES, enums.CHANGE_CATEGORY_LABELS),
  oasdiffRuleId: z.string(),
  classification: labeled(enums.CLASSIFICATIONS, enums.CLASSIFICATION_LABELS),
  confidence: z.number().min(0).max(1),
  path: z.string(),
  method: z.string().nullable(),
  jsonPointer: z.string(),
  evidenceBefore: json,
  evidenceAfter: json,
  mappingStatus: labeled(enums.MAPPING_STATUSES, enums.MAPPING_STATUS_LABELS),
  mappingSource: labeled(enums.MAPPING_SOURCES, enums.MAPPING_SOURCE_LABELS).nullable(),
  mapping: json,
  migrationNoteId: id.nullable(),
  confirmedBy: z.string().nullable(),
  confirmedAt: date.nullable(),
  createdAt: date,
});
/** Classified changes. @implementedIn inc06 */
export const ChangesSchema = z.array(ChangeSchema);
/** Explicit human mapping confirmation; response uses ChangeSchema. @implementedIn inc06 */
export const ConfirmMappingRequestSchema = z
  .object({ mapping: z.record(z.string(), json), confirmedBy: text })
  .strict();
/** Start one run. @implementedIn inc13 */
export const StartRunRequestSchema = z.object({ changeId: id, repositoryId: id }).strict();
/** Run metadata with text labels for every outcome. @implementedIn inc13 */
export const RunSchema = z.object({
  id,
  changeId: id,
  repositoryId: id,
  commitSha: z.string(),
  parentRunId: id.nullable(),
  stageReached: labeled(enums.STAGES, enums.STAGE_LABELS),
  status: labeled(enums.RUN_STATUSES, enums.RUN_STATUS_LABELS),
  failureStage: labeled(enums.STAGES, enums.STAGE_LABELS).nullable(),
  failureDetail: z.string().nullable(),
  flaggedReason: z.string().nullable(),
  attemptCount: z.number().int().min(0).max(4),
  tokensIn: z.number().nonnegative(),
  tokensOut: z.number().nonnegative(),
  costUsd: z.string(),
  modelId: z.string().nullable(),
  isFixture: z.boolean(),
  prUrl: z.string().nullable(),
  startedAt: date,
  finishedAt: date.nullable(),
});
/** Recorded stage result. @implementedIn inc13 */
export const StageResultSchema = z.object({
  id,
  runId: id,
  stage: labeled(enums.STAGES, enums.STAGE_LABELS),
  status: labeled(enums.STAGE_RESULT_STATUSES, enums.STAGE_RESULT_STATUS_LABELS),
  result: json,
  startedAt: date,
  finishedAt: date,
});
/** Located call evidence. @implementedIn inc13 */
export const CallSiteSchema = z.object({
  id,
  runId: id,
  filePath: z.string(),
  line: z.number().int().positive(),
  column: z.number().int().positive(),
  pattern: labeled(enums.CALL_PATTERNS, enums.CALL_PATTERN_LABELS),
  excerpt: z.string(),
});
/** Coverage evidence. @implementedIn inc13 */
export const CoverageSchema = z.object({
  id,
  runId: id,
  filePath: z.string(),
  inspected: z.boolean(),
  skipReason: z.string().nullable(),
});
/** Repair attempt evidence. @implementedIn inc13 */
export const AttemptSchema = z.object({
  id,
  runId: id,
  attemptNumber: z.number().int().min(1).max(4),
  patch: z.string(),
  validationOutput: z.string().nullable(),
  compileErrors: z.number().nullable(),
  testsPassed: z.number().nullable(),
  testsTotal: z.number().nullable(),
  outcome: labeled(enums.ATTEMPT_OUTCOMES, enums.ATTEMPT_OUTCOME_LABELS),
  guardName: labeled(enums.GUARD_NAMES, enums.GUARD_NAME_LABELS).nullable(),
  tokensIn: z.number(),
  tokensOut: z.number(),
  costUsd: z.string(),
  modelId: z.string(),
  durationMs: z.number(),
  createdAt: date,
});
/** Run Detail and JSON export contain the same evidence. @implementedIn inc13 */
export const RunDetailSchema = z.object({
  run: RunSchema,
  change: ChangeSchema,
  migrationNote: MigrationNoteSchema.nullable(),
  stageResults: z.array(StageResultSchema),
  callSites: z.array(CallSiteSchema),
  coverage: z.array(CoverageSchema),
  attempts: z.array(AttemptSchema),
});
/** Run list. @implementedIn inc13 */
export const RunsSchema = z.array(RunSchema);
/** Reanalysis and delivery retry requests. @implementedIn inc13 */
export const RunActionRequestSchema = z.object({}).strict();
/** Run export selector; JSON uses RunDetailSchema, HTML is a document string. @implementedIn inc13 */
export const ExportQuerySchema = z.object({ format: z.enum(['json', 'html']) });
/** HTML export response. @implementedIn inc13 */
export const HtmlExportSchema = z.string();
/** Evaluation label selector (omitted means latest). @implementedIn inc16 */
export const ResultsQuerySchema = z.object({ label: text.optional() });
/** Persisted scenario evaluation row. @implementedIn inc16 */
export const EvaluationResultSchema = z.object({
  id,
  evalLabel: z.string(),
  scenarioId: z.string(),
  baseline: labeled(enums.BASELINES, enums.BASELINE_LABELS),
  outcome: labeled(enums.RUN_STATUSES, enums.RUN_STATUS_LABELS),
  attemptsUsed: z.number().int().min(0).max(4),
  costUsd: z.string(),
  durationMs: z.number(),
  modelMs: z.number().nullable(),
  containerMs: z.number().nullable(),
  reviewVerdict: labeled(enums.REVIEW_VERDICTS, enums.REVIEW_VERDICT_LABELS),
  excluded: z.boolean(),
  exclusionReason: z.string().nullable(),
  isPartial: z.boolean(),
  createdAt: date,
});
/** Latest evaluation; no label/results before the first study. @implementedIn inc16 */
export const ResultsSchema = z.object({
  label: z.string().nullable(),
  results: z.array(EvaluationResultSchema),
});
/** Shared endpoint schemas; declaration does not register unimplemented routes. @implementedIn inc04 */
export const API_CONTRACT = {
  repositories: {
    path: '/api/repositories',
    GET: { response: RepositoriesSchema },
    POST: { request: RegisterRepositorySchema, response: RepositorySchema },
  },
  apis: {
    path: '/api/apis',
    GET: { response: ApisSchema },
    POST: { request: RegisterApiSchema, response: ApiSchema },
  },
  specs: {
    path: '/api/apis/:id/specs',
    POST: { request: SpecUploadSchema, response: IngestResponseSchema },
  },
  check: {
    path: '/api/apis/:id/check',
    POST: { request: CheckRequestSchema, response: IngestResponseSchema },
  },
  checks: { path: '/api/apis/:id/checks', GET: { response: SpecChecksSchema } },
  migrationNotes: {
    path: '/api/apis/:id/migration-notes',
    POST: { request: MigrationNoteRequestSchema, response: MigrationNoteSchema },
  },
  changes: { path: '/api/changes', GET: { query: ChangesQuerySchema, response: ChangesSchema } },
  confirmMapping: {
    path: '/api/changes/:id/confirm-mapping',
    POST: { request: ConfirmMappingRequestSchema, response: ChangeSchema },
  },
  runs: {
    path: '/api/runs',
    GET: { response: RunsSchema },
    POST: { request: StartRunRequestSchema, response: RunSchema },
  },
  run: { path: '/api/runs/:id', GET: { response: RunDetailSchema } },
  reanalyze: {
    path: '/api/runs/:id/reanalyze',
    POST: { request: RunActionRequestSchema, response: RunSchema },
  },
  retryDelivery: {
    path: '/api/runs/:id/retry-delivery',
    POST: { request: RunActionRequestSchema, response: RunSchema },
  },
  export: {
    path: '/api/runs/:id/export',
    GET: { query: ExportQuerySchema, response: z.union([RunDetailSchema, HtmlExportSchema]) },
  },
  results: { path: '/api/results', GET: { query: ResultsQuerySchema, response: ResultsSchema } },
} as const;
/** Inferred shared wire types. */
export type RepositoryResponse = z.infer<typeof RepositorySchema>;
/** API configuration wire type. */
export type ApiResponse = z.infer<typeof ApiSchema>;
/** Change evidence wire type. */
export type ChangeResponse = z.infer<typeof ChangeSchema>;
/** Run detail wire type. */
export type RunDetail = z.infer<typeof RunDetailSchema>;
/** Evaluation wire type. */
export type ResultsResponse = z.infer<typeof ResultsSchema>;
/** Raw uploaded document. @implementedIn inc04 */
export type SpecUpload = z.infer<typeof SpecUploadSchema>;
/** URL check request. @implementedIn inc04 */
export type CheckRequest = z.infer<typeof CheckRequestSchema>;
/** Check history item. @implementedIn inc04 */
export type SpecCheckResponse = z.infer<typeof SpecCheckSchema>;
/** Migration note input. @implementedIn inc06 */
export type MigrationNoteRequest = z.infer<typeof MigrationNoteRequestSchema>;
/** Migration note record. @implementedIn inc06 */
export type MigrationNoteResponse = z.infer<typeof MigrationNoteSchema>;
/** Change-list filter. @implementedIn inc06 */
export type ChangesQuery = z.infer<typeof ChangesQuerySchema>;
/** Human mapping confirmation input. @implementedIn inc06 */
export type ConfirmMappingRequest = z.infer<typeof ConfirmMappingRequestSchema>;
/** Start-run input. @implementedIn inc13 */
export type StartRunRequest = z.infer<typeof StartRunRequestSchema>;
/** Run metadata. @implementedIn inc13 */
export type RunResponse = z.infer<typeof RunSchema>;
/** Reanalysis/retry input. @implementedIn inc13 */
export type RunActionRequest = z.infer<typeof RunActionRequestSchema>;
/** Export format. @implementedIn inc13 */
export type ExportQuery = z.infer<typeof ExportQuerySchema>;
/** Evaluation selector. @implementedIn inc16 */
export type ResultsQuery = z.infer<typeof ResultsQuerySchema>;
/** Evaluation row. @implementedIn inc16 */
export type EvaluationResultResponse = z.infer<typeof EvaluationResultSchema>;
