import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, expect, it } from 'vitest';

const script = fileURLToPath(new URL('./final-report.ts', import.meta.url));
const tsx = fileURLToPath(new URL('../../node_modules/tsx/dist/loader.mjs', import.meta.url));
const roots: string[] = [];
function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'sma-report-test-'));
  roots.push(root);
  mkdirSync(join(root, 'docs'));
  mkdirSync(join(root, 'eval/results/study'), { recursive: true });
  return root;
}
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});
it('includes generated report bytes without retyping its tables', () => {
  const root = fixture();
  const report = '# Measured study\n\n| value | count |\n| --- | --- |\n| failures | 3 |\n';
  writeFileSync(join(root, 'eval/results/study/report.md'), report);
  execFileSync(process.execPath, ['--import', tsx, script, 'eval/results/study/report.md'], {
    cwd: root,
  });
  const output = readFileSync(join(root, 'docs/final-report.md'), 'utf8');
  expect(output).toContain(report);
  expect(output).toContain('SHA-256');
  expect(output).not.toContain('PENDING:');
});
it('does not invent evaluation results when no report was selected', () => {
  const root = fixture();
  execFileSync(process.execPath, ['--import', tsx, script], { cwd: root });
  expect(readFileSync(join(root, 'docs/final-report.md'), 'utf8')).toContain('PENDING:');
});
it('refuses an existing report outside eval/results', () => {
  const root = fixture();
  writeFileSync(join(root, 'report.md'), 'outside');
  const result = spawnSync(process.execPath, ['--import', tsx, script, 'report.md'], { cwd: root });
  expect(result.status).not.toBe(0);
});
it('lists each PARTIAL acceptance check with its reason, never as a pass', () => {
  const root = fixture();
  mkdirSync(join(root, 'docs/acceptance/output'), { recursive: true });
  const check = (id: string, verdict: string, reason: string) => ({
    id,
    title: `T ${id}`,
    verdict,
    reason,
  });
  writeFileSync(
    join(root, 'docs/acceptance/output/summary.json'),
    JSON.stringify({
      meta: { commit: 'abcdef123456' },
      checks: [
        check('AT-01', 'PASS', 'All 5 assertions passed.'),
        check('AT-12', 'PARTIAL', 'Study missing:\n  fake model adapter.'),
      ],
    }),
  );
  execFileSync(process.execPath, ['--import', tsx, script], { cwd: root });
  const output = readFileSync(join(root, 'docs/final-report.md'), 'utf8');
  const section =
    output
      .split('<!-- BEGIN PARTIAL ACCEPTANCE -->')[1]
      ?.split('<!-- END PARTIAL ACCEPTANCE -->')[0] ?? '';
  expect(section).toContain('commit abcdef123456: 1 PASS, 1 PARTIAL, 0 FAIL');
  expect(section).toContain('- **AT-12** T AT-12: Study missing: fake model adapter.');
  expect(section).not.toContain('**AT-01**');
});
it('says when no acceptance summary exists instead of inventing one', () => {
  const root = fixture();
  execFileSync(process.execPath, ['--import', tsx, script], { cwd: root });
  expect(readFileSync(join(root, 'docs/final-report.md'), 'utf8')).toContain(
    'No acceptance summary found',
  );
});
