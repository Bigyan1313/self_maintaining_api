/**
 * Proves the DATABASE (CHECK / UNIQUE constraints) rejects invalid data — not app code.
 * Runs against `sma_test` only.
 */
import { afterAll, beforeAll, describe, it } from 'vitest';
import {
  insertApi,
  insertAttempt,
  insertCallSites,
  insertChange,
  insertCoverageEntries,
  insertEvaluationResult,
  insertRepository,
  insertRun,
  insertSpecCheck,
  insertSpecVersion,
  insertStageResult,
} from '../src/infra/db/index.js';
import type { DbClient } from '../src/infra/db/client.js';
import {
  attemptValues,
  expectDbRejects,
  openTestDb,
  PG,
  randomCommitSha,
  randomSha256,
  seedChain,
  uid,
  type Chain,
} from './db-helpers.js';

let client: DbClient;
let chain: Chain;

beforeAll(async () => {
  client = openTestDb();
  chain = await seedChain(client);
});
afterAll(async () => {
  await client.close();
});

const check = (constraint: string) => ({ code: PG.checkViolation, constraint });
const unique = (constraint: string) => ({ code: PG.uniqueViolation, constraint });

describe('attempts (DR-03, DR-04)', () => {
  it('rejects a 5th attempt (attempt_number = 5)', async () => {
    await expectDbRejects(
      insertAttempt(client.db, attemptValues(chain.run.id, 5)),
      check('attempts_number_1_4'),
    );
  });

  it('rejects attempt_number = 0', async () => {
    await expectDbRejects(
      insertAttempt(client.db, attemptValues(chain.run.id, 0)),
      check('attempts_number_1_4'),
    );
  });

  it('rejects a duplicate attempt_number for the same run', async () => {
    const { run } = await seedChain(client);
    await insertAttempt(client.db, attemptValues(run.id, 1));
    await expectDbRejects(
      insertAttempt(client.db, attemptValues(run.id, 1)),
      unique('attempts_run_attempt_uq'),
    );
  });

  it('rejects outcome "cheating" without a guard_name', async () => {
    await expectDbRejects(
      insertAttempt(client.db, { ...attemptValues(chain.run.id, 2), outcome: 'cheating' }),
      check('attempts_cheating_iff_guard'),
    );
  });

  it.each(['pass', 'fail', 'error', 'timeout'] as const)(
    'rejects outcome "%s" WITH a guard_name',
    async (outcome) => {
      await expectDbRejects(
        insertAttempt(client.db, {
          ...attemptValues(chain.run.id, 3),
          outcome,
          guardName: 'type_suppression',
        }),
        check('attempts_cheating_iff_guard'),
      );
    },
  );

  it('rejects tests_passed greater than tests_total', async () => {
    await expectDbRejects(
      insertAttempt(client.db, {
        ...attemptValues(chain.run.id, 4),
        testsPassed: 13,
        testsTotal: 12,
      }),
      check('attempts_tests_consistent'),
    );
  });

  it('rejects negative token counts', async () => {
    await expectDbRejects(
      insertAttempt(client.db, { ...attemptValues(chain.run.id, 4), tokensIn: -1 }),
      check('attempts_usage_non_negative'),
    );
  });
});

describe('spec_versions (FR-05)', () => {
  it('rejects a second version with the same (api_id, content_sha256)', async () => {
    await expectDbRejects(
      insertSpecVersion(client.db, {
        apiId: chain.api.id,
        sourceMode: 'uploaded',
        sourceIdentifier: 'same-content-again.yaml',
        contentSha256: chain.v1.contentSha256,
        normalized: {},
      }),
      unique('spec_versions_api_hash_uq'),
    );
  });

  it.each([
    ['uppercase hex', 'A'.repeat(64)],
    ['too short', 'a'.repeat(63)],
    ['non-hex', 'g'.repeat(64)],
  ])('rejects a content_sha256 that is %s', async (_label, hash) => {
    await expectDbRejects(
      insertSpecVersion(client.db, {
        apiId: chain.api.id,
        sourceMode: 'uploaded',
        sourceIdentifier: 'x.yaml',
        contentSha256: hash,
        normalized: {},
      }),
      check('spec_versions_sha256_format'),
    );
  });
});

describe('changes (FR-07, FR-10, BR-04)', () => {
  const base = () => ({
    apiId: chain.api.id,
    fromVersionId: chain.v1.id,
    toVersionId: chain.v2.id,
    category: 'field_type_changed' as const,
    oasdiffRuleId: 'response-property-type-changed',
    classification: 'breaking' as const,
    confidence: 0.8,
    path: '/orders/{id}',
    method: 'GET',
    jsonPointer: '/paths/~1orders~1{id}/get',
  });

  it.each([1.5, -0.1])('rejects confidence = %s', async (confidence) => {
    await expectDbRejects(
      insertChange(client.db, { ...base(), confidence }),
      check('changes_confidence_0_1'),
    );
  });

  it('rejects mapping_status "confirmed" with no mapping_source', async () => {
    await expectDbRejects(
      insertChange(client.db, { ...base(), mappingStatus: 'confirmed' }),
      check('changes_confirmed_iff_source'),
    );
  });

  it('rejects a mapping_source on an unconfirmed mapping', async () => {
    await expectDbRejects(
      insertChange(client.db, {
        ...base(),
        mappingStatus: 'unconfirmed',
        mappingSource: 'migration_note',
      }),
      check('changes_confirmed_iff_source'),
    );
  });

  it('rejects mapping_source "human" without confirmed_by', async () => {
    await expectDbRejects(
      insertChange(client.db, {
        ...base(),
        mappingStatus: 'confirmed',
        mappingSource: 'human',
        confirmedAt: new Date(),
      }),
      check('changes_human_source_has_confirmer'),
    );
  });

  it('rejects mapping_source "human" without confirmed_at', async () => {
    await expectDbRejects(
      insertChange(client.db, {
        ...base(),
        mappingStatus: 'confirmed',
        mappingSource: 'human',
        confirmedBy: 'reviewer@example.com',
      }),
      check('changes_human_source_has_confirmer'),
    );
  });

  it('rejects a change whose from and to versions are the same', async () => {
    await expectDbRejects(
      insertChange(client.db, { ...base(), toVersionId: chain.v1.id }),
      check('changes_versions_differ'),
    );
  });
});

describe('apis and repositories', () => {
  it('rejects poll_interval_seconds = 30 (FR-12: at least 60)', async () => {
    await expectDbRejects(
      insertApi(client.db, { name: `api-${uid()}`, pollIntervalSeconds: 30 }),
      check('apis_poll_interval_min_60'),
    );
  });

  it('rejects a duplicate API name', async () => {
    await expectDbRejects(insertApi(client.db, { name: chain.api.name }), unique('apis_name_uq'));
  });

  it('rejects a credential_ref that is not an env var name (no secrets, NFR-04)', async () => {
    await expectDbRejects(
      insertRepository(client.db, {
        owner: 'acme',
        name: `r-${uid()}`,
        defaultBranch: 'main',
        credentialRef: 'ghp_s3cr3tT0k3nValue',
      }),
      check('repositories_credential_ref_is_env_var_name'),
    );
  });

  it('rejects a duplicate (owner, name) repository', async () => {
    await expectDbRejects(
      insertRepository(client.db, {
        owner: chain.repository.owner,
        name: chain.repository.name,
        defaultBranch: 'main',
      }),
      unique('repositories_owner_name_uq'),
    );
  });
});

describe('runs', () => {
  const runBase = () => ({
    changeId: chain.change.id,
    repositoryId: chain.repository.id,
    commitSha: randomCommitSha(),
    stageReached: 'repair' as const,
    // Explicit start time: finished_at below comes from the host clock, which may lag the DB's.
    startedAt: new Date(Date.now() - 60_000),
  });

  it('rejects attempt_count = 5', async () => {
    await expectDbRejects(
      insertRun(client.db, { ...runBase(), attemptCount: 5 }),
      check('runs_attempt_count_0_4'),
    );
  });

  it('rejects status "stage_failure" without failure_stage', async () => {
    await expectDbRejects(
      insertRun(client.db, { ...runBase(), status: 'stage_failure', finishedAt: new Date() }),
      check('runs_stage_failure_has_stage'),
    );
  });

  it('rejects a finished status without finished_at, and "running" with finished_at', async () => {
    await expectDbRejects(
      insertRun(client.db, { ...runBase(), status: 'repaired' }),
      check('runs_running_iff_unfinished'),
    );
    await expectDbRejects(
      insertRun(client.db, { ...runBase(), status: 'running', finishedAt: new Date() }),
      check('runs_running_iff_unfinished'),
    );
  });

  it('rejects a malformed commit_sha', async () => {
    await expectDbRejects(
      insertRun(client.db, { ...runBase(), commitSha: 'main' }),
      check('runs_commit_sha_format'),
    );
  });

  it('rejects a run that is its own parent', async () => {
    const id = crypto.randomUUID();
    await expectDbRejects(
      insertRun(client.db, { ...runBase(), id, parentRunId: id }),
      check('runs_not_own_parent'),
    );
  });
});

describe('locate, checks, stage results, evaluation', () => {
  it('rejects a coverage entry with inspected = false and no skip_reason (FR-15)', async () => {
    await expectDbRejects(
      insertCoverageEntries(client.db, [
        { runId: chain.run.id, filePath: 'src/unsupported/wrapper.ts', inspected: false },
      ]),
      check('coverage_entries_skipped_has_reason'),
    );
  });

  it('rejects a spec_check "failed" with no error_detail (FR-11)', async () => {
    await expectDbRejects(
      insertSpecCheck(client.db, {
        apiId: chain.api.id,
        outcome: 'failed',
        failureStage: 'ingest',
      }),
      check('spec_checks_failed_has_error_detail'),
    );
  });

  it('rejects a call site at line 0', async () => {
    await expectDbRejects(
      insertCallSites(client.db, [
        {
          runId: chain.run.id,
          filePath: 'src/a.ts',
          line: 0,
          column: 1,
          pattern: 'fetch',
          excerpt: 'x',
        },
      ]),
      check('call_sites_position_positive'),
    );
  });

  it('rejects a second result for the same (run, stage) (FR-38)', async () => {
    const { run } = await seedChain(client);
    const row = {
      runId: run.id,
      stage: 'detect' as const,
      status: 'ok' as const,
      result: {},
      startedAt: new Date(),
      finishedAt: new Date(),
    };
    await insertStageResult(client.db, row);
    await expectDbRejects(
      insertStageResult(client.db, row),
      unique('run_stage_results_run_stage_uq'),
    );
  });

  const evalRow = () => ({
    evalLabel: `eval-${uid()}`,
    scenarioId: 'S01',
    baseline: 'B3' as const,
    outcome: 'repaired' as const,
    attemptsUsed: 1,
    costUsd: '0.01',
    durationMs: 1000,
  });

  it('rejects an excluded evaluation result without exclusion_reason', async () => {
    await expectDbRejects(
      insertEvaluationResult(client.db, { ...evalRow(), excluded: true }),
      check('evaluation_results_excluded_has_reason'),
    );
  });

  it('rejects a duplicate (eval_label, scenario_id, baseline)', async () => {
    const row = evalRow();
    await insertEvaluationResult(client.db, row);
    await expectDbRejects(
      insertEvaluationResult(client.db, row),
      unique('evaluation_results_label_scenario_baseline_uq'),
    );
  });

  it('rejects attempts_used = 5 in an evaluation result', async () => {
    await expectDbRejects(
      insertEvaluationResult(client.db, { ...evalRow(), attemptsUsed: 5 }),
      check('evaluation_results_attempts_0_4'),
    );
  });

  it('spec version hashes from randomSha256 are valid (helper sanity)', async () => {
    await insertSpecVersion(client.db, {
      apiId: chain.api.id,
      sourceMode: 'retrieved',
      sourceIdentifier: 'https://example.com/openapi.yaml',
      contentSha256: randomSha256(),
      normalized: {},
    });
  });
});
