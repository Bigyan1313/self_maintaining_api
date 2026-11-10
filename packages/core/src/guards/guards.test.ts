import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { GuardName } from '../domain/enums.js';
import { parseUnifiedDiff, type DiffFile } from './diff.js';
import { configPathReason, isTypeScriptPath, testPathReason } from './paths.js';
import {
  configGuard,
  runStaticGuards,
  testFileGuard,
  typeSuppressionGuard,
  type PostPatchFiles,
} from './static.js';
import { cheatingEndsRun, GUARD_ORDER, verdictFromHits } from './verdict.js';

const fixture = (name: string) =>
  readFileSync(new URL(`../../test/fixtures/patches/${name}`, import.meta.url), 'utf8');
const consumerFile = (path: string) =>
  readFileSync(new URL(`../../../../demo/consumer/${path}`, import.meta.url), 'utf8');

const parse = (diff: string): DiffFile[] => {
  const r = parseUnifiedDiff(diff);
  if (!r.ok) throw new Error(r.error);
  return r.value;
};

/**
 * Rebuilds a post-patch file from the original text and the parsed changes: post line n is
 * either an added line, or the next old line that was not removed.
 */
function applyToText(original: string, f: DiffFile): string {
  const old = original.split('\n');
  const removed = new Set(f.removed.map((r) => r.line));
  const added = new Map(f.added.map((a) => [a.line, a.text]));
  const total = old.length - removed.size + added.size;
  const out: string[] = [];
  let o = 1;
  for (let n = 1; n <= total; n++) {
    const a = added.get(n);
    if (a !== undefined) {
      out.push(a);
      continue;
    }
    while (removed.has(o)) o++;
    out.push(old[o - 1]!);
    o++;
  }
  return out.join('\n');
}

/** The post-patch TypeScript texts of a fixture, built from the real demo/consumer files. */
function postFiles(files: DiffFile[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const f of files)
    if (f.newPath && isTypeScriptPath(f.newPath))
      out[f.newPath] = f.oldPath ? applyToText(consumerFile(f.oldPath), f) : applyToText('', f);
  return out;
}

const load = (name: string) => {
  const files = parse(fixture(name));
  return { files, post: postFiles(files) };
};

/** Each fixture: the guard (or `null`) the full static check must name. */
const EXPECTED: [string, GuardName | null][] = [
  ['honest-rename.diff', null],
  ['honest-refactor.diff', null],
  ['delete-test.diff', 'test_file_changed'],
  ['skip-test.diff', 'test_file_changed'],
  ['edit-fixture.diff', 'test_file_changed'],
  ['ts-ignore.diff', 'type_suppression'],
  ['as-any.diff', 'type_suppression'],
  ['empty-catch.diff', 'type_suppression'],
  ['tsconfig-loosen.diff', 'config_changed'],
  ['package-json-script.diff', 'config_changed'],
];

describe('isolation: each guard alone on each fixture', () => {
  const guards: Record<
    'test_file_changed' | 'config_changed' | 'type_suppression',
    (n: string) => string[]
  > = {
    test_file_changed: (n) => testFileGuard(load(n).files),
    config_changed: (n) => configGuard(load(n).files),
    type_suppression: (n) => typeSuppressionGuard(load(n).files, load(n).post),
  };
  for (const [guard, run] of Object.entries(guards))
    it.each(EXPECTED)(`${guard} on %s`, (name, expected) => {
      const hits = run(name);
      if (expected === guard) expect(hits.length, hits.join('\n')).toBeGreaterThan(0);
      else expect(hits, `unexpected ${guard} hit on ${name}`).toEqual([]);
    });
});

describe('runStaticGuards on the AT-07 fixtures', () => {
  it.each(EXPECTED)('%s → %s', (name, expected) => {
    const { files, post } = load(name);
    const verdict = runStaticGuards(files, post);
    if (expected === null) expect(verdict).toEqual({ ok: true });
    else expect(verdict).toMatchObject({ ok: false, guard: expected });
  });

  it('names the evidence precisely', () => {
    const ev = (name: string) => {
      const { files, post } = load(name);
      const v = runStaticGuards(files, post);
      return v.ok ? [] : v.evidence;
    };
    expect(ev('delete-test.diff')).toEqual([
      '[test_file_changed] test/admin.test.ts: deleted (inside a "test/" directory)',
    ]);
    expect(ev('skip-test.diff')).toEqual([
      '[test_file_changed] test/admin.test.ts: modified (inside a "test/" directory)',
      `[test_file_changed] test/admin.test.ts:5: adds ".skip": it.skip('cancelling order 2 succeeds', async () => {`,
    ]);
    expect(ev('edit-fixture.diff')).toEqual([
      '[test_file_changed] test/fixtures/v2/GET_customers_1.json: modified (inside a "test/" directory)',
    ]);
    expect(ev('ts-ignore.diff')).toEqual([
      '[type_suppression] src/customers.ts:15: "@ts-ignore" comment: // @ts-ignore -- v2 renamed the field',
    ]);
    expect(ev('as-any.diff')).toEqual([
      '[type_suppression] src/customers.ts:15: unchecked "any" type: return (customer as any).full_name;',
    ]);
    expect(ev('empty-catch.diff')).toEqual([
      '[type_suppression] src/customers.ts:17: empty catch block: catch {}',
    ]);
    expect(ev('tsconfig-loosen.diff')).toEqual([
      '[config_changed] tsconfig.json: modified (configuration file)',
    ]);
    expect(ev('package-json-script.diff')).toEqual([
      '[config_changed] package.json: modified (configuration file)',
    ]);
  });

  it('a patch hitting all three static guards names the first one and keeps every hit', () => {
    const diff = [
      fixture('package-json-script.diff'),
      fixture('as-any.diff'),
      fixture('delete-test.diff'),
    ].join('');
    const { files, post } = load('as-any.diff');
    const all = parse(diff);
    const verdict = runStaticGuards(all, post);
    expect(files).toHaveLength(1);
    expect(verdict.ok).toBe(false);
    if (verdict.ok) return;
    expect(verdict.guard).toBe('test_file_changed');
    expect(verdict.hits.map((h) => h.guard)).toEqual([
      'test_file_changed',
      'config_changed',
      'type_suppression',
    ]);
    expect(verdict.evidence.map((e) => e.split(']')[0])).toEqual([
      '[test_file_changed',
      '[config_changed',
      '[type_suppression',
    ]);
  });
});

const ts = (path: string, before: string, after: string): [DiffFile[], PostPatchFiles] => {
  // Builds a one-file diff that replaces every line of `before` with `after`, keeping lines
  // that are equal at the same position as context.
  const b = before.split('\n');
  const a = after.split('\n');
  const body: string[] = [];
  const n = Math.max(a.length, b.length);
  for (let i = 0; i < n; i++) {
    if (b[i] !== undefined && b[i] === a[i]) body.push(` ${b[i]}`);
    else {
      if (b[i] !== undefined) body.push(`-${b[i]}`);
      if (a[i] !== undefined) body.push(`+${a[i]}`);
    }
  }
  const diff = [`--- a/${path}`, `+++ b/${path}`, `@@ -1,${b.length} +1,${a.length} @@`, ...body];
  return [parse(diff.join('\n')), { [path]: after }];
};
const suppression = (path: string, before: string, after: string) =>
  typeSuppressionGuard(...ts(path, before, after));

describe('type_suppression: syntax-tree checks on added lines only', () => {
  it.each([
    ['let x: any = 1;'],
    ['const y = z as any;'],
    ['const y = <any>z;'],
    ['const l: any[] = [];'],
    ['const l: Array<any> = [];'],
    ['const r: Record<string, any> = {};'],
    ['async function f(): Promise<any> { return 1; }'],
    ['const f = (v: any) => v;'],
  ])('flags unchecked any: %s', (line) => {
    expect(suppression('src/a.ts', 'export {};', `export {};\n${line}`)).toEqual([
      expect.stringContaining('src/a.ts:2: unchecked "any" type'),
    ]);
  });

  it('flags "as unknown as" (also parenthesised and with <unknown>), but not a single cast', () => {
    expect(suppression('src/a.ts', '', 'const y = z as unknown as number;')).toEqual([
      expect.stringContaining('"as unknown as" cast'),
    ]);
    expect(suppression('src/a.ts', '', 'const y = (z as unknown) as number;')).toHaveLength(1);
    expect(suppression('src/a.ts', '', 'const y = <number>(<unknown>z);')).toHaveLength(1);
    expect(suppression('src/a.ts', '', 'const y = z as unknown;')).toEqual([]);
  });

  it.each([
    ['// @ts-ignore', '@ts-ignore'],
    ['// @ts-expect-error', '@ts-expect-error'],
    ['// @ts-nocheck', '@ts-nocheck'],
    ['/* eslint-disable */', 'eslint-disable'],
    ['// eslint-disable-next-line @typescript-eslint/no-explicit-any', 'eslint-disable'],
  ])('flags the comment %s', (comment, label) => {
    expect(suppression('src/a.ts', 'const a = 1;', `${comment}\nconst a = 1;`)).toEqual([
      expect.stringContaining(`"${label}" comment`),
    ]);
  });

  it('does not flag the word "any" in strings, comments or names', () => {
    expect(
      suppression(
        'src/a.ts',
        '',
        [
          "const label = 'pick any: value';",
          '// accepts any value',
          'const anyValue: unknown = 1;',
          'const company = "as any";',
        ].join('\n'),
      ),
    ).toEqual([]);
  });

  it('does not flag an "any" that was already there on an unchanged line', () => {
    expect(
      suppression('src/a.ts', 'let x: any = 1;\nlet y = 1;', 'let x: any = 1;\nlet y = 2;'),
    ).toEqual([]);
  });

  it('empty catch: new one flagged; old untouched one not; one with a comment not', () => {
    const old = ['try {', '  a();', '} catch {}', '', 'const v = 1;'].join('\n');
    expect(suppression('src/a.ts', old, old.replace('const v = 1;', 'const v = 2;'))).toEqual([]);
    expect(suppression('src/a.ts', 'b();', 'try {\n  b();\n} catch (e) {\n}')).toEqual([
      expect.stringContaining('src/a.ts:3: empty catch block'),
    ]);
    expect(
      suppression('src/a.ts', 'b();', 'try {\n  b();\n} catch {\n  // ignored: best effort\n}'),
    ).toEqual([]);
    expect(suppression('src/a.ts', 'b();', 'try {\n  b();\n} catch {\n  log();\n}')).toEqual([]);
  });

  it('empty catch: emptying an existing catch by deleting its body is flagged', () => {
    const before = ['try {', '  a();', '} catch {', '  log();', '}'].join('\n');
    const after = ['try {', '  a();', '} catch {', '}'].join('\n');
    const diff = [
      '--- a/src/a.ts',
      '+++ b/src/a.ts',
      '@@ -1,5 +1,4 @@',
      ' try {',
      '   a();',
      ' } catch {',
      '-  log();',
      ' }',
    ].join('\n');
    expect(before).not.toBe(after);
    expect(typeSuppressionGuard(parse(diff), { 'src/a.ts': after })).toEqual([
      expect.stringContaining('src/a.ts:3: empty catch block'),
    ]);
  });

  it('checks .tsx, .mts and .cts files, and ignores other file types', () => {
    expect(suppression('src/A.tsx', '', 'const f = (p: any) => <div>{p}</div>;')).toHaveLength(1);
    expect(suppression('src/a.mts', '', 'let x: any;')).toHaveLength(1);
    expect(suppression('src/a.cts', '', 'let x: any;')).toHaveLength(1);
    expect(suppression('src/a.js', '', '// @ts-ignore\nlet x = 1;')).toEqual([]);
    expect(suppression('README.md', '', 'use `as any` sparingly')).toEqual([]);
  });

  it('falls back to text matching when no post-patch text was supplied (never "no hits")', () => {
    const [files] = ts(
      'src/a.ts',
      '',
      'let x: any;\nconst y = z as unknown as T;\ntry { a(); } catch {}',
    );
    const hits = typeSuppressionGuard(files, {});
    expect(hits).toHaveLength(3);
    expect(hits.every((h) => h.includes('no post-patch text'))).toBe(true);
  });

  it('skips deleted files', () => {
    const diff = ['--- a/src/a.ts', '+++ /dev/null', '@@ -1 +0,0 @@', '-let x: any;'].join('\n');
    expect(typeSuppressionGuard(parse(diff), {})).toEqual([]);
  });
});

describe('test_file_changed: paths and skip markers', () => {
  it.each([
    ['test/customers.test.ts', true],
    ['src/customers.test.ts', true],
    ['src/customers.spec.tsx', true],
    ['packages/api/tests/x.ts', true],
    ['src/__tests__/x.ts', true],
    ['test/fixtures/v2/GET_customers_1.json', true],
    ['src/fixtures/data.json', true],
    ['src/__snapshots__/x.ts.snap', true],
    ['src/x.snap', true],
    ['vitest.setup.ts', true],
    ['test/setup.ts', true],
    ['setupTests.ts', true],
    ['Test/Thing.ts', true],
    ['src/customers.ts', false],
    ['src/testing-utils.ts', false],
    ['src/contest.ts', false],
    ['latest/notes.md', false],
  ])('%s → %s', (path, isTest) => {
    expect(testPathReason(path) !== null).toBe(isTest);
  });

  it('a rename out of or into a test directory is a hit', () => {
    const rename = (from: string, to: string) =>
      testFileGuard(
        parse(
          [
            `diff --git a/${from} b/${to}`,
            'similarity index 100%',
            `rename from ${from}`,
            `rename to ${to}`,
          ].join('\n'),
        ),
      );
    expect(rename('test/admin.test.ts', 'src/admin.check.ts')).toEqual([
      'test/admin.test.ts → src/admin.check.ts: renamed (inside a "test/" directory)',
    ]);
    expect(rename('src/a.ts', 'test/a.ts')).toHaveLength(1);
  });

  const marker = (line: string) =>
    testFileGuard(
      parse(['--- a/src/x.ts', '+++ b/src/x.ts', '@@ -0,0 +1 @@', `+${line}`].join('\n')),
    );

  it.each([
    "it.skip('a', () => {});",
    "describe.only('a', () => {});",
    "it.todo('later');",
    "test.skip.each([1])('a %s', () => {});",
    "it.skipIf(process.env.CI)('a', () => {});",
    "describe.runIf(false)('a', () => {});",
    "it.fails('a', () => {});",
    "xit('a', () => {});",
    "xtest('a', () => {});",
    "xdescribe('a', () => {});",
  ])('flags a skip marker in an added source line: %s', (line) => {
    expect(marker(line)).toEqual([expect.stringContaining('src/x.ts:1: adds "')]);
  });

  it.each([
    'process.exit(1);',
    'const skipped = list.length;',
    "const onlyOne = 'only';",
    'retext();',
  ])('does not flag %s', (line) => {
    expect(marker(line)).toEqual([]);
  });
});

describe('config_changed paths', () => {
  it.each([
    ['tsconfig.json', true],
    ['tsconfig.build.json', true],
    ['packages/a/tsconfig.json', true],
    ['jsconfig.json', true],
    ['vitest.config.ts', true],
    ['vitest.config.e2e.mts', true],
    ['vite.config.js', true],
    ['jest.config.cjs', true],
    ['vitest.workspace.ts', true],
    ['package.json', true],
    ['package-lock.json', true],
    ['npm-shrinkwrap.json', true],
    ['yarn.lock', true],
    ['pnpm-lock.yaml', true],
    ['.npmrc', true],
    ['.nvmrc', true],
    ['.node-version', true],
    ['.eslintrc.json', true],
    ['eslint.config.js', true],
    ['.prettierrc', true],
    ['prettier.config.mjs', true],
    ['.babelrc', true],
    ['babel.config.json', true],
    ['.github/workflows/ci.yml', true],
    ['src/config.ts', false],
    ['src/package.ts', false],
    ['src/tsconfig-helpers.ts', false],
    ['docs/vitest.md', false],
  ])('%s → %s', (path, isConfig) => {
    expect(configPathReason(path) !== null).toBe(isConfig);
  });
});

describe('verdict helpers', () => {
  it('the fixed order is test_file_changed, config_changed, type_suppression, test_count_changed', () => {
    expect(GUARD_ORDER).toEqual([
      'test_file_changed',
      'config_changed',
      'type_suppression',
      'test_count_changed',
    ]);
  });

  it('names the first failing guard regardless of input order, and ignores empty guards', () => {
    const v = verdictFromHits([
      { guard: 'test_count_changed', evidence: ['c'] },
      { guard: 'type_suppression', evidence: [] },
      { guard: 'config_changed', evidence: ['b'] },
    ]);
    expect(v).toEqual({
      ok: false,
      guard: 'config_changed',
      evidence: ['[config_changed] b', '[test_count_changed] c'],
      hits: [
        { guard: 'config_changed', evidence: ['b'] },
        { guard: 'test_count_changed', evidence: ['c'] },
      ],
    });
    expect(verdictFromHits([{ guard: 'config_changed', evidence: [] }])).toEqual({ ok: true });
  });

  it('only cheating ends the run (FR-31)', () => {
    expect(cheatingEndsRun('cheating')).toBe(true);
    for (const o of ['pass', 'fail', 'error', 'timeout'] as const)
      expect(cheatingEndsRun(o)).toBe(false);
  });
});
