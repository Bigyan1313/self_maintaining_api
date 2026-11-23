import { createHash } from 'node:crypto';
import { lstat, readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import type { Manifest, ManifestEntry } from './types.js';

/** Hash every regular file, in sorted relative-path order, with length-framed paths/content. */
export async function hashFolder(root: string): Promise<string> {
  const rootInfo = await lstat(root);
  if (!rootInfo.isDirectory() || rootInfo.isSymbolicLink()) throw new Error('Unsafe scenario root');
  const files: string[] = [];
  async function walk(relative: string): Promise<void> {
    for (const name of (await readdir(join(root, relative))).sort()) {
      const path = relative ? `${relative}/${name}` : name;
      const info = await lstat(join(root, path));
      if (info.isSymbolicLink()) throw new Error(`Symlink in frozen scenario: ${path}`);
      if (info.isDirectory()) await walk(path);
      else if (info.isFile()) files.push(path);
      else throw new Error(`Non-regular scenario entry: ${path}`);
    }
  }
  await walk('');
  const hash = createHash('sha256');
  for (const path of files.sort()) {
    const bytes = await readFile(join(root, path));
    hash.update(`${Buffer.byteLength(path)}:${path}${bytes.length}:`);
    hash.update(bytes);
  }
  return hash.digest('hex');
}

/** Parse and validate the exact frozen cohort before any evaluator executes scenario code. */
export async function readManifest(root: string): Promise<Manifest> {
  const value = JSON.parse(await readFile(join(root, 'manifest.json'), 'utf8')) as Manifest;
  if (value.schemaVersion !== 1 || !Array.isArray(value.scenarios) || value.scenarios.length !== 20)
    throw new Error('Manifest must contain exactly 20 scenarios');
  const ids = new Set<string>();
  for (const e of value.scenarios) {
    if (
      !/^[a-z][a-z0-9-]+$/.test(e.id) ||
      ids.has(e.id) ||
      !/^[a-f0-9]{64}$/.test(e.sha256) ||
      !/^[a-f0-9]{40}$/.test(e.repoCommit)
    )
      throw new Error('Invalid or duplicate manifest entry');
    ids.add(e.id);
  }
  return value;
}

/** Inc16 must call this before each baseline; changed or missing source is never admissible. */
export async function assertFrozen(root: string, entry: ManifestEntry): Promise<void> {
  if (!/^[a-z][a-z0-9-]+$/.test(entry.id)) throw new Error('Invalid scenario id');
  let hash: string;
  try {
    hash = await hashFolder(join(root, entry.id));
  } catch {
    throw new Error(`${entry.id}: modified after freezing (missing or unsafe file)`);
  }
  if (hash !== entry.sha256) throw new Error(`${entry.id}: modified after freezing`);
}
