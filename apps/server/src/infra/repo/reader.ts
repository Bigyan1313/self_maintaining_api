import { lstat, readdir, open } from 'node:fs/promises';
import { constants } from 'node:fs';
import { resolve, join } from 'node:path';
import { repoSkipReason, type RepoEntry, type RepoReader } from '@sma/core';

/** Filesystem adapter: excludes directories before descent and does not follow symbolic links. */
export const fileSystemRepoReader: RepoReader = {
  async *entries(repoPath) {
    const root = resolve(repoPath);
    if (!(await lstat(root)).isDirectory())
      throw new Error('Repository must be a directory, not a symlink');
    async function* walk(relative: string): AsyncIterable<RepoEntry> {
      for (const name of (await readdir(join(root, relative))).sort()) {
        const path = relative ? `${relative}/${name}` : name;
        const stat = await lstat(join(root, path));
        const kind = stat.isSymbolicLink() ? 'symlink' : stat.isDirectory() ? 'directory' : 'file';
        yield { path, kind };
        if (kind === 'directory' && !repoSkipReason(path, kind)) yield* walk(path);
      }
    }
    yield* walk('');
  },
  async read(repoPath, path) {
    const file = await open(join(repoPath, path), constants.O_RDONLY | constants.O_NOFOLLOW);
    try {
      if (!(await file.stat()).isFile()) throw new Error('Source must be a regular file');
      return await file.readFile('utf8');
    } finally {
      await file.close();
    }
  },
};
