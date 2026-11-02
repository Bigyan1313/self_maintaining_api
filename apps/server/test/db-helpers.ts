import { createHash, randomUUID } from 'node:crypto';
import { expect } from 'vitest';
import { createDbClient, type DbClient } from '../src/infra/db/client.js';
import { loadRootEnv } from '../src/infra/db/env.js';
import { testDatabaseUrl } from '../src/infra/db/test-db.js';
import {
  insertApi,
  insertChange,
  insertRepository,
  insertRun,
  insertSpecVersion,
} from '../src/infra/db/index.js';
import type { Api, Change, Repository, Run, SpecVersion } from '../src/infra/db/types.js';

/** Opens a client on the `sma_test` database. */
export function openTestDb(): DbClient {
  loadRootEnv();
  return createDbClient(testDatabaseUrl());
}

/** Lowercase hex SHA-256 of a random value (unique per call). */
export function randomSha256(): string {
  return createHash('sha256').update(randomUUID()).digest('hex');
}

/** A random 40-char git commit SHA. */
export function randomCommitSha(): string {
  return createHash('sha1').update(randomUUID()).digest('hex');
}

/** Unique suffix so tests never collide (the append-only tables cannot be cleaned up). */
export const uid = (): string => randomUUID().slice(0, 8);

/** Postgres error details, unwrapped from Drizzle's wrapper error. */
interface PgErrorLike {
  code?: string;
  constraint?: string;
  message?: string;
  cause?: unknown;
}

function findPgError(error: unknown): PgErrorLike | undefined {
  let current: unknown = error;
  for (let depth = 0; depth < 5 && current; depth++) {
    const e = current as PgErrorLike;
    if (typeof e.code === 'string') return e;
    current = e.cause;
  }
  return undefined;
}

/** SQLSTATE codes asserted by the tests. */
export const PG = {
  checkViolation: '23514',
  uniqueViolation: '23505',
  raiseException: 'P0001',
} as const;

/**
 * Asserts that a query is rejected by the database with a given SQLSTATE (and, optionally, a
 * specific constraint name or message fragment).
 */
export async function expectDbRejects(
  promise: Promise<unknown>,
  expected: { code: string; constraint?: string; message?: RegExp },
): Promise<void> {
  let caught: unknown;
  try {
    await promise;
  } catch (error) {
    caught = error;
  }
  expect(caught, 'expected the database to reject the query').toBeDefined();
  const pgError = findPgError(caught);
  expect(pgError?.code, String((caught as Error | undefined)?.message)).toBe(expected.code);
  if (expected.constraint) expect(pgError?.constraint).toBe(expected.constraint);
  if (expected.message) expect(pgError?.message).toMatch(expected.message);
}

/** Records created by {@link seedChain}. */
export interface Chain {
  repository: Repository;
  api: Api;
  v1: SpecVersion;
  v2: SpecVersion;
  change: Change;
  run: Run;
}

/** Inserts repository → api → 2 spec versions → change → running run, all unique. */
export async function seedChain(client: DbClient): Promise<Chain> {
  const { db } = client;
  const s = uid();
  const repository = await insertRepository(db, {
    owner: 'acme',
    name: `consumer-${s}`,
    defaultBranch: 'main',
    credentialRef: 'GITHUB_TOKEN',
    localPath: `/tmp/consumer-${s}`,
  });
  const api = await insertApi(db, { name: `demo-shop-${s}`, pollIntervalSeconds: 300 });
  const v1 = await insertSpecVersion(db, {
    apiId: api.id,
    sourceMode: 'fixture',
    sourceIdentifier: 'demo/api/specs/v1.yaml',
    contentSha256: randomSha256(),
    normalized: { openapi: '3.1.0', info: { version: '1.0.0' } },
  });
  const v2 = await insertSpecVersion(db, {
    apiId: api.id,
    sourceMode: 'fixture',
    sourceIdentifier: 'demo/api/specs/v2.yaml',
    contentSha256: randomSha256(),
    normalized: { openapi: '3.1.0', info: { version: '2.0.0' } },
  });
  const change = await insertChange(db, {
    apiId: api.id,
    fromVersionId: v1.id,
    toVersionId: v2.id,
    category: 'field_renamed',
    oasdiffRuleId: 'response-required-property-removed',
    classification: 'breaking',
    confidence: 0.9,
    path: '/customers/{id}',
    method: 'GET',
    jsonPointer: '/paths/~1customers~1{id}/get/responses/200',
    evidenceBefore: { customer_name: { type: 'string' } },
    evidenceAfter: { full_name: { type: 'string' } },
  });
  const run = await insertRun(db, {
    changeId: change.id,
    repositoryId: repository.id,
    commitSha: randomCommitSha(),
    stageReached: 'locate',
    isFixture: true,
  });
  return { repository, api, v1, v2, change, run };
}

/** Minimal valid attempt values for a run. */
export function attemptValues(runId: string, attemptNumber: number) {
  return {
    runId,
    attemptNumber,
    patch: '--- a/src/customers.ts\n+++ b/src/customers.ts\n',
    validationOutput: 'ok',
    compileErrors: 0,
    testsPassed: 12,
    testsTotal: 12,
    outcome: 'fail' as const,
    tokensIn: 1000,
    tokensOut: 200,
    costUsd: '0.004200',
    modelId: 'test-model',
    durationMs: 1234,
  };
}
