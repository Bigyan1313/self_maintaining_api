/**
 * Cheat-guard wiring (AT-07, guard part) without Docker: the validator is a mock, so these
 * tests prove that a cheating patch never reaches the container. Host git builds the
 * post-patch texts (no target code runs). The DB part proves DR-04 end to end.
 */
import { execFileSync } from 'node:child_process';
import { readdirSync, readFileSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import {
  parseUnifiedDiff,
  type GuardName,
  type Result,
  type TestCaseResult,
  type ValidationResult,
} from '@sma/core';
import type { DbClient } from '../src/infra/db/client.js';
import { insertAttempt } from '../src/infra/db/index.js';
import { applyPatch, createWorkingCopy, disposeWorkingCopy } from '../src/infra/workcopy/index.js';
import {
  attemptFieldsFromVerdict,
  guardedValidate,
  readPostPatchFiles,
  type GuardedVerdict,
} from '../src/pipeline/guarded-validate.js';
import type { ValidateError, ValidateInput, ValidateOutput } from '../src/pipeline/validate.js';
import { attemptValues, expectDbRejects, openTestDb, PG, seedChain } from './db-helpers.js';

const repoRoot = fileURLToPath(new URL('../../../', import.meta.url));
const consumer = join(repoRoot, 'demo/consumer');
const patchDir = join(repoRoot, 'packages/core/test/fixtures/patches');
const fixture = (name: string) => readFileSync(join(patchDir, name), 'utf8');

let workRoot = '';
beforeAll(async () => {
  workRoot = await mkdtemp(join(tmpdir(), 'sma-guards-'));
});
afterAll(async () => {
  await rm(workRoot, { recursive: true, force: true });
});
const workcopy = () => ({ workRoot });

const NAMES = ['admin a', 'customers b', 'invoices c', 'orders d'];
const result = (
  passed: number,
  over: Partial<ValidationResult> = {},
  names: string[] = NAMES,
): ValidationResult => {
  const testResults: TestCaseResult[] = names.map((name, i) => ({
    file: `test/${name.split(' ')[0]}.test.ts`,
    name,
    status: i < passed ? 'passed' : 'failed',
  }));
  return {
    status: passed === names.length ? 'pass' : 'fail',
    compileErrors: 0,
    testsPassed: passed,
    testsTotal: names.length,
    testResults,
    testFiles: [...new Set(testResults.map((t) => t.file))].sort(),
    durationMs: 10,
    rawOutput: 'raw output',
    ...over,
  };
};
const PRE = result(1);

/** A validator mock that returns one fixed result. */
const mockValidate = (r: Result<ValidationResult, ValidateError>) =>
  vi.fn(async (_input: ValidateInput): Promise<Result<ValidateOutput, ValidateError>> => {
    if (!r.ok) return r;
    return {
      ok: true,
      value: {
        workDir: '/x',
        commit: 'c',
        result: r.value,
        patchFiles: [],
        timings: { installMs: 1, validateMs: 1 },
      },
    };
  });

const CHEATS: [string, GuardName][] = [
  ['delete-test.diff', 'test_file_changed'],
  ['skip-test.diff', 'test_file_changed'],
  ['edit-fixture.diff', 'test_file_changed'],
  ['ts-ignore.diff', 'type_suppression'],
  ['as-any.diff', 'type_suppression'],
  ['empty-catch.diff', 'type_suppression'],
  ['tsconfig-loosen.diff', 'config_changed'],
  ['package-json-script.diff', 'config_changed'],
];
const HONEST = ['honest-rename.diff', 'honest-refactor.diff'];

describe('the fixtures are real patches for demo/consumer', () => {
  it.each([...CHEATS.map(([n]) => n), ...HONEST])('%s applies with git apply', async (name) => {
    const copy = await createWorkingCopy(consumer, undefined, workcopy());
    if (!copy.ok) throw new Error(copy.error.message);
    try {
      const applied = await applyPatch(copy.value.path, fixture(name), workcopy());
      expect(applied.ok, applied.ok ? '' : applied.error.message).toBe(true);
    } finally {
      await disposeWorkingCopy(copy.value.path, workcopy());
    }
  });
});

describe('guardedValidate: static guards run before any container', () => {
  it.each(CHEATS)('%s → cheating (%s), and the validator is never called', async (name, guard) => {
    const validate = mockValidate({ ok: true, value: result(4) });
    const v = await guardedValidate(
      {
        repoPath: consumer,
        patch: fixture(name),
        env: { API_VERSION: 'v2' },
        preResult: PRE,
        workcopy: workcopy(),
      },
      { validate },
    );
    expect(v).toMatchObject({ outcome: 'cheating', guard, validated: false });
    expect(v.evidence?.length).toBeGreaterThan(0);
    expect(v.result).toBeUndefined();
    expect(validate).not.toHaveBeenCalled();
  });

  it.each(HONEST)('%s passes the static guards and is validated once', async (name) => {
    const validate = mockValidate({ ok: true, value: result(4) });
    const v = await guardedValidate(
      {
        repoPath: consumer,
        patch: fixture(name),
        env: { API_VERSION: 'v2' },
        preResult: PRE,
        workcopy: workcopy(),
      },
      { validate },
    );
    expect(v).toEqual({ outcome: 'pass', result: result(4), validated: true });
    expect(validate).toHaveBeenCalledTimes(1);
    expect(validate.mock.calls[0]![0]).toMatchObject({
      repoPath: consumer,
      patch: fixture(name),
      env: { API_VERSION: 'v2' },
      dispose: true,
    });
  });

  it('leaves no throwaway working copy behind', () => {
    expect(readdirSync(workRoot)).toEqual([]);
  });
});

describe('guardedValidate: after validation', () => {
  const honest = (validate: ReturnType<typeof mockValidate>) =>
    guardedValidate(
      {
        repoPath: consumer,
        patch: fixture('honest-refactor.diff'),
        preResult: PRE,
        workcopy: workcopy(),
      },
      { validate, readPostPatchFiles: async () => ({ ok: true, value: {} }) },
    );

  it('passing went down → cheating (test_count_changed), result kept', async () => {
    const post = result(0);
    const v = await honest(mockValidate({ ok: true, value: post }));
    expect(v).toMatchObject({
      outcome: 'cheating',
      guard: 'test_count_changed',
      result: post,
      validated: true,
    });
    expect(v.evidence).toEqual(['[test_count_changed] passing tests went down: 1 → 0']);
  });

  it('total changed → cheating', async () => {
    const v = await honest(mockValidate({ ok: true, value: result(1, {}, NAMES.slice(0, 3)) }));
    expect(v.guard).toBe('test_count_changed');
    expect(v.evidence).toContain('[test_count_changed] total tests changed: 4 → 3');
  });

  it('a test renamed with the same totals → cheating', async () => {
    const renamed = [...NAMES.slice(0, 3), 'orders d (renamed)'];
    const v = await honest(mockValidate({ ok: true, value: result(1, {}, renamed) }));
    expect(v.evidence).toEqual([
      '[test_count_changed] test missing after the patch: test/orders.test.ts › orders d',
    ]);
  });

  it('more tests pass with the same total → the validator status stands (fail, then pass)', async () => {
    expect(await honest(mockValidate({ ok: true, value: result(3) }))).toMatchObject({
      outcome: 'fail',
      validated: true,
    });
    expect((await honest(mockValidate({ ok: true, value: result(4) }))).outcome).toBe('pass');
  });

  it.each(['error', 'timeout'] as const)(
    'a %s result keeps its status; the count guard does not judge missing counts',
    async (status) => {
      const r = result(0, { status, testsTotal: 0, testResults: [], errorReason: 'x' });
      const v = await honest(mockValidate({ ok: true, value: r }));
      expect(v).toEqual({ outcome: status, result: r, validated: true });
    },
  );

  it('a typed validator failure → error with its code, no guard', async () => {
    const v = await honest(
      mockValidate({ ok: false, error: { code: 'container_unavailable', message: 'Docker down' } }),
    );
    expect(v).toEqual({
      outcome: 'error',
      error: { code: 'container_unavailable', message: 'Docker down' },
      validated: false,
    });
  });
});

describe('guardedValidate: unreadable patches are errors, never guessed at', () => {
  it.each([
    [
      'escapes the repo',
      '--- a/../x.ts\n+++ b/../x.ts\n@@ -1 +1 @@\n-a\n+b\n',
      /leaves the repository/,
    ],
    ['malformed hunk', '--- a/src/x.ts\n+++ b/src/x.ts\n@@ -1 +1 @@\nnonsense\n', /malformed diff/],
    ['empty', '', /no files/],
  ])('%s → error patch_invalid; nothing is read or validated', async (_label, patch, message) => {
    const validate = mockValidate({ ok: true, value: result(4) });
    const readPost = vi.fn(readPostPatchFiles);
    const v = await guardedValidate(
      { repoPath: consumer, patch, preResult: PRE, workcopy: workcopy() },
      { validate, readPostPatchFiles: readPost },
    );
    expect(v.outcome).toBe('error');
    expect(v.error?.code).toBe('patch_invalid');
    expect(v.error?.message).toMatch(message);
    expect(v.guard).toBeUndefined();
    expect(readPost).not.toHaveBeenCalled();
    expect(validate).not.toHaveBeenCalled();
  });

  it('a patch that does not apply → error patch_invalid', async () => {
    const validate = mockValidate({ ok: true, value: result(4) });
    const patch = fixture('honest-rename.diff').replaceAll('customer_name', 'no_such_field');
    const v = await guardedValidate(
      { repoPath: consumer, patch, preResult: PRE, workcopy: workcopy() },
      { validate },
    );
    expect(v).toMatchObject({ outcome: 'error', error: { code: 'patch_invalid' } });
    expect(validate).not.toHaveBeenCalled();
  });
});

describe('readPostPatchFiles', () => {
  it('returns the real post-patch text of the changed TypeScript files only', async () => {
    const patch = fixture('honest-rename.diff');
    const parsed = parseUnifiedDiff(patch);
    if (!parsed.ok) throw new Error(parsed.error);
    const r = await readPostPatchFiles(consumer, undefined, patch, parsed.value, workcopy());
    if (!r.ok) throw new Error(r.error.message);
    expect(Object.keys(r.value)).toEqual(['src/customers.ts']);
    expect(r.value['src/customers.ts']).toContain('return customer.full_name;');
    expect(readFileSync(join(consumer, 'src/customers.ts'), 'utf8')).toContain(
      'return customer.customer_name;',
    );
  });

  it('makes no working copy when no TypeScript file changes', async () => {
    const patch = fixture('package-json-script.diff');
    const parsed = parseUnifiedDiff(patch);
    if (!parsed.ok) throw new Error(parsed.error);
    const r = await readPostPatchFiles(
      '/does/not/exist',
      undefined,
      patch,
      parsed.value,
      workcopy(),
    );
    expect(r).toEqual({ ok: true, value: {} });
  });
});

describe('DR-04 end to end: verdict → attempts row', () => {
  let client: DbClient;
  beforeAll(() => {
    client = openTestDb();
  });
  afterAll(async () => {
    await client.close();
  });

  const cheating = (): Promise<GuardedVerdict> =>
    guardedValidate(
      { repoPath: consumer, patch: fixture('as-any.diff'), preResult: PRE, workcopy: workcopy() },
      { validate: mockValidate({ ok: true, value: result(4) }) },
    );

  it('maps the guard name only onto a cheating outcome', async () => {
    const fields = attemptFieldsFromVerdict(await cheating());
    expect(fields).toMatchObject({
      outcome: 'cheating',
      guardName: 'type_suppression',
      testsPassed: null,
      testsTotal: null,
    });
    expect(fields.validationOutput).toMatch(
      /^Cheat guard type_suppression:\n\[type_suppression\] src\/customers\.ts:15/,
    );
    expect(
      attemptFieldsFromVerdict({
        outcome: 'pass',
        guard: 'config_changed',
        result: result(4),
        validated: true,
      }),
    ).toMatchObject({ outcome: 'pass', guardName: null, testsPassed: 4, testsTotal: 4 });
  });

  it('a cheating verdict with its guard name is stored', async () => {
    const { run } = await seedChain(client);
    const fields = attemptFieldsFromVerdict(await cheating());
    const row = await insertAttempt(client.db, {
      ...attemptValues(run.id, 1),
      ...fields,
      patch: fixture('as-any.diff'),
    });
    expect(row).toMatchObject({ outcome: 'cheating', guardName: 'type_suppression' });
  });

  it('a guard name on a pass is rejected by the database', async () => {
    const { run } = await seedChain(client);
    await expectDbRejects(
      insertAttempt(client.db, {
        ...attemptValues(run.id, 1),
        outcome: 'pass',
        guardName: 'test_count_changed',
      }),
      { code: PG.checkViolation, constraint: 'attempts_cheating_iff_guard' },
    );
  });
});

describe('host repository', () => {
  it('demo/consumer has no changes after all of the above', () => {
    const status = execFileSync('git', ['status', '--porcelain', '--', 'demo/consumer'], {
      cwd: repoRoot,
      encoding: 'utf8',
    });
    expect(status).toBe('');
  });
});
