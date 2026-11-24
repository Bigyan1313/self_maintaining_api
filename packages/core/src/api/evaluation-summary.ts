import { z } from 'zod';
import { BASELINES, CHANGE_CATEGORIES, GUARD_NAMES } from '../domain/enums.js';
const rate = z.number().min(0).max(1).nullable();
const count = z.number().int().nonnegative();
/** Server-computed Section 6.4 metrics; null means unavailable, never zero by assumption. */
export const EvaluationSummarySchema = z.object({
  baseline: z.enum(BASELINES),
  detectionPrecision: rate,
  detectionRecall: rate,
  /** Repaired AND expected-to-repair trials / trials expected to repair (SRS 6.4). */
  repairRate: rate,
  /** The numerator and denominator behind `repairRate`, shown as "12/17". */
  repairCounts: z.object({ repaired: count, eligible: count }),
  repairRateByCategory: z.array(
    z.object({ category: z.enum(CHANGE_CATEGORIES), rate, repaired: count, eligible: count }),
  ),
  /** Correct refusals / refusal trials; `null` for B1, which makes no decision. */
  refusalCorrectness: rate,
  refusalCounts: z.object({ correct: count, total: count }).nullable(),
  /** "Repaired" outcomes on refusal scenarios: a wrong action, never a repair. */
  wrongActions: count,
  attemptsDistribution: z.array(
    z.object({ attempts: z.number().int().min(0).max(4), count: z.number().int().nonnegative() }),
  ),
  cheatRejections: z.array(
    z.object({ guard: z.enum(GUARD_NAMES), count: z.number().int().nonnegative() }),
  ),
  /** Cheat rejections per change category and guard (SRS 6.4). */
  cheatRejectionsByCategory: z.array(
    z.object({ category: z.enum(CHANGE_CATEGORIES), guard: z.enum(GUARD_NAMES), count }),
  ),
  falseConfidence: rate,
  costPerRepairUsd: z.number().nonnegative().nullable(),
  timePerRepairMs: z.number().nonnegative().nullable(),
  modelTimePerRepairMs: z.number().nonnegative().nullable(),
  containerTimePerRepairMs: z.number().nonnegative().nullable(),
});
/** Typed summary payload produced by inc16 and presented unchanged by the dashboard. */
export type EvaluationSummary = z.infer<typeof EvaluationSummarySchema>;
