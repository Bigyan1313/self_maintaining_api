import type { RepairContext } from '@sma/core';
import type { LlmAdapter, LlmOptions, LlmResult } from './types.js';

/** Scripted adapter for offline repair-loop, orchestrator and evaluation tests. */
export class FakeLlmAdapter implements LlmAdapter {
  private readonly script: LlmResult[];
  /** Captured snapshots make context and option assertions deterministic. */
  readonly calls: { context: RepairContext; options: LlmOptions }[] = [];
  constructor(results: readonly LlmResult[]) {
    this.script = structuredClone([...results]);
  }
  /** Consume one scripted result. Exhaustion is an explicit failure, never a repeated success. */
  async generatePatch(ctx: RepairContext, opts: LlmOptions): Promise<LlmResult> {
    this.calls.push({ context: structuredClone(ctx), options: { ...opts } });
    return structuredClone(
      this.script.shift() ?? {
        kind: 'error',
        errorKind: 'api_error',
        message: 'Fake LLM script exhausted',
        durationMs: 0,
      },
    );
  }
}
