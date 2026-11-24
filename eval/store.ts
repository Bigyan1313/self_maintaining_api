import { mkdir, readFile, rename, writeFile, open, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { scrubDeep, knownSecrets } from '../apps/server/src/pipeline/run-detail.js';
import { EvaluationStudySchema, type EvaluationStudy } from '@sma/core';
/** Validate labels before using them as a path segment. */
export function studyDirectory(root: string, label: string): string {
  if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,79}$/.test(label)) throw new Error('Invalid evaluation label');
  return join(root, label);
}
/** Durable file first, then DB mirror. A failed mirror is repaired by resume/review. */
export async function saveStudy(
  root: string,
  study: EvaluationStudy,
  mirror: (s: EvaluationStudy) => Promise<void>,
): Promise<void> {
  const value = EvaluationStudySchema.parse(scrubDeep(study, knownSecrets(process.env)));
  const dir = studyDirectory(root, value.label);
  await mkdir(dir, { recursive: true });
  const temp = join(dir, 'results.json.tmp');
  await writeFile(temp, JSON.stringify(value, null, 2) + '\n', { mode: 0o600 });
  const handle = await open(temp, 'r');
  try {
    await handle.sync();
  } finally {
    await handle.close();
  }
  await rename(temp, join(dir, 'results.json'));
  await mirror(value);
}
/** Read the versioned artifact, rejecting unsupported/corrupt data. */
export async function readStudy(root: string, label: string): Promise<EvaluationStudy> {
  return EvaluationStudySchema.parse(
    JSON.parse(await readFile(join(studyDirectory(root, label), 'results.json'), 'utf8')),
  );
}
/** Single writer per label. A dead local process lock can be reclaimed on resume. */
export async function lockStudy(root: string, label: string): Promise<() => Promise<void>> {
  const dir = studyDirectory(root, label);
  await mkdir(dir, { recursive: true });
  const file = join(dir, '.lock');
  try {
    const handle = await open(file, 'wx', 0o600);
    await handle.writeFile(String(process.pid));
    await handle.close();
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== 'EEXIST') throw e;
    const pid = Number(await readFile(file, 'utf8'));
    if (!Number.isSafeInteger(pid) || pid <= 0)
      throw new Error('Invalid evaluation lock; inspect .lock', { cause: e });
    try {
      process.kill(pid, 0);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ESRCH') {
        await rm(file);
        return lockStudy(root, label);
      }
      throw error;
    }
    throw new Error('This evaluation label already has an active writer', { cause: e });
  }
  return () => rm(file, { force: true });
}
