import { describe, expect, it } from 'vitest';
import { inspectPatch, unsafePathReason } from './patch.js';

const modify = (path: string) =>
  [
    `diff --git a/${path} b/${path}`,
    `--- a/${path}`,
    `+++ b/${path}`,
    '@@ -1,2 +1,2 @@',
    ' keep',
    '-old',
    '+new',
    '',
  ].join('\n');

const reason = (diff: string) => {
  const r = inspectPatch(diff);
  return r.ok ? null : r.error.reason;
};

describe('inspectPatch: accepted patches', () => {
  it('lists a modified file', () => {
    expect(inspectPatch(modify('src/orders.ts'))).toEqual({
      ok: true,
      value: [{ oldPath: 'src/orders.ts', newPath: 'src/orders.ts', change: 'modified' }],
    });
  });

  it('lists added, deleted and renamed files in one patch', () => {
    const diff = [
      'diff --git a/src/new.ts b/src/new.ts',
      'new file mode 100644',
      '--- /dev/null',
      '+++ b/src/new.ts',
      '@@ -0,0 +1 @@',
      '+export const x = 1;',
      'diff --git a/src/old.ts b/src/old.ts',
      'deleted file mode 100644',
      '--- a/src/old.ts',
      '+++ /dev/null',
      '@@ -1 +0,0 @@',
      '-export const y = 2;',
      'diff --git a/src/a.ts b/src/b.ts',
      'similarity index 100%',
      'rename from src/a.ts',
      'rename to src/b.ts',
      '',
    ].join('\n');
    expect(inspectPatch(diff)).toEqual({
      ok: true,
      value: [
        { oldPath: null, newPath: 'src/new.ts', change: 'added' },
        { oldPath: 'src/old.ts', newPath: null, change: 'deleted' },
        { oldPath: 'src/a.ts', newPath: 'src/b.ts', change: 'renamed' },
      ],
    });
  });

  it('reads a plain (non-git) unified diff', () => {
    const diff = [
      '--- a/src/x.ts\t2026-01-01',
      '+++ b/src/x.ts\t2026-01-02',
      '@@ -1 +1 @@',
      '-a',
      '+b',
    ].join('\n');
    expect(inspectPatch(diff)).toEqual({
      ok: true,
      value: [{ oldPath: 'src/x.ts', newPath: 'src/x.ts', change: 'modified' }],
    });
  });

  it('does not mistake hunk content that looks like a header for a header', () => {
    const diff = [
      'diff --git a/src/x.ts b/src/x.ts',
      '--- a/src/x.ts',
      '+++ b/src/x.ts',
      '@@ -1,2 +1,2 @@',
      '--- ../../etc/passwd',
      '+++ /etc/passwd',
      '',
    ].join('\n');
    expect(inspectPatch(diff).ok).toBe(true);
  });

  it('decodes quoted file names', () => {
    const r = inspectPatch(
      [
        'diff --git "a/src/a b.ts" "b/src/a b.ts"',
        '--- "a/src/a b.ts"',
        '+++ "b/src/a b.ts"',
        '@@ -1 +1 @@',
        '-a',
        '+b',
      ].join('\n'),
    );
    expect(r.ok && r.value[0]!.newPath).toBe('src/a b.ts');
  });
});

describe('inspectPatch: rejected patches (patch_invalid)', () => {
  it('rejects ../ paths, in any header', () => {
    expect(reason(modify('../outside.ts'))).toMatch(/leaves the repository/);
    expect(reason(modify('src/../../outside.ts'))).toMatch(/leaves the repository/);
    expect(
      reason(
        ['diff --git a/src/a.ts b/src/a.ts', 'rename from src/a.ts', 'rename to ../a.ts'].join(
          '\n',
        ),
      ),
    ).toMatch(/leaves the repository/);
    expect(
      reason(['--- a/src/x.ts', '+++ b/../x.ts', '@@ -1 +1 @@', '-a', '+b'].join('\n')),
    ).toMatch(/leaves the repository/);
  });

  it('rejects absolute paths', () => {
    expect(
      reason(['--- /etc/hosts', '+++ /etc/hosts', '@@ -1 +1 @@', '-a', '+b'].join('\n')),
    ).toMatch(/absolute/);
    expect(reason(modify('/etc/hosts').replace('a//etc', 'a/etc'))).not.toBeNull();
  });

  it('rejects quoted paths that decode to ..', () => {
    expect(
      reason(
        [
          'diff --git "a/\\056\\056/x" "b/\\056\\056/x"',
          '--- "a/\\056\\056/x"',
          '+++ "b/\\056\\056/x"',
        ].join('\n'),
      ),
    ).toMatch(/leaves the repository/);
  });

  it('rejects anything under .git', () => {
    expect(reason(modify('.git/hooks/post-checkout'))).toMatch(/inside \.git/);
    expect(reason(modify('sub/.GIT/config'))).toMatch(/inside \.git/);
  });

  it('rejects binary patches', () => {
    expect(
      reason(['diff --git a/x.png b/x.png', 'GIT binary patch', 'literal 1', 'zcmV'].join('\n')),
    ).toMatch(/binary/);
    expect(
      reason(['diff --git a/x.png b/x.png', 'Binary files a/x.png and b/x.png differ'].join('\n')),
    ).toMatch(/binary/);
    expect(reason(`${modify('src/x.ts')}\u0000`)).toMatch(/NUL/);
  });

  it('rejects symlinks and submodules', () => {
    expect(
      reason(
        [
          'diff --git a/link b/link',
          'new file mode 120000',
          '--- /dev/null',
          '+++ b/link',
          '@@ -0,0 +1 @@',
          '+/etc',
        ].join('\n'),
      ),
    ).toMatch(/symbolic link/);
    expect(reason(['diff --git a/l b/l', 'index 1111111..2222222 120000'].join('\n'))).toMatch(
      /symbolic link/,
    );
    expect(reason(['diff --git a/m b/m', 'new file mode 160000'].join('\n'))).toMatch(/submodule/);
  });

  it('rejects an empty patch and an unreadable header', () => {
    expect(reason('')).toMatch(/no files/);
    expect(reason('hello\n')).toMatch(/no files/);
    expect(reason('diff --git a/x y b/x y\n')).toMatch(/cannot read/);
  });
});

describe('unsafePathReason', () => {
  it.each([
    ['src/a.ts', null],
    ['a..b/c.ts', null],
    ['.github/x.yml', null],
    ['', 'empty path'],
    ['C:/x', 'absolute'],
    ['\\\\server\\share', 'absolute'],
    ['~/x', 'absolute'],
    ['a\\..\\b', 'leaves'],
    ['a\nb', 'control'],
  ])('%j → %s', (path, expected) => {
    const r = unsafePathReason(path);
    if (expected === null) expect(r).toBeNull();
    else expect(r).toContain(expected);
  });
});
