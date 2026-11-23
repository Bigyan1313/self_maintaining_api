/** Shared setup for the orchestrator and run-route tests. */
import { execFile } from 'node:child_process';
import { cp, mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { promisify } from 'node:util';
import { vi } from 'vitest';
import { ok, type ValidationResult } from '@sma/core';
import type { Db } from '../src/infra/db/client.js';
import {
  insertApi,
  insertRepository,
  type Change,
  type Repository,
} from '../src/infra/db/index.js';
import { createGitHubClient } from '../src/infra/github/client.js';
import type { LlmResult } from '../src/infra/llm/types.js';
import { FakeLlmAdapter } from '../src/infra/llm/fake.js';
import type { DeliverDeps } from '../src/pipeline/deliver.js';
import type { GuardedValidateInput, GuardedVerdict } from '../src/pipeline/guarded-validate.js';
import {
  Orchestrator,
  type OrchestratorOptions,
  type OrchestratorPorts,
} from '../src/pipeline/orchestrator.js';
import { uid } from './db-helpers.js';
import { createFakeGitHub, type FakeGitHub } from './github-fake.js';
import { PASS, consumer, repoRoot, result } from './repair-helpers.js';

const exec = promisify(execFile);

/** Fake GitHub token used by every orchestrator test (never a real credential). */
export const TOKEN = 'ghp_ORCHESTRATORFAKE123';

/** The demo migration note, verbatim. */
export const NOTE_YAML = await readFile(
  join(repoRoot, 'demo/api/migration-notes/v1-to-v2.yaml'),
  'utf8',
);

const temps: string[] = [];
/** Removes every temp directory the helpers created. */
export async function cleanupTemps(): Promise<void> {
  await Promise.all(temps.splice(0).map((d) => rm(d, { recursive: true, force: true })));
}

async function commitAll(dir: string): Promise<void> {
  const git = (...args: string[]) =>
    exec('git', [
      '-C',
      dir,
      '-c',
      'user.name=Test',
      '-c',
      'user.email=test@example.test',
      '-c',
      'commit.gpgsign=false',
      '-c',
      'core.hooksPath=/dev/null',
      ...args,
    ]);
  await git('init', '-q');
  await git('add', '-A');
  await git('commit', '-q', '-m', 'fixture');
}

/** A committed git repository containing `files`. */
export async function gitRepo(files: Record<string, string>): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'sma-inc13-repo-'));
  temps.push(dir);
  for (const [path, content] of Object.entries(files)) {
    await mkdir(dirname(join(dir, path)), { recursive: true });
    await writeFile(join(dir, path), content);
  }
  await commitAll(dir);
  return dir;
}

/** A committed git copy of demo/consumer (no node_modules). */
export async function consumerRepo(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'sma-inc13-consumer-'));
  temps.push(dir);
  await cp(consumer, dir, {
    recursive: true,
    filter: (src) => !src.split(/[\\/]/).includes('node_modules'),
  });
  await commitAll(dir);
  return dir;
}

/**
 * A committed git copy of the rename-only consumer (v1 fixtures plus the v2 customer
 * responses; see docs/decisions/inc11.md): the correct rename patch takes it to 12/12.
 */
export async function renameOnlyRepo(): Promise<string> {
  const { renameOnlyConsumer } = await import('./repair-helpers.js');
  const dir = await renameOnlyConsumer();
  temps.push(dir);
  await commitAll(dir);
  return dir;
}

/** Registers a repository for `localPath` with a unique name and `GITHUB_TOKEN` credential. */
export async function registerRepo(db: Db, localPath: string): Promise<Repository> {
  return insertRepository(db, {
    owner: 'acme',
    name: `consumer-${uid()}`,
    defaultBranch: 'main',
    credentialRef: 'GITHUB_TOKEN',
    localPath,
  });
}

/** A mocked GitHub API for `repo`, plus delivery deps that use it. */
export function fakeGitHub(repo: Repository): { gh: FakeGitHub; deps: DeliverDeps } {
  const gh = createFakeGitHub({ owner: repo.owner, repo: repo.name });
  return {
    gh,
    deps: {
      env: { GITHUB_TOKEN: TOKEN },
      createClient: (o) => createGitHubClient({ ...o, fetch: gh.fetch }),
    },
  };
}

/** A GitHub port that routes each repository to its own fake, created on first use. */
export function fakeGitHubPort() {
  const fakes = new Map<string, FakeGitHub>();
  const deps: DeliverDeps = {
    env: { GITHUB_TOKEN: TOKEN },
    createClient: (o) => {
      let gh = fakes.get(o.repo);
      if (!gh) {
        gh = createFakeGitHub({ owner: o.owner, repo: o.repo });
        fakes.set(o.repo, gh);
      }
      return createGitHubClient({ ...o, fetch: gh.fetch });
    },
  };
  return { deps, fakes, of: (repo: Repository) => fakes.get(repo.name) };
}

/**
 * A mocked validator (no Docker): the pre-patch baseline fails 10/12, then each guarded
 * verdict comes from `verdicts` (default: pass 12/12).
 */
export function fakeValidator(verdicts: GuardedVerdict[] = []) {
  const baseline = result();
  return {
    validate: vi.fn(async () =>
      ok({
        workDir: '/x',
        commit: 'c',
        result: baseline,
        patchFiles: [],
        timings: { installMs: 0, validateMs: 0 },
      }),
    ),
    guardedValidate: vi.fn(
      async (_input: GuardedValidateInput): Promise<GuardedVerdict> =>
        verdicts.shift() ?? { outcome: 'pass', result: PASS(), validated: true },
    ),
  };
}

/** A guarded verdict for a validation result. */
export const verdictOf = (r: ValidationResult): GuardedVerdict => ({
  outcome: r.status,
  result: r,
  validated: true,
});

/** Builds an orchestrator on `db` with fakes; every port can be overridden. */
export function makeOrchestrator(
  db: Db,
  script: LlmResult[] = [],
  ports: Partial<OrchestratorPorts> = {},
  options: OrchestratorOptions = {},
) {
  const llm = new FakeLlmAdapter(script);
  const github = fakeGitHubPort();
  const validator = fakeValidator();
  const orchestrator = new Orchestrator(
    { db, llm, validator, github: github.deps, ...ports },
    { tokenCeiling: 100_000, env: { GITHUB_TOKEN: TOKEN }, ...options },
  );
  return { orchestrator, llm, github, validator };
}

/** The demo API after v1 → v2 (with the migration note): the stored changes by key. */
export interface DemoApi {
  apiId: string;
  v1: string;
  v2: string;
  changes: Change[];
  rename: Change;
  deleteOrder: Change;
}

/**
 * Registers a new demo API and runs the spec-check flow twice: fixture v1 (baseline), then
 * fixture v2 with the demo migration note.
 */
export async function demoApi(db: Db, orchestrator: Orchestrator): Promise<DemoApi> {
  const api = await insertApi(db, { name: `demo-shop-${uid()}` });
  const first = await orchestrator.checkSpec(api.id, { mode: 'fixture', version: 'v1' });
  const second = await orchestrator.checkSpec(
    api.id,
    { mode: 'fixture', version: 'v2' },
    { migrationNote: NOTE_YAML },
  );
  if (second.pipeline.failure) throw new Error(`demo v2 failed: ${second.pipeline.failure.detail}`);
  const { listChangesForVersions } = await import('../src/infra/db/index.js');
  const changes = await listChangesForVersions(
    db,
    first.check.specVersionId!,
    second.check.specVersionId!,
  );
  const find = (category: string, method: string, path: string) => {
    const c = changes.find(
      (x) => x.category === category && x.method === method && x.path === path,
    );
    if (!c) throw new Error(`missing demo change ${category} ${method} ${path}`);
    return c;
  };
  return {
    apiId: api.id,
    v1: first.check.specVersionId!,
    v2: second.check.specVersionId!,
    changes,
    rename: find('field_renamed', 'GET', '/customers/{id}'),
    deleteOrder: find('endpoint_removed', 'DELETE', '/orders/{id}'),
  };
}
