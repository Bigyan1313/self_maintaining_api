import { err, ok, type Result } from '../result.js';
import { diffHeaderPath } from '../validate/patch.js';

/** How a diff changes one file. A git copy is reported as `added` (a new file appears). */
export type DiffFileStatus = 'added' | 'modified' | 'deleted' | 'renamed';

/** One added line, numbered in the post-patch file (1-based). */
export interface AddedLine {
  line: number;
  text: string;
}

/** One removed line, numbered in the pre-patch file (1-based). */
export interface RemovedLine {
  line: number;
  text: string;
  /** Post-patch line number of the first line after the removal point. */
  at: number;
}

/** One file in a unified diff, with its changed lines. */
export interface DiffFile {
  /** Path before the change (`null` for an added file). Repository-relative, no `a/` prefix. */
  oldPath: string | null;
  /** Path after the change (`null` for a deleted file). */
  newPath: string | null;
  status: DiffFileStatus;
  added: AddedLine[];
  removed: RemovedLine[];
  /** The diff carries binary content for this file (git `Binary files … differ`). */
  binary: boolean;
  /** Set when git reports the file as a copy of another one. */
  copiedFrom?: string;
}

const GIT_HEADER = /^diff --git ("(?:[^"\\]|\\.)*"|[^\s"]+) ("(?:[^"\\]|\\.)*"|[^\s"]+)$/;
const HUNK = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/;
const COPY_RENAME = /^(rename from|rename to|copy from|copy to) (.+)$/;

interface Building extends DiffFile {
  /** A `---`/`+++` pair was already read for this file. */
  headerSeen: boolean;
}

const blank = (oldPath: string | null, newPath: string | null): Building => ({
  oldPath,
  newPath,
  status: 'modified',
  added: [],
  removed: [],
  binary: false,
  headerSeen: false,
});

/**
 * Parses a unified diff (git format, or plain `---`/`+++`) into files with their added and
 * removed lines (inc09 Part A). Pure.
 *
 * The parser is strict on purpose. Inside a hunk, every line must start with ` `, `+`, `-`
 * or `\`, and the hunk must have exactly the line counts its header promises. Anything else
 * makes the patch malformed, so a guard never reasons about lines it could not read.
 * @param diff - The unified diff text.
 * @returns The files in diff order, or why the diff is malformed.
 */
export function parseUnifiedDiff(diff: string): Result<DiffFile[], string> {
  const files: Building[] = [];
  let cur: Building | null = null;
  let oldLeft = 0;
  let newLeft = 0;
  let oldNo = 0;
  let newNo = 0;
  const lines = diff.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    const where = `line ${i + 1}`;
    if (oldLeft > 0 || newLeft > 0) {
      if (line.startsWith('\\')) continue; // "\ No newline at end of file"
      const c = line[0];
      if (c === '+') {
        if (newLeft <= 0) return err(`${where}: more added lines than the hunk header says`);
        cur!.added.push({ line: newNo, text: line.slice(1) });
        newNo += 1;
        newLeft -= 1;
      } else if (c === '-') {
        if (oldLeft <= 0) return err(`${where}: more removed lines than the hunk header says`);
        cur!.removed.push({ line: oldNo, text: line.slice(1), at: newNo });
        oldNo += 1;
        oldLeft -= 1;
      } else if (c === ' ' || line === '') {
        if (oldLeft <= 0 || newLeft <= 0)
          return err(`${where}: more context lines than the hunk header says`);
        oldNo += 1;
        newNo += 1;
        oldLeft -= 1;
        newLeft -= 1;
      } else {
        return err(`${where}: unexpected line inside a hunk`);
      }
      continue;
    }
    const hunk = HUNK.exec(line);
    if (hunk) {
      if (!cur) return err(`${where}: hunk before any file header`);
      oldNo = Number(hunk[1]);
      newNo = Number(hunk[3]);
      oldLeft = hunk[2] === undefined ? 1 : Number(hunk[2]);
      newLeft = hunk[4] === undefined ? 1 : Number(hunk[4]);
      // A zero-length side names the line *before* the hunk; the next line is one further.
      if (oldLeft === 0) oldNo += 1;
      if (newLeft === 0) newNo += 1;
      continue;
    }
    if (line.startsWith('diff --git ')) {
      const m = GIT_HEADER.exec(line);
      if (!m) return err(`${where}: cannot read the file names in a "diff --git" header`);
      cur = blank(diffHeaderPath(m[1]!), diffHeaderPath(m[2]!));
      files.push(cur);
      continue;
    }
    if (cur && (line.startsWith('GIT binary patch') || /^Binary files .* differ$/.test(line))) {
      cur.binary = true;
      continue;
    }
    if (cur && line.startsWith('new file mode')) {
      cur.status = 'added';
      cur.oldPath = null;
      continue;
    }
    if (cur && line.startsWith('deleted file mode')) {
      cur.status = 'deleted';
      cur.newPath = null;
      continue;
    }
    const cr = COPY_RENAME.exec(line);
    if (cr && cur) {
      const p = diffHeaderPath(cr[2]!);
      if (cr[1] === 'rename from') {
        cur.status = 'renamed';
        cur.oldPath = p;
      } else if (cr[1] === 'rename to') {
        cur.status = 'renamed';
        cur.newPath = p;
      } else if (cr[1] === 'copy from') {
        cur.status = 'added';
        if (p !== null) cur.copiedFrom = p;
        cur.oldPath = null;
      } else {
        cur.status = 'added';
        cur.newPath = p;
      }
      continue;
    }
    if (line.startsWith('--- ') && lines[i + 1]?.startsWith('+++ ')) {
      const oldP = diffHeaderPath(line.slice(4));
      const newP = diffHeaderPath(lines[i + 1]!.slice(4));
      if (!cur || cur.headerSeen) {
        // Plain (non-git) diff: each ---/+++ pair starts a new file.
        cur = blank(oldP, newP);
        cur.status = oldP === null ? 'added' : newP === null ? 'deleted' : 'modified';
        files.push(cur);
      } else {
        if (cur.status !== 'deleted') cur.newPath = newP;
        if (cur.status !== 'added') cur.oldPath = oldP;
        if (oldP === null) cur.status = 'added';
        if (newP === null) cur.status = 'deleted';
      }
      cur.headerSeen = true;
      i += 1;
    }
  }
  if (oldLeft > 0 || newLeft > 0) return err('the last hunk ends before its header says it does');
  if (files.length === 0) return err('the diff touches no files');
  return ok(files.map(({ headerSeen: _seen, ...f }) => f));
}

/**
 * The path a guard should judge a file by: the new path, or the old one for a deletion.
 * @param file - A parsed diff file.
 */
export function diffFilePath(file: DiffFile): string {
  return file.newPath ?? file.oldPath ?? '';
}

/**
 * Post-patch line numbers the patch changed: every added line, plus the line on each side of
 * a pure deletion (where the removed text used to be).
 * @param file - A parsed diff file.
 */
export function changedLines(file: DiffFile): Set<number> {
  const set = new Set<number>(file.added.map((a) => a.line));
  for (const r of file.removed) {
    set.add(r.at);
    if (r.at > 1) set.add(r.at - 1);
  }
  return set;
}
