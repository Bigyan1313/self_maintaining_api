import Anthropic from '@anthropic-ai/sdk';
import { readFile } from 'node:fs/promises';
import {
  isRepairSourcePath,
  parseRepairOutput,
  redactRepairSecrets,
  type RepairContext,
} from '@sma/core';
import type { LlmAdapter, LlmOptions, LlmResult } from './types.js';
export type { LlmAdapter, LlmOptions, LlmResult, LlmUsage } from './types.js';

/** Hard per-attempt deadline (NFR-06). */
export const MAX_LLM_TIMEOUT_MS = 120_000;
/**
 * `output_config.effort` sent on every request. Sent explicitly so a provider default change
 * cannot silently change the evaluation. No sampling parameters or `thinking` are sent: on
 * claude-sonnet-5-5, non-default `temperature`/`top_p`/`top_k` and `thinking: disabled` are 400s.
 */
export const LLM_EFFORT = 'high' as const;
/** Content blocks an answer may contain; only `text` blocks are read. */
const ANSWER_BLOCK_TYPES = new Set(['text', 'thinking', 'redacted_thinking']);
interface Price {
  inputUsdPerMillionTokens: number;
  outputUsdPerMillionTokens: number;
}
async function pricing(model: string): Promise<Price> {
  const parsed = JSON.parse(
    await readFile(new URL('../../../../../config/llm-pricing.json', import.meta.url), 'utf8'),
  ) as { models: Record<string, Price> };
  const price = Object.hasOwn(parsed.models, model) ? parsed.models[model] : undefined;
  if (
    !price ||
    !Number.isFinite(price.inputUsdPerMillionTokens) ||
    !Number.isFinite(price.outputUsdPerMillionTokens) ||
    price.inputUsdPerMillionTokens < 0 ||
    price.outputUsdPerMillionTokens < 0
  )
    throw new Error('Unpriced model');
  return price;
}

/** Anthropic transport; the only module allowed to import or call the provider SDK. */
export class AnthropicLlmAdapter implements LlmAdapter {
  /** Make one request, without retries, tools, caching, or provider debug logging. */
  async generatePatch(ctx: RepairContext, opts: LlmOptions): Promise<LlmResult> {
    const started = performance.now();
    const duration = () => Math.round(performance.now() - started);
    const error = (
      errorKind: Extract<LlmResult, { kind: 'error' }>['errorKind'],
      message: string,
    ): LlmResult => ({ kind: 'error', errorKind, message, durationMs: duration() });
    const key = process.env.ANTHROPIC_API_KEY?.trim();
    if (!key) return error('missing_key', 'ANTHROPIC_API_KEY is not configured');
    const modelId = process.env.LLM_MODEL?.trim();
    if (!modelId) return error('api_error', 'Configure an exact LLM_MODEL with a pricing entry');
    if (
      !Number.isSafeInteger(opts.maxOutputTokens) ||
      opts.maxOutputTokens < 1 ||
      !Number.isFinite(opts.timeoutMs) ||
      opts.timeoutMs <= 0
    )
      return error('api_error', 'Invalid model request limits');
    if (!ctx.includedFiles.length || ctx.includedFiles.some((p) => !isRepairSourcePath(p)))
      return error('invalid_output', 'Context must list eligible source files');
    const timeout = Math.min(opts.timeoutMs, MAX_LLM_TIMEOUT_MS);
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const scrub = (text: string) => redactRepairSecrets(text.split(key).join('[REDACTED]')).text;
    try {
      const price = await pricing(modelId);
      const sdk = new Anthropic({
        apiKey: key,
        baseURL: 'https://api.anthropic.com',
        maxRetries: 0,
        timeout,
        logLevel: 'off',
      });
      const deadline = new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => {
          controller.abort();
          reject(new Error('deadline'));
        }, timeout);
      });
      const response = await Promise.race([
        sdk.messages.create(
          {
            model: modelId,
            max_tokens: opts.maxOutputTokens,
            output_config: { effort: LLM_EFFORT },
            system: scrub(ctx.system),
            messages: [{ role: 'user', content: scrub(ctx.user) }],
          },
          { signal: controller.signal, timeout, maxRetries: 0 },
        ),
        deadline,
      ]);
      const tokensIn = response.usage.input_tokens;
      const tokensOut = response.usage.output_tokens;
      if (
        ![tokensIn, tokensOut].every((n) => Number.isSafeInteger(n) && n >= 0) ||
        response.usage.cache_creation_input_tokens ||
        response.usage.cache_read_input_tokens
      )
        return error('invalid_output', 'Provider returned unsupported usage accounting');
      if (response.model !== modelId)
        return error('invalid_output', 'Provider returned an incomplete or unsupported response');
      // Usage is known from here on, so every unusable answer still reports what it cost.
      const billed = {
        tokensIn,
        tokensOut,
        costUsd:
          (tokensIn * price.inputUsdPerMillionTokens +
            tokensOut * price.outputUsdPerMillionTokens) /
          1_000_000,
        modelId,
      };
      const stopReason = String(response.stop_reason ?? 'none');
      const unusable = (message: string): LlmResult => {
        const failure = error('invalid_output', message);
        return failure.kind === 'error' ? { ...failure, usage: billed, stopReason } : failure;
      };
      if (stopReason === 'max_tokens')
        return unusable(
          `Answer truncated at max_tokens (${opts.maxOutputTokens} output tokens); not a usable patch`,
        );
      // Adaptive thinking is on by default on current models, so an answer can carry thinking
      // blocks (empty text unless display is requested). They are not the answer: skip them and
      // read only the text. Any other block type (tool use, server tools) is still unsupported.
      if (
        stopReason !== 'end_turn' ||
        response.content.some((block) => !ANSWER_BLOCK_TYPES.has(block.type))
      )
        return unusable('Provider returned an incomplete or unsupported response');
      const text = response.content
        .map((block) => (block.type === 'text' ? block.text : ''))
        .join('\n');
      // Refusals may be redacted; a patch containing secrets is refused rather than silently altered.
      const parsed = parseRepairOutput(text, ctx.includedFiles);
      if (parsed.kind === 'invalid_output') return unusable(parsed.message);
      if (parsed.kind === 'patch' && scrub(parsed.patch) !== parsed.patch)
        return unusable('Provider patch contains credential-like text');
      const usage = { ...billed, durationMs: duration(), stopReason };
      return parsed.kind === 'patch'
        ? { ...parsed, ...usage }
        : { ...parsed, reason: scrub(parsed.reason), ...usage };
    } catch (cause) {
      if (controller.signal.aborted || cause instanceof Anthropic.APIConnectionTimeoutError)
        return error('timeout', 'Model request exceeded its deadline; no automatic retry was made');
      // Do not expose provider exceptions: they can contain prompts, keys or arbitrary server data.
      return error(
        'api_error',
        'Model request failed; verify provider configuration and availability',
      );
    } finally {
      if (timer) clearTimeout(timer);
    }
  }
}
