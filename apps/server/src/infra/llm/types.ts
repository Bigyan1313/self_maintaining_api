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
    };
/** All repair orchestration depends on this interface, never on a provider SDK. */
export interface LlmAdapter {
  generatePatch(ctx: RepairContext, opts: LlmOptions): Promise<LlmResult>;
}
