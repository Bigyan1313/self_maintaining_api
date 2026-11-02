/** Shared file selection limits for registration and the future locator. */
export const REPO_LIMITS = { files: 200, lines: 20_000 } as const;
/** File metadata supplied by the infrastructure adapter; symlinks are never followed. */
export interface RepoEntry {
  path: string;
  kind: 'file' | 'directory' | 'symlink';
}
/** Dependency-injected reader keeps core independent of the filesystem. Paths are repo-relative. */
export interface RepoReader {
  entries(repoPath: string): AsyncIterable<RepoEntry>;
  read(repoPath: string, relativePath: string): Promise<string>;
}
/** Selection/coverage metadata, shared with Increment 07. */
export interface RepoSize {
  files: number;
  lines: number;
  exceeded: boolean;
  selected: string[];
  skipped: { path: string; reason: string }[];
}
/** Exclusion reason, or undefined for a supported TypeScript file/directory. */
export function repoSkipReason(path: string, kind: RepoEntry['kind']): string | undefined {
  if (kind === 'symlink') return 'symbolic link not followed';
  const parts = path.replaceAll('\\', '/').split('/');
  if (
    parts.some((p) =>
      ['node_modules', '.git', 'dist', 'build', 'coverage', '.ssh', '.aws', '.config'].includes(p),
    )
  )
    return 'dependency, metadata, configuration or build output';
  const name = parts.at(-1) ?? '';
  if (
    parts.some(
      (p) =>
        /^\.env/i.test(p) ||
        /credential|secret|(?:^|[._-])(?:token|private[-_]?key)(?:[._-]|$)/i.test(p),
    ) ||
    /\.(pem|key|p12|pfx)$/i.test(name) ||
    /^id_(rsa|ed25519|ecdsa)/.test(name)
  )
    return 'credential or environment file';
  if (kind === 'directory') return undefined;
  if (/\.d\.ts$/.test(name)) return 'declaration file';
  if (!/\.tsx?$/.test(name)) return 'not TypeScript source';
  if (/(?:^|[.])config\.[cm]?tsx?$/.test(name)) return 'configuration file';
  return undefined;
}
/** Count selected source with the same rules as Locate; reader must not traverse symlinks. */
export async function countRepoSize(repoPath: string, reader: RepoReader): Promise<RepoSize> {
  const result: RepoSize = { files: 0, lines: 0, exceeded: false, selected: [], skipped: [] };
  for await (const entry of reader.entries(repoPath)) {
    const reason = repoSkipReason(entry.path, entry.kind);
    if (reason) {
      result.skipped.push({ path: entry.path, reason });
      continue;
    }
    if (entry.kind !== 'file') continue;
    const text = await reader.read(repoPath, entry.path);
    result.files++;
    result.lines +=
      text.length === 0 ? 0 : text.split(/\r\n|\r|\n/).length - (/\r$|\n$/.test(text) ? 1 : 0);
    result.selected.push(entry.path);
  }
  result.exceeded = result.files > REPO_LIMITS.files || result.lines > REPO_LIMITS.lines;
  return result;
}
