/** Safe GitHub client (FR-34, C-02, NFR-04) against a mocked GitHub API. No network. */
import { afterEach, describe, expect, it, vi } from 'vitest';
import * as clientModule from '../src/infra/github/client.js';
import { githubRequestRefusal } from '../src/infra/github/allowlist.js';
import { GitHubError, createGitHubClient } from '../src/infra/github/client.js';
import { createFakeGitHub } from './github-fake.js';

const TOKEN = 'ghp_FAKE123';
const SHA = 'a'.repeat(40);
const FORBIDDEN = /merge|auto|delete|remove|update|push|graphql|^request$|octokit/i;

function setup(opts: Parameters<typeof createFakeGitHub>[0] = {}) {
  const gh = createFakeGitHub(opts);
  const client = createGitHubClient({
    owner: gh.owner,
    repo: gh.repo,
    defaultBranch: 'main',
    token: TOKEN,
    fetch: gh.fetch,
  });
  return { gh, client };
}

afterEach(() => vi.restoreAllMocks());

describe('never-merge proof: the export surface', () => {
  it('the module exports only the factory, the error class and two constants', () => {
    expect(Object.keys(clientModule).sort()).toEqual([
      'GITHUB_API_URL',
      'GITHUB_REQUEST_TIMEOUT_MS',
      'GitHubError',
      'createGitHubClient',
    ]);
    for (const name of Object.keys(clientModule)) expect(name).not.toMatch(FORBIDDEN);
  });

  it('the client exposes exactly the delivery operations, frozen', () => {
    const { client } = setup();
    expect(Object.keys(client).sort()).toEqual([
      'addLabels',
      'createBlob',
      'createBranch',
      'createCommit',
      'createPullRequest',
      'createTree',
      'ensureLabel',
      'getCommit',
      'getPullRequest',
      'getRef',
      'getRepo',
    ]);
    for (const name of Object.keys(client)) expect(name).not.toMatch(FORBIDDEN);
    expect(Object.isFrozen(client)).toBe(true);
    expect(() => {
      (client as unknown as Record<string, unknown>).merge = () => undefined;
    }).toThrow();
  });
});

describe('branch safety', () => {
  it('refuses to create the default branch, with no createRef request sent', async () => {
    const { gh, client } = setup();
    await expect(client.createBranch('main', SHA)).rejects.toThrow(/default branch/);
    await expect(client.createBranch('refs/heads/main', SHA)).rejects.toBeInstanceOf(GitHubError);
    expect(gh.calls.filter((c) => c.path === '/git/refs')).toHaveLength(0);
  });

  it("also protects GitHub's live default branch when it differs from the stored one", async () => {
    const { gh, client } = setup({ defaultBranch: 'sma/trunk' });
    await expect(client.createBranch('sma/trunk', SHA)).rejects.toThrow(/default branch/);
    expect(gh.sequence()).toEqual(['GET ']);
  });

  it('refuses any branch outside sma/', async () => {
    const { gh, client } = setup();
    await expect(client.createBranch('feature/x', SHA)).rejects.toThrow(/sma\//);
    expect(gh.calls.filter((c) => c.path === '/git/refs')).toHaveLength(0);
  });

  it('creates a new sma/ branch', async () => {
    const { gh, client } = setup();
    await expect(client.createBranch('sma/run-1-field_renamed', SHA)).resolves.toEqual({
      ref: 'refs/heads/sma/run-1-field_renamed',
    });
    expect(gh.refs.get('sma/run-1-field_renamed')).toBe(SHA);
    expect(gh.refs.get('main')).not.toBe(SHA);
  });
});

describe('transport allowlist', () => {
  const scope = {
    baseUrl: 'https://api.github.com',
    owner: 'acme',
    repo: 'consumer',
    protectedBranches: ['main'],
  };
  const base = 'https://api.github.com/repos/acme/consumer';

  it.each([
    ['PUT', `${base}/pulls/1/merge`, undefined],
    ['POST', 'https://api.github.com/graphql', '{"query":"mutation{enablePullRequestAutoMerge}"}'],
    ['PATCH', `${base}/git/refs/heads/main`, '{"sha":"x"}'],
    ['PATCH', `${base}/git/refs/heads/sma/x`, '{"sha":"x"}'],
    ['DELETE', `${base}/git/refs/heads/sma/x`, undefined],
    ['DELETE', `${base}`, undefined],
    ['PATCH', `${base}/pulls/1`, '{"state":"closed"}'],
    ['PUT', `${base}/contents/src/a.ts`, '{}'],
    ['POST', `${base}/merges`, '{}'],
    ['POST', `${base}/git/refs`, '{"ref":"refs/heads/main","sha":"x"}'],
    ['POST', `${base}/git/refs`, '{"ref":"refs/heads/feature","sha":"x"}'],
    ['POST', `${base}/git/refs`, '{"ref":"refs/tags/sma/v1","sha":"x"}'],
    ['POST', `${base}/pulls`, '{"head":"main","base":"main"}'],
    ['GET', 'https://api.github.com/repos/acme/other', undefined],
    ['GET', 'https://evil.example/repos/acme/consumer', undefined],
  ])('refuses %s %s', (method, url, body) => {
    expect(githubRequestRefusal(scope, method, url, body)).not.toBeNull();
  });

  it.each([
    ['GET', base, undefined],
    ['POST', `${base}/git/blobs`, '{}'],
    ['POST', `${base}/git/refs`, '{"ref":"refs/heads/sma/run-1","sha":"x"}'],
    ['POST', `${base}/pulls`, '{"head":"sma/run-1","base":"main"}'],
    ['POST', `${base}/issues/3/labels`, '{"labels":[]}'],
  ])('allows %s %s', (method, url, body) => {
    expect(githubRequestRefusal(scope, method, url, body)).toBeNull();
  });
});

describe('operations against the mocked API', () => {
  it('creates a label only when it is missing', async () => {
    const { gh, client } = setup({ labels: ['machine-generated'] });
    await client.ensureLabel({ name: 'machine-generated', color: '000000', description: 'x' });
    await client.ensureLabel({ name: 'awaiting-human-review', color: '000000', description: 'x' });
    expect(gh.sequence()).toEqual(['GET /labels/:name', 'GET /labels/:name', 'POST /labels']);
    expect(gh.labels.has('awaiting-human-review')).toBe(true);
  });

  it('sends blobs as base64 and reads PRs back', async () => {
    const { gh, client } = setup();
    await client.createBlob('héllo');
    expect(gh.calls[0]!.body).toEqual({
      content: Buffer.from('héllo').toString('base64'),
      encoding: 'base64',
    });
    const pr = await client.createPullRequest({
      title: 't',
      body: 'b',
      head: 'sma/x',
      base: 'main',
    });
    expect(pr).toMatchObject({ number: 1, merged: false, head: 'sma/x', base: 'main' });
    expect(await client.getPullRequest(1)).toMatchObject({ number: 1, state: 'open' });
  });
});

describe('token protection (NFR-04)', () => {
  it('requires a token', () => {
    expect(() =>
      createGitHubClient({ owner: 'a', repo: 'b', defaultBranch: 'main', token: '' }),
    ).toThrow(GitHubError);
  });

  it('errors never contain the token, carry no cause, and nothing is logged', async () => {
    const logs = (['log', 'info', 'warn', 'error', 'debug'] as const).map((m) =>
      vi.spyOn(console, m).mockImplementation(() => undefined),
    );
    const { gh, client } = setup();
    gh.fail({
      method: 'POST',
      path: /^\/pulls$/,
      status: 500,
      message: `boom token ${TOKEN} leaked`,
    });
    const error = await client
      .createPullRequest({ title: 't', body: 'b', head: 'sma/x', base: 'main' })
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(GitHubError);
    const e = error as GitHubError;
    expect(e.status).toBe(500);
    expect(e.operation).toBe('createPullRequest');
    expect(e.cause).toBeUndefined();
    const serialized = `${e.message} ${e.stack} ${JSON.stringify(e)} ${JSON.stringify(Object.entries(e))}`;
    expect(serialized).not.toContain(TOKEN);
    expect(e.message).toContain('[REDACTED]');
    for (const spy of logs) expect(spy).not.toHaveBeenCalled();
    // The token did go to the (mocked) API, only as the Authorization header.
    expect(gh.calls[0]!.authorization).toBe(`token ${TOKEN}`);
  });

  it('a network failure is also redacted', async () => {
    const client = createGitHubClient({
      owner: 'a',
      repo: 'b',
      defaultBranch: 'main',
      token: TOKEN,
      fetch: () =>
        Promise.reject(new Error(`connect failed for https://x:${TOKEN}@api.github.com`)),
    });
    const e = (await client.getRepo().catch((x: unknown) => x)) as GitHubError;
    expect(e).toBeInstanceOf(GitHubError);
    expect(e.message).not.toContain(TOKEN);
  });
});
