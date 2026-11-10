import { Node, Project, SyntaxKind, type SourceFile } from 'ts-morph';
import { changedLines, diffFilePath, type DiffFile } from './diff.js';
import { configPathReason, isTypeScriptPath, testPathReason } from './paths.js';
import { excerpt, verdictFromHits, type GuardVerdict } from './verdict.js';

/** Post-patch text of changed files, keyed by repository-relative path (`/` separators). */
export type PostPatchFiles = Readonly<Record<string, string>>;

const describePath = (f: DiffFile): string =>
  f.status === 'renamed' && f.oldPath !== f.newPath
    ? `${f.oldPath} → ${f.newPath}`
    : diffFilePath(f);

/** Calls that skip, focus, disable or invert tests. Matched on added lines of any file. */
const SKIP_MARKERS: readonly { label: string; re: RegExp }[] = [
  { label: '.skip', re: /\.\s*skip\b\s*[.(`]/ },
  { label: '.only', re: /\.\s*only\b\s*[.(`]/ },
  { label: '.todo', re: /\.\s*todo\b\s*[.(`]/ },
  { label: '.fails', re: /\.\s*fails\b\s*[.(`]/ },
  { label: 'skipIf(', re: /\bskipIf\s*\(/ },
  { label: 'runIf(', re: /\brunIf\s*\(/ },
  { label: 'xit(', re: /\bxit\s*[.(]/ },
  { label: 'xtest(', re: /\bxtest\s*[.(]/ },
  { label: 'xdescribe(', re: /\bxdescribe\s*[.(]/ },
];

/**
 * `test_file_changed` (FR-27): the patch adds, modifies, deletes or renames a test file or
 * test fixture, or any added line in any file skips, focuses or disables tests.
 * @param files - The parsed patch.
 * @returns Every hit; empty when the guard passes.
 */
export function testFileGuard(files: readonly DiffFile[]): string[] {
  const out: string[] = [];
  for (const f of files) {
    const paths = [f.oldPath, f.newPath, f.copiedFrom ?? null].filter(
      (p): p is string => p !== null,
    );
    const reason = paths.map(testPathReason).find((r) => r !== null);
    if (reason) out.push(`${describePath(f)}: ${f.status} (${reason})`);
    for (const a of f.added)
      for (const m of SKIP_MARKERS)
        if (m.re.test(a.text))
          out.push(`${diffFilePath(f)}:${a.line}: adds "${m.label}": ${excerpt(a.text)}`);
  }
  return out;
}

/**
 * `config_changed` (FR-30): the patch touches compiler, test-runner, package, lint/format or
 * CI configuration instead of source code.
 * @param files - The parsed patch.
 * @returns Every hit; empty when the guard passes.
 */
export function configGuard(files: readonly DiffFile[]): string[] {
  const out: string[] = [];
  for (const f of files) {
    const reason = [f.oldPath, f.newPath]
      .filter((p): p is string => p !== null)
      .map(configPathReason)
      .find((r) => r !== null);
    if (reason) out.push(`${describePath(f)}: ${f.status} (${reason})`);
  }
  return out;
}

const SUPPRESSION_COMMENTS: readonly { label: string; re: RegExp }[] = [
  { label: '@ts-ignore', re: /@ts-ignore\b/ },
  { label: '@ts-expect-error', re: /@ts-expect-error\b/ },
  { label: '@ts-nocheck', re: /@ts-nocheck\b/ },
  { label: 'eslint-disable', re: /eslint-disable/ },
];

/** Used only when no post-patch text was supplied for a changed TypeScript file. */
const FALLBACK_PATTERNS: readonly { label: string; re: RegExp }[] = [
  {
    label: 'unchecked "any" type',
    re: /:\s*any\b|\bas\s+any\b|<\s*any\s*>|\bany\s*\[\]|Array<\s*any\s*>|Record<[^>]*,\s*any\s*>/,
  },
  { label: '"as unknown as" cast', re: /\bas\s+unknown\s+as\b/ },
  { label: 'empty catch block', re: /\bcatch\s*(\([^)]*\))?\s*\{\s*\}/ },
];

const isUnknownCast = (node: Node): Node | undefined => {
  if (!Node.isAsExpression(node) && !Node.isTypeAssertion(node)) return undefined;
  let inner: Node = node.getExpression();
  while (Node.isParenthesizedExpression(inner)) inner = inner.getExpression();
  if (!Node.isAsExpression(inner) && !Node.isTypeAssertion(inner)) return undefined;
  const t = inner.getTypeNode();
  return t?.getKind() === SyntaxKind.UnknownKeyword ? t : undefined;
};

/** Syntax-tree checks on one post-patch file, limited to the lines the patch changed. */
function treeHits(sf: SourceFile, path: string, file: DiffFile): string[] {
  const added = new Set(file.added.map((a) => a.line));
  const changed = changedLines(file);
  const lineText = (n: number) => file.added.find((a) => a.line === n)?.text ?? '';
  const out: string[] = [];
  sf.forEachDescendant((node) => {
    if (node.getKind() === SyntaxKind.AnyKeyword) {
      const line = node.getStartLineNumber();
      if (added.has(line))
        out.push(`${path}:${line}: unchecked "any" type: ${excerpt(lineText(line))}`);
      return;
    }
    const unknownType = isUnknownCast(node);
    if (unknownType) {
      const line = unknownType.getStartLineNumber();
      if (added.has(line))
        out.push(`${path}:${line}: "as unknown as" cast: ${excerpt(lineText(line))}`);
      return;
    }
    if (Node.isCatchClause(node)) {
      const block = node.getBlock();
      const empty =
        block.getStatements().length === 0 && block.getText().slice(1, -1).trim() === '';
      if (!empty) return;
      const from = node.getStartLineNumber();
      const to = block.getEndLineNumber();
      for (let l = from; l <= to; l++)
        if (changed.has(l)) {
          out.push(`${path}:${from}: empty catch block: ${excerpt(node.getText())}`);
          break;
        }
    }
  });
  return out;
}

/**
 * `type_suppression` (FR-29), in the **added lines only** of `.ts`/`.tsx`/`.mts`/`.cts`
 * files: `@ts-ignore`, `@ts-expect-error`, `@ts-nocheck` and `eslint-disable` comments, an
 * unchecked `any` (any `any` in a type position), an `as unknown as` cast, or an empty
 * `catch` block that overlaps a changed line.
 *
 * Code checks use the ts-morph syntax tree of the post-patch text, so the word "any" in a
 * string or comment is not a hit, and an old empty `catch` the patch did not touch is not
 * flagged. If a changed TypeScript file has no post-patch text, a regex fallback over its
 * added lines is used instead, so missing text never means "no hits".
 * @param files - The parsed patch.
 * @param postPatchFiles - Post-patch text of the changed files.
 * @returns Every hit; empty when the guard passes.
 */
export function typeSuppressionGuard(
  files: readonly DiffFile[],
  postPatchFiles: PostPatchFiles,
): string[] {
  const out: string[] = [];
  let project: Project | undefined;
  for (const f of files) {
    const path = f.newPath;
    if (
      path === null ||
      !isTypeScriptPath(path) ||
      (f.added.length === 0 && f.removed.length === 0)
    )
      continue;
    for (const a of f.added)
      for (const c of SUPPRESSION_COMMENTS)
        if (c.re.test(a.text))
          out.push(`${path}:${a.line}: "${c.label}" comment: ${excerpt(a.text)}`);
    const text = Object.hasOwn(postPatchFiles, path) ? postPatchFiles[path] : undefined;
    if (text === undefined) {
      for (const a of f.added)
        for (const p of FALLBACK_PATTERNS)
          if (p.re.test(a.text))
            out.push(
              `${path}:${a.line}: ${p.label} (no post-patch text, text match): ${excerpt(a.text)}`,
            );
      continue;
    }
    project ??= new Project({
      useInMemoryFileSystem: true,
      skipAddingFilesFromTsConfig: true,
      skipFileDependencyResolution: true,
    });
    const sf = project.createSourceFile(`/repo/${path}`, text, { overwrite: true });
    out.push(...treeHits(sf, path, f));
  }
  return out;
}

/**
 * Runs the static guards in their fixed order, before any code runs: `test_file_changed`,
 * `config_changed`, `type_suppression` (FR-27, FR-30, FR-29).
 * @param patch - The parsed patch (see `parseUnifiedDiff`).
 * @param postPatchFiles - Post-patch text of the changed TypeScript files.
 * @returns `{ ok: true }`, or the first failing guard plus every hit of every failing guard.
 */
export function runStaticGuards(
  patch: readonly DiffFile[],
  postPatchFiles: PostPatchFiles,
): GuardVerdict {
  return verdictFromHits([
    { guard: 'test_file_changed', evidence: testFileGuard(patch) },
    { guard: 'config_changed', evidence: configGuard(patch) },
    { guard: 'type_suppression', evidence: typeSuppressionGuard(patch, postPatchFiles) },
  ]);
}
