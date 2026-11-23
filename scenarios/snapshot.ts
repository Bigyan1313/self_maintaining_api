import { execFile } from 'node:child_process';
import { cp, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
const exec = promisify(execFile);

/** Materialize a reproducible Git snapshot in a disposable copy, without changing repo/. */
export async function snapshotCommit(repo: string): Promise<string> {
  const temp = await mkdtemp(join(tmpdir(), 'sma-snapshot-'));
  const dir = join(temp, 'repo');
  const env = {
    PATH: process.env.PATH,
    GIT_CONFIG_NOSYSTEM: '1',
    GIT_CONFIG_GLOBAL: '/dev/null',
    GIT_AUTHOR_NAME: 'SMA scenarios',
    GIT_COMMITTER_NAME: 'SMA scenarios',
    GIT_AUTHOR_EMAIL: 'scenarios@example.invalid',
    GIT_COMMITTER_EMAIL: 'scenarios@example.invalid',
    GIT_AUTHOR_DATE: '2000-01-01T00:00:00Z',
    GIT_COMMITTER_DATE: '2000-01-01T00:00:00Z',
  };
  async function git(...args: string[]): Promise<string> {
    return (
      await exec('git', ['-c', 'core.hooksPath=/dev/null', '-c', 'core.autocrlf=false', ...args], {
        cwd: dir,
        env,
      })
    ).stdout.trim();
  }
  try {
    await cp(repo, dir, { recursive: true });
    await git('init', '--quiet', '--object-format=sha1', '--initial-branch=main');
    await git('add', '--all');
    await git('commit', '--quiet', '--no-gpg-sign', '-m', 'Frozen scenario consumer v1');
    return await git('rev-parse', 'HEAD');
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
}
