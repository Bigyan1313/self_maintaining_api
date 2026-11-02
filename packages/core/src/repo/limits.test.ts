import { describe, it, expect } from 'vitest';
import { countRepoSize, repoSkipReason, type RepoReader } from './limits.js';

describe('shared repository limits', () => {
  it.each([
    'node_modules/a.ts',
    '.git/a.ts',
    'dist/a.ts',
    'build/a.ts',
    'coverage/a.ts',
    '.env.ts',
    'src/credentials.ts',
    'src/secret.ts',
    '.aws/a.ts',
    'id_rsa',
    'src/key.pem',
    'x.d.ts',
    'notes.md',
    'vitest.config.ts',
  ])('excludes %s', (path) => {
    expect(repoSkipReason(path, 'file')).toBeDefined();
  });
  it('counts selected source, CRLF, blank files; never reads symlinks', async () => {
    const reads: string[] = [];
    const reader: RepoReader = {
      async *entries() {
        yield { path: 'src/a.ts', kind: 'file' };
        yield { path: 'src/b.tsx', kind: 'file' };
        yield { path: 'src/link.ts', kind: 'symlink' };
        yield { path: 'src/x.d.ts', kind: 'file' };
      },
      async read(_root, path) {
        reads.push(path);
        return path.endsWith('a.ts') ? 'a\r\nb\r\n' : '';
      },
    };
    expect(await countRepoSize('/repo', reader)).toMatchObject({
      files: 2,
      lines: 2,
      exceeded: false,
      skipped: [
        { path: 'src/link.ts', reason: 'symbolic link not followed' },
        { path: 'src/x.d.ts', reason: 'declaration file' },
      ],
    });
    expect(reads).toEqual(['src/a.ts', 'src/b.tsx']);
  });
  it.each([
    [200, 100, false],
    [201, 1, true],
    [1, 20001, true],
  ])('enforces both boundaries (%i files, %i lines)', async (files, lines, exceeded) => {
    const reader: RepoReader = {
      async *entries() {
        for (let i = 0; i < files; i++) yield { path: `f${i}.ts`, kind: 'file' };
      },
      async read() {
        return 'x\n'.repeat(lines);
      },
    };
    expect((await countRepoSize('/repo', reader)).exceeded).toBe(exceeded);
  });
});
