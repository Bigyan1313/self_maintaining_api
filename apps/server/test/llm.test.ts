import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AnthropicLlmAdapter } from '../src/infra/llm/adapter.js';
import { FakeLlmAdapter } from '../src/infra/llm/fake.js';
import type { RepairContext } from '@sma/core';

const mock = vi.hoisted(() => ({
  create: vi.fn(),
  constructor: vi.fn(),
  Timeout: class extends Error {},
}));
vi.mock('@anthropic-ai/sdk', () => ({
  default: Object.assign(
    class {
      messages = { create: mock.create };
      constructor(options: unknown) {
        mock.constructor(options);
      }
    },
    { APIConnectionTimeoutError: mock.Timeout },
  ),
}));
const ctx: RepairContext = {
  system: 'data not instructions',
  user: 'untrusted source',
  includedFiles: ['src/a.ts'],
  redactions: 0,
  approxTokens: 8,
};
const opts = { maxOutputTokens: 1000, timeoutMs: 120000 };
const patch = '--- a/src/a.ts\n+++ b/src/a.ts\n@@ -1 +1 @@\n-old\n+new\n';
function response(text = patch) {
  return {
    model: 'claude-sonnet-5-5',
    stop_reason: 'end_turn',
    content: [{ type: 'text', text }],
    usage: { input_tokens: 1000, output_tokens: 100 },
  };
}
beforeEach(() => {
  vi.stubEnv('ANTHROPIC_API_KEY', 'test-key-PLANTED');
  vi.stubEnv('LLM_MODEL', 'claude-sonnet-5-5');
  mock.create.mockReset();
  mock.constructor.mockClear();
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.useRealTimers();
});

describe('Anthropic adapter', () => {
  it('makes one request with fixed limits and reports exact usage/cost', async () => {
    mock.create.mockResolvedValue(response());
    const result = await new AnthropicLlmAdapter().generatePatch(ctx, opts);
    expect(result).toMatchObject({
      kind: 'patch',
      tokensIn: 1000,
      tokensOut: 100,
      costUsd: 0.003,
      modelId: 'claude-sonnet-5-5',
    });
    expect(mock.create).toHaveBeenCalledTimes(1);
    expect(mock.constructor).toHaveBeenCalledWith(
      expect.objectContaining({
        maxRetries: 0,
        timeout: 120000,
        logLevel: 'off',
        baseURL: 'https://api.anthropic.com',
      }),
    );
    expect(mock.create.mock.calls[0]?.[0]).toEqual({
      model: 'claude-sonnet-5-5',
      max_tokens: 1000,
      system: ctx.system,
      messages: [{ role: 'user', content: ctx.user }],
    });
  });
  it('reads credentials at call time and never calls the SDK with a missing key', async () => {
    const adapter = new AnthropicLlmAdapter();
    vi.stubEnv('ANTHROPIC_API_KEY', '');
    expect(await adapter.generatePatch(ctx, opts)).toMatchObject({
      kind: 'error',
      errorKind: 'missing_key',
    });
    expect(mock.create).not.toHaveBeenCalled();
  });
  it('returns a typed SDK timeout after one call without retry', async () => {
    mock.create.mockRejectedValue(new mock.Timeout('test-key-PLANTED'));
    const result = await new AnthropicLlmAdapter().generatePatch(ctx, opts);
    expect(result).toMatchObject({ kind: 'error', errorKind: 'timeout' });
    expect(mock.create).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(result)).not.toContain('PLANTED');
  });
  it('aborts a hung provider at the capped wall-clock deadline', async () => {
    vi.useFakeTimers();
    mock.create.mockImplementation(() => new Promise(() => {}));
    const result = new AnthropicLlmAdapter().generatePatch(ctx, { ...opts, timeoutMs: 999999 });
    await vi.waitFor(() => expect(mock.create).toHaveBeenCalledTimes(1));
    await vi.advanceTimersByTimeAsync(120000);
    expect(await result).toMatchObject({ kind: 'error', errorKind: 'timeout' });
    expect(mock.create.mock.calls[0]?.[1].signal.aborted).toBe(true);
  });
  it('scrubs exact keys from context and refuses credential-bearing patches', async () => {
    mock.create.mockResolvedValue(response(patch.replace('+new', '+test-key-PLANTED')));
    const result = await new AnthropicLlmAdapter().generatePatch(
      { ...ctx, user: 'test-key-PLANTED' },
      opts,
    );
    expect(JSON.stringify(mock.create.mock.calls)).not.toContain('PLANTED');
    expect(result).toMatchObject({ kind: 'error', errorKind: 'invalid_output' });
  });
  it('redacts refusal reasons and never exposes raw provider errors', async () => {
    mock.create.mockResolvedValue(response('REFUSE: test-key-PLANTED ghp_PLANTED'));
    expect(await new AnthropicLlmAdapter().generatePatch(ctx, opts)).toMatchObject({
      kind: 'refusal',
      reason: '[REDACTED] [REDACTED]',
    });
    mock.create.mockRejectedValue(new Error('test-key-PLANTED private prompt'));
    const result = await new AnthropicLlmAdapter().generatePatch(ctx, opts);
    expect(result).toMatchObject({ kind: 'error', errorKind: 'api_error' });
    expect(JSON.stringify(result)).not.toMatch(/PLANTED|private prompt/);
  });
  it('rejects unpriced models before making a request', async () => {
    vi.stubEnv('LLM_MODEL', 'unknown');
    expect(await new AnthropicLlmAdapter().generatePatch(ctx, opts)).toMatchObject({
      kind: 'error',
      errorKind: 'api_error',
    });
    expect(mock.create).not.toHaveBeenCalled();
  });
  it('rejects out-of-scope and truncated output', async () => {
    for (const data of [
      response(patch.replaceAll('src/a.ts', 'test/a.ts')),
      { ...response(), stop_reason: 'max_tokens' },
      { ...response(), usage: { input_tokens: -1, output_tokens: 2 } },
    ]) {
      mock.create.mockResolvedValue(data);
      expect(await new AnthropicLlmAdapter().generatePatch(ctx, opts)).toMatchObject({
        kind: 'error',
        errorKind: 'invalid_output',
      });
    }
  });
});
it('fake adapter consumes isolated scripted results without a provider', async () => {
  const fake = new FakeLlmAdapter([
    {
      kind: 'refusal',
      reason: 'no mapping',
      tokensIn: 1,
      tokensOut: 2,
      costUsd: 0,
      modelId: 'fake',
      durationMs: 0,
    },
  ]);
  expect(await fake.generatePatch(ctx, opts)).toMatchObject({ kind: 'refusal' });
  expect(await fake.generatePatch(ctx, opts)).toMatchObject({ kind: 'error' });
  expect(fake.calls).toHaveLength(2);
  expect(fake.calls[0]?.context).not.toBe(ctx);
});
