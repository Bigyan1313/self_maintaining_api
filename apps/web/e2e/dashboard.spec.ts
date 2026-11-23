import { test, expect } from '@playwright/test';
import { resolve } from 'node:path';
const screenshots = resolve('../../docs/acceptance/screenshots/inc14');
test('configuration → changes → confirmation → run → exports → results', async ({ page }) => {
  await page.goto('/configuration');
  await expect(page.getByText(/FIXTURE DEMONSTRATION/)).toBeVisible();
  const repo = page.getByRole('heading', { name: 'Register repository' }).locator('..');
  await repo.getByLabel('Owner', { exact: true }).fill('example');
  await repo.getByLabel('Repository name').fill('consumer');
  await repo.getByLabel('Local repository path on server').fill('invalid');
  await repo.getByRole('button', { name: 'Register repository' }).click();
  await expect(repo.getByLabel('Local repository path on server')).toHaveAttribute(
    'aria-invalid',
    'true',
  );
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({
    path: resolve(screenshots, '01-configuration-error.png'),
    fullPage: true,
  });
  await repo.getByLabel('Local repository path on server').fill('/workspace/consumer');
  await repo.getByRole('button', { name: 'Register repository' }).click();
  await expect(page.getByText('Repository registered.')).toBeVisible();
  await page.getByLabel('API name', { exact: true }).fill('Shop API');
  await page.getByLabel('Specification URL').fill('https://example.test/openapi.yaml');
  await page.getByRole('button', { name: 'Register API', exact: true }).click();
  await expect(page.getByText('API registered.')).toBeVisible();
  await page.getByLabel('Specification for Shop API').setInputFiles({
    name: 'v1.yaml',
    mimeType: 'text/plain',
    buffer: Buffer.from('openapi: 3.0.3\ninfo: {title: Shop, version: v1}'),
  });
  await page.getByRole('button', { name: 'Upload spec', exact: true }).click();
  await expect(page.getByText('Baseline established', { exact: true }).first()).toBeVisible();
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({
    path: resolve(screenshots, '02-configuration-baseline.png'),
    fullPage: true,
  });
  await page.getByLabel('Specification for Shop API').setInputFiles({
    name: 'v2.yaml',
    mimeType: 'text/plain',
    buffer: Buffer.from('openapi: 3.0.3\ninfo: {title: Shop, version: v2}'),
  });
  await page.getByRole('button', { name: 'Upload spec', exact: true }).click();
  await expect(page.getByText('Changed', { exact: true }).first()).toBeVisible();
  await page.getByRole('button', { name: 'Check for changes' }).click();
  await expect(page.getByText('No change', { exact: true }).first()).toBeVisible();
  await page.getByRole('link', { name: 'View changes', exact: true }).click();
  await page.getByRole('button', { name: 'View evidence' }).click();
  await expect(page.getByText('Specification evidence')).toBeVisible();
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: resolve(screenshots, '03-changes.png'), fullPage: true });
  await page.getByRole('button', { name: 'Confirm mapping', exact: true }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.getByLabel('Mapping JSON').fill(
    JSON.stringify({
      kind: 'field_renamed',
      method: 'GET',
      path: '/customers/{id}',
      location: 'response',
      old: 'customer_name',
      new: 'full_name',
    }),
  );
  await page.getByLabel('Confirmed by').fill('Fixture reviewer');
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({
    path: resolve(screenshots, '04-confirm-mapping-dialog.png'),
    fullPage: true,
  });
  await page.getByRole('button', { name: 'Confirm and allow repair' }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.getByText('Mapping confirmed', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'View evidence' }).click();
  await page.getByLabel('Consumer repository').selectOption({ label: 'example/consumer' });
  await page.getByRole('button', { name: 'Start run', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Run detail', exact: true })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Open pull request' })).toBeVisible();
  await page.getByText('Validation output — attempt 1', { exact: true }).click();
  await expect(page.getByText(/Network disabled; non-root container/)).toBeVisible();
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: resolve(screenshots, '05-run-detail.png'), fullPage: true });
  for (const format of ['JSON', 'HTML']) {
    const download = page.waitForEvent('download');
    await page.getByRole('button', { name: `Export ${format}` }).click();
    const result = await download;
    expect(result.suggestedFilename()).toMatch(new RegExp(`\\.${format.toLowerCase()}$`));
    await result.saveAs(test.info().outputPath(`run.${format.toLowerCase()}`));
  }
  await page.getByRole('link', { name: '← All runs' }).click();
  await expect(page.getByRole('table', { name: 'Recorded runs' })).toBeVisible();
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: resolve(screenshots, '06-runs.png'), fullPage: true });
  await page.getByRole('link', { name: 'Results' }).click();
  await expect(page.getByRole('heading', { name: 'Failed scenarios' })).toBeVisible();
  await expect(page.getByText(/Excluded: Example/)).toBeVisible();
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: resolve(screenshots, '07-results.png'), fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: resolve(screenshots, '08-results-mobile.png'), fullPage: true });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
});
