import { lstat, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { err, ok, type Result } from '@sma/core';
import {
  applyPatch,
  createWorkingCopy,
  disposeWorkingCopy,
  type WorkcopyError,
  type WorkcopyOptions,
} from './index.js';

/** One file as a patch leaves it. `content: null` means the patch deletes the path. */
export interface PatchedFile {
  /** Repository-relative path. */
  path: string;
  content: string | null;
  /** Git file mode. */
  mode: '100644' | '100755';
}

/**
 * The full contents of every file a stored patch changes, as delivery needs them to build a
 * commit with the Git Data API (FR-33, FR-37).
 *
 * Applies the patch to a fresh isolated working copy of the repository at `commitSha` (the
 * analyzed commit), reads the touched files, and deletes the copy. Only `git apply` runs; no
 * repository code is executed (C-03), and the developer's repository is only read (FR-20).
 * @param repoPath - The developer's repository.
 * @param commitSha - Analyzed commit (git repositories only), or `undefined` for a plain folder.
 * @param patch - The validated unified diff.
 * @param options - Work root.
 */
export async function patchedFilesFromPatch(
  repoPath: string,
  commitSha: string | undefined,
  patch: string,
  options: WorkcopyOptions = {},
): Promise<Result<PatchedFile[], WorkcopyError>> {
  const copy = await createWorkingCopy(repoPath, commitSha, options);
  if (!copy.ok) return copy;
  try {
    const applied = await applyPatch(copy.value.path, patch, options);
    if (!applied.ok) return applied;
    const files = new Map<string, PatchedFile>();
    for (const file of applied.value) {
      if (file.oldPath && file.oldPath !== file.newPath)
        files.set(file.oldPath, { path: file.oldPath, content: null, mode: '100644' });
      if (!file.newPath) continue;
      const abs = join(copy.value.path, file.newPath);
      const stat = await lstat(abs);
      if (!stat.isFile())
        return err({ code: 'patch_invalid', message: `${file.newPath} is not a regular file` });
      files.set(file.newPath, {
        path: file.newPath,
        content: await readFile(abs, 'utf8'),
        mode: stat.mode & 0o111 ? '100755' : '100644',
      });
    }
    return ok([...files.values()]);
  } catch {
    return err({ code: 'workcopy_failed', message: 'could not read the patched files' });
  } finally {
    await disposeWorkingCopy(copy.value.path, options);
  }
}
