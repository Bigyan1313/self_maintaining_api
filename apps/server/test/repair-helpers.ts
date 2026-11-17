/** Shared inputs for the repair-loop tests (unit and Docker). */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { cp, mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import type {
  LocateResult,
  MigrationMapping,
  RepairContextInput,
  ValidationResult,
} from '@sma/core';
import type { LlmResult } from '../src/infra/llm/types.js';

export const repoRoot = fileURLToPath(new URL('../../../', import.meta.url));
export const consumer = join(repoRoot, 'demo/consumer');
export const MODEL = 'claude-sonnet-5-5';

/** The demo rename mapping, exactly as the migration note states it. */
export const renameMapping = {
  kind: 'field_renamed',
  method: 'GET',
  path: '/customers/{id}',
  location: 'response',
  old: 'customer_name',
  new: 'full_name',
} as unknown as MigrationMapping;

/** The confirmed, breaking demo rename change. */
export function renameChange(
  over: Partial<RepairContextInput['change']> = {},
): RepairContextInput['change'] {
  return {
    difference: { ruleId: 'response-required-property-removed', path: '/customers/{id}' },
    category: 'field_renamed',
    classification: 'breaking',
    confidence: 0.6,
    mappingStatus: 'confirmed',
    mappingSource: 'migration_note',
    mapping: renameMapping,
    reason: 'renamed',
    ...over,
  } as RepairContextInput['change'];
}

/** Locate result: the one fetch call in src/customers.ts. */
export const renameLocate: Pick<LocateResult, 'callSites'> = {
  callSites: [
    {
      filePath: 'src/customers.ts',
      line: 12,
      column: 21,
      pattern: 'fetch',
      excerpt: 'const res = await fetch(`${apiBaseUrl()}/customers/${id}`);',
    },
  ],
};

/** A patch fixture from packages/core/test/fixtures/patches. */
export const patchFixture = (name: string): string =>
  readFileSync(join(repoRoot, 'packages/core/test/fixtures/patches', name), 'utf8');

/** The honest rename (customer_name → full_name in src/customers.ts). */
export const CORRECT_PATCH = patchFixture('honest-rename.diff');

/** Applies, compiles, but returns the wrong value: the customers tests still fail. */
export const WRONG_PATCH = `diff --git a/src/customers.ts b/src/customers.ts
--- a/src/customers.ts
+++ b/src/customers.ts
@@ -12,5 +12,5 @@ export async function getCustomerDisplayName(id: number): Promise<string> {
   const res = await fetch(\`\${apiBaseUrl()}/customers/\${id}\`);
   if (!res.ok) throw new Error(\`Customer \${id} request failed with status \${res.status}\`);
   const customer = (await res.json()) as CustomerResponse;
-  return customer.customer_name;
+  return customer.email;
 }
`;

/** A model answer carrying a patch. */
export const patchAnswer = (patch: string, tokensIn = 1000, tokensOut = 200): LlmResult => ({
  kind: 'patch',
  patch,
  tokensIn,
  tokensOut,
  costUsd: (tokensIn * 2 + tokensOut * 10) / 1_000_000,
  modelId: MODEL,
  durationMs: 5,
});

/** A validation result for the mocked validator. */
export function result(over: Partial<ValidationResult> = {}): ValidationResult {
  return {
    status: 'fail',
    compileErrors: 0,
    testsPassed: 10,
    testsTotal: 12,
    testResults: [
      {
        file: 'test/customers.test.ts',
        name: 'customers display name for customer 1 is "Ada Lovelace"',
        status: 'failed',
      },
    ],
    testFiles: ['test/customers.test.ts'],
    durationMs: 10,
    rawOutput: 'AssertionError: expected "ada@example.com" to be "Ada Lovelace"',
    ...over,
  };
}

export const PASS = (): ValidationResult =>
  result({ status: 'pass', testsPassed: 12, testResults: [], rawOutput: 'all passed' });

/** SHA-256 of every file under a directory (skipping node_modules), for an unchanged-repo check. */
export async function snapshot(dir: string): Promise<string> {
  const hash = createHash('sha256');
  async function walk(d: string): Promise<void> {
    for (const e of (await readdir(d, { withFileTypes: true })).sort((a, b) =>
      a.name.localeCompare(b.name),
    )) {
      if (e.name === 'node_modules') continue;
      const p = join(d, e.name);
      if (e.isDirectory()) await walk(p);
      else hash.update(relative(dir, p)).update(await readFile(p));
    }
  }
  await walk(dir);
  return hash.digest('hex');
}

/** Builds the rename-only consumer: v1 fixtures, with the v2 customer responses swapped in. */
export async function renameOnlyConsumer(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'sma-inc11-rename-only-'));
  await cp(consumer, dir, {
    recursive: true,
    filter: (src) => !src.split(/[\\/]/).includes('node_modules'),
  });
  const v1 = join(consumer, 'test/fixtures/v1');
  const v2 = join(dir, 'test/fixtures/v2');
  await rm(v2, { recursive: true });
  await cp(v1, v2, { recursive: true });
  for (const f of await readdir(join(consumer, 'test/fixtures/v2')))
    if (f.startsWith('GET_customers_'))
      await cp(join(consumer, 'test/fixtures/v2', f), join(v2, f));
  return dir;
}
