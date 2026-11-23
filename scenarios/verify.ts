import { execFile } from 'node:child_process';
import { cp, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from 'yaml';
import { buildValidationResult, type CommandRun, type ValidationResult } from '@sma/core';
import { installDependencies, runChecks } from '../apps/server/src/infra/validator/sandbox.js';
import { createWorkingCopy, disposeWorkingCopy } from '../apps/server/src/infra/workcopy/index.js';
import { assertFrozen, readManifest } from './integrity.js';
import { snapshotCommit } from './snapshot.js';
import { auditScenario } from './audit.js';
import type { ManifestEntry } from './types.js';

/** Admission evidence; errors are explicit exclusions, never a passing scenario. */
export interface Verification {
  id: string;
  admissible: boolean;
  reason?: string;
  beforePassed: number;
  beforeTotal: number;
  afterPassed: number;
  afterTotal: number;
  detected?: number;
  located?: number;
}
/** The two unpatched runs, identical source and tests, differing only in API_VERSION. */
export type Pair = { before: ValidationResult; after: ValidationResult };

/** Reject runner errors, compilation failures, skips, changed test sets, and non-breaking cases. */
export function assess(id: string, pair: Pair): Verification {
  const { before, after } = pair;
  const result: Verification = {
    id,
    admissible: false,
    beforePassed: before.testsPassed,
    beforeTotal: before.testsTotal,
    afterPassed: after.testsPassed,
    afterTotal: after.testsTotal,
  };
  if (
    before.status !== 'pass' ||
    before.testsTotal === 0 ||
    before.testsPassed !== before.testsTotal ||
    before.compileErrors
  )
    result.reason = 'Before API: typecheck and every test must pass';
  else if (
    after.status !== 'fail' ||
    after.compileErrors ||
    !after.testResults.some((t) => t.status === 'failed')
  )
    result.reason =
      'After API: expected an actual failing test with successful compilation, not a runner error/timeout';
  else if (
    before.testsTotal !== after.testsTotal ||
    JSON.stringify(before.testResults.map((t) => [t.file, t.name]).sort()) !==
      JSON.stringify(after.testResults.map((t) => [t.file, t.name]).sort())
  )
    result.reason = 'Before/after test sets differ';
  else if (after.testResults.some((t) => t.status === 'skipped' || t.status === 'todo'))
    result.reason = 'After API: skipped/todo tests are not admission evidence';
  else result.admissible = true;
  return result;
}

async function hostCommand(dir: string, args: string[], version?: string): Promise<CommandRun> {
  return new Promise((resolveRun) => {
    execFile(
      'npm',
      args,
      {
        cwd: dir,
        timeout: 120_000,
        killSignal: 'SIGKILL',
        maxBuffer: 10 * 1024 * 1024,
        env: {
          PATH: process.env.PATH,
          HOME: tmpdir(),
          CI: 'true',
          API_VERSION: version,
          npm_config_cache: join(tmpdir(), 'sma-scenario-npm-cache'),
        },
      },
      (error, stdout, stderr) =>
        resolveRun({
          command: `npm ${args.join(' ')}`,
          exitCode: error ? (typeof error.code === 'number' ? error.code : null) : 0,
          timedOut: error?.killed ?? false,
          output: stdout + stderr,
        }),
    );
  });
}

/** Explicit authoring-only host checks of trusted fixtures, in a disposable source copy. */
export async function hostPair(repo: string): Promise<Pair> {
  const temp = await mkdtemp(join(tmpdir(), 'sma-scenarios-'));
  const dir = join(temp, 'repo');
  try {
    await cp(repo, dir, { recursive: true });
    const install = await hostCommand(dir, ['ci', '--ignore-scripts', '--no-audit', '--no-fund']);
    if (install.exitCode !== 0) throw new Error(`npm ci failed: ${install.output}`);
    async function check(version: string): Promise<ValidationResult> {
      const started = Date.now();
      const typecheck = await hostCommand(dir, ['run', 'typecheck'], version);
      const report = join(dir, 'vitest-report.json');
      await rm(report, { force: true });
      const test = await hostCommand(
        dir,
        ['test', '--', '--reporter=json', `--outputFile=${report}`],
        version,
      );
      let vitestJson: unknown;
      try {
        vitestJson = JSON.parse(await readFile(report, 'utf8'));
      } catch {
        vitestJson = undefined;
      }
      return buildValidationResult({
        typecheck,
        test,
        vitestJson,
        durationMs: Date.now() - started,
        rootDir: dir,
      });
    }
    return { before: await check('v1'), after: await check('v2') };
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
}

/** Reuse inc08's pinned, non-root, network-disabled sandbox for both unpatched checks. */
export async function containerPair(repo: string): Promise<Pair> {
  const copy = await createWorkingCopy(repo);
  if (!copy.ok) throw new Error(copy.error.message);
  try {
    const install = await installDependencies(copy.value.path);
    if (!install.ok) throw new Error(install.error.message);
    const before = await runChecks(copy.value.path, { env: { API_VERSION: 'v1' } });
    if (!before.ok) throw new Error(before.error.message);
    const after = await runChecks(copy.value.path, { env: { API_VERSION: 'v2' } });
    if (!after.ok) throw new Error(after.error.message);
    return { before: before.value, after: after.value };
  } finally {
    await disposeWorkingCopy(copy.value.path);
  }
}

/** Verify integrity before any detector or consumer runs; report every exclusion. */
export async function verifyOne(
  root: string,
  entry: ManifestEntry,
  runner: (repo: string) => Promise<Pair>,
  audit = auditScenario,
): Promise<Verification> {
  const empty = {
    id: entry.id,
    admissible: false,
    beforePassed: 0,
    beforeTotal: 0,
    afterPassed: 0,
    afterTotal: 0,
  };
  try {
    await assertFrozen(root, entry);
    const folder = join(root, entry.id);
    if ((await snapshotCommit(join(folder, 'repo'))) !== entry.repoCommit)
      throw new Error('Frozen repository commit mismatch');
    const evidence = await audit(folder);
    const result = assess(entry.id, await runner(join(folder, 'repo')));
    await assertFrozen(root, entry);
    return { ...result, ...evidence };
  } catch (e) {
    return { ...empty, reason: e instanceof Error ? e.message : String(e) };
  }
}

/** Full twenty-case admission check. Default container mode is mandatory for evaluation. */
export async function verify(root: string, mode: 'container' | 'host'): Promise<Verification[]> {
  const manifest = await readManifest(root);
  const counts = new Map<string, number>();
  let refusals = 0;
  let intact = true;
  for (const entry of manifest.scenarios) {
    try {
      await assertFrozen(root, entry);
    } catch {
      intact = false;
      continue;
    }
    const meta = parse(await readFile(join(root, entry.id, 'scenario.yaml'), 'utf8'));
    counts.set(meta.category, (counts.get(meta.category) ?? 0) + 1);
    if (meta.expected.outcome === 'refuse') refusals++;
  }
  if (
    intact &&
    (['field_renamed', 'field_type_changed', 'required_param_added', 'endpoint_removed'].some(
      (c) => counts.get(c) !== 5,
    ) ||
      refusals !== 3)
  )
    throw new Error('Cohort must contain five per category and three refusals');
  const results: Verification[] = [];
  for (const entry of manifest.scenarios) {
    const result = await verifyOne(root, entry, mode === 'host' ? hostPair : containerPair);
    results.push(result);
    console.log(`${result.id}: ${result.admissible ? 'admissible' : result.reason}`);
    await writeFile(
      join(root, 'verification.json'),
      JSON.stringify({ schemaVersion: 1, mode, manifest, results }, null, 2) + '\n',
    );
  }
  return results;
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  if (args.length > 1 || args.some((a) => !['--host', '--container'].includes(a)))
    throw new Error('Usage: scenarios:verify [--container|--host]');
  const results = await verify(
    fileURLToPath(new URL('.', import.meta.url)),
    args[0] === '--host' ? 'host' : 'container',
  );
  const admitted = results.filter((r) => r.admissible).length;
  console.log(`${admitted}/20 admissible`);
  if (admitted !== 20) process.exitCode = 1;
}
