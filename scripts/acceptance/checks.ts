/**
 * The acceptance checks that can run after Increment 10: AT-01, AT-02, AT-03, AT-04, AT-05,
 * AT-07 (guards half), AT-09 and AT-11. Each one drives the real HTTP routes (through
 * `app.inject`, no mocks) or calls the real pipeline functions, against a real PostgreSQL database,
 * the real oasdiff binary and the real Docker sandbox.
 *
 * @packageDocumentation
 */
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { cpSync, existsSync, mkdirSync, readFileSync, symlinkSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { count, eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { parse as parseYaml } from 'yaml';
import {
  buildRepairContext,
  cheatingEndsRun,
  locateCallSites,
  type LocateResult,
  type LocateTarget,
  type RepairContextInput,
  type ValidationResult,
} from '@sma/core';
import { buildApp } from '../../apps/server/src/app.js';
import { createDbClient, type DbClient } from '../../apps/server/src/infra/db/client.js';
import {
  getApiById,
  insertAttempt,
  insertRun,
  listCallSites,
  listCoverageEntries,
  listSpecVersions,
  listStageResults,
  type Change,
} from '../../apps/server/src/infra/db/index.js';
import { apis, repositories, runs, specChecks } from '../../apps/server/src/infra/db/schema.js';
import { fileSystemRepoReader } from '../../apps/server/src/infra/repo/reader.js';
import { VALIDATOR_IMAGE } from '../../apps/server/src/infra/validator/image.js';
import { buildRunArgs } from '../../apps/server/src/infra/validator/sandbox.js';
import { disposeWorkingCopy } from '../../apps/server/src/infra/workcopy/index.js';
import { detectAndClassify } from '../../apps/server/src/pipeline/classify.js';
import {
  attemptFieldsFromVerdict,
  guardedValidate,
  type GuardedVerdict,
} from '../../apps/server/src/pipeline/guarded-validate.js';
import { locate } from '../../apps/server/src/pipeline/locate.js';
import { validate } from '../../apps/server/src/pipeline/validate.js';
import {
  CONSUMER_CALL_SITES,
  CONSUMER_COVERAGE_LIMITS,
  DEMO_V1_ENUM,
  DEMO_V1_V2,
} from './expected.js';
import type { CheckInfo, Recorder } from './record.js';

/** Shared state for one acceptance run. */
export interface Ctx {
  root: string;
  tmp: string;
  dbUrl: string;
  client: DbClient;
  app: FastifyInstance;
  docker: string | null;
  specs: { v1: string; v2: string; note: string };
  /** `git status --porcelain` and HEAD of this repository before any container run. */
  hostBefore: { status: string; head: string };
  shared: {
    at03?: { apiId: string; v1: string; v2: string; changes: Change[] };
    consumerRepo?: { path: string; repositoryId: string };
  };
}

/** One acceptance check: its SRS description and the code that runs it. */
export interface CheckDef {
  info: CheckInfo & { procedure: string };
  run: (r: Recorder, ctx: Ctx) => Promise<void>;
}

// ---------- helpers ----------

interface HttpResult {
  status: number;
  body: unknown;
}

async function http(
  ctx: Ctx,
  method: 'GET' | 'POST',
  url: string,
  payload?: unknown,
  contentType?: string,
): Promise<HttpResult> {
  const res = await ctx.app.inject({
    method,
    url,
    ...(payload === undefined
      ? {}
      : {
          payload: payload as string | object,
          ...(contentType ? { headers: { 'content-type': contentType } } : {}),
        }),
  });
  let body: unknown = res.body;
  try {
    body = res.json();
  } catch {
    // keep the text body
  }
  return { status: res.statusCode, body };
}

const obj = (v: unknown): Record<string, unknown> =>
  v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
const fields = (v: unknown): string[] =>
  Array.isArray(v) ? v.map((e) => String(obj(e).field)) : [];

function git(cwd: string, args: string[]): string {
  return execFileSync(
    'git',
    [
      '-c',
      'user.name=Acceptance',
      '-c',
      'user.email=acceptance@example.invalid',
      '-c',
      'core.hooksPath=/dev/null',
      '-c',
      'commit.gpgsign=false',
      ...args,
    ],
    { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] },
  ).trim();
}

/** Creates a git repository (branch `main`, one commit) with the given files and symlinks. */
function makeRepo(
  ctx: Ctx,
  name: string,
  files: Record<string, string>,
  links: Record<string, string> = {},
  copyFrom?: { from: string; entries: string[] },
): string {
  const dir = join(ctx.tmp, name);
  mkdirSync(dir, { recursive: true });
  for (const entry of copyFrom?.entries ?? [])
    cpSync(join(copyFrom!.from, entry), join(dir, entry), {
      recursive: true,
      filter: (src) => !src.includes('node_modules'),
    });
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(dirname(join(dir, path)), { recursive: true });
    writeFileSync(join(dir, path), text);
  }
  for (const [path, target] of Object.entries(links)) symlinkSync(target, join(dir, path));
  git(dir, ['init', '--quiet', '--initial-branch=main']);
  git(dir, ['add', '--all']);
  git(dir, ['commit', '--quiet', '-m', 'acceptance fixture']);
  return dir;
}

/** demo/consumer plus deliberate coverage limits (alias, .env, symlink). */
function consumerCopy(ctx: Ctx, name: string): string {
  return makeRepo(
    ctx,
    name,
    {
      'src/alias.ts':
        "// Re-exported client alias: a coverage limit (FR-17).\nexport { default as http } from 'axios';\n",
      '.env': 'DEMO_API_URL=http://localhost:4002\n',
    },
    { 'src/linked.ts': 'customers.ts' },
    {
      from: join(ctx.root, 'demo/consumer'),
      entries: ['src', 'test', 'package.json', 'tsconfig.json', 'vitest.config.ts', 'README.md'],
    },
  );
}

/** Uploads a spec text to an API; returns the HTTP result and the check's version id. */
async function upload(ctx: Ctx, apiId: string, text: string, contentType = 'application/yaml') {
  const res = await http(ctx, 'POST', `/api/apis/${apiId}/specs`, text, contentType);
  const check = obj(obj(res.body).check);
  return {
    ...res,
    outcome: String(obj(check.outcome).value ?? ''),
    versionId: (check.specVersionId as string | null) ?? null,
  };
}

/** Creates an API with an uploaded v1 baseline and returns its id and baseline version id. */
async function apiWithBaseline(ctx: Ctx, name: string, spec: string) {
  const res = await http(ctx, 'POST', '/api/apis', { name, specText: spec, filename: 'v1.yaml' });
  if (res.status !== 201) throw new Error(`POST /api/apis failed: ${JSON.stringify(res.body)}`);
  const api = obj(res.body);
  return { apiId: String(api.id), baseline: String(api.baselineVersionId) };
}

/** Independent canonical form: sort keys recursively, no whitespace. */
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object')
    return `{${Object.keys(value)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${canonical((value as Record<string, unknown>)[k])}`)
      .join(',')}}`;
  return JSON.stringify(value);
}

/** Reverses key order at every level (same content, different text). */
function reverseKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(reverseKeys);
  if (value && typeof value === 'object')
    return Object.fromEntries(
      Object.entries(value)
        .reverse()
        .map(([k, v]) => [k, reverseKeys(v)]),
    );
  return value;
}

/** Plain RFC 6901 lookup, written here so evidence is checked independently of core. */
function lookup(doc: unknown, pointer: string): unknown {
  if (pointer === '') return doc;
  let cur: unknown = doc;
  for (const raw of pointer.slice(1).split('/')) {
    const key = raw.replace(/~1/g, '/').replace(/~0/g, '~');
    if (cur === null || typeof cur !== 'object' || !(key in (cur as object))) return undefined;
    cur = (cur as Record<string, unknown>)[key];
  }
  return cur;
}

const same = (a: unknown, b: unknown) => canonical(a) === canonical(b);

function findChange(
  changes: readonly Change[],
  ruleId: string,
  method: string | null,
  path: string,
) {
  return changes.find((c) => c.oasdiffRuleId === ruleId && c.method === method && c.path === path);
}

function changeFor(changes: readonly Change[], method: string, path: string): Change {
  const c =
    changes.find(
      (x) => x.method === method && x.path === path && x.classification === 'breaking',
    ) ?? changes.find((x) => x.method === method && x.path === path);
  if (!c) throw new Error(`no change for ${method} ${path}`);
  return c;
}

const ZERO_SHA = '0'.repeat(40);

/** Turns a stored change row into the input `buildRepairContext` takes. */
function repairInput(c: Change, files: { path: string; content: string }[]): RepairContextInput {
  return {
    change: {
      difference: {
        id: c.id,
        ruleId: c.oasdiffRuleId,
        level: 'error',
        path: c.path,
        method: c.method as RepairContextInput['change']['difference']['method'],
        jsonPointer: c.jsonPointer,
        description: '',
        details: {},
        evidenceBefore: c.evidenceBefore ?? null,
        evidenceAfter: c.evidenceAfter ?? null,
      },
      category: c.category,
      classification: c.classification,
      confidence: c.confidence,
      mappingStatus: c.mappingStatus,
      mappingSource: c.mappingSource,
      mapping: (c.mapping ?? null) as RepairContextInput['change']['mapping'],
      reason: '',
    },
    specSectionBefore: c.evidenceBefore ?? null,
    specSectionAfter: c.evidenceAfter ?? null,
    migrationNoteEntry: null,
    callSiteFiles: files,
    previousErrors: [],
  };
}

function tryRepairContext(
  input: RepairContextInput,
): { ok: true; files: string[] } | { ok: false; error: string } {
  try {
    return { ok: true, files: buildRepairContext(input).includedFiles };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

async function rowCounts(ctx: Ctx) {
  const db = ctx.client.db;
  const n = async (t: typeof apis | typeof repositories | typeof runs | typeof specChecks) =>
    (await db.select({ n: count() }).from(t))[0]!.n;
  return {
    repositories: await n(repositories),
    apis: await n(apis),
    spec_checks: await n(specChecks),
    runs: await n(runs),
  };
}

async function registerRepo(ctx: Ctx, name: string, localPath: string): Promise<string> {
  const res = await http(ctx, 'POST', '/api/repositories', {
    owner: 'acceptance',
    name,
    defaultBranch: 'main',
    localPath,
  });
  if (res.status !== 201) throw new Error(`register ${name}: ${JSON.stringify(res.body)}`);
  return String(obj(res.body).id);
}

async function newRun(ctx: Ctx, changeId: string, repositoryId: string) {
  return insertRun(ctx.client.db, {
    changeId,
    repositoryId,
    commitSha: ZERO_SHA,
    stageReached: 'classify',
  });
}

function summarizeLocate(res: LocateResult) {
  return {
    outcome: res.outcome,
    reason: res.reason,
    callSites: res.callSites.map((s) => `${s.filePath}:${s.line}:${s.column} ${s.pattern}`),
    unsupported: res.unsupported.map((u) => `${u.filePath}:${u.line} ${u.kind}`),
    skipped: res.coverage.filter((c) => !c.inspected).map((c) => `${c.filePath} (${c.skipReason})`),
    inspected: res.coverage.filter((c) => c.inspected).length,
  };
}

function summarizeVerdict(v: GuardedVerdict) {
  return {
    outcome: v.outcome,
    guard: v.guard ?? null,
    validated: v.validated,
    evidence: v.evidence ?? [],
    ...(v.result
      ? {
          result: {
            status: v.result.status,
            compileErrors: v.result.compileErrors,
            testsPassed: v.result.testsPassed,
            testsTotal: v.result.testsTotal,
          },
        }
      : {}),
    ...(v.error ? { error: `${v.error.code}: ${v.error.message}` } : {}),
  };
}

const hostState = (root: string) => ({
  status: execFileSync(
    'git',
    ['status', '--porcelain', '--', 'demo/consumer', 'apps/server/test/fixtures'],
    {
      cwd: root,
      encoding: 'utf8',
    },
  ),
  head: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(),
});

/** Captures `git status` and HEAD of this repository (used before and after container runs). */
export { hostState };

// ---------- AT-01 ----------

const at01: CheckDef = {
  info: {
    id: 'AT-01',
    title: 'Configuration',
    requirements: 'FR-01, FR-02; UI-01',
    procedure:
      'Save and reload a valid configuration. Reject missing fields, an unreachable repository, an unparseable specification, and a repository over the size limits.',
    inputs: [
      'A git repository copied from `demo/consumer` (branch `main`).',
      'The Demo Shop v1 spec, `demo/api/specs/v1.yaml`.',
      'Invalid inputs: empty bodies, a `localPath` that does not exist, a token value in `credentialRef`, the spec text `{bad`, and a git repository with 201 TypeScript files.',
    ],
  },
  async run(r, ctx) {
    r.step('Create a git repository from demo/consumer to register');
    const repoPath = consumerCopy(ctx, 'at01-consumer');
    r.show('localPath', repoPath);

    r.step(
      'POST /api/repositories  {owner, name, defaultBranch: "main", localPath, credentialRef: "SMA_ACCEPTANCE_UNSET_TOKEN"}',
    );
    const repo = await http(ctx, 'POST', '/api/repositories', {
      owner: 'acceptance',
      name: 'demo-consumer',
      defaultBranch: 'main',
      localPath: repoPath,
      credentialRef: 'SMA_ACCEPTANCE_UNSET_TOKEN',
    });
    r.show(`HTTP ${repo.status}`, repo.body);
    r.check('valid repository is saved (201)', repo.status === 201, repo.status);
    r.check(
      'only the NAME of the credential variable is stored (FR-01)',
      obj(repo.body).credentialRef === 'SMA_ACCEPTANCE_UNSET_TOKEN',
      obj(repo.body).credentialRef,
    );

    r.step('POST /api/apis  {name: "demo-shop", specText: <v1.yaml>, filename: "v1.yaml"}');
    const api = await http(ctx, 'POST', '/api/apis', {
      name: 'demo-shop',
      specText: ctx.specs.v1,
      filename: 'v1.yaml',
    });
    r.show(`HTTP ${api.status}`, api.body);
    r.check(
      'valid API is saved (201) with a baseline version',
      api.status === 201 && !!obj(api.body).baselineVersionId,
      api.status,
    );

    r.step(
      'Restart: close the server and its database pool, start a new server on the same database',
    );
    await ctx.app.close();
    await ctx.client.close();
    ctx.client = createDbClient(ctx.dbUrl);
    ctx.app = buildApp({}, { db: ctx.client.db, polling: false });
    await ctx.app.ready();

    r.step('GET /api/repositories and GET /api/apis on the new server');
    const repos = await http(ctx, 'GET', '/api/repositories');
    const apiList = await http(ctx, 'GET', '/api/apis');
    const reloadedRepo = (repos.body as unknown[]).map(obj).find((x) => x.id === obj(repo.body).id);
    const reloadedApi = (apiList.body as unknown[]).map(obj).find((x) => x.id === obj(api.body).id);
    r.show('reloaded repository', reloadedRepo ?? null);
    r.show('reloaded API', reloadedApi ?? null);
    r.check(
      'the repository is reloaded unchanged',
      same(reloadedRepo, repo.body),
      reloadedRepo?.name,
    );
    r.check('the API is reloaded unchanged', same(reloadedApi, api.body), reloadedApi?.name);

    const before = await rowCounts(ctx);
    r.show('row counts before the invalid requests', before);
    const reject = async (label: string, url: string, payload: unknown, field: string) => {
      r.step(`POST ${url}  ${label}`);
      const res = await http(ctx, 'POST', url, payload);
      r.show(`HTTP ${res.status}`, res.body);
      r.check(
        `rejected with 400 naming the field "${field}"`,
        res.status === 400 && fields(res.body).includes(field),
        fields(res.body),
      );
    };
    await reject('{} (missing fields)', '/api/repositories', {}, 'owner');
    await reject('{} (missing fields)', '/api/apis', {}, 'name');
    await reject(
      '{..., localPath: "/nonexistent/acceptance-repo"} (unreachable repository)',
      '/api/repositories',
      {
        owner: 'acceptance',
        name: 'missing',
        defaultBranch: 'main',
        localPath: '/nonexistent/acceptance-repo',
      },
      'localPath',
    );
    await reject(
      '{..., credentialRef: "ghp_" + 36 characters} (a token value instead of a variable name)',
      '/api/repositories',
      {
        owner: 'acceptance',
        name: 'token-value',
        defaultBranch: 'main',
        localPath: repoPath,
        credentialRef: `ghp_${'A'.repeat(36)}`,
      },
      'credentialRef',
    );
    await reject(
      '{name, specText: "{bad"} (unparseable specification)',
      '/api/apis',
      { name: 'bad-spec', specText: '{bad' },
      'specText',
    );
    const big = makeRepo(
      ctx,
      'at01-oversized',
      Object.fromEntries(
        Array.from({ length: 201 }, (_, i) => [`src/f${i}.ts`, `export const v${i} = ${i};\n`]),
      ),
    );
    await reject(
      '{..., localPath: <git repo with 201 .ts files>} (over the 200-file limit)',
      '/api/repositories',
      { owner: 'acceptance', name: 'oversized', defaultBranch: 'main', localPath: big },
      'localPath',
    );

    r.step('Count rows again: invalid input must not save anything or start any analysis (FR-02)');
    const after = await rowCounts(ctx);
    r.show('row counts after', after);
    r.check(
      'no repository, API, spec check or run was created by an invalid request',
      same(before, after),
      after,
    );
    r.skip(
      'UI-01: the Configuration view in the dashboard',
      'the dashboard views are built in inc 14',
    );
  },
};

// ---------- AT-02 ----------

const at02: CheckDef = {
  info: {
    id: 'AT-02',
    title: 'Ingestion',
    requirements: 'FR-03 to FR-06, FR-11, FR-12',
    procedure:
      'Verify baseline establishment, an identical-hash upload producing no new version, and a changed specification producing a version and a difference list. Verify a failed retrieval leaves the baseline unchanged.',
    inputs: [
      '`demo/api/specs/v1.yaml` as YAML, then the same document as JSON with every key order reversed.',
      'A spec URL that cannot be reached: `http://127.0.0.1:1/openapi.yaml`.',
      '`demo/api/specs/v2.yaml`.',
    ],
  },
  async run(r, ctx) {
    r.step(
      'POST /api/apis  {name: "demo-shop-at02", specSourceUrl: "http://127.0.0.1:1/openapi.yaml"}',
    );
    const created = await http(ctx, 'POST', '/api/apis', {
      name: 'demo-shop-at02',
      specSourceUrl: 'http://127.0.0.1:1/openapi.yaml',
    });
    r.show(`HTTP ${created.status}`, created.body);
    const apiId = String(obj(created.body).id);

    r.step('POST /api/apis/:id/specs  (v1.yaml, content-type application/yaml)');
    const first = await upload(ctx, apiId, ctx.specs.v1);
    r.show(`HTTP ${first.status}`, first.body);
    r.check(
      'outcome is "baseline_established" (FR-04)',
      first.outcome === 'baseline_established',
      first.outcome,
    );
    const baselineId = first.versionId;
    const api1 = await getApiById(ctx.client.db, apiId);
    r.check(
      'the API baseline now points to this version',
      api1?.baselineVersionId === baselineId,
      api1?.baselineVersionId,
    );
    const [stored] = await listSpecVersions(ctx.client.db, apiId);
    const expectedHash = createHash('sha256')
      .update(canonical(parseYaml(ctx.specs.v1)), 'utf8')
      .digest('hex');
    r.show('stored spec_versions row (FR-03)', {
      sourceMode: stored?.sourceMode,
      sourceIdentifier: stored?.sourceIdentifier,
      retrievedAt: stored?.retrievedAt,
      contentSha256: stored?.contentSha256,
    });
    r.check(
      'stored as normalized JSON with source, time and SHA-256 (FR-03)',
      !!stored && !!stored.retrievedAt && /^[0-9a-f]{64}$/.test(stored.contentSha256),
      stored?.sourceIdentifier,
    );
    r.check(
      'the SHA-256 equals an independent hash of the key-sorted JSON',
      stored?.contentSha256 === expectedHash,
      expectedHash,
    );

    r.step('POST /api/apis/:id/specs  (the same document as JSON, every key order reversed)');
    const reordered = JSON.stringify(reverseKeys(parseYaml(ctx.specs.v1)), null, 1);
    const second = await upload(ctx, apiId, reordered, 'application/json');
    r.show(`HTTP ${second.status}`, obj(obj(second.body).check));
    const versionsAfterSame = (await listSpecVersions(ctx.client.db, apiId)).length;
    r.check('outcome is "no_change"', second.outcome === 'no_change', second.outcome);
    r.check(
      'no second version was stored (FR-05)',
      versionsAfterSame === 1 && second.versionId === baselineId,
      versionsAfterSame,
    );

    r.step('POST /api/apis/:id/check  (retrieve from the unreachable URL)');
    const failed = await http(ctx, 'POST', `/api/apis/${apiId}/check`, {});
    r.show(`HTTP ${failed.status}`, failed.body);
    const failedCheck = obj(obj(failed.body).check);
    r.check(
      'reported as a failed check (422), not as "no change" (FR-11)',
      failed.status === 422 && obj(failedCheck.outcome).value === 'failed',
      obj(failedCheck.outcome).value,
    );
    r.check(
      'the failure has an error detail',
      typeof failedCheck.errorDetail === 'string' && failedCheck.errorDetail.length > 0,
      failedCheck.errorDetail,
    );
    const api2 = await getApiById(ctx.client.db, apiId);
    r.check(
      'the baseline is unchanged after the failure',
      api2?.baselineVersionId === baselineId,
      api2?.baselineVersionId,
    );

    r.step('POST /api/apis/:id/specs  (v2.yaml) — a later check after the failure');
    const third = await upload(ctx, apiId, ctx.specs.v2);
    r.show(`HTTP ${third.status}`, obj(obj(third.body).check));
    const versions = await listSpecVersions(ctx.client.db, apiId);
    r.check('outcome is "changed"', third.outcome === 'changed', third.outcome);
    r.check('a second version is stored', versions.length === 2, versions.length);
    const api3 = await getApiById(ctx.client.db, apiId);
    r.check(
      'the baseline is not moved by a check (it stays v1)',
      api3?.baselineVersionId === baselineId,
      api3?.baselineVersionId,
    );

    r.step(
      'detectAndClassify(db, apiId, v1, v2)  — called directly; its HTTP route comes with the orchestrator (inc 13)',
    );
    const diff = await detectAndClassify(ctx.client.db, apiId, baselineId!, third.versionId!);
    if (!diff.ok) throw new Error(`detectAndClassify failed: ${JSON.stringify(diff.error)}`);
    const list = diff.value.map(
      (c) => `${c.method ?? '-'} ${c.path || '-'}  ${c.oasdiffRuleId}  ${c.jsonPointer}`,
    );
    r.show('difference list (FR-06)', list);
    r.check(
      'a structured difference list is produced (9 differences)',
      diff.value.length === 9,
      diff.value.length,
    );
    r.check(
      'every difference has a path, a method and a JSON pointer (FR-06)',
      diff.value.every((c) => c.path && c.method && c.jsonPointer.startsWith('/')),
      diff.value.filter((c) => !c.jsonPointer.startsWith('/')).length,
    );

    r.step('GET /api/apis/:id/checks');
    const checks = await http(ctx, 'GET', `/api/apis/${apiId}/checks`);
    const outcomes = (checks.body as unknown[]).map((c) => obj(obj(c).outcome));
    r.show('outcomes with their text labels (the route lists newest first)', outcomes);
    r.check(
      'all four checks are recorded (newest first), each with a text label',
      same(
        outcomes.map((o) => o.value),
        ['changed', 'failed', 'no_change', 'baseline_established'],
      ) && outcomes.every((o) => typeof o.label === 'string' && o.label.length > 0),
      outcomes.map((o) => o.label),
    );

    r.step(
      'FR-12: POST /api/apis with pollIntervalSeconds 59, then 60 (polling is optional; when set it must be ≥ 60 s)',
    );
    const p59 = await http(ctx, 'POST', '/api/apis', {
      name: 'poll-59',
      specSourceUrl: 'https://example.com/openapi.yaml',
      pollIntervalSeconds: 59,
    });
    const p60 = await http(ctx, 'POST', '/api/apis', {
      name: 'poll-60',
      specSourceUrl: 'https://example.com/openapi.yaml',
      pollIntervalSeconds: 60,
    });
    r.show('59 s', `HTTP ${p59.status} ${JSON.stringify(p59.body)}`);
    r.show('60 s', `HTTP ${p60.status}`);
    r.check(
      'an interval under 60 s is rejected and 60 s is accepted',
      p59.status === 400 && p60.status === 201,
      [p59.status, p60.status],
    );
  },
};

// ---------- AT-03 ----------

const at03: CheckDef = {
  info: {
    id: 'AT-03',
    title: 'Detection',
    requirements: 'FR-06 to FR-09',
    procedure:
      'Over the frozen pairs, verify every expected difference is found with its path, method, and pointer, and that evidence is retained.',
    inputs: [
      '`demo/api/specs/v1.yaml` → `demo/api/specs/v2.yaml` (the only spec pair that exists before inc 15).',
      'The migration note `demo/api/migration-notes/v1-to-v2.yaml`.',
      'Hand-written expected differences: `DEMO_V1_V2` in `scripts/acceptance/expected.ts`.',
    ],
  },
  async run(r, ctx) {
    r.step(
      'POST /api/apis {name: "demo-shop-at03", specText: v1}, then POST /api/apis/:id/specs (v2)',
    );
    const { apiId, baseline } = await apiWithBaseline(ctx, 'demo-shop-at03', ctx.specs.v1);
    const v2 = await upload(ctx, apiId, ctx.specs.v2);
    r.show('versions', { v1: baseline, v2: v2.versionId, outcome: v2.outcome });

    r.step(
      'POST /api/apis/:id/migration-notes  {fromVersionId: v1, toVersionId: v2, rawYaml: v1-to-v2.yaml}',
    );
    const note = await http(ctx, 'POST', `/api/apis/${apiId}/migration-notes`, {
      fromVersionId: baseline,
      toVersionId: v2.versionId,
      rawYaml: ctx.specs.note,
    });
    const mappings = (obj(obj(note.body).parsed).mappings as unknown[] | undefined) ?? [];
    r.show(
      `HTTP ${note.status}, extracted mappings`,
      mappings.map((m) => `${obj(m).kind} ${obj(m).method} ${obj(m).path}`),
    );
    r.check(
      'the note is accepted and its 4 old→new mappings are extracted (FR-09)',
      note.status === 201 && mappings.length === 4,
      mappings.length,
    );

    r.step('detectAndClassify(db, apiId, v1, v2)');
    const res = await detectAndClassify(ctx.client.db, apiId, baseline, v2.versionId!);
    if (!res.ok) throw new Error(`detectAndClassify failed: ${JSON.stringify(res.error)}`);
    const changes = res.value;
    ctx.shared.at03 = { apiId, v1: baseline, v2: v2.versionId!, changes };
    const before = (await listSpecVersions(ctx.client.db, apiId)).find(
      (v) => v.id === baseline,
    )!.normalized;
    const after = (await listSpecVersions(ctx.client.db, apiId)).find(
      (v) => v.id === v2.versionId,
    )!.normalized;

    r.step(
      'Compare with the 9 hand-written expected differences; check each pointer against the stored specs',
    );
    r.check(
      'exactly the 9 expected differences are found, no more',
      changes.length === DEMO_V1_V2.length,
      changes.length,
    );
    for (const e of DEMO_V1_V2) {
      const c = findChange(changes, e.ruleId, e.method, e.path);
      r.check(`found ${e.method} ${e.path} ${e.ruleId}`, !!c, c?.jsonPointer ?? 'missing');
      if (!c) continue;
      const b = lookup(before, c.jsonPointer);
      const a = lookup(after, c.jsonPointer);
      r.check(
        `  pointer resolves in the stored spec and the evidence equals the spec text there (FR-08)`,
        c.jsonPointer.startsWith('/') &&
          (b !== undefined || a !== undefined) &&
          same(c.evidenceBefore ?? null, b ?? null) &&
          same(c.evidenceAfter ?? null, a ?? null),
        { before: c.evidenceBefore ?? null, after: c.evidenceAfter ?? null },
      );
    }

    r.step('GET /api/changes?apiId=<id>  (the stored rows, as the dashboard will read them)');
    const listed = await http(ctx, 'GET', `/api/changes?apiId=${apiId}`);
    const rows = (listed.body as unknown[]).map(obj);
    r.show(
      'stored changes',
      rows.map(
        (c) =>
          `${c.method} ${c.path} | ${obj(c.classification).label} | ${obj(c.category).label} | ${obj(c.mappingStatus).label}`,
      ),
    );
    r.check(
      'every stored change keeps its pointer and before/after evidence (FR-08)',
      rows.length === 9 &&
        rows.every(
          (c) => typeof c.jsonPointer === 'string' && 'evidenceBefore' in c && 'evidenceAfter' in c,
        ),
      rows.length,
    );
    r.skip(
      '"over the frozen pairs": the other scenario pairs',
      'the 20 frozen scenarios are built in inc 15; only the demo v1→v2 pair exists now',
    );
  },
};

// ---------- AT-04 ----------

const at04: CheckDef = {
  info: {
    id: 'AT-04',
    title: 'Classification and refusal',
    requirements: 'FR-07, FR-10, FR-18, FR-36; BR-04, BR-05',
    procedure:
      'Verify breaking, safe, and unknown verdicts against hand-written labels. Verify that a change with no confirmed mapping is flagged and never enters repair.',
    inputs: [
      'The classified v1→v2 changes from AT-03 (with the migration note).',
      'v1 → v1 with `cancelled` added to the Order status enum (made in memory from v1.yaml).',
      'v1 → v2 with no migration note (for a human confirmation).',
      'Hand-written labels: `DEMO_V1_V2` and `DEMO_V1_ENUM` in `scripts/acceptance/expected.ts`.',
    ],
  },
  async run(r, ctx) {
    const at03 = ctx.shared.at03;
    if (!at03) throw new Error('AT-03 did not produce classified changes');

    r.step(
      'Compare each v1→v2 verdict with its hand-written label (breaking / safe, category, mapping)',
    );
    const table: string[] = [];
    for (const e of DEMO_V1_V2) {
      const c = findChange(at03.changes, e.ruleId, e.method, e.path);
      const got = c
        ? `${c.classification}, ${c.category}, ${c.mappingStatus}, confidence ${c.confidence}`
        : 'missing';
      table.push(
        `${e.method} ${e.path} ${e.ruleId}: expected ${e.classification}, ${e.category}, ${e.mappingWithNote}; got ${got}`,
      );
      r.check(
        `${e.method} ${e.path} ${e.ruleId} → ${e.classification}`,
        !!c &&
          c.classification === e.classification &&
          c.category === e.category &&
          c.mappingStatus === e.mappingWithNote &&
          c.confidence >= 0 &&
          c.confidence <= 1,
        got,
      );
    }
    r.show('labels vs verdicts', table);

    r.step(
      'Unknown verdicts: POST /api/apis (v1), upload v1 with `cancelled` added to the Order status enum, detectAndClassify',
    );
    const enumSpec = ctx.specs.v1.replace(
      'enum: [open, closed]\n',
      'enum: [open, closed, cancelled]\n',
    );
    if (enumSpec === ctx.specs.v1) throw new Error('could not build the enum variant of v1.yaml');
    const en = await apiWithBaseline(ctx, 'demo-shop-at04-enum', ctx.specs.v1);
    const enUp = await upload(ctx, en.apiId, enumSpec);
    const enRes = await detectAndClassify(ctx.client.db, en.apiId, en.baseline, enUp.versionId!);
    if (!enRes.ok) throw new Error(`detectAndClassify failed: ${JSON.stringify(enRes.error)}`);
    r.show(
      'verdicts',
      enRes.value.map(
        (c) =>
          `${c.method ?? '-'} ${c.path || '-'} ${c.oasdiffRuleId} → ${c.classification} (${c.confidence}), ${c.mappingStatus}`,
      ),
    );
    r.check(
      'exactly the 3 expected differences are found',
      enRes.value.length === DEMO_V1_ENUM.length,
      enRes.value.length,
    );
    for (const e of DEMO_V1_ENUM) {
      const c = findChange(enRes.value, e.ruleId, e.method, e.path);
      r.check(
        `${e.method ?? '-'} ${e.path || '-'} ${e.ruleId} → unknown, unconfirmed`,
        c?.classification === 'unknown' && c.mappingStatus === 'unconfirmed',
        c?.classification ?? 'missing',
      );
    }

    r.step(
      'Refusal: buildRepairContext() for changes without a confirmed mapping (the gate in front of Repair)',
    );
    const customers = readFileSync(join(ctx.root, 'demo/consumer/src/customers.ts'), 'utf8');
    const admin = readFileSync(join(ctx.root, 'demo/consumer/src/admin.ts'), 'utf8');
    const del = findChange(
      at03.changes,
      'api-removed-without-deprecation',
      'DELETE',
      '/orders/{id}',
    )!;
    const unknownChange = enRes.value.find((c) => c.classification === 'unknown')!;
    for (const [label, c, file] of [
      [
        'DELETE /orders/{id} (breaking, no note entry, no replacement)',
        del,
        { path: 'src/admin.ts', content: admin },
      ],
      ['an unknown enum change', unknownChange, { path: 'src/customers.ts', content: customers }],
    ] as const) {
      const out = tryRepairContext(repairInput(c, [file]));
      r.show(label, out);
      r.check(
        `repair is refused for ${label}`,
        !out.ok && /confirmed mapping/.test(out.error),
        out.ok ? out.files : out.error,
      );
    }
    r.check(
      'DELETE /orders/{id} (removed with no documented replacement) stays unconfirmed with no mapping (BR-05)',
      del.mappingStatus === 'unconfirmed' && del.mapping === null,
      { mappingStatus: del.mappingStatus, mapping: del.mapping },
    );
    const renamed = findChange(
      at03.changes,
      'response-required-property-removed',
      'GET',
      '/customers/{id}',
    )!;
    const allowed = tryRepairContext(
      repairInput(renamed, [{ path: 'src/customers.ts', content: customers }]),
    );
    r.show('control: the note-confirmed rename', allowed);
    r.check(
      'control: a breaking change with a note-confirmed mapping is accepted',
      allowed.ok,
      allowed.ok ? allowed.files : allowed.error,
    );

    r.step('Human confirmation (FR-10): v1→v2 with no note, POST /api/changes/:id/confirm-mapping');
    const hn = await apiWithBaseline(ctx, 'demo-shop-at04-human', ctx.specs.v1);
    const hnUp = await upload(ctx, hn.apiId, ctx.specs.v2);
    const hnRes = await detectAndClassify(ctx.client.db, hn.apiId, hn.baseline, hnUp.versionId!);
    if (!hnRes.ok) throw new Error('detectAndClassify failed');
    r.check(
      'without a note, every change is unconfirmed',
      hnRes.value.every((c) => c.mappingStatus === 'unconfirmed'),
      hnRes.value.map((c) => c.mappingStatus),
    );
    const cand = findChange(
      hnRes.value,
      'response-required-property-removed',
      'GET',
      '/customers/{id}',
    )!;
    const before = tryRepairContext(
      repairInput(cand, [{ path: 'src/customers.ts', content: customers }]),
    );
    r.check(
      'the unconfirmed rename candidate is refused',
      !before.ok,
      before.ok ? before.files : before.error,
    );
    const base = {
      kind: 'field_renamed',
      method: 'GET',
      path: '/customers/{id}',
      location: 'response',
      old: 'customer_name',
    };
    const wrong = await http(ctx, 'POST', `/api/changes/${cand.id}/confirm-mapping`, {
      mapping: { ...base, new: 'display_name' },
      confirmedBy: 'acceptance script (acting as the reviewer)',
    });
    r.show(`wrong target "display_name": HTTP ${wrong.status}`, wrong.body);
    r.check(
      'a mapping that does not match the spec evidence is rejected (400)',
      wrong.status === 400,
      wrong.status,
    );
    const right = await http(ctx, 'POST', `/api/changes/${cand.id}/confirm-mapping`, {
      mapping: { ...base, new: 'full_name' },
      confirmedBy: 'acceptance script (acting as the reviewer)',
    });
    const rb = obj(right.body);
    r.show(`target "full_name": HTTP ${right.status}`, {
      mappingStatus: rb.mappingStatus,
      mappingSource: rb.mappingSource,
      confirmedBy: rb.confirmedBy,
    });
    r.check(
      'an explicit confirmation that matches the evidence is stored with source "human" and the confirmer',
      right.status === 200 &&
        obj(rb.mappingSource).value === 'human' &&
        typeof rb.confirmedBy === 'string',
      obj(rb.mappingSource).value,
    );
    r.skip(
      'a run for an unconfirmed change is recorded as "flagged" with its reason, and opens no pull request (FR-18, FR-36)',
      'the repair loop and the orchestrator that set run status are inc 11 and inc 13',
    );
  },
};

// ---------- AT-05 ----------

const at05: CheckDef = {
  info: {
    id: 'AT-05',
    title: 'Location and coverage',
    requirements: 'FR-13 to FR-17; BR-02',
    procedure:
      'Verify all three call patterns are located with file and line, and that dynamic URLs, wrappers, aliases, and excluded files are reported as coverage limits rather than treated as absent.',
    inputs: [
      'A git repository copied from `demo/consumer` (src, test, config files), plus `src/alias.ts` (a re-exported axios alias), `.env`, and a symlink `src/linked.ts → customers.ts`.',
      'A small clean git repository with one file that calls only `/health`.',
      'Targets from the v1→v2 changes of AT-03. Hand-written expected call sites: `CONSUMER_CALL_SITES` in `scripts/acceptance/expected.ts`.',
    ],
  },
  async run(r, ctx) {
    const at03 = ctx.shared.at03;
    if (!at03) throw new Error('AT-03 did not produce classified changes');
    r.step('Create the consumer copy and register it: POST /api/repositories');
    const repoPath = consumerCopy(ctx, 'at05-consumer');
    const repositoryId = await registerRepo(ctx, 'at05-consumer', repoPath);
    ctx.shared.consumerRepo = { path: repoPath, repositoryId };
    const head = git(repoPath, ['rev-parse', 'HEAD']);
    r.show('repository', { repositoryId, head });

    const targets: { name: string; target: LocateTarget }[] = [
      { name: 'fetch', target: { method: 'GET', path: '/customers/{id}' } },
      { name: 'axios instance', target: { method: 'GET', path: '/orders/{id}' } },
      { name: 'axios static', target: { method: 'DELETE', path: '/orders/{id}' } },
      {
        name: 'generated client',
        target: { method: 'GET', path: '/orders/{id}/invoice', operationId: 'getOrderInvoice' },
      },
    ];
    const results = new Map<string, LocateResult>();
    for (const { name, target } of targets) {
      r.step(`locate(db, run, repo, ${JSON.stringify(target)})  — ${name}`);
      const run = await newRun(
        ctx,
        changeFor(at03.changes, target.method, target.path).id,
        repositoryId,
      );
      const res = await locate(ctx.client.db, run.id, repoPath, target);
      results.set(`${target.method} ${target.path}`, res);
      r.show('result', summarizeLocate(res));
      r.check('outcome is "affected"', res.outcome === 'affected', res.outcome);
      for (const e of CONSUMER_CALL_SITES.filter(
        (s) => s.target.method === target.method && s.target.path === target.path,
      )) {
        const hit = res.callSites.find(
          (s) => s.filePath === e.filePath && s.line === e.line && s.pattern === e.pattern,
        );
        r.check(
          `found ${e.pattern} at ${e.filePath}:${e.line} with column and excerpt (FR-13, FR-14)`,
          !!hit && hit.column >= 1 && hit.excerpt.length > 0,
          hit ? `${hit.filePath}:${hit.line}:${hit.column}` : 'missing',
        );
      }
      const sites = await listCallSites(ctx.client.db, run.id);
      const coverage = await listCoverageEntries(ctx.client.db, run.id);
      const stages = await listStageResults(ctx.client.db, run.id);
      const stored = (await ctx.client.db.select().from(runs).where(eq(runs.id, run.id)))[0];
      r.check(
        'call sites, coverage and the locate stage result are stored; the run records the real commit',
        sites.length === res.callSites.length &&
          coverage.length === res.coverage.length &&
          stages.length === 1 &&
          stored?.commitSha === head,
        {
          callSites: sites.length,
          coverage: coverage.length,
          stageResults: stages.length,
          commitSha: stored?.commitSha,
        },
      );
    }

    r.step(
      'Coverage limits in the same results: unsupported usage and skipped files (FR-15, FR-17)',
    );
    const res = results.get('GET /customers/{id}')!;
    for (const u of CONSUMER_COVERAGE_LIMITS.unsupported) {
      const hit = res.unsupported.find((x) => x.filePath === u.filePath && x.kind === u.kind);
      r.check(
        `${u.kind} in ${u.filePath} is reported as unsupported usage`,
        !!hit,
        hit ? `${hit.filePath}:${hit.line}` : res.unsupported.map((x) => `${x.filePath} ${x.kind}`),
      );
    }
    for (const s of CONSUMER_COVERAGE_LIMITS.skipped) {
      const hit = res.coverage.find((c) => c.filePath === s.filePath);
      r.check(
        `${s.filePath} is listed as skipped: "${s.reason}"`,
        !!hit && !hit.inspected && hit.skipReason === s.reason,
        hit ?? 'missing',
      );
    }

    r.step('A target nothing calls directly, in the same repository: GET /invoices/{orderId}');
    const nr = await newRun(
      ctx,
      changeFor(at03.changes, 'GET', '/invoices/{orderId}').id,
      repositoryId,
    );
    const needs = await locate(ctx.client.db, nr.id, repoPath, {
      method: 'GET',
      path: '/invoices/{orderId}',
    });
    r.show('result', summarizeLocate(needs));
    r.check(
      'no call found, but dynamic URL / wrapper / alias exist → "needs_review", never "not affected" (BR-02)',
      needs.callSites.length === 0 && needs.outcome === 'needs_review',
      needs.outcome,
    );

    r.step('A clean repository whose only call is fetch("/health"): locate GET /customers/{id}');
    const clean = makeRepo(ctx, 'at05-clean', {
      'src/health.ts':
        "export async function ping(): Promise<boolean> {\n  return (await fetch('/health')).ok;\n}\n",
    });
    const cleanId = await registerRepo(ctx, 'at05-clean', clean);
    const cr = await newRun(ctx, changeFor(at03.changes, 'GET', '/customers/{id}').id, cleanId);
    const notAffected = await locate(ctx.client.db, cr.id, clean, {
      method: 'GET',
      path: '/customers/{id}',
    });
    r.show('result', summarizeLocate(notAffected));
    r.check(
      'complete coverage and no call → "not_affected" with the text "Not affected within supported scope" (FR-16)',
      notAffected.outcome === 'not_affected' &&
        notAffected.reason === 'Not affected within supported scope',
      notAffected.reason,
    );
  },
};

// ---------- AT-07 (guards half) ----------

const GUARD_CASES = [
  {
    patch: 'packages/core/test/fixtures/patches/delete-test.diff',
    label: 'delete a test',
    guard: 'test_file_changed',
    container: false,
  },
  {
    patch: 'scripts/acceptance/patches/wrong-display-name.diff',
    label: 'reduce passing tests',
    guard: 'test_count_changed',
    container: true,
  },
  {
    patch: 'packages/core/test/fixtures/patches/ts-ignore.diff',
    label: 'add a type suppression',
    guard: 'type_suppression',
    container: false,
  },
  {
    patch: 'packages/core/test/fixtures/patches/tsconfig-loosen.diff',
    label: 'edit configuration',
    guard: 'config_changed',
    container: false,
  },
] as const;

const at07: CheckDef = {
  info: {
    id: 'AT-07',
    title: 'Failures and guards (guards half)',
    requirements: 'FR-11, FR-24, FR-27 to FR-31, FR-37; DR-04, DR-05; NFR-02, NFR-06',
    procedure:
      'Inject a source failure, a model failure, a container failure, a delivery failure, and a token-ceiling breach. Verify stage-specific reporting with no false success. Separately, submit patches that delete a test, reduce passing tests, add a type suppression, and edit configuration; verify each is rejected and names its guard.',
    inputs: [
      '`demo/consumer` validated against API v1 in the Docker sandbox (the pre-patch baseline).',
      'Patches: `delete-test.diff`, `ts-ignore.diff`, `tsconfig-loosen.diff` (from `packages/core/test/fixtures/patches/`) and `wrong-display-name.diff` (from `scripts/acceptance/patches/`, a source-only change that makes 2 passing tests fail).',
    ],
  },
  async run(r, ctx) {
    if (!ctx.docker) {
      r.block('Docker is not running; the sandbox baseline and the count guard need it');
      return;
    }
    const consumer = join(ctx.root, 'demo/consumer');
    r.step(
      'validate({repoPath: demo/consumer, env: {API_VERSION: "v1"}})  → pre-patch baseline in the sandbox',
    );
    const base = await validate({ repoPath: consumer, env: { API_VERSION: 'v1' }, dispose: true });
    if (!base.ok)
      throw new Error(`baseline validation failed: ${base.error.code}: ${base.error.message}`);
    const pre: ValidationResult = base.value.result;
    r.show('baseline', {
      status: pre.status,
      compileErrors: pre.compileErrors,
      testsPassed: pre.testsPassed,
      testsTotal: pre.testsTotal,
      timings: base.value.timings,
    });
    r.check(
      'baseline passes 12 of 12 tests',
      pre.status === 'pass' && pre.testsPassed === 12 && pre.testsTotal === 12,
      `${pre.testsPassed}/${pre.testsTotal}`,
    );

    const verdicts: GuardedVerdict[] = [];
    for (const c of GUARD_CASES) {
      r.step(
        `guardedValidate({patch: ${c.patch.split('/').pop()}, preResult: baseline})  — ${c.label}`,
      );
      const patch = readFileSync(join(ctx.root, c.patch), 'utf8');
      const v = await guardedValidate({
        repoPath: consumer,
        patch,
        env: { API_VERSION: 'v1' },
        preResult: pre,
      });
      verdicts.push(v);
      r.show('verdict', summarizeVerdict(v));
      r.check(
        `rejected as cheating and names the guard "${c.guard}"`,
        v.outcome === 'cheating' && v.guard === c.guard,
        `${v.outcome} / ${v.guard ?? 'no guard'}`,
      );
      r.check(
        c.container
          ? 'the container ran (the count guard needs real test results)'
          : 'the container never ran (static guard, before any code runs)',
        v.validated === c.container,
        `validated: ${v.validated}`,
      );
    }

    r.step('Store each rejection as an attempt (attempts table) and try two invalid rows (DR-04)');
    const at03 = ctx.shared.at03;
    const repo = ctx.shared.consumerRepo;
    if (!at03 || !repo) throw new Error('AT-03/AT-05 state missing');
    const change = changeFor(at03.changes, 'GET', '/customers/{id}');
    const stored: string[] = [];
    for (const [i, v] of verdicts.entries()) {
      const run = await newRun(ctx, change.id, repo.repositoryId);
      const a = await insertAttempt(ctx.client.db, {
        runId: run.id,
        attemptNumber: 1,
        patch: readFileSync(join(ctx.root, GUARD_CASES[i]!.patch), 'utf8'),
        ...attemptFieldsFromVerdict(v),
        tokensIn: 0,
        tokensOut: 0,
        costUsd: '0',
        modelId: 'none (fixture patch, no model call)',
        durationMs: 0,
      });
      stored.push(`${a.outcome} / ${a.guardName}`);
    }
    r.show('stored attempts', stored);
    r.check(
      'each cheating attempt is stored with exactly its guard name',
      same(
        stored,
        GUARD_CASES.map((c) => `cheating / ${c.guard}`),
      ),
      stored,
    );
    const tryInsert = async (
      outcome: 'cheating' | 'fail',
      guardName: 'type_suppression' | null,
    ) => {
      const run = await newRun(ctx, change.id, repo.repositoryId);
      try {
        await insertAttempt(ctx.client.db, {
          runId: run.id,
          attemptNumber: 1,
          patch: '-',
          outcome,
          guardName,
          tokensIn: 0,
          tokensOut: 0,
          costUsd: '0',
          modelId: 'none',
          durationMs: 0,
        });
        return 'accepted';
      } catch (e) {
        let cause: unknown = e;
        for (let d = 0; d < 5 && cause; d++) {
          const pg = cause as { code?: string; constraint?: string; cause?: unknown };
          if (pg.code) return `rejected: ${pg.code} ${pg.constraint ?? ''}`.trim();
          cause = pg.cause;
        }
        return `rejected: ${String(e)}`;
      }
    };
    const noGuard = await tryInsert('cheating', null);
    const guardOnFail = await tryInsert('fail', 'type_suppression');
    r.show('cheating without a guard', noGuard);
    r.show('fail with a guard', guardOnFail);
    r.check(
      'the database rejects a cheating attempt with no guard name',
      noGuard === 'rejected: 23514 attempts_cheating_iff_guard',
      noGuard,
    );
    r.check(
      'the database rejects a guard name on a non-cheating attempt',
      guardOnFail === 'rejected: 23514 attempts_cheating_iff_guard',
      guardOnFail,
    );
    r.check(
      'cheatingEndsRun: "cheating" ends the run, "fail" does not (FR-31)',
      cheatingEndsRun('cheating') && !cheatingEndsRun('fail'),
      [cheatingEndsRun('cheating'), cheatingEndsRun('fail')],
    );
    r.skip(
      'the run stops with no further attempts after a cheating verdict (FR-31, end to end)',
      'the repair loop is inc 11',
    );
    r.skip(
      'failure half: injected model, container and delivery failures and a token-ceiling breach, each reported as its own stage failure with no false success (FR-24, FR-37, NFR-02)',
      'needs the repair loop (inc 11), delivery (inc 12) and the orchestrator (inc 13); the source-failure case is recorded in AT-02',
    );
  },
};

// ---------- AT-09 ----------

const at09: CheckDef = {
  info: {
    id: 'AT-09',
    title: 'Boundaries',
    requirements: 'FR-15, FR-17; C-01',
    procedure:
      'Test an oversized repository, an oversized specification, a symbolic link, and an ambiguous change. Verify limits are reported and compatibility is never inferred from uninspected code.',
    inputs: [
      'A git repository with 201 TypeScript files (limit: 200 files / 20,000 lines).',
      'A spec upload of 5 MiB + 1 byte (limit: 5 MiB).',
      'A git repository with `src/a.ts` and a symlink `src/link.ts → a.ts`.',
      'v1 → v2 with no migration note (the `customer_name` → `full_name` rename is ambiguous without one).',
    ],
  },
  async run(r, ctx) {
    const target: LocateTarget = { method: 'GET', path: '/customers/{id}' };
    r.step('locateCallSites(<git repo with 201 .ts files>, GET /customers/{id})');
    const big = makeRepo(
      ctx,
      'at09-oversized',
      Object.fromEntries(
        Array.from({ length: 201 }, (_, i) => [`src/f${i}.ts`, `export const v${i} = ${i};\n`]),
      ),
    );
    const bigRes = await locateCallSites(big, target, fileSystemRepoReader);
    r.show('result', {
      ...summarizeLocate(bigRes),
      skipped: `${bigRes.coverage.filter((c) => !c.inspected).length} entries`,
      limitsExceeded: bigRes.limitsExceeded,
    });
    r.check(
      'the size limit is reported',
      !!bigRes.limitsExceeded && bigRes.limitsExceeded.files === 201,
      bigRes.limitsExceeded?.message,
    );
    r.check(
      'no file counts as inspected, all 201 sources are listed as over the limit, and the outcome is "needs_review", not "not_affected"',
      bigRes.outcome === 'needs_review' &&
        bigRes.coverage.every((c) => !c.inspected) &&
        bigRes.coverage.filter((c) => c.skipReason === 'repository size limit exceeded').length ===
          201,
      {
        outcome: bigRes.outcome,
        inspected: bigRes.coverage.filter((c) => c.inspected).length,
        overLimit: bigRes.coverage.filter((c) => c.skipReason === 'repository size limit exceeded')
          .length,
        otherSkips: bigRes.coverage
          .filter((c) => c.skipReason !== 'repository size limit exceeded')
          .map((c) => `${c.filePath} (${c.skipReason})`),
      },
    );
    const reg = await http(ctx, 'POST', '/api/repositories', {
      owner: 'acceptance',
      name: 'at09-oversized',
      defaultBranch: 'main',
      localPath: big,
    });
    r.check(
      'registering it is refused (400, field localPath)',
      reg.status === 400 && fields(reg.body).includes('localPath'),
      reg.body,
    );

    r.step('POST /api/apis/:id/specs with a 5 MiB + 1 byte body');
    const { apiId, baseline } = await apiWithBaseline(ctx, 'demo-shop-at09', ctx.specs.v1);
    const huge = `openapi: 3.1.0\n# ${'x'.repeat(5 * 1024 * 1024 + 1 - 'openapi: 3.1.0\n# '.length)}`;
    const up = await upload(ctx, apiId, huge);
    const chk = obj(obj(up.body).check);
    r.show(`HTTP ${up.status}`, { outcome: chk.outcome, errorDetail: chk.errorDetail });
    r.check(
      'reported as a failed check (413, "too_large")',
      up.status === 413 &&
        up.outcome === 'failed' &&
        String(chk.errorDetail).startsWith('too_large'),
      chk.errorDetail,
    );
    const api = await getApiById(ctx.client.db, apiId);
    const versions = await listSpecVersions(ctx.client.db, apiId);
    r.check(
      'the baseline and the stored versions are unchanged',
      api?.baselineVersionId === baseline && versions.length === 1,
      versions.length,
    );

    r.step('Ambiguous change: v1 → v2 with no migration note, detectAndClassify');
    const amb = await apiWithBaseline(ctx, 'demo-shop-at09-ambiguous', ctx.specs.v1);
    const ambUp = await upload(ctx, amb.apiId, ctx.specs.v2);
    const ambRes = await detectAndClassify(
      ctx.client.db,
      amb.apiId,
      amb.baseline,
      ambUp.versionId!,
    );
    if (!ambRes.ok) throw new Error('detectAndClassify failed');
    const cand = findChange(
      ambRes.value,
      'response-required-property-removed',
      'GET',
      '/customers/{id}',
    );
    r.show(
      'the customer_name removal',
      cand
        ? {
            category: cand.category,
            classification: cand.classification,
            confidence: cand.confidence,
            mappingStatus: cand.mappingStatus,
            mapping: cand.mapping,
          }
        : 'missing',
    );
    r.check(
      'reported as a possible rename (field_renamed, breaking, confidence 0.6) but NOT confirmed (BR-04)',
      !!cand &&
        cand.category === 'field_renamed' &&
        cand.classification === 'breaking' &&
        cand.confidence === 0.6 &&
        cand.mappingStatus === 'unconfirmed' &&
        cand.mapping === null,
      cand?.mappingStatus,
    );
    r.step('Register a repository with a symbolic link, then locate GET /customers/{id}');
    const linked = makeRepo(
      ctx,
      'at09-symlink',
      { 'src/a.ts': 'export const a = 1;\n' },
      { 'src/link.ts': 'a.ts' },
    );
    const linkedId = await registerRepo(ctx, 'at09-symlink', linked);
    const run = await newRun(ctx, changeFor(ambRes.value, 'GET', '/customers/{id}').id, linkedId);
    const linkRes = await locate(ctx.client.db, run.id, linked, target);
    r.show('result', summarizeLocate(linkRes));
    const link = linkRes.coverage.find((c) => c.filePath === 'src/link.ts');
    r.check(
      'the symlink is not followed and is listed with its reason',
      link?.inspected === false && link.skipReason === 'symbolic link not followed',
      link,
    );
    r.check(
      'no call found, but coverage is incomplete → "needs_review", not "not_affected"',
      linkRes.callSites.length === 0 && linkRes.outcome === 'needs_review',
      linkRes.outcome,
    );
  },
};

// ---------- AT-11 ----------

const at11: CheckDef = {
  info: {
    id: 'AT-11',
    title: 'Isolation',
    requirements: 'FR-20, FR-32, FR-34; NFR-03; C-02, C-03',
    procedure:
      'Verify the container runs without network access, without host credentials, and as a non-root user, and that the developer’s working copy and the default branch are unchanged after a full run.',
    inputs: [
      'The probe repository `apps/server/test/fixtures/validator/probe-repo`: 7 Vitest tests that try the network, print the user id and environment, and write to the file system.',
      'Fake host credentials set in the server process: `GITHUB_TOKEN=ghp_FAKE…`, `ANTHROPIC_API_KEY=sk-ant-FAKE…`.',
      'This repository (`demo/consumer`, test fixtures) before and after every container run of AT-07 and AT-11.',
    ],
  },
  async run(r, ctx) {
    if (!ctx.docker) {
      r.block('Docker is not running');
      return;
    }
    const probe = join(ctx.root, 'apps/server/test/fixtures/validator/probe-repo');
    const fakeGithub = `ghp_FAKE${'0'.repeat(32)}`;
    const fakeAnthropic = 'sk-ant-FAKE-acceptance-0000';
    r.step(
      'validate({repoPath: probe-repo, env: {API_VERSION: "probe"}}) with fake GITHUB_TOKEN and ANTHROPIC_API_KEY in process.env',
    );
    process.env.GITHUB_TOKEN = fakeGithub;
    process.env.ANTHROPIC_API_KEY = fakeAnthropic;
    let out;
    try {
      out = await validate({ repoPath: probe, env: { API_VERSION: 'probe' } });
    } finally {
      delete process.env.GITHUB_TOKEN;
      delete process.env.ANTHROPIC_API_KEY;
    }
    if (!out.ok) throw new Error(`${out.error.code}: ${out.error.message}`);
    const res = out.value.result;
    const status = (name: string) =>
      res.testResults.find((t) => t.name === name)?.status ?? 'missing';
    r.show(
      'probe test results',
      res.testResults.map((t) => `${t.status.padEnd(7)} ${t.name}`),
    );
    const dump = /SMA_ENV_DUMP (\{.*\})/.exec(res.rawOutput)?.[1];
    const env = dump ? (JSON.parse(dump) as Record<string, string>) : null;
    r.show('container environment printed by the probe', env);
    r.show(
      'user printed by the probe',
      /SMA_UID=\d+ SMA_GID=\d+/.exec(res.rawOutput)?.[0] ?? 'missing',
    );
    r.check(
      'no network: fetch https://example.com and http://1.1.1.1 both fail inside the container',
      status('network probe: fetch https://example.com') === 'failed' &&
        status('network probe: fetch by IP http://1.1.1.1') === 'failed',
      [
        status('network probe: fetch https://example.com'),
        status('network probe: fetch by IP http://1.1.1.1'),
      ],
    );
    r.check(
      'not root: the probe sees a non-zero uid',
      status('user probe: not running as root') === 'passed' &&
        /SMA_UID=\d+/.test(res.rawOutput) &&
        !/SMA_UID=0\b/.test(res.rawOutput),
      /SMA_UID=\d+/.exec(res.rawOutput)?.[0],
    );
    r.check(
      'no host credentials: neither fake value nor any TOKEN/KEY/SECRET/PASSWORD variable reaches the container',
      !!env &&
        !res.rawOutput.includes(fakeGithub) &&
        !res.rawOutput.includes(fakeAnthropic) &&
        !Object.keys(env).some((k) => /TOKEN|KEY|SECRET|PASSWORD/i.test(k)),
      env ? Object.keys(env) : 'no env dump',
    );
    r.check(
      'host file system protected: /etc/hosts and paths outside /work are not writable; writes in /work stay in the copy',
      status('fs probe: cannot write /etc/hosts') === 'passed' &&
        status('fs probe: cannot write outside /work and /tmp') === 'passed' &&
        status('fs probe: can write inside /work') === 'passed' &&
        existsSync(join(out.value.workDir, 'probe-wrote-this.txt')) &&
        !existsSync(join(probe, 'probe-wrote-this.txt')),
      {
        inCopy: existsSync(join(out.value.workDir, 'probe-wrote-this.txt')),
        inDeveloperRepo: existsSync(join(probe, 'probe-wrote-this.txt')),
      },
    );
    await disposeWorkingCopy(out.value.workDir);

    r.step('buildRunArgs({phase: "validate", ...})  — the docker run flags the sandbox uses');
    const args = buildRunArgs({
      phase: 'validate',
      name: 'sma-example',
      workDir: '/path/to/copy',
      env: { API_VERSION: 'v1' },
      command: ['npm', 'test'],
    });
    r.show('docker', args.join(' '));
    const flag = (f: string, v: string) => args.some((a, i) => a === f && args[i + 1] === v);
    const user = args[args.indexOf('--user') + 1] ?? '';
    r.check(
      'network none, non-root user, memory/CPU/pids limits, all capabilities dropped, read-only root, only the copy mounted',
      flag('--network', 'none') &&
        !/^0(:|$)/.test(user) &&
        args.includes('--memory') &&
        args.includes('--cpus') &&
        args.includes('--pids-limit') &&
        flag('--cap-drop', 'ALL') &&
        args.includes('--read-only') &&
        args.filter((a) => a === '--volume').length === 1,
      { user },
    );
    r.check(
      'the image is pinned by digest',
      /@sha256:[0-9a-f]{64}$/.test(VALIDATOR_IMAGE),
      VALIDATOR_IMAGE,
    );

    r.step(
      'git status --porcelain -- demo/consumer apps/server/test/fixtures; git rev-parse HEAD  (after all container runs)',
    );
    const now = hostState(ctx.root);
    r.show('before', ctx.hostBefore);
    r.show('after', now);
    r.check(
      "the developer's working copy and HEAD are unchanged (FR-20)",
      same(now, ctx.hostBefore),
      now.head,
    );

    r.step('docker ps --all --filter label=sma.validator=1');
    const left = execFileSync(
      'docker',
      ['ps', '--all', '--quiet', '--filter', 'label=sma.validator=1'],
      { encoding: 'utf8' },
    ).trim();
    r.show('containers left', left || '(none)');
    r.check('no sandbox container is left behind', left === '', left || 'none');
    r.skip(
      'the default branch is unchanged after a full pipeline run, and nothing is merged (FR-34, C-02)',
      'delivery (inc 12) and the full pipeline run (inc 13) are not built; no code in this build pushes or merges',
    );
  },
};

/** The checks, in the order they run. Later checks reuse state from AT-03 and AT-05. */
export const CHECKS: readonly CheckDef[] = [at01, at02, at03, at04, at05, at07, at09, at11];

/** Checks of Appendix A that cannot be recorded before later increments. */
export const PENDING = [
  {
    id: 'AT-06',
    title: 'Repair loop',
    requirements: 'FR-18 to FR-23, FR-25, FR-26',
    waitsFor: 'the repair loop (inc 11)',
  },
  {
    id: 'AT-08',
    title: 'Records, delivery, and export',
    requirements: 'FR-33 to FR-35, FR-38 to FR-42; DR-01 to DR-03',
    waitsFor: 'delivery (inc 12), the orchestrator and export (inc 13) and the dashboard (inc 14)',
  },
  {
    id: 'AT-10',
    title: 'Context and data protection',
    requirements: 'FR-19; NFR-04, NFR-08',
    waitsFor:
      'the repair loop (inc 11) and delivery (inc 12), so the context, logs, reports and PR bodies can be inspected end to end',
  },
  {
    id: 'AT-12',
    title: 'Evaluation',
    requirements: 'EV-01 to EV-09; NFR-01, NFR-05, NFR-07, NFR-09',
    waitsFor: 'the scenarios (inc 15) and the evaluation script (inc 16)',
  },
] as const;
