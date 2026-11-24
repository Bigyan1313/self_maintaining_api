/**
 * Proves the append-only triggers (FR-39) reject UPDATE / DELETE / TRUNCATE at the database level.
 * Uses raw SQL through the pool so no application code is involved.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createDbClient, type DbClient } from '../src/infra/db/client.js';
import { loadRootEnv } from '../src/infra/db/env.js';
import { resetTestDatabase, testDatabaseUrl } from '../src/infra/db/test-db.js';
import {
  confirmMapping,
  finishRun,
  getRunById,
  insertAttempt,
  insertCallSites,
  insertCoverageEntries,
  insertStageResult,
  updateRunProgress,
} from '../src/infra/db/index.js';
import { attemptValues, expectDbRejects, PG, seedChain, type Chain } from './db-helpers.js';

let client: DbClient;
let chain: Chain;
const appendOnly = { code: PG.raiseException, message: /^append-only:/ };

beforeAll(async () => {
  // TRUNCATE CASCADE takes exclusive locks on the shared table graph. Keep these
  // trigger checks isolated from concurrently inserting pipeline tests.
  loadRootEnv();
  const url = new URL(testDatabaseUrl());
  url.pathname = '/sma_append_only_test';
  await resetTestDatabase(url.toString());
  client = createDbClient(url.toString());
  chain = await seedChain(client);
  await insertAttempt(client.db, attemptValues(chain.run.id, 1));
  await insertStageResult(client.db, {
    runId: chain.run.id,
    stage: 'ingest',
    status: 'ok',
    result: {},
    startedAt: new Date(),
    finishedAt: new Date(),
  });
  await insertCallSites(client.db, [
    {
      runId: chain.run.id,
      filePath: 'src/customers.ts',
      line: 3,
      column: 9,
      pattern: 'fetch',
      excerpt: 'fetch(...)',
    },
  ]);
  await insertCoverageEntries(client.db, [
    { runId: chain.run.id, filePath: 'src/customers.ts', inspected: true },
  ]);
});
afterAll(async () => {
  await client.close();
});

const sql = (text: string, values: unknown[] = []) => client.pool.query(text, values);

describe('fully append-only tables reject UPDATE and DELETE', () => {
  it('rejects UPDATE on an attempt', async () => {
    await expectDbRejects(
      sql(`UPDATE attempts SET outcome = 'pass' WHERE run_id = $1`, [chain.run.id]),
      appendOnly,
    );
  });

  it('rejects DELETE on an attempt', async () => {
    await expectDbRejects(
      sql(`DELETE FROM attempts WHERE run_id = $1`, [chain.run.id]),
      appendOnly,
    );
  });

  it.each([
    ['run_stage_results', `UPDATE run_stage_results SET status = 'failed' WHERE run_id = $1`],
    ['run_stage_results', `DELETE FROM run_stage_results WHERE run_id = $1`],
    ['call_sites', `UPDATE call_sites SET line = 99 WHERE run_id = $1`],
    ['call_sites', `DELETE FROM call_sites WHERE run_id = $1`],
    [
      'coverage_entries',
      `UPDATE coverage_entries SET inspected = false, skip_reason = 'x' WHERE run_id = $1`,
    ],
    ['coverage_entries', `DELETE FROM coverage_entries WHERE run_id = $1`],
  ])('%s: %s', async (_table, statement) => {
    await expectDbRejects(sql(statement, [chain.run.id]), appendOnly);
  });

  it.each([
    `UPDATE spec_versions SET source_identifier = 'changed' WHERE id = $1`,
    `DELETE FROM spec_versions WHERE id = $1`,
  ])('spec_versions: %s', async (statement) => {
    await expectDbRejects(sql(statement, [chain.v1.id]), appendOnly);
  });

  it.each([
    'attempts',
    'run_stage_results',
    'call_sites',
    'coverage_entries',
    'spec_versions',
    'runs',
    'changes',
  ])('rejects TRUNCATE on %s', async (table) => {
    await expectDbRejects(sql(`TRUNCATE ${table} CASCADE`), appendOnly);
  });

  it('the protected rows are still there', async () => {
    const { rows } = await sql(`SELECT count(*)::int AS n FROM attempts WHERE run_id = $1`, [
      chain.run.id,
    ]);
    expect(rows[0]).toEqual({ n: 1 });
  });
});

describe('runs: DELETE never; UPDATE only until finished', () => {
  it('rejects DELETE on a running run', async () => {
    const { run } = await seedChain(client);
    await expectDbRejects(sql(`DELETE FROM runs WHERE id = $1`, [run.id]), appendOnly);
  });

  it('allows progress updates while running, then freezes the run once finished', async () => {
    const { run } = await seedChain(client);
    const progressed = await updateRunProgress(client.db, run.id, {
      stageReached: 'repair',
      attemptCount: 2,
    });
    expect(progressed.attemptCount).toBe(2);

    const finished = await finishRun(client.db, run.id, { status: 'failed', attemptCount: 4 });
    expect(finished.finishedAt).toBeInstanceOf(Date);

    await expectDbRejects(
      sql(`UPDATE runs SET status = 'repaired' WHERE id = $1`, [run.id]),
      appendOnly,
    );
    await expectDbRejects(updateRunProgress(client.db, run.id, { prUrl: 'https://x' }), appendOnly);
    await expectDbRejects(sql(`DELETE FROM runs WHERE id = $1`, [run.id]), appendOnly);

    expect((await getRunById(client.db, run.id))?.status).toBe('failed');
  });
});

describe('changes: DELETE never; UPDATE only of mapping confirmation columns', () => {
  it('rejects DELETE on a change', async () => {
    await expectDbRejects(sql(`DELETE FROM changes WHERE id = $1`, [chain.change.id]), appendOnly);
  });

  it.each([
    `UPDATE changes SET classification = 'safe' WHERE id = $1`,
    `UPDATE changes SET confidence = 0.1 WHERE id = $1`,
    `UPDATE changes SET evidence_after = '{}'::jsonb WHERE id = $1`,
    `UPDATE changes SET mapping_status = 'confirmed', mapping_source = 'migration_note', path = '/x' WHERE id = $1`,
  ])('rejects: %s', async (statement) => {
    await expectDbRejects(sql(statement, [chain.change.id]), appendOnly);
  });

  it('allows a human to confirm the mapping', async () => {
    const { change } = await seedChain(client);
    const confirmedAt = new Date();
    const updated = await confirmMapping(client.db, change.id, {
      mappingSource: 'human',
      mapping: { old: 'customer_name', new: 'full_name' },
      confirmedBy: 'reviewer@example.com',
      confirmedAt,
    });
    expect(updated.mappingStatus).toBe('confirmed');
    expect(updated.mappingSource).toBe('human');
    expect(updated.confirmedBy).toBe('reviewer@example.com');
    expect(updated.classification).toBe(change.classification);
  });
});
