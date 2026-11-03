import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, mkdir, writeFile, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { locateCallSites } from '@sma/core';
import { locate } from '../src/pipeline/locate.js';
import { fileSystemRepoReader } from '../src/infra/repo/reader.js';
import { repositories } from '../src/infra/db/schema.js';
import {
  getRunById,
  listCallSites,
  listCoverageEntries,
  listStageResults,
  finishRun,
} from '../src/infra/db/index.js';
import { openTestDb, seedChain } from './db-helpers.js';

const exec = promisify(execFile);
const target = { method: 'GET', path: '/customers/{id}' } as const;
let client: ReturnType<typeof openTestDb>;
const directories: string[] = [];
beforeAll(() => {
  client = openTestDb();
});
afterAll(async () => {
  await client.close();
  await Promise.all(directories.map((path) => rm(path, { recursive: true, force: true })));
});
async function fixture() {
  const repoPath = await mkdtemp(join(tmpdir(), 'sma-locate-'));
  directories.push(repoPath);
  await mkdir(join(repoPath, 'src'));
  await writeFile(join(repoPath, 'src/a.ts'), 'fetch("/customers/123");\nfetch(buildUrl());\n');
  await writeFile(join(repoPath, 'src/readme.md'), 'Excluded from TypeScript analysis.');
  await exec('git', ['init', repoPath]);
  await exec('git', ['-C', repoPath, 'add', '.']);
  await exec('git', [
    '-C',
    repoPath,
    '-c',
    'user.name=Test',
    '-c',
    'user.email=test@example.test',
    '-c',
    'core.hooksPath=/dev/null',
    '-c',
    'commit.gpgsign=false',
    'commit',
    '-m',
    'fixture',
  ]);
  const chain = await seedChain(client);
  await client.db
    .update(repositories)
    .set({ localPath: repoPath })
    .where(eq(repositories.id, chain.repository.id));
  return { repoPath, ...chain };
}

describe('Locate persistence', () => {
  it('records the real commit, source positions, coverage and unsupported evidence atomically', async () => {
    const { repoPath, run } = await fixture();
    const result = await locate(client.db, run.id, repoPath, target);
    expect(result.outcome).toBe('affected');
    const sites = await listCallSites(client.db, run.id);
    expect(sites).toHaveLength(1);
    expect(sites[0]).toMatchObject({ filePath: 'src/a.ts', line: 1, column: 1, pattern: 'fetch' });
    expect(await listCoverageEntries(client.db, run.id)).toContainEqual(
      expect.objectContaining({ filePath: 'src/readme.md', inspected: false }),
    );
    const { stdout } = await exec('git', ['-C', repoPath, 'rev-parse', 'HEAD']);
    expect((await getRunById(client.db, run.id))?.commitSha).toBe(stdout.trim());
    const stages = await listStageResults(client.db, run.id);
    expect(stages).toHaveLength(1);
    expect(stages[0]?.result).toMatchObject({ commitSha: stdout.trim(), locate: result });
    expect(result.unsupported[0]?.kind).toBe('dynamic_url');
  });
  it('serializes concurrent requests and does not duplicate append-only evidence', async () => {
    const { repoPath, run } = await fixture();
    const results = await Promise.all([
      locate(client.db, run.id, repoPath, target),
      locate(client.db, run.id, repoPath, target),
    ]);
    expect(results[0]).toEqual(results[1]);
    expect(await listCallSites(client.db, run.id)).toHaveLength(1);
    expect(await listStageResults(client.db, run.id)).toHaveLength(1);
    await expect(
      locate(client.db, run.id, repoPath, { ...target, path: '/different' }),
    ).rejects.toThrow('different target');
  });
  it('rejects dirty repositories without partial writes', async () => {
    const { repoPath, run } = await fixture();
    await writeFile(join(repoPath, 'src/new.ts'), 'fetch("/customers/1");');
    await expect(locate(client.db, run.id, repoPath, target)).rejects.toThrow('repository changes');
    expect(await listCallSites(client.db, run.id)).toEqual([]);
    expect(await listStageResults(client.db, run.id)).toEqual([]);
  });
  it('rolls back if source changes during analysis', async () => {
    const { repoPath, run } = await fixture();
    await expect(
      locate(client.db, run.id, repoPath, target, {
        reader: {
          ...fileSystemRepoReader,
          async read(root, path) {
            const text = await fileSystemRepoReader.read(root, path);
            await writeFile(join(root, path), text + '\n// changed');
            return text;
          },
        },
      }),
    ).rejects.toThrow('repository changes');
    expect(await listCallSites(client.db, run.id)).toEqual([]);
    expect((await getRunById(client.db, run.id))?.commitSha).toBe(run.commitSha);
  });
  it('rejects a foreign repository or finished run', async () => {
    const first = await fixture();
    const second = await fixture();
    await expect(locate(client.db, first.run.id, second.repoPath, target)).rejects.toThrow(
      'does not belong',
    );
    await finishRun(client.db, first.run.id, { status: 'not_affected' });
    await expect(locate(client.db, first.run.id, first.repoPath, target)).rejects.toThrow(
      'finished run',
    );
  });
  it('never follows real symbolic links and records exclusions', async () => {
    const { repoPath } = await fixture();
    await symlink('a.ts', join(repoPath, 'src/link.ts'));
    await writeFile(join(repoPath, 'src/.env'), 'not source');
    await mkdir(join(repoPath, 'node_modules'));
    await writeFile(join(repoPath, 'node_modules/hidden.ts'), 'fetch("/customers/1");');
    const result = await locateCallSites(repoPath, target, fileSystemRepoReader);
    expect(result.callSites).toHaveLength(1);
    expect(result.coverage).toContainEqual({
      filePath: 'src/link.ts',
      inspected: false,
      skipReason: 'symbolic link not followed',
    });
    expect(result.coverage.find((e) => e.filePath === 'src/.env')?.inspected).toBe(false);
    expect(result.coverage.find((e) => e.filePath === 'node_modules')?.inspected).toBe(false);
  });
});
