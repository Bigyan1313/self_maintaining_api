import type { LlmAdapter, LlmOptions, LlmResult } from '../apps/server/src/infra/llm/types.js';
import type { EvaluationStudy, RepairContext } from '@sma/core';
/** Conservative input ceiling: UTF-8 bytes plus protocol allowance, not approximate tokens. */
export function maximumCallCost(
  ctx: RepairContext,
  opts: LlmOptions,
  pricing: { input: number; output: number },
): number {
  return (
    ((Buffer.byteLength(ctx.system + ctx.user, 'utf8') + 8192) * pricing.input +
      opts.maxOutputTokens * pricing.output) /
    1_000_000
  );
}
/**
 * The stop reason to record for one model call: the provider's, `no_response` when nothing
 * arrived (timeout, network), or `not_reported` (scripted fakes).
 */
export function stopReasonOf(response: LlmResult): string {
  if (response.stopReason) return response.stopReason;
  if (response.kind === 'error' && !response.usage) return 'no_response';
  return 'not_reported';
}
/** Persist a reservation before calling the provider; crashes cannot reset the spending limit. */
export class BudgetAdapter implements LlmAdapter {
  modelMs = 0;
  calls = 0;
  stopped: string | null = null;
  constructor(
    private inner: LlmAdapter,
    private study: EvaluationStudy,
    private save: () => Promise<void>,
    private interrupted: () => boolean,
    private recordResponse: (response: LlmResult) => void = () => {},
  ) {}
  /** Checkpoint budget authorization, delegate one call, then persist known usage. */
  async generatePatch(ctx: RepairContext, opts: LlmOptions): Promise<LlmResult> {
    const reserve = this.study.fake
      ? 0
      : maximumCallCost(ctx, opts, this.study.environment.pricing);
    if (
      this.interrupted() ||
      this.study.spentUsd + this.study.reservedUsd + reserve > this.study.config.maxCost
    ) {
      this.stopped = this.interrupted()
        ? 'Interrupted by signal'
        : 'Cost limit reached before the next model call';
      return { kind: 'error', errorKind: 'api_error', message: this.stopped, durationMs: 0 };
    }
    this.study.reservedUsd += reserve;
    await this.save();
    this.calls++;
    const response = await this.inner.generatePatch(ctx, opts);
    this.modelMs += response.durationMs;
    const usage = response.kind === 'error' ? response.usage : response;
    // No response means billing is uncertain. Keep the reservation for resume.
    if (usage || (response.kind === 'error' && response.errorKind === 'missing_key')) {
      this.study.reservedUsd = Math.max(0, this.study.reservedUsd - reserve);
      this.study.spentUsd += usage?.costUsd ?? 0;
    }
    const reason = stopReasonOf(response);
    const calls = this.study.modelCalls;
    calls.total++;
    calls.stopReasons[reason] = (calls.stopReasons[reason] ?? 0) + 1;
    if (reason === 'max_tokens') calls.maxTokensStops++;
    this.recordResponse(response);
    await this.save();
    return response;
  }
}
