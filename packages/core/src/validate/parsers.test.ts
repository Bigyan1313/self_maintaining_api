import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { buildValidationResult, formatRawOutput, type CommandRun } from './result.js';
import { parseTscOutput } from './tsc.js';
import { parseVitestJson, relativeToRoot } from './vitest.js';

// Recorded inside the validation container (see docs/decisions/inc08.md).
const fixture = (name: string) =>
  readFileSync(new URL(`../../test/fixtures/validator/${name}`, import.meta.url), 'utf8');
const v1 = JSON.parse(fixture('vitest-consumer-v1.json')) as unknown;
const v2 = JSON.parse(fixture('vitest-consumer-v2.json')) as unknown;
const tscTypeError = fixture('tsc-consumer-type-error.txt');

/** inc02's report: the 8 tests that fail against v2. */
const V2_FAILING = [
  'admin cancelling order 2 succeeds',
  'customers display name for customer 1 is "Ada Lovelace"',
  'customers display name for customer 3 is "Grace Hopper"',
  'invoices amount due on order 1 is 19.99',
  'invoices invoice label for order 2 is "INV-0002 (due 0.00)"',
  'orders open orders are 1 and 3',
  'orders order 1 total with shipping is 24.99',
  'orders order 4 total with shipping is 105',
];

const run = (over: Partial<CommandRun> = {}): CommandRun => ({
  command: 'npm run typecheck',
  exitCode: 0,
  output: '',
  timedOut: false,
  ...over,
});
const testRun = (over: Partial<CommandRun> = {}) => run({ command: 'npm test', ...over });

describe('parseTscOutput', () => {
  it('counts the recorded TS2322 error and parses its location', () => {
    const out = parseTscOutput(tscTypeError);
    expect(out.errorCount).toBe(1);
    expect(out.diagnostics).toEqual([
      {
        file: 'src/orders.ts',
        line: 5,
        column: 14,
        code: 'TS2322',
        message: "Type 'string' is not assignable to type 'number'.",
      },
    ]);
  });

  it('counts global and oddly shaped error lines too, and nothing else', () => {
    const out = parseTscOutput(
      [
        'error TS5083: Cannot read file tsconfig.json.',
        'src/a.ts(1,1): error TS1005: ";" expected.',
        '  weird prefix error TS9999 still counted',
        'src/b.ts(2,2): warning: not an error',
        'Found 3 errors.',
      ].join('\r\n'),
    );
    expect(out.errorCount).toBe(3);
    expect(out.diagnostics.map((d) => d.code)).toEqual(['TS5083', 'TS1005']);
    expect(out.diagnostics[0]!.file).toBeNull();
  });

  it('returns 0 for clean output', () => {
    expect(parseTscOutput('> tsc --noEmit\n').errorCount).toBe(0);
  });
});

describe('parseVitestJson', () => {
  it('reads the recorded v1 report: 12/12, five files relative to /work', () => {
    const r = parseVitestJson(v1);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.testsPassed).toBe(12);
    expect(r.value.testsTotal).toBe(12);
    expect(r.value.success).toBe(true);
    expect(r.value.failedSuites).toEqual([]);
    expect(r.value.testFiles).toEqual([
      'test/admin.test.ts',
      'test/customers.test.ts',
      'test/invoices.test.ts',
      'test/orders.test.ts',
      'test/unsupported.test.ts',
    ]);
  });

  it('reads the recorded v2 report: 4/12, and the failing names match inc02', () => {
    const r = parseVitestJson(v2);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.testsPassed).toBe(4);
    expect(r.value.testsTotal).toBe(12);
    expect(r.value.success).toBe(false);
    const failing = r.value.testResults.filter((t) => t.status === 'failed').map((t) => t.name);
    expect(failing.sort()).toEqual([...V2_FAILING].sort());
  });

  it('maps pending/disabled to skipped, keeps todo, and never counts an unknown status as passed', () => {
    const r = parseVitestJson({
      success: true,
      testResults: [
        {
          name: '/work/t.test.ts',
          status: 'passed',
          assertionResults: [
            { title: 'a', ancestorTitles: ['s'], status: 'pending' },
            { title: 'b', status: 'disabled' },
            { title: 'c', status: 'todo' },
            { title: 'd', status: 'weird' },
            { fullName: 'e full', title: 'e', status: 'passed' },
          ],
        },
      ],
    });
    expect(r.ok && r.value.testResults.map((t) => [t.name, t.status])).toEqual([
      ['s a', 'skipped'],
      ['b', 'skipped'],
      ['c', 'todo'],
      ['d', 'failed'],
      ['e full', 'passed'],
    ]);
    expect(r.ok && r.value.testsPassed).toBe(1);
  });

  it('records a suite that failed without any failing case (for example an import error)', () => {
    const r = parseVitestJson({
      success: false,
      testResults: [{ name: '/work/test/broken.test.ts', status: 'failed', assertionResults: [] }],
    });
    expect(r.ok && r.value.failedSuites).toEqual(['test/broken.test.ts']);
  });

  it('rejects a report with the wrong shape', () => {
    expect(parseVitestJson(null).ok).toBe(false);
    expect(parseVitestJson({ success: true }).ok).toBe(false);
    expect(parseVitestJson({ success: 'yes', testResults: [] }).ok).toBe(false);
  });

  it('relativeToRoot strips only the root prefix', () => {
    expect(relativeToRoot('/work/test/a.ts', '/work')).toBe('test/a.ts');
    expect(relativeToRoot('/work/test/a.ts', '/work/')).toBe('test/a.ts');
    expect(relativeToRoot('/workspace/a.ts', '/work')).toBe('/workspace/a.ts');
    expect(relativeToRoot('C:\\work\\a.ts', 'C:\\work')).toBe('a.ts');
  });
});

describe('buildValidationResult', () => {
  const base = { durationMs: 1234 };

  it('v1 → pass 12/12 with 0 compile errors', () => {
    const r = buildValidationResult({ ...base, typecheck: run(), test: testRun(), vitestJson: v1 });
    expect(r).toMatchObject({
      status: 'pass',
      compileErrors: 0,
      testsPassed: 12,
      testsTotal: 12,
      durationMs: 1234,
    });
    expect(r.errorReason).toBeUndefined();
  });

  it('v2 → fail 4/12', () => {
    const r = buildValidationResult({
      ...base,
      typecheck: run(),
      test: testRun({ exitCode: 1 }),
      vitestJson: v2,
    });
    expect(r).toMatchObject({ status: 'fail', testsPassed: 4, testsTotal: 12 });
  });

  it('a compile error → fail, even when every test passed', () => {
    const r = buildValidationResult({
      ...base,
      typecheck: run({ exitCode: 2, output: tscTypeError }),
      test: testRun(),
      vitestJson: v1,
    });
    expect(r).toMatchObject({ status: 'fail', compileErrors: 1, testsPassed: 12 });
  });

  it('zero tests → fail (pass needs testsTotal > 0)', () => {
    const r = buildValidationResult({
      ...base,
      typecheck: run(),
      test: testRun(),
      vitestJson: { success: true, testResults: [] },
    });
    expect(r.status).toBe('fail');
  });

  it('a non-zero test exit code or a failed suite → fail, even with all cases passed', () => {
    expect(
      buildValidationResult({
        ...base,
        typecheck: run(),
        test: testRun({ exitCode: 1 }),
        vitestJson: v1,
      }).status,
    ).toBe('fail');
    const withBrokenSuite = {
      success: true,
      testResults: [
        {
          name: '/work/a.test.ts',
          status: 'passed',
          assertionResults: [{ title: 'x', status: 'passed' }],
        },
        { name: '/work/b.test.ts', status: 'failed', assertionResults: [] },
      ],
    };
    expect(
      buildValidationResult({
        ...base,
        typecheck: run(),
        test: testRun(),
        vitestJson: withBrokenSuite,
      }).status,
    ).toBe('fail');
  });

  it('a skipped test → not pass', () => {
    const json = {
      success: true,
      testResults: [
        {
          name: '/work/a.test.ts',
          status: 'passed',
          assertionResults: [
            { title: 'x', status: 'passed' },
            { title: 'y', status: 'skipped' },
          ],
        },
      ],
    };
    expect(
      buildValidationResult({ ...base, typecheck: run(), test: testRun(), vitestJson: json })
        .status,
    ).toBe('fail');
  });

  it('no JSON report → error, with the reason and raw output kept', () => {
    const r = buildValidationResult({
      ...base,
      typecheck: run({ output: 'tsc ok' }),
      test: testRun({ exitCode: 1, output: 'vitest: command not found' }),
      vitestJson: undefined,
    });
    expect(r.status).toBe('error');
    expect(r.errorReason).toMatch(/no JSON report/);
    expect(r.rawOutput).toContain('vitest: command not found');
  });

  it('a malformed report → error', () => {
    const r = buildValidationResult({
      ...base,
      typecheck: run(),
      test: testRun(),
      vitestJson: { nope: 1 },
    });
    expect(r).toMatchObject({ status: 'error', testsTotal: 0 });
  });

  it('a type check that fails without any TS error line → error', () => {
    const r = buildValidationResult({
      ...base,
      typecheck: run({ exitCode: 1, output: 'npm ERR! Missing script: "typecheck"' }),
      test: testRun(),
      vitestJson: v1,
    });
    expect(r.status).toBe('error');
    expect(r.errorReason).toMatch(/no TypeScript errors/);
  });

  it('either command timing out → timeout', () => {
    expect(
      buildValidationResult({
        ...base,
        typecheck: run({ timedOut: true, exitCode: null }),
        test: null,
        vitestJson: undefined,
      }).status,
    ).toBe('timeout');
    const r = buildValidationResult({
      ...base,
      typecheck: run(),
      test: testRun({ timedOut: true, exitCode: null, output: 'RUN v5' }),
      vitestJson: undefined,
    });
    expect(r.status).toBe('timeout');
    expect(r.rawOutput).toContain('[killed: wall-clock limit reached]');
  });

  it('a missing command → error', () => {
    expect(
      buildValidationResult({ ...base, typecheck: null, test: null, vitestJson: undefined }).status,
    ).toBe('error');
    expect(
      buildValidationResult({ ...base, typecheck: run(), test: null, vitestJson: undefined })
        .status,
    ).toBe('error');
  });
});

describe('formatRawOutput', () => {
  it('keeps every command, its output and its exit code, in order', () => {
    const raw = formatRawOutput([
      run({ output: 'a' }),
      null,
      testRun({ exitCode: 1, output: 'b\n' }),
    ]);
    expect(raw).toBe('$ npm run typecheck\na\n[exit code 0]\n\n$ npm test\nb\n[exit code 1]\n');
  });
});
