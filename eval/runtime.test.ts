import { expect, it } from 'vitest';
import { execFile } from 'node:child_process';
import { readFile, rm } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { promisify } from 'node:util';
import type { SpecDifference } from '@sma/core';
import type { Change } from '../apps/server/src/infra/db/index.js';
import { committedCopy, detectionLabel, admit } from './runtime.js';
const exec = promisify(execFile);
const difference = (details: Record<string, unknown>): SpecDifference => ({
  id: 'd',
  ruleId: 'rule',
  level: 'info',
  path: '/x',
  method: 'GET',
  jsonPointer: '',
  description: '',
  details,
  evidenceBefore: null,
  evidenceAfter: null,
});
const root = fileURLToPath(new URL('../scenarios', import.meta.url));
const manifest = JSON.parse(await readFile(join(root, 'manifest.json'), 'utf8'));
it('materializes exactly the frozen commit and never changes the source', async () => {
  const entry = manifest.scenarios.find((e: { id: string }) => e.id === 'rename-shop-flat');
  const dir = await committedCopy(join(root, entry.id, 'repo'), entry.repoCommit);
  try {
    expect((await exec('git', ['-C', dir, 'rev-parse', 'HEAD'])).stdout.trim()).toBe(
      entry.repoCommit,
    );
    expect(await readFile(join(dir, 'src/consumer.ts'), 'utf8')).toBe(
      await readFile(join(root, entry.id, 'repo/src/consumer.ts'), 'utf8'),
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
  await expect(committedCopy(join(root, entry.id, 'repo'), '0'.repeat(40))).rejects.toThrow(
    'differs from frozen commit',
  );
});
it('maps real parser detail identities without reading ground truth', () => {
  const c = {
    method: 'GET',
    path: '/x',
    category: 'field_renamed',
    classification: 'breaking',
  } as Change;
  expect(detectionLabel(c, difference({ propertyPath: ['nested', 'old'] })).field).toBe(
    'nested/old',
  );
  expect(detectionLabel(c, difference({ paramName: 'q', paramIn: 'query' }))).toMatchObject({
    parameter: 'q',
    location: 'query',
  });
  expect(detectionLabel(c).field).toBeUndefined();
});
it('excludes a modified frozen hash before any container/model execution', async () => {
  const entry = { ...manifest.scenarios[0], sha256: '0'.repeat(64) };
  expect(await admit(root, entry)).toMatchObject({
    admissible: false,
    reason: expect.stringContaining('modified after freezing'),
  });
});
