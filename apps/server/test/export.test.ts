/** Run export (FR-41, DR-05, BR-06, NFR-04): pure rendering plus file writing. No database. */
import { chmod, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { RunDetailSchema, type RunDetail } from '@sma/core';
import {
  ExportWriteError,
  FIXTURE_BANNER,
  escapeHtml,
  exportRunJson,
  renderRunHtml,
  sortKeys,
  writeRunExport,
} from '../src/pipeline/export.js';
import { knownSecrets, scrubDeep } from '../src/pipeline/run-detail.js';
import { CORRECT_PATCH } from './repair-helpers.js';

const ID = 'f930e8e3-b188-4a05-8981-f2c0a53afe6c';
const T = '2026-11-22T10:00:00.000Z';
const XSS = '<script>alert("x")</script>';

/** A complete, contract-valid run detail. */
function sample(over: { run?: Partial<RunDetail['run']> } = {}): RunDetail {
  return RunDetailSchema.parse({
    run: {
      id: ID,
      changeId: ID,
      repositoryId: ID,
      commitSha: 'a'.repeat(40),
      parentRunId: null,
      stageReached: { value: 'deliver', label: 'Deliver' },
      status: { value: 'repaired', label: 'Repaired (awaiting review)' },
      failureStage: null,
      failureDetail: null,
      flaggedReason: null,
      attemptCount: 1,
      tokensIn: 1000,
      tokensOut: 200,
      costUsd: '0.004000',
      modelId: 'claude-sonnet-5-5',
      isFixture: true,
      prUrl: 'https://github.com/acme/consumer/pull/1',
      startedAt: T,
      finishedAt: T,
      ...over.run,
    },
    change: {
      id: ID,
      apiId: ID,
      fromVersionId: ID,
      toVersionId: ID,
      category: { value: 'field_renamed', label: 'Field renamed' },
      oasdiffRuleId: 'response-required-property-removed',
      classification: { value: 'breaking', label: 'Breaking' },
      confidence: 0.6,
      path: '/customers/{id}',
      method: 'GET',
      jsonPointer: '/paths/~1customers~1{id}/get',
      evidenceBefore: { customer_name: { type: 'string', description: XSS } },
      evidenceAfter: { full_name: { type: 'string' } },
      mappingStatus: { value: 'confirmed', label: 'Mapping confirmed' },
      mappingSource: { value: 'migration_note', label: 'Confirmed by migration note' },
      mapping: { kind: 'field_renamed', old: 'customer_name', new: 'full_name' },
      migrationNoteId: ID,
      confirmedBy: null,
      confirmedAt: null,
      createdAt: T,
    },
    migrationNote: {
      id: ID,
      apiId: ID,
      fromVersionId: ID,
      toVersionId: ID,
      rawYaml: "api: demo-shop\nfrom: '1.0.0'\n",
      parsed: { api: 'demo-shop' },
      uploadedAt: T,
    },
    stageResults: [
      {
        id: ID,
        runId: ID,
        stage: { value: 'locate', label: 'Locate' },
        status: { value: 'ok', label: 'OK' },
        result: { z: 1, a: 2 },
        startedAt: T,
        finishedAt: T,
      },
    ],
    callSites: [
      {
        id: ID,
        runId: ID,
        filePath: 'src/customers.ts',
        line: 12,
        column: 21,
        pattern: { value: 'fetch', label: 'fetch' },
        excerpt: 'const res = await fetch(`/customers/${id}`) && a < b;',
      },
    ],
    coverage: [
      { id: ID, runId: ID, filePath: 'README.md', inspected: false, skipReason: 'not TS' },
    ],
    attempts: [
      {
        id: ID,
        runId: ID,
        attemptNumber: 1,
        patch: CORRECT_PATCH,
        validationOutput: `Tests 12 passed (12) ${XSS}`,
        compileErrors: 0,
        testsPassed: 12,
        testsTotal: 12,
        outcome: { value: 'pass', label: 'Passed validation' },
        guardName: null,
        tokensIn: 1000,
        tokensOut: 200,
        costUsd: '0.004000',
        modelId: 'claude-sonnet-5-5',
        durationMs: 1234,
        createdAt: T,
      },
    ],
  });
}

describe('JSON export', () => {
  it('has a stable, sorted key order and round-trips to the same record', () => {
    const detail = sample();
    const json = exportRunJson(detail);
    expect(JSON.parse(json)).toEqual(detail);
    expect(exportRunJson(structuredClone(detail))).toBe(json);
    expect(Object.keys(JSON.parse(json) as object)).toEqual([
      'attempts',
      'callSites',
      'change',
      'coverage',
      'migrationNote',
      'run',
      'stageResults',
    ]);
    expect(json.indexOf('"a": 2')).toBeLessThan(json.indexOf('"z": 1'));
  });

  it('sortKeys sorts nested objects and keeps array order', () => {
    expect(JSON.stringify(sortKeys({ b: [{ y: 1, x: 2 }, 3], a: null }))).toBe(
      '{"a":null,"b":[{"x":2,"y":1},3]}',
    );
  });
});

describe('HTML export', () => {
  const html = renderRunHtml(sample());

  it('is self-contained: no script, no external resources, a CSP that forbids both', () => {
    expect(html).not.toMatch(/<script/i);
    expect(html).not.toMatch(/<(img|link|iframe|object|embed)\b/i);
    expect(html).not.toMatch(/\bsrc=/i);
    expect(html).toContain(`content="default-src 'none'; style-src 'unsafe-inline'"`);
    expect(html).toMatch(/^<!doctype html>/);
  });

  it('escapes every stored value', () => {
    expect(html).toContain('&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt;');
    expect(html).not.toContain(XSS);
    expect(html).toContain('a &lt; b');
    expect(escapeHtml(`<a href='x'>&</a>`)).toBe('&lt;a href=&#39;x&#39;&gt;&amp;&lt;/a&gt;');
  });

  it('has every section, a text-labelled outcome and the PR link', () => {
    for (const heading of [
      'Summary',
      'Pull request',
      'Specification evidence',
      'Mapping source',
      'Stage results',
      'Call sites',
      'Coverage',
      'Attempts',
      'Attempt 1: Passed validation',
    ])
      expect(html).toContain(`<h2>${heading}</h2>`);
    expect(html).toContain('Outcome: Repaired (awaiting review)');
    expect(html).toContain('<a href="https://github.com/acme/consumer/pull/1">');
    expect(html).toContain('customer_name');
    expect(html).toContain('Confirmed by migration note');
    expect(html).toContain(escapeHtml(CORRECT_PATCH.split('\n')[0]));
  });

  it('shows the FIXTURE / DEMO RUN banner only for fixture runs (BR-06)', () => {
    expect(html).toContain(FIXTURE_BANNER);
    expect(renderRunHtml(sample({ run: { isFixture: false } }))).not.toContain(FIXTURE_BANNER);
  });

  it('shows the reason when there is no pull request, and never links a non-https URL', () => {
    const flagged = renderRunHtml(
      sample({
        run: {
          status: { value: 'flagged', label: 'Flagged' },
          prUrl: null,
          flaggedReason: 'No confirmed mapping: reported, not repaired.',
        },
      }),
    );
    expect(flagged).toContain('No pull request. Reason: No confirmed mapping');
    expect(flagged).toContain('Outcome: Flagged');
    const js = renderRunHtml(sample({ run: { prUrl: 'javascript:alert(1)' } }));
    expect(js).not.toContain('href="javascript');
  });
});

describe('credentials never reach an export (NFR-04)', () => {
  it('scrubDeep removes known values and token shapes, keys included', () => {
    const secret = 'super-secret-db-password';
    const env = {
      GITHUB_TOKEN: 'ghp' + '_REALLOOKINGTOKEN0001',
      DATABASE_URL: `postgres://sma:${secret}@localhost:5432/sma`,
      HOME: '/home/someone',
    };
    const secrets = knownSecrets(env);
    expect(secrets).toEqual(expect.arrayContaining(['ghp' + '_REALLOOKINGTOKEN0001', secret]));
    expect(secrets).not.toContain('/home/someone');
    const dirty = sample({
      run: { failureDetail: `push failed for ${'ghp' + '_REALLOOKINGTOKEN0001'} and ${secret}` },
    });
    dirty.attempts[0]!.validationOutput = 'Authorization: token sk-ant-abcdef123456';
    const clean = scrubDeep(dirty, secrets);
    const out = exportRunJson(clean) + renderRunHtml(clean);
    for (const s of ['ghp' + '_REALLOOKINGTOKEN0001', secret, 'sk-ant-abcdef123456'])
      expect(out).not.toContain(s);
    expect(out).toContain('[REDACTED]');
  });
});

describe('writing exports (DR-05)', () => {
  const dirs: string[] = [];
  afterAll(async () => {
    for (const d of dirs) await chmod(d, 0o700).catch(() => undefined);
    await Promise.all(dirs.map((d) => rm(d, { recursive: true, force: true })));
  });
  const tmp = async () => {
    const d = await mkdtemp(join(tmpdir(), 'sma-export-'));
    dirs.push(d);
    return d;
  };

  it('writes both files and only then reports saved', async () => {
    const dir = await tmp();
    const detail = sample();
    const saved = await writeRunExport(detail, dir);
    expect(saved).toEqual({
      saved: true,
      json: join(dir, `run-${ID}.json`),
      html: join(dir, `run-${ID}.html`),
    });
    expect(JSON.parse(await readFile(saved.json, 'utf8'))).toEqual(detail);
    expect(await readFile(saved.html, 'utf8')).toBe(renderRunHtml(detail));
    expect((await readdir(dir)).sort()).toEqual([`run-${ID}.html`, `run-${ID}.json`]);
  });

  it('a read-only folder → ExportWriteError, nothing saved, no partial files', async () => {
    const dir = await tmp();
    await chmod(dir, 0o500);
    await expect(writeRunExport(sample(), dir)).rejects.toBeInstanceOf(ExportWriteError);
    await chmod(dir, 0o700);
    expect(await readdir(dir)).toEqual([]);
  });

  it('a failure on the second file removes the first (no half-saved report)', async () => {
    const dir = await tmp();
    // A directory where the HTML file should go makes its rename fail after the JSON landed.
    const { mkdir } = await import('node:fs/promises');
    await mkdir(join(dir, `run-${ID}.html`));
    await writeFile(join(dir, `run-${ID}.html`, 'keep'), 'x');
    await expect(writeRunExport(sample(), dir)).rejects.toThrow(/was not saved/);
    expect((await readdir(dir)).filter((f) => f.endsWith('.json') || f.includes('.tmp-'))).toEqual(
      [],
    );
  });

  it('a path below a file → ExportWriteError', async () => {
    const dir = await tmp();
    await writeFile(join(dir, 'file'), 'x');
    await expect(writeRunExport(sample(), join(dir, 'file', 'exports'))).rejects.toBeInstanceOf(
      ExportWriteError,
    );
  });
});
