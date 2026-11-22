/**
 * Delivery (FR-33 to FR-37, C-02, NFR-04) on the real test database with a mocked GitHub API
 * at the fetch boundary. No network.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { NEVER_MERGE_NOTE, type DeliveryEvidence } from '@sma/core';
import {
  getRunById,
  insertAttempt,
  listAttempts,
  listChildRuns,
  listStageResults,
} from '../src/infra/db/index.js';
import { createGitHubClient } from '../src/infra/github/client.js';
import {
  deliver,
  recordFlaggedFinding,
  retryDelivery,
  type DeliverDeps,
  type PatchedFile,
} from '../src/pipeline/deliver.js';
import { attemptValues, openTestDb, seedChain, type Chain } from './db-helpers.js';
import { createFakeGitHub, type FakeGitHub } from './github-fake.js';
import { CORRECT_PATCH } from './repair-helpers.js';

const TOKEN = 'ghp_FAKE123';

let client: ReturnType<typeof openTestDb>;
beforeAll(() => {
  client = openTestDb();
});
afterAll(async () => {
  await client.close();
});
afterEach(() => vi.restoreAllMocks());

const FILES: PatchedFile[] = [
  { path: 'src/customers.ts', content: 'export const fixed = true;\n', mode: '100644' },
];

function evidence(chain: Chain, rawOutput = 'Tests 12 passed (12)'): DeliveryEvidence {
  return {
    runId: chain.run.id,
    isFixture: true,
    change: {
      category: 'field_renamed',
      method: 'GET',
      path: '/customers/{id}',
      jsonPointer: chain.change.jsonPointer,
      before: chain.change.evidenceBefore,
      after: chain.change.evidenceAfter,
    },
    confirmation: {
      source: 'migration_note',
      noteRef: 'demo/api/migration-notes/v1-to-v2.yaml',
      entry: { kind: 'field_renamed', old: 'customer_name', new: 'full_name' },
    },
    callSites: [{ filePath: 'src/customers.ts', line: 12, column: 21, pattern: 'fetch' }],
    affectedFiles: ['src/customers.ts'],
    attempts: 1,
    tests: { passed: 12, total: 12, rawOutput },
  };
}

/** A run whose attempt 1 passed validation with CORRECT_PATCH. */
async function validatedRun(outcome: 'pass' | 'cheating' | 'fail' = 'pass') {
  const chain = await seedChain(client);
  await insertAttempt(client.db, {
    ...attemptValues(chain.run.id, 1),
    patch: CORRECT_PATCH,
    outcome,
    guardName: outcome === 'cheating' ? 'test_file_changed' : null,
  });
  const gh = createFakeGitHub({ owner: chain.repository.owner, repo: chain.repository.name });
  const createClient = vi.fn((o: Parameters<typeof createGitHubClient>[0]) =>
    createGitHubClient({ ...o, fetch: gh.fetch }),
  );
  const deps: DeliverDeps = { env: { GITHUB_TOKEN: TOKEN }, createClient };
  return { chain, gh, deps, createClient };
}

const input = (chain: Chain, over: Partial<Parameters<typeof deliver>[0]> = {}) => ({
  db: client.db,
  runId: chain.run.id,
  repository: chain.repository,
  patch: CORRECT_PATCH,
  patchedFiles: FILES,
  evidence: evidence(chain),
  ...over,
});

const LABEL_CALLS = ['GET /labels/:name', 'POST /labels', 'GET /labels/:name', 'POST /labels'];
const noWrites = (gh: FakeGitHub) =>
  expect(gh.calls.filter((c) => ['PUT', 'PATCH', 'DELETE'].includes(c.method))).toEqual([]);

describe('deliver: happy path (FR-33 to FR-35)', () => {
  it('makes exactly repo → commit → blob → tree → commit → sma/ ref → PR → labels', async () => {
    const { chain, gh, deps } = await validatedRun();
    const out = await deliver(input(chain), deps);
    const branch = `sma/run-${chain.run.id}-field_renamed`;
    expect(out).toEqual({
      status: 'delivered',
      runId: chain.run.id,
      prUrl: `https://github.com/${gh.owner}/${gh.repo}/pull/1`,
      prNumber: 1,
      branch,
    });
    expect(gh.sequence()).toEqual([
      'GET ',
      'GET /git/commits/:sha',
      'POST /git/blobs',
      'POST /git/trees',
      'POST /git/commits',
      'POST /git/refs',
      'POST /pulls',
      ...LABEL_CALLS,
      'POST /issues/:n/labels',
    ]);
    noWrites(gh);

    // Built on the analyzed commit, never on the current default branch.
    const call = (p: string) => gh.calls.find((c) => c.path === p)!;
    expect(gh.calls[1]!.path).toBe(`/git/commits/${chain.run.commitSha}`);
    expect(call('/git/commits').body).toMatchObject({ parents: [chain.run.commitSha] });
    expect(call('/git/trees').body).toMatchObject({
      tree: [{ path: 'src/customers.ts', mode: '100644', type: 'blob' }],
    });
    expect(call('/git/refs').body).toMatchObject({ ref: `refs/heads/${branch}` });
    expect(gh.refs.get('main')).not.toBe(call('/git/refs').body!.sha);

    const pr = call('/pulls').body!;
    expect(pr).toMatchObject({
      title: '[SMA] field_renamed: GET /customers/{id}',
      head: branch,
      base: 'main',
    });
    const body = String(pr.body);
    expect(body).toContain(NEVER_MERGE_NOTE);
    expect(body).toContain('"customer_name"');
    expect(body).toContain('"full_name"');
    expect(body).toContain('demo/api/migration-notes/v1-to-v2.yaml');
    expect(body).toContain('`src/customers.ts:12:21` (fetch)');
    expect(body).toContain('12/12 tests passed');
    expect(body).toContain('fixture / demonstration run');
    expect(call('/issues/1/labels').body).toEqual({
      labels: ['machine-generated', 'awaiting-human-review'],
    });

    const run = await getRunById(client.db, chain.run.id);
    expect(run).toMatchObject({
      status: 'repaired',
      stageReached: 'deliver',
      prUrl: out.status === 'delivered' ? out.prUrl : '',
    });
    expect(run!.finishedAt).not.toBeNull();
    const stages = await listStageResults(client.db, chain.run.id);
    expect(stages.map((s) => [s.stage, s.status])).toEqual([['deliver', 'ok']]);
    expect(stages[0]!.result).toMatchObject({
      branch,
      prNumber: 1,
      baseCommitSha: chain.run.commitSha,
    });
  });

  it('does not recreate labels that exist, and deletes files with a null tree entry', async () => {
    const { chain, deps } = await validatedRun();
    const gh = createFakeGitHub({
      owner: chain.repository.owner,
      repo: chain.repository.name,
      labels: ['machine-generated', 'awaiting-human-review'],
    });
    const files: PatchedFile[] = [...FILES, { path: 'src/old.ts', content: null, mode: '100644' }];
    await deliver(input(chain, { patchedFiles: files }), {
      ...deps,
      createClient: (o) => createGitHubClient({ ...o, fetch: gh.fetch }),
    });
    expect(gh.sequence().filter((s) => s === 'POST /labels')).toEqual([]);
    expect(gh.sequence().filter((s) => s === 'POST /git/blobs')).toHaveLength(1);
    expect(gh.calls.find((c) => c.path === '/git/trees')!.body!.tree).toContainEqual({
      path: 'src/old.ts',
      mode: '100644',
      type: 'blob',
      sha: null,
    });
  });
});

describe('deliver: only validated patches', () => {
  it.each(['cheating', 'fail'] as const)(
    'a %s attempt is never delivered (0 GitHub calls)',
    async (outcome) => {
      const { chain, gh, deps, createClient } = await validatedRun(outcome);
      await expect(deliver(input(chain), deps)).rejects.toThrow(/passed validation/);
      expect(createClient).not.toHaveBeenCalled();
      expect(gh.calls).toHaveLength(0);
    },
  );

  it('a patch other than the validated one is refused', async () => {
    const { chain, gh, deps } = await validatedRun();
    await expect(deliver(input(chain, { patch: `${CORRECT_PATCH}\n` }), deps)).rejects.toThrow(
      /not the patch that passed/,
    );
    expect(gh.calls).toHaveLength(0);
  });
});

describe('deliver: failures are a deliver stage_failure and keep the patch (FR-37)', () => {
  it('GitHub 500 on create PR → stage_failure; retryDelivery reuses the branch and succeeds', async () => {
    const { chain, gh, deps } = await validatedRun();
    gh.fail({ method: 'POST', path: /^\/pulls$/, status: 500 });
    const out = await deliver(input(chain), deps);
    expect(out).toMatchObject({ status: 'stage_failure', runId: chain.run.id });
    expect(out.status === 'stage_failure' && out.reason).toMatch(/createPullRequest.*500/);

    const failed = await getRunById(client.db, chain.run.id);
    expect(failed).toMatchObject({
      status: 'stage_failure',
      failureStage: 'deliver',
      stageReached: 'deliver',
      prUrl: null,
    });
    expect(failed!.failureDetail).toMatch(/patch is kept; delivery can be retried/);
    const [stage] = await listStageResults(client.db, chain.run.id);
    expect(stage).toMatchObject({ stage: 'deliver', status: 'failed' });
    // The validated patch is still stored.
    expect((await listAttempts(client.db, chain.run.id))[0]).toMatchObject({
      outcome: 'pass',
      patch: CORRECT_PATCH,
    });

    const before = gh.calls.length;
    const retry = await retryDelivery(client.db, chain.run.id, deps);
    expect(retry).toMatchObject({
      status: 'delivered',
      branch: `sma/run-${chain.run.id}-field_renamed`,
    });
    expect(gh.sequence().slice(before)).toEqual([
      'GET ',
      'GET /git/ref/heads/sma/run-:n-field_renamed'.replace(':n', chain.run.id),
      'POST /pulls',
      ...LABEL_CALLS,
      'POST /issues/:n/labels',
    ]);
    const children = await listChildRuns(client.db, chain.run.id);
    expect(children).toHaveLength(1);
    expect(children[0]).toMatchObject({
      id: retry.runId,
      status: 'repaired',
      stageReached: 'deliver',
      prUrl: retry.status === 'delivered' ? retry.prUrl : '',
      commitSha: chain.run.commitSha,
      isFixture: true,
    });
    const [childStage] = await listStageResults(client.db, retry.runId);
    expect(childStage!.result).toMatchObject({ retryOf: chain.run.id, sourceRunId: chain.run.id });
    // The failed run is untouched (append-only, FR-39).
    expect(await getRunById(client.db, chain.run.id)).toEqual(failed);
    await expect(retryDelivery(client.db, chain.run.id, deps)).rejects.toThrow(/already retried/);
  });

  it('a failure before the branch exists → retry rebuilds files from the stored patch', async () => {
    const { chain, gh, deps } = await validatedRun();
    gh.fail({ method: 'POST', path: /^\/git\/trees$/, status: 502 });
    expect((await deliver(input(chain), deps)).status).toBe('stage_failure');
    const materialize = vi.fn(async () => ({ ok: true as const, value: FILES }));
    const retry = await retryDelivery(client.db, chain.run.id, { ...deps, materialize });
    expect(retry.status).toBe('delivered');
    expect(materialize).toHaveBeenCalledWith(
      chain.repository.localPath,
      chain.run.commitSha,
      CORRECT_PATCH,
    );
    expect(retry.status === 'delivered' && retry.branch).toBe(
      `sma/run-${retry.runId}-field_renamed`,
    );
  });

  it('a labelling failure after the PR opened → retry only adds labels (no duplicate PR)', async () => {
    const { chain, gh, deps } = await validatedRun();
    gh.fail({ method: 'POST', path: /^\/issues\/\d+\/labels$/, status: 500 });
    expect((await deliver(input(chain), deps)).status).toBe('stage_failure');
    expect((await getRunById(client.db, chain.run.id))!.prUrl).toMatch(/\/pull\/1$/);
    const before = gh.calls.length;
    const retry = await retryDelivery(client.db, chain.run.id, deps);
    expect(retry).toMatchObject({ status: 'delivered', prNumber: 1 });
    expect(gh.sequence().slice(before)).toEqual([
      'GET ',
      'GET /labels/:name',
      'GET /labels/:name',
      'POST /issues/:n/labels',
    ]);
  });

  it('a missing credential env var → stage_failure with no GitHub call', async () => {
    const { chain, gh, deps, createClient } = await validatedRun();
    const out = await deliver(input(chain), { ...deps, env: {} });
    expect(out).toMatchObject({
      status: 'stage_failure',
      reason: 'Environment variable GITHUB_TOKEN is not set.',
    });
    expect(createClient).not.toHaveBeenCalled();
    expect(gh.calls).toHaveLength(0);
  });

  it('an analyzed commit missing on GitHub → a clear stage_failure, no branch', async () => {
    const { chain, gh, deps } = await validatedRun();
    gh.fail({ method: 'GET', path: /^\/git\/commits\//, status: 404, message: 'Not Found' });
    const out = await deliver(input(chain), deps);
    expect(out.status === 'stage_failure' && out.reason).toMatch(/analyzed commit .* is not in/);
    expect(gh.calls.some((c) => c.path === '/git/refs')).toBe(false);
  });

  it('only a failed delivery can be retried', async () => {
    const { chain, deps } = await validatedRun();
    await expect(retryDelivery(client.db, chain.run.id, deps)).rejects.toThrow(/delivery failed/);
  });
});

describe('flagged findings (FR-36)', () => {
  it('cheating → 0 GitHub calls, reason stored, run finished', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    const { chain, gh } = await validatedRun('cheating');
    const run = await recordFlaggedFinding({
      db: client.db,
      runId: chain.run.id,
      status: 'cheating_rejected',
      reason: 'Cheat guard test_file_changed rejected attempt 1; the run stopped.',
    });
    expect(run).toMatchObject({
      status: 'cheating_rejected',
      flaggedReason: 'Cheat guard test_file_changed rejected attempt 1; the run stopped.',
      prUrl: null,
    });
    expect(run.finishedAt).not.toBeNull();
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(gh.calls).toHaveLength(0);
    const stages = await listStageResults(client.db, chain.run.id);
    expect(stages).toHaveLength(1);
    expect(stages[0]).toMatchObject({
      stage: 'deliver',
      status: 'skipped',
      result: { flagged: true, status: 'cheating_rejected', pullRequest: null },
    });
  });

  it.each(['flagged', 'failed', 'aborted'] as const)('%s is a flagged finding', async (status) => {
    const chain = await seedChain(client);
    const run = await recordFlaggedFinding({
      db: client.db,
      runId: chain.run.id,
      status,
      reason: 'why',
    });
    expect(run).toMatchObject({ status, flaggedReason: 'why' });
  });

  it('rejects a non-flagged status, an empty reason, and a finished run', async () => {
    const chain = await seedChain(client);
    const call = (status: string, reason = 'x') =>
      recordFlaggedFinding({
        db: client.db,
        runId: chain.run.id,
        status: status as 'flagged',
        reason,
      });
    await expect(call('repaired')).rejects.toThrow(/Not a flagged status/);
    await expect(call('flagged', '  ')).rejects.toThrow(/needs a reason/);
    await call('flagged');
    await expect(call('flagged')).rejects.toThrow(/finished/);
  });
});

describe('token protection (NFR-04)', () => {
  it(`with GITHUB_TOKEN=${TOKEN}, the token is in no error, stored record, log or PR body`, async () => {
    const logs = (['log', 'info', 'warn', 'error', 'debug'] as const).map((m) =>
      vi.spyOn(console, m).mockImplementation(() => undefined),
    );
    const { chain, gh, deps } = await validatedRun();
    gh.fail({
      method: 'POST',
      path: /^\/pulls$/,
      status: 500,
      message: `bad credentials ${TOKEN}`,
    });
    const ev = evidence(chain, `env dump: GITHUB_TOKEN=${TOKEN}`);
    const failed = await deliver(input(chain, { evidence: ev }), deps);
    const retry = await retryDelivery(client.db, chain.run.id, deps);
    expect(retry.status).toBe('delivered');

    const stored = JSON.stringify({
      failed,
      retry,
      runs: [await getRunById(client.db, chain.run.id), await getRunById(client.db, retry.runId)],
      stages: [
        await listStageResults(client.db, chain.run.id),
        await listStageResults(client.db, retry.runId),
      ],
    });
    expect(stored).not.toContain(TOKEN);
    expect(stored).toContain('[REDACTED]');
    const sent = gh.calls
      .filter((c) => c.body)
      .map((c) => JSON.stringify(c.body))
      .join('\n');
    expect(sent).not.toContain(TOKEN);
    for (const spy of logs) expect(spy).not.toHaveBeenCalled();
    // The token was used, but only as the Authorization header.
    expect(gh.calls.every((c) => c.authorization === `token ${TOKEN}`)).toBe(true);
  });
});
