/**
 * LIVE delivery smoke test (AT-08): opens a real pull request on the demo consumer repository
 * with the honest field-rename patch. Skipped unless GITHUB_TOKEN and SMA_DEMO_REPO
 * (`owner/name`) are set. The PR is left open for a human: **it is never merged**.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { loadRootEnv } from '../src/infra/db/env.js';
import {
  findRepository,
  insertAttempt,
  insertRepository,
  insertRun,
} from '../src/infra/db/index.js';
import { createGitHubClient } from '../src/infra/github/client.js';
import { patchedFilesFromPatch } from '../src/infra/workcopy/materialize.js';
import { deliver } from '../src/pipeline/deliver.js';
import { attemptValues, openTestDb, seedChain } from './db-helpers.js';
import { CORRECT_PATCH, consumer } from './repair-helpers.js';

loadRootEnv();
const [owner, name] = (process.env.SMA_DEMO_REPO ?? '').split('/');
const live = Boolean(process.env.GITHUB_TOKEN?.trim() && owner && name);
if (!live)
  console.warn('[deliver] SKIPPING live delivery test: needs GITHUB_TOKEN and SMA_DEMO_REPO.');

describe.skipIf(!live)('live delivery to the demo consumer repository', () => {
  let client: ReturnType<typeof openTestDb>;
  beforeAll(() => {
    client = openTestDb();
  });
  afterAll(async () => {
    await client.close();
  });

  it('opens a labelled, unmerged PR from an sma/ branch', { timeout: 120_000 }, async () => {
    const token = process.env.GITHUB_TOKEN!.trim();
    const gh = createGitHubClient({ owner: owner!, repo: name!, defaultBranch: 'main', token });
    const info = await gh.getRepo();
    const head = await gh.getRef(info.defaultBranch);

    const repository =
      (await findRepository(client.db, owner!, name!)) ??
      (await insertRepository(client.db, {
        owner: owner!,
        name: name!,
        defaultBranch: info.defaultBranch,
        credentialRef: 'GITHUB_TOKEN',
        localPath: consumer,
      }));
    const { change } = await seedChain(client);
    const run = await insertRun(client.db, {
      changeId: change.id,
      repositoryId: repository.id,
      commitSha: head.sha,
      stageReached: 'validate',
      isFixture: true,
    });
    await insertAttempt(client.db, {
      ...attemptValues(run.id, 1),
      patch: CORRECT_PATCH,
      outcome: 'pass',
    });
    const files = await patchedFilesFromPatch(consumer, undefined, CORRECT_PATCH);
    expect(files.ok).toBe(true);

    const out = await deliver({
      db: client.db,
      runId: run.id,
      repository,
      patch: CORRECT_PATCH,
      patchedFiles: files.ok ? files.value : [],
      evidence: {
        runId: run.id,
        isFixture: true,
        change: {
          category: 'field_renamed',
          method: 'GET',
          path: '/customers/{id}',
          jsonPointer: change.jsonPointer,
          before: change.evidenceBefore,
          after: change.evidenceAfter,
        },
        confirmation: {
          source: 'migration_note',
          noteRef: 'demo/api/migration-notes/v1-to-v2.yaml',
          entry: { kind: 'field_renamed', old: 'customer_name', new: 'full_name' },
        },
        callSites: [{ filePath: 'src/customers.ts', line: 12, column: 21, pattern: 'fetch' }],
        affectedFiles: ['src/customers.ts'],
        attempts: 1,
        tests: {
          passed: 12,
          total: 12,
          rawOutput: 'Live delivery smoke test (validation fixture).',
        },
      },
    });
    expect(out.status, out.status === 'stage_failure' ? out.reason : '').toBe('delivered');
    if (out.status !== 'delivered') return;
    console.warn(`[deliver] LIVE PR (do not merge): ${out.prUrl}`);
    const pr = await gh.getPullRequest(out.prNumber);
    expect(pr).toMatchObject({ state: 'open', merged: false, base: info.defaultBranch });
    expect(pr.head.startsWith('sma/')).toBe(true);
    expect(pr.labels).toEqual(
      expect.arrayContaining(['machine-generated', 'awaiting-human-review']),
    );
    // The default branch did not move.
    expect((await gh.getRef(info.defaultBranch)).sha).toBe(head.sha);
  });
});
