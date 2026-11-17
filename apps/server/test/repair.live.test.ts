/**
 * LIVE repair (AT-06): the real model repairs the demo `field_renamed` change end to end, on the
 * rename-only consumer, with the real Docker validator. Skipped unless ANTHROPIC_API_KEY (and
 * LLM_MODEL) are set and Docker is running. It costs real money: a few cents at most, since the
 * token ceiling is 60,000 tokens.
 */
import { rm } from 'node:fs/promises';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { loadRootEnv } from '../src/infra/db/env.js';
import { listAttempts } from '../src/infra/db/index.js';
import { AnthropicLlmAdapter } from '../src/infra/llm/adapter.js';
import { dockerServerVersion } from '../src/infra/validator/docker.js';
import { repair } from '../src/pipeline/repair.js';
import { openTestDb, seedChain } from './db-helpers.js';
import {
  renameChange,
  renameLocate,
  renameMapping,
  renameOnlyConsumer,
  snapshot,
} from './repair-helpers.js';

loadRootEnv();
const live =
  Boolean(process.env.ANTHROPIC_API_KEY?.trim() && process.env.LLM_MODEL?.trim()) &&
  (await dockerServerVersion()) !== null;
if (!live)
  console.warn('[repair] SKIPPING live model test: needs ANTHROPIC_API_KEY, LLM_MODEL and Docker.');

describe.skipIf(!live)('live repair of the demo field rename', () => {
  let client: ReturnType<typeof openTestDb>;
  let repo: string;
  beforeAll(async () => {
    client = openTestDb();
    repo = await renameOnlyConsumer();
  });
  afterAll(async () => {
    await client?.close();
    if (repo) await rm(repo, { recursive: true, force: true });
  });

  it(
    'repairs end to end and records attempts, tokens, cost and time',
    { timeout: 1_800_000 },
    async () => {
      const before = await snapshot(repo);
      const chain = await seedChain(client);
      const started = performance.now();
      const out = await repair({
        db: client.db,
        runId: chain.run.id,
        change: renameChange(),
        specSectionBefore: { customer_name: { type: 'string' } },
        specSectionAfter: { full_name: { type: 'string' } },
        migrationNoteEntry: renameMapping,
        locateResult: renameLocate,
        repo: { path: repo },
        env: { API_VERSION: 'v2' },
        adapter: new AnthropicLlmAdapter(),
        tokenCeiling: 60_000,
        mode: 'full',
      });
      const rows = await listAttempts(client.db, chain.run.id);
      // The AT-06 numbers for the increment report.
      console.info(
        `[repair live] status=${out.status} attempts=${out.attempts} tokensIn=${out.tokensIn} ` +
          `tokensOut=${out.tokensOut} costUsd=${out.costUsd.toFixed(6)} ` +
          `wallMs=${Math.round(performance.now() - started)} ` +
          `perAttempt=${JSON.stringify(rows.map((r) => [r.outcome, r.tokensIn, r.tokensOut, r.costUsd, r.durationMs]))}`,
      );
      expect(out.status).toBe('repaired');
      expect(out.finalResult).toMatchObject({ testsPassed: 12, testsTotal: 12 });
      expect(rows.every((r) => r.tokensIn > 0 && r.modelId === process.env.LLM_MODEL)).toBe(true);
      expect(await snapshot(repo)).toBe(before);
    },
  );
});
