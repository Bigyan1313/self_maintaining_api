import { z } from 'zod';
import {
  BASELINES,
  CHANGE_CATEGORIES,
  CLASSIFICATIONS,
  GUARD_NAMES,
  RUN_STATUSES,
} from '../domain/enums.js';
const count = z.number().int().nonnegative();
const nonnegative = z.number().finite().nonnegative();
/** Counts for one classification, matched one-to-one against frozen labels. */
export const DetectionCountsSchema = z.object({ tp: count, fp: count, fn: count });
/** A comparable detection identity; fields/parameters disambiguate changes in one operation. */
export const DetectionLabelSchema = z.object({
  method: z.string().nullable(),
  path: z.string(),
  category: z.enum(CHANGE_CATEGORIES),
  classification: z.enum(CLASSIFICATIONS),
  field: z.string().optional(),
  parameter: z.string().optional(),
  location: z.string().optional(),
});
/** One scored scenario/baseline/repetition, with evidence retained for review. */
export const EvaluationTrialSchema = z.object({
  id: z.string().uuid(),
  scenarioId: z.string(),
  baseline: z.enum(BASELINES),
  repeat: z.number().int().min(1).max(3),
  category: z.enum(CHANGE_CATEGORIES),
  expected: z.enum(['repair', 'refuse']),
  outcome: z.enum(RUN_STATUSES),
  reason: z.string(),
  attemptsUsed: count.max(4),
  tokensIn: count,
  tokensOut: count,
  costUsd: nonnegative,
  durationMs: nonnegative,
  modelMs: nonnegative,
  containerMs: nonnegative,
  guard: z.enum(GUARD_NAMES).nullable(),
  patch: z.string(),
  migrationNote: z.string(),
  runId: z.string().uuid().nullable(),
  detection: z.record(z.enum(CLASSIFICATIONS), DetectionCountsSchema).nullable(),
  detected: z.array(DetectionLabelSchema),
  labels: z.array(DetectionLabelSchema),
  review: z
    .object({
      verdict: z.enum(['correct', 'incorrect']),
      name: z.string().min(1),
      note: z.string().min(1),
      at: z.string().datetime(),
    })
    .nullable(),
  completed: z.boolean(),
  createdAt: z.string().datetime(),
  /** Provider `stop_reason` of each model call, in order (`no_response` when none arrived). */
  stopReasons: z.array(z.string()).default([]),
});
/** Versioned, independently readable evaluation artifact, also mirrored in PostgreSQL. */
export const EvaluationStudySchema = z.object({
  schemaVersion: z.literal(1),
  label: z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,79}$/),
  startedAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  status: z.enum(['partial', 'complete']),
  stopReason: z.string().nullable(),
  fake: z.boolean(),
  config: z.object({
    baselines: z.array(z.enum(BASELINES)).min(1),
    scenarioIds: z.array(z.string()).min(1),
    repeat: z.union([z.literal(1), z.literal(3)]),
    maxCost: nonnegative,
  }),
  environment: z.object({
    gitCommit: z.string(),
    modelId: z.string(),
    image: z.string(),
    oasdiff: z.string(),
    node: z.string(),
    platform: z.string(),
    arch: z.string(),
    cpuCores: count,
    ramBytes: count,
    pricing: z.object({ input: nonnegative, output: nonnegative }),
    maxOutputTokens: count,
    /** `output_config.effort` sent on every model call; older artifacts did not record it. */
    effort: z.string().default('not recorded'),
  }),
  manifest: z.array(z.object({ id: z.string(), sha256: z.string(), repoCommit: z.string() })),
  admissions: z.array(
    z.object({
      id: z.string(),
      admissible: z.boolean(),
      reason: z.string().optional(),
      beforePassed: count,
      beforeTotal: count,
      afterPassed: count,
      afterTotal: count,
    }),
  ),
  trials: z.array(EvaluationTrialSchema),
  inFlight: z
    .object({ scenarioId: z.string(), baseline: z.enum(BASELINES), repeat: count })
    .nullable(),
  // A call reservation is persisted before a paid request. After a crash it remains charged
  // conservatively because the provider may have billed a response we never received.
  spentUsd: nonnegative,
  reservedUsd: nonnegative,
  /**
   * Every model call's stop reason, counted. `maxTokensStops` makes truncated answers
   * (`stop_reason: "max_tokens"`) visible on their own.
   */
  modelCalls: z
    .object({
      total: count,
      maxTokensStops: count,
      stopReasons: z.record(z.string(), count),
    })
    .default({ total: 0, maxTokensStops: 0, stopReasons: {} }),
});
/** A persisted study. */
export type EvaluationStudy = z.infer<typeof EvaluationStudySchema>;
/** One trial. */
export type EvaluationTrial = z.infer<typeof EvaluationTrialSchema>;
/** Detection identity used for predictions and hand labels. */
export type DetectionLabel = z.infer<typeof DetectionLabelSchema>;
