import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { changedLines, diffFilePath, parseUnifiedDiff, type DiffFile } from './diff.js';

const fixture = (name: string) =>
  readFileSync(new URL(`../../test/fixtures/patches/${name}`, import.meta.url), 'utf8');

const parse = (diff: string): DiffFile[] => {
  const r = parseUnifiedDiff(diff);
  if (!r.ok) throw new Error(r.error);
  return r.value;
};
const parseError = (diff: string) => {
  const r = parseUnifiedDiff(diff);
  return r.ok ? null : r.error;
};

describe('parseUnifiedDiff: real git diffs (fixtures)', () => {
  it('honest-rename.diff: one modified file with numbered added and removed lines', () => {
    const [f, ...rest] = parse(fixture('honest-rename.diff'));
    expect(rest).toEqual([]);
    expect(f).toMatchObject({
      oldPath: 'src/customers.ts',
      newPath: 'src/customers.ts',
      status: 'modified',
      binary: false,
    });
    expect(f!.removed).toEqual([
      { line: 6, text: '  customer_name: string;', at: 6 },
      { line: 15, text: '  return customer.customer_name;', at: 15 },
    ]);
    expect(f!.added).toEqual([
      { line: 6, text: '  full_name: string;' },
      { line: 15, text: '  return customer.full_name;' },
    ]);
  });

  it('delete-test.diff: a deleted file', () => {
    const [f] = parse(fixture('delete-test.diff'));
    expect(f).toMatchObject({ oldPath: 'test/admin.test.ts', newPath: null, status: 'deleted' });
    expect(f!.added).toEqual([]);
    expect(f!.removed.length).toBeGreaterThan(5);
  });

  it('empty-catch.diff: added line numbers follow the post-patch file', () => {
    const [f] = parse(fixture('empty-catch.diff'));
    expect(f!.added.map((a) => [a.line, a.text.trim()])).toEqual([
      [15, 'try {'],
      [16, 'return customer.customer_name.trim();'],
      [17, '} catch {}'],
      [18, "return '';"],
    ]);
  });

  it.each([
    'as-any.diff',
    'delete-test.diff',
    'edit-fixture.diff',
    'empty-catch.diff',
    'honest-refactor.diff',
    'honest-rename.diff',
    'package-json-script.diff',
    'skip-test.diff',
    'ts-ignore.diff',
    'tsconfig-loosen.diff',
  ])('%s parses', (name) => {
    expect(parse(fixture(name)).length).toBe(1);
  });
});

describe('parseUnifiedDiff: statuses', () => {
  it('added, renamed (with and without content), copied and binary files', () => {
    const files = parse(
      [
        'diff --git a/src/new.ts b/src/new.ts',
        'new file mode 100644',
        'index 0000000..1111111',
        '--- /dev/null',
        '+++ b/src/new.ts',
        '@@ -0,0 +1,2 @@',
        '+export const a = 1;',
        '+export const b = 2;',
        'diff --git a/src/a.ts b/src/b.ts',
        'similarity index 100%',
        'rename from src/a.ts',
        'rename to src/b.ts',
        'diff --git a/src/c.ts b/src/d.ts',
        'similarity index 90%',
        'rename from src/c.ts',
        'rename to src/d.ts',
        '--- a/src/c.ts',
        '+++ b/src/d.ts',
        '@@ -1 +1 @@',
        '-old',
        '+new',
        'diff --git a/src/x.ts b/test/x.test.ts',
        'similarity index 100%',
        'copy from src/x.ts',
        'copy to test/x.test.ts',
        'diff --git a/logo.png b/logo.png',
        'Binary files a/logo.png and b/logo.png differ',
        '',
      ].join('\n'),
    );
    expect(files.map((f) => [f.oldPath, f.newPath, f.status])).toEqual([
      [null, 'src/new.ts', 'added'],
      ['src/a.ts', 'src/b.ts', 'renamed'],
      ['src/c.ts', 'src/d.ts', 'renamed'],
      [null, 'test/x.test.ts', 'added'],
      ['logo.png', 'logo.png', 'modified'],
    ]);
    expect(files[0]!.added).toEqual([
      { line: 1, text: 'export const a = 1;' },
      { line: 2, text: 'export const b = 2;' },
    ]);
    expect(files[2]!.added).toEqual([{ line: 1, text: 'new' }]);
    expect(files[3]!.copiedFrom).toBe('src/x.ts');
    expect(files[4]!.binary).toBe(true);
    expect(diffFilePath(files[3]!)).toBe('test/x.test.ts');
  });

  it('plain (non-git) diff with two files, and a deletion to /dev/null', () => {
    const files = parse(
      [
        '--- a/src/x.ts\t2026-01-01',
        '+++ b/src/x.ts\t2026-01-02',
        '@@ -1,2 +1,2 @@',
        ' keep',
        '-a',
        '+b',
        '--- a/src/y.ts',
        '+++ /dev/null',
        '@@ -1 +0,0 @@',
        '-gone',
      ].join('\n'),
    );
    expect(files.map((f) => [f.oldPath, f.newPath, f.status])).toEqual([
      ['src/x.ts', 'src/x.ts', 'modified'],
      ['src/y.ts', null, 'deleted'],
    ]);
    expect(files[0]!.added).toEqual([{ line: 2, text: 'b' }]);
    expect(diffFilePath(files[1]!)).toBe('src/y.ts');
  });

  it('header-looking lines inside a hunk are content, and "\\ No newline" is skipped', () => {
    const [f] = parse(
      [
        'diff --git a/src/x.ts b/src/x.ts',
        '--- a/src/x.ts',
        '+++ b/src/x.ts',
        '@@ -1,2 +1,2 @@',
        '--- ../../etc/passwd',
        '\\ No newline at end of file',
        '+++ /etc/passwd',
        ' ',
      ].join('\n'),
    );
    expect(f!.removed[0]!.text).toBe('-- ../../etc/passwd');
    expect(f!.added[0]).toEqual({ line: 1, text: '++ /etc/passwd' });
  });

  it('an empty line inside a hunk counts as context', () => {
    const [f] = parse(
      ['--- a/x.ts', '+++ b/x.ts', '@@ -1,3 +1,3 @@', ' a', '', '-b', '+c'].join('\n'),
    );
    expect(f!.added).toEqual([{ line: 3, text: 'c' }]);
  });
});

describe('parseUnifiedDiff: malformed diffs are rejected, never guessed', () => {
  it.each([
    [['--- a/x', '+++ b/x', '@@ -1 +1 @@', 'garbage', '+b'], /unexpected line inside a hunk/],
    [['--- a/x', '+++ b/x', '@@ -1,2 +1,2 @@', ' a'], /ends before/],
    [['--- a/x', '+++ b/x', '@@ -1 +1 @@', '+a', '+b'], /more added lines/],
    [['--- a/x', '+++ b/x', '@@ -1 +1 @@', '-a', '-b'], /more removed lines/],
    [['--- a/x', '+++ b/x', '@@ -1,1 +1,2 @@', ' a', ' b'], /more context lines/],
    [['@@ -1 +1 @@', '-a', '+b'], /hunk before any file header/],
    [['diff --git a/x y b/x y'], /cannot read the file names/],
    [['just some text'], /touches no files/],
    [[''], /touches no files/],
  ])('%j → %s', (lines, expected) => {
    expect(parseError(lines.join('\n'))).toMatch(expected);
  });
});

describe('changedLines', () => {
  it('adds every added line and both neighbours of a pure deletion', () => {
    const [f] = parse(
      [
        '--- a/x.ts',
        '+++ b/x.ts',
        '@@ -1,5 +1,4 @@',
        ' one',
        ' two',
        '-three',
        ' four',
        '-five',
        '+FIVE',
      ].join('\n'),
    );
    expect([...changedLines(f!)].sort((a, b) => a - b)).toEqual([2, 3, 4]);
  });
});
