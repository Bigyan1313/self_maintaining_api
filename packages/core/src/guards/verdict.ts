import type { AttemptOutcome, GuardName } from '../domain/enums.js';

/** Static guards, in the order they run, before any code runs (FR-27, FR-30, FR-29). */
export const STATIC_GUARD_ORDER = [
  'test_file_changed',
  'config_changed',
  'type_suppression',
] as const;

/** Every guard in its fixed order. The count guard (FR-28) runs after validation. */
export const GUARD_ORDER: readonly GuardName[] = [...STATIC_GUARD_ORDER, 'test_count_changed'];

/** Everything one guard found. */
export interface GuardHit {
  guard: GuardName;
  /** One line per hit, for example `src/a.ts:12: unchecked "any" type: let x: any`. */
  evidence: string[];
}

/**
 * A guard verdict. On rejection, `guard` is the **first** failing guard in
 * {@link GUARD_ORDER}: that one name is recorded (DR-04). `evidence` lists every hit of
 * every failing guard, each prefixed with its guard name, and `hits` keeps them per guard.
 */
export type GuardVerdict =
  { ok: true } | { ok: false; guard: GuardName; evidence: string[]; hits: GuardHit[] };

/**
 * Builds a verdict from per-guard findings. Guards with no evidence are ignored.
 * @param hits - Findings of the guards that ran, in any order.
 */
export function verdictFromHits(hits: readonly GuardHit[]): GuardVerdict {
  const failing = GUARD_ORDER.map((g) => hits.find((h) => h.guard === g)).filter(
    (h): h is GuardHit => h !== undefined && h.evidence.length > 0,
  );
  const first = failing[0];
  if (!first) return { ok: true };
  return {
    ok: false,
    guard: first.guard,
    evidence: failing.flatMap((h) => h.evidence.map((e) => `[${h.guard}] ${e}`)),
    hits: failing.map((h) => ({ guard: h.guard, evidence: [...h.evidence] })),
  };
}

/**
 * Whether an attempt outcome ends the run immediately, with no further attempts (FR-31).
 * Only a cheating verdict does. Other failures may be retried (FR-21).
 * @param outcome - Outcome of one attempt.
 */
export function cheatingEndsRun(outcome: AttemptOutcome): boolean {
  return outcome === 'cheating';
}

/** Shortens a source line for evidence: trimmed, at most 120 characters. */
export function excerpt(text: string): string {
  const t = text.trim();
  return t.length > 120 ? `${t.slice(0, 117)}...` : t;
}
