/**
 * Never-merge proof (FR-34, C-02): the build fails if merge, auto-merge or `git push` appears
 * anywhere in the server source.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, it } from 'vitest';

const SRC = fileURLToPath(new URL('../src', import.meta.url));

const FORBIDDEN: readonly RegExp[] = [
  /pulls\s*\.\s*merge/i,
  /enablePullRequestAutoMerge/i,
  /git\s+push/i,
  /["'`]\s*push\s*["'`]/, // execFile('git', ['push', …])
  /\/pulls\/\{?[a-z_]*\}?\/merge/i, // raw REST route
  /\bgit\s*\.\s*(?:updateRef|deleteRef)\b/,
  /\bmergePullRequest\b/,
];

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory()
      ? files(path)
      : /\.(ts|js|mjs|cjs)$/.test(name)
        ? [path]
        : [];
  });
}

it('no merge, auto-merge, ref update/delete or git push in apps/server/src', () => {
  const hits = files(SRC).flatMap((file) =>
    readFileSync(file, 'utf8')
      .split('\n')
      .flatMap((line, i) =>
        FORBIDDEN.filter((re) => re.test(line)).map(
          (re) => `${relative(SRC, file)}:${i + 1} matches ${re}`,
        ),
      ),
  );
  expect(files(SRC).length).toBeGreaterThan(10);
  expect(hits).toEqual([]);
});

it('the patterns do catch the forbidden calls', () => {
  for (const line of [
    'await octokit.rest.pulls.merge({ owner, repo, pull_number })',
    'mutation { enablePullRequestAutoMerge(input: {}) { clientMutationId } }',
    "execFile('git', ['push', 'origin', 'main'])",
    'git push origin main',
    "octokit.request('PUT /repos/{owner}/{repo}/pulls/{pull_number}/merge')",
    'octokit.rest.git.updateRef({ ref })',
  ])
    expect(
      FORBIDDEN.some((re) => re.test(line)),
      line,
    ).toBe(true);
});
