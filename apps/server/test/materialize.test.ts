/** Rebuilding patched files from a stored patch (FR-37). Only git apply runs; no Docker. */
import { readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { expect, it } from 'vitest';
import { patchedFilesFromPatch } from '../src/infra/workcopy/materialize.js';
import { CORRECT_PATCH, consumer } from './repair-helpers.js';

it('returns the full patched contents and leaves no working copy behind', async () => {
  const workRoot = await mkdtemp(join(tmpdir(), 'sma-materialize-'));
  const out = await patchedFilesFromPatch(consumer, undefined, CORRECT_PATCH, { workRoot });
  expect(out.ok).toBe(true);
  if (!out.ok) return;
  expect(out.value.map((f) => f.path)).toEqual(['src/customers.ts']);
  expect(out.value[0]!.content).toContain('full_name');
  expect(out.value[0]!.content).not.toContain('customer.customer_name');
  expect(out.value[0]!.mode).toBe('100644');
  expect(await readdir(workRoot)).toEqual([]);
});

it('a patch that does not apply is patch_invalid', async () => {
  const workRoot = await mkdtemp(join(tmpdir(), 'sma-materialize-'));
  const bad = CORRECT_PATCH.replace(/customer_name/g, 'nope_name');
  const out = await patchedFilesFromPatch(consumer, undefined, bad, { workRoot });
  expect(out).toMatchObject({ ok: false, error: { code: 'patch_invalid' } });
  expect(await readdir(workRoot)).toEqual([]);
});
