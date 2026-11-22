import type { ChangeCategory } from '../domain/enums.js';

/** Every branch the system creates starts with this prefix (FR-34, C-02). */
export const DELIVERY_BRANCH_PREFIX = 'sma/';

/** Labels on every pull request the system opens (FR-35). */
export const DELIVERY_LABELS = [
  {
    name: 'machine-generated',
    color: '5319e7',
    description: 'Opened by Self-Maintaining APIs; not written by a person.',
  },
  {
    name: 'awaiting-human-review',
    color: 'fbca04',
    description: 'Validated patch. A person must review it; the tool never merges.',
  },
] as const;

/**
 * Branch name for a run's pull request: `sma/run-<runId>-<category>`.
 * @param runId - Run id (a UUID).
 * @param category - Change category.
 */
export function deliveryBranchName(runId: string, category: ChangeCategory): string {
  return `${DELIVERY_BRANCH_PREFIX}run-${runId}-${category}`;
}

/**
 * Why a branch name may not be created, or `null` when it is safe. A safe name starts with
 * `sma/`, uses only `[A-Za-z0-9._/-]`, has no `..`, empty segment, `.lock` suffix or leading
 * dash, and is not any of the protected (default) branch names (FR-34).
 * @param name - Branch name without `refs/heads/`.
 * @param protectedBranches - Names that must never be written (the default branch).
 */
export function unsafeBranchReason(
  name: string,
  protectedBranches: readonly string[],
): string | null {
  const bare = name.replace(/^refs\/heads\//, '');
  if (protectedBranches.some((b) => b.replace(/^refs\/heads\//, '') === bare))
    return 'branch is the default branch';
  if (!bare.startsWith(DELIVERY_BRANCH_PREFIX))
    return `branch must start with "${DELIVERY_BRANCH_PREFIX}"`;
  if (bare.length > 200) return 'branch name is too long';
  if (!/^[A-Za-z0-9._/-]+$/.test(bare)) return 'branch name has unsupported characters';
  if (
    bare.includes('..') ||
    bare.split('/').some((p) => !p || p.startsWith('.') || p.startsWith('-')) ||
    bare.endsWith('.lock')
  )
    return 'branch name is not a valid git ref';
  return null;
}
