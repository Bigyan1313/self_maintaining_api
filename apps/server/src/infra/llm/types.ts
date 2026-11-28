import type { RepairContext } from '@sma/core';

/** Provider-independent request limits; timeout is capped at 120 seconds. */
export interface LlmOptions {
  maxOutputTokens: number;
  timeoutMs: number;
}
/** Recorded usage from a completed provider response. */
export interface LlmUsage {
  tokensIn: number;
  tokensOut: number;
  costUsd: number;
  modelId: string;
  durationMs: number;
  /** Provider `stop_reason` (for example `end_turn`, `max_tokens`); absent for fakes. */
  stopReason?: string;
}
/** One attempt returns a patch, explicit refusal, or a safe typed failure. */
export type LlmResult =
  | ({ kind: 'patch'; patch: string } & LlmUsage)
  | ({ kind: 'refusal'; reason: string } & LlmUsage)
  | {
      kind: 'error';
      errorKind: 'timeout' | 'api_error' | 'invalid_output' | 'missing_key';
      message: string;
      durationMs: number;
      /**
       * Billed usage when the provider did answer but the answer was unusable
       * (`invalid_output`), so the repair loop can record it and count it against the
       * token ceiling (FR-23, FR-24). Absent when no response was received.
       */
      usage?: Omit<LlmUsage, 'durationMs'>;
      /** Provider `stop_reason` when a response arrived (for example `max_tokens`). */
      stopReason?: string;
    };
/** All repair orchestration depends on this interface, never on a provider SDK. */
export interface LlmAdapter {
  generatePatch(ctx: RepairContext, opts: LlmOptions): Promise<LlmResult>;
}
