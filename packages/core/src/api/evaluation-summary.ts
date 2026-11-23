import { z } from 'zod';
import { BASELINES, CHANGE_CATEGORIES, GUARD_NAMES } from '../domain/enums.js';
const rate = z.number().min(0).max(1).nullable();
/** Server-computed Section 6.4 metrics; null means unavailable, never zero by assumption. */
export const EvaluationSummarySchema = z.object({
  baseline: z.enum(BASELINES),
  detectionPrecision: rate,
  detectionRecall: rate,
  repairRate: rate,
  repairRateByCategory: z.array(z.object({ category: z.enum(CHANGE_CATEGORIES), rate })),
  refusalCorrectness: rate,
  attemptsDistribution: z.array(
    z.object({ attempts: z.number().int().min(0).max(4), count: z.number().int().nonnegative() }),
  ),
  cheatRejections: z.array(
    z.object({ guard: z.enum(GUARD_NAMES), count: z.number().int().nonnegative() }),
  ),
  falseConfidence: rate,
  costPerRepairUsd: z.number().nonnegative().nullable(),
  timePerRepairMs: z.number().nonnegative().nullable(),
  modelTimePerRepairMs: z.number().nonnegative().nullable(),
  containerTimePerRepairMs: z.number().nonnegative().nullable(),
});
/** Typed summary payload produced by inc16 and presented unchanged by the dashboard. */
export type EvaluationSummary = z.infer<typeof EvaluationSummarySchema>;
