import { test, expect } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { mkdtemp, writeFile, mkdir, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

// Real HTTP/database/orchestrator flow, deliberately unconfirmed: no model or GitHub calls.
let repoPath = '';
const owner = `e2e-${Date.now()}`;
function spec(version: number) {
  const field = version === 1 ? 'customer_name' : 'full_name';
  const content = {
    'application/json': {
      schema: { type: 'object', required: [field], properties: { [field]: { type: 'string' } } },
      example: { [field]: 'Ada' },
    },
  };
  const operation = {
    operationId: 'getCustomer',
    parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
    responses: { '200': { description: 'Customer', content } },
  };
  return JSON.stringify({
    openapi: '3.0.3',
    info: { title: 'Browser smoke', version: String(version) },
    paths: { '/customers/{id}': { get: operation } },
  });
}
test.beforeAll(async () => {
  repoPath = await mkdtemp(join(tmpdir(), 'sma-dashboard-real-'));
  await mkdir(join(repoPath, 'src'));
  await writeFile(
    join(repoPath, 'src/customer.ts'),
    'export async function customer(id: string) { return fetch(`https://api.example.test/customers/${id}`); }\n',
  );
  execFileSync('git', ['init', '--quiet', '--initial-branch=main'], { cwd: repoPath });
  execFileSync('git', ['add', '.'], { cwd: repoPath });
  execFileSync(
    'git',
    [
      '-c',
      'user.name=Browser test',
      '-c',
      'user.email=browser@example.invalid',
      '-c',
      'core.hooksPath=/dev/null',
      'commit',
      '--quiet',
      '--no-gpg-sign',
      '-m',
      'Trusted browser fixture',
    ],
    { cwd: repoPath },
  );
});
test.afterAll(async () => {
  if (repoPath) await rm(repoPath, { recursive: true, force: true });
});
test('real configuration, detection, safe unconfirmed run and exports', async ({ page }) => {
  await page.goto('/configuration');
  await expect(page.getByText(/FIXTURE DEMONSTRATION/)).toHaveCount(0);
  const repo = page.getByRole('heading', { name: 'Register repository' }).locator('..');
  await repo.getByLabel('Owner', { exact: true }).fill(owner);
  await repo.getByLabel('Repository name').fill('consumer');
  await repo.getByLabel('Local repository path on server').fill(repoPath);
  await repo.getByRole('button', { name: 'Register repository' }).click();
  await expect(page.getByText('Repository registered.')).toBeVisible();
  const name = `Browser API ${owner}`;
  await page.getByLabel('API name', { exact: true }).fill(name);
  await page.getByLabel('Specification URL').fill('https://example.invalid/openapi.yaml');
  await page.getByRole('button', { name: 'Register API', exact: true }).click();
  await expect(page.getByText('API registered.')).toBeVisible();
  const card = page.getByRole('heading', { name, exact: true }).locator('..');
  for (const version of [1, 2]) {
    await card.getByLabel(`Specification for ${name}`).setInputFiles({
      name: `v${version}.json`,
      mimeType: 'application/json',
      buffer: Buffer.from(spec(version)),
    });
    await card.getByRole('button', { name: 'Upload spec', exact: true }).click();
    await expect(
      card.getByText(version === 1 ? 'Baseline established' : 'Changed', { exact: true }).first(),
    ).toBeVisible();
  }
  await card.getByRole('link', { name: 'View changes' }).click();
  const row = page.getByRole('row').filter({ has: page.getByText('Breaking', { exact: true }) });
  await row.getByRole('button', { name: 'View evidence' }).click();
  await page.getByRole('button', { name: 'Confirm mapping', exact: true }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  await page.getByLabel('Consumer repository').selectOption({ label: `${owner}/consumer` });
  await page.getByRole('button', { name: 'Start run', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Run detail', exact: true })).toBeVisible();
  await expect(page.getByText('Flagged', { exact: true })).toBeVisible({ timeout: 30000 });
  await expect(page.getByText(/No pull request:/)).toBeVisible();
  await expect(page.getByText('No repair attempts recorded.')).toBeVisible();
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export JSON' }).click();
  const file = await download;
  const reportPath = test.info().outputPath('real-run.json');
  await file.saveAs(reportPath);
  const report = JSON.parse(await readFile(reportPath, 'utf8'));
  expect(report.run.status.value).toBe('flagged');
  expect(report.attempts).toEqual([]);
  expect(report.run.prUrl).toBeNull();
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({
    path: resolve('../../docs/acceptance/screenshots/inc14/09-real-unconfirmed-run.png'),
    fullPage: true,
  });
  await page.getByRole('link', { name: 'Results' }).click();
  await expect(page.getByText(/Waiting on Increment 16|No evaluation results yet/)).toBeVisible();
});
