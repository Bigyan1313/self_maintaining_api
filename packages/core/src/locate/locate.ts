import { countRepoSize, type RepoReader } from '../repo/limits.js';
import { analyzeSources } from './analyze.js';
import type { LocateResult, LocateTarget } from './types.js';

/** Locate supported calls without executing target code; reads are supplied by infrastructure. */
export async function locateCallSites(
  repoPath: string,
  target: LocateTarget,
  reader: RepoReader,
): Promise<LocateResult> {
  // Reuse the registration selector and cache its reads, so counting and parsing see one snapshot.
  const sources = new Map<string, string>();
  const unreadable = new Set<string>();
  const snapshot: RepoReader = {
    entries: (path) => reader.entries(path),
    async read(root, path) {
      try {
        const text = await reader.read(root, path);
        sources.set(path, text);
        return text;
      } catch {
        unreadable.add(path);
        return '';
      }
    },
  };
  const result: LocateResult = {
    outcome: 'needs_review',
    callSites: [],
    coverage: [],
    unsupported: [],
    reason: 'Repository coverage is incomplete; needs review.',
  };
  let size;
  try {
    size = await countRepoSize(repoPath, snapshot);
  } catch {
    return result;
  }
  result.coverage = size.skipped.map((s) => ({
    filePath: s.path,
    inspected: false,
    skipReason: s.reason,
  }));
  if (size.exceeded) {
    result.limitsExceeded = {
      files: size.files,
      lines: size.lines,
      message: 'Repository exceeds 200 selected TypeScript files or 20,000 source lines.',
    };
    result.reason = result.limitsExceeded.message;
    result.coverage.push(
      ...size.selected.map((filePath) => ({
        filePath,
        inspected: false,
        skipReason: 'repository size limit exceeded',
      })),
    );
    return result;
  }
  const analyzed = analyzeSources(sources, target);
  result.callSites = analyzed.callSites;
  result.unsupported = analyzed.unsupported;
  for (const filePath of size.selected) {
    const skipReason = unreadable.has(filePath)
      ? 'source could not be read'
      : analyzed.invalidFiles.includes(filePath)
        ? 'TypeScript syntax could not be parsed'
        : undefined;
    result.coverage.push({
      filePath,
      inspected: !skipReason,
      ...(skipReason ? { skipReason } : {}),
    });
  }
  result.coverage.sort((a, b) => a.filePath.localeCompare(b.filePath));
  // Expected scope exclusions are documented, not treated as missing supported source.
  const incomplete =
    unreadable.size > 0 ||
    analyzed.invalidFiles.length > 0 ||
    size.skipped.some((s) => s.reason === 'symbolic link not followed');
  if (result.callSites.length) {
    result.outcome = 'affected';
    result.reason =
      'Supported calls to the changed operation were found; coverage limits are listed separately.';
  } else if (!incomplete && result.unsupported.length === 0) {
    result.outcome = 'not_affected';
    result.reason = 'Not affected within supported scope';
  } else
    result.reason =
      'No supported matching call was found, but coverage is incomplete or usage is unsupported; needs review.';
  return result;
}
