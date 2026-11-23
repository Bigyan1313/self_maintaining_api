import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { parse } from 'yaml';
import { classify, locateCallSites, parseMigrationNote, parseOasdiffChangelog } from '@sma/core';
import { runOasdiff } from '../apps/server/src/infra/oasdiff/runner.js';
import { fileSystemRepoReader } from '../apps/server/src/infra/repo/reader.js';

/** Require real oasdiff detection and a supported call site for the intended breaking change. */
export async function auditScenario(
  folder: string,
): Promise<{ detected: number; located: number }> {
  const metadata = parse(await readFile(join(folder, 'scenario.yaml'), 'utf8'));
  const before = parse(await readFile(join(folder, 'specs/before.yaml'), 'utf8'));
  const after = parse(await readFile(join(folder, 'specs/after.yaml'), 'utf8'));
  const raw = await runOasdiff(before, after);
  if (!raw.ok) throw new Error(raw.error.message);
  const differences = parseOasdiffChangelog(raw.value, { before, after });
  if (!differences.ok) throw new Error(differences.error.message);
  let note = null;
  try {
    const parsed = parseMigrationNote(await readFile(join(folder, 'migration-note.yaml'), 'utf8'));
    if (!parsed.ok) throw new Error('Invalid scenario migration note');
    note = parsed.value;
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e;
  }
  const changes = classify(differences.value, note);
  const intended = changes.filter(
    (c) => c.category === metadata.category && c.classification === 'breaking',
  );
  if (intended.length === 0)
    throw new Error(
      `Intended ${metadata.category} change not detected/classified: ${JSON.stringify(changes.map((c) => ({ rule: c.difference.ruleId, category: c.category, details: c.difference.details })))}`,
    );
  if (
    intended.some(
      (c) =>
        c.mappingStatus !== (metadata.expected.outcome === 'refuse' ? 'unconfirmed' : 'confirmed'),
    )
  )
    throw new Error('Migration mapping does not support expected repair/refusal');
  const located = await locateCallSites(
    join(folder, 'repo'),
    metadata.target,
    fileSystemRepoReader,
  );
  if (located.callSites.length === 0) throw new Error('No supported call site found');
  const patterns = new Set(located.callSites.map((s) => s.pattern));
  for (const pattern of metadata.callPatterns)
    if (!patterns.has(pattern)) throw new Error(`Declared pattern ${pattern} not located`);
  return { detected: differences.value.length, located: located.callSites.length };
}
