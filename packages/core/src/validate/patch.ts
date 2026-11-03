import { err, ok, type Result } from '../result.js';

/** How a patch changes one file. */
export type PatchFileChange = 'added' | 'deleted' | 'modified' | 'renamed' | 'copied';

/** One file touched by a unified diff. Paths are repository-relative, without `a/` or `b/`. */
export interface PatchFile {
  /** Path before the change, or `null` for an added file. */
  oldPath: string | null;
  /** Path after the change, or `null` for a deleted file. */
  newPath: string | null;
  change: PatchFileChange;
}

/** Why a patch was rejected before it was applied. */
export interface PatchRejection {
  reason: string;
}

const ESCAPES: Record<string, number> = {
  n: 10,
  t: 9,
  r: 13,
  '"': 34,
  '\\': 92,
  a: 7,
  b: 8,
  f: 12,
  v: 11,
};

/**
 * Decodes a git C-style quoted path (`"a/x\tb"`); other tokens are returned unchanged.
 * @param raw - The token as it appears in the diff header.
 */
function unquote(raw: string): string {
  if (!(raw.length >= 2 && raw.startsWith('"') && raw.endsWith('"'))) return raw;
  const encoder = new TextEncoder();
  const bytes: number[] = [];
  const body = raw.slice(1, -1);
  for (let i = 0; i < body.length; i++) {
    const ch = body[i]!;
    if (ch !== '\\') {
      bytes.push(...encoder.encode(ch));
      continue;
    }
    const next = body[i + 1] ?? '';
    if (/[0-7]/.test(next)) {
      const oct = /^[0-7]{1,3}/.exec(body.slice(i + 1))![0];
      bytes.push(parseInt(oct, 8));
      i += oct.length;
    } else {
      bytes.push(ESCAPES[next] ?? next.charCodeAt(0));
      i += 1;
    }
  }
  return new TextDecoder().decode(new Uint8Array(bytes));
}

/** Drops a trailing tab-separated timestamp and the `a/` or `b/` prefix; `/dev/null` → `null`. */
function headerPath(raw: string): string | null {
  const token = unquote(raw.split('\t')[0]!.trim());
  if (token === '/dev/null') return null;
  return token.replace(/^[ab]\//, '');
}

/**
 * Checks that a path stays inside the repository: not empty, not absolute, no `..` segment,
 * nothing under `.git`, and no control characters.
 * @param path - Repository-relative path from the diff.
 * @returns Why the path is unsafe, or `null` if it is fine.
 */
export function unsafePathReason(path: string): string | null {
  if (path === '') return 'empty path';
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f\u007f]/.test(path))
    return `control character in path ${JSON.stringify(path)}`;
  if (/^([/\\~]|[A-Za-z]:)/.test(path)) return `absolute path "${path}"`;
  const segments = path.split(/[\\/]/);
  if (segments.includes('..')) return `path "${path}" leaves the repository`;
  if (segments.some((s) => s.toLowerCase() === '.git')) return `path "${path}" is inside .git`;
  return null;
}

const GIT_HEADER = /^diff --git ("(?:[^"\\]|\\.)*"|[^\s"]+) ("(?:[^"\\]|\\.)*"|[^\s"]+)$/;
const MODE_LINE = /^(?:new file mode|deleted file mode|old mode|new mode) (\d+)$/;
const INDEX_LINE = /^index [0-9a-f]+\.\.[0-9a-f]+(?: (\d+))?$/;
const HUNK = /^@@ -\d+(?:,(\d+))? \+\d+(?:,(\d+))? @@/;
const COPY_RENAME = /^(rename from|rename to|copy from|copy to) (.+)$/;

interface Entry {
  oldPath: string | null;
  newPath: string | null;
  change: PatchFileChange;
}

/**
 * Lists the files a unified diff touches, and rejects a patch that is unsafe to apply: a path
 * outside the repository (`..`, absolute), a path under `.git`, binary content, a symbolic
 * link, or a submodule entry.
 *
 * This is the first of two independent checks. `git apply --check` (without `--unsafe-paths`)
 * runs after it.
 * @param diff - The unified diff text (git format or plain `---`/`+++`).
 * @returns The touched files, or why the patch was rejected.
 */
export function inspectPatch(diff: string): Result<PatchFile[], PatchRejection> {
  if (diff.includes('\u0000')) return err({ reason: 'patch contains NUL bytes (binary content)' });
  const files: Entry[] = [];
  const paths: string[] = [];
  let current: Entry | null = null;
  // Lines still expected in the current hunk (old side, new side); headers are only read outside.
  let oldLeft = 0;
  let newLeft = 0;
  const lines = diff.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    if (oldLeft > 0 || newLeft > 0) {
      if (line.startsWith('\\')) continue; // "\ No newline at end of file"
      if (line.startsWith('-')) oldLeft -= 1;
      else if (line.startsWith('+')) newLeft -= 1;
      else {
        oldLeft -= 1;
        newLeft -= 1;
      }
      continue;
    }
    const hunk = HUNK.exec(line);
    if (hunk) {
      oldLeft = hunk[1] === undefined ? 1 : Number(hunk[1]);
      newLeft = hunk[2] === undefined ? 1 : Number(hunk[2]);
      continue;
    }
    if (line.startsWith('diff --git ')) {
      const m = GIT_HEADER.exec(line);
      if (!m) return err({ reason: 'cannot read the file names in a "diff --git" header' });
      current = { oldPath: headerPath(m[1]!), newPath: headerPath(m[2]!), change: 'modified' };
      files.push(current);
      continue;
    }
    if (line.startsWith('GIT binary patch') || /^Binary files .* differ$/.test(line))
      return err({ reason: 'patch contains binary content' });
    const mode = MODE_LINE.exec(line)?.[1] ?? INDEX_LINE.exec(line)?.[1];
    if (mode === '120000') return err({ reason: 'patch creates or changes a symbolic link' });
    if (mode === '160000') return err({ reason: 'patch changes a submodule' });
    if (current && line.startsWith('new file mode')) {
      current.change = 'added';
      current.oldPath = null;
    } else if (current && line.startsWith('deleted file mode')) {
      current.change = 'deleted';
      current.newPath = null;
    }
    const cr = COPY_RENAME.exec(line);
    if (cr && current) {
      const p = headerPath(cr[2]!) ?? '';
      const [verb, side] = cr[1]!.split(' ') as ['rename' | 'copy', 'from' | 'to'];
      current.change = verb === 'rename' ? 'renamed' : 'copied';
      if (side === 'from') current.oldPath = p;
      else current.newPath = p;
      paths.push(p);
      continue;
    }
    if (line.startsWith('--- ') && lines[i + 1]?.startsWith('+++ ')) {
      const oldP = headerPath(line.slice(4));
      const newP = headerPath(lines[i + 1]!.slice(4));
      if (oldP !== null) paths.push(oldP);
      if (newP !== null) paths.push(newP);
      if (!current) {
        // Plain (non-git) diff: each ---/+++ pair starts a new file.
        files.push({
          oldPath: oldP,
          newPath: newP,
          change: oldP === null ? 'added' : newP === null ? 'deleted' : 'modified',
        });
      } else {
        if (current.change !== 'deleted') current.newPath = newP;
        if (current.change !== 'added') current.oldPath = oldP;
      }
      i += 1;
      continue;
    }
  }
  for (const f of files)
    paths.push(...[f.oldPath, f.newPath].filter((p): p is string => p !== null));
  for (const p of paths) {
    const reason = unsafePathReason(p);
    if (reason) return err({ reason });
  }
  if (files.length === 0) return err({ reason: 'patch touches no files' });
  return ok(files.map((f) => ({ ...f })));
}
