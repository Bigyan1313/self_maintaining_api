/**
 * The only GitHub access in the system: a narrow wrapper around Octokit for delivery
 * (FR-33 to FR-35).
 *
 * **There is no merge, no auto-merge, no ref update and no delete here, and none can be added
 * by a caller.** The Octokit instance never leaves this module, and its transport refuses every
 * request that is not on the delivery allowlist (see `allowlist.ts`). Branches must be `sma/…`
 * and never the default branch (FR-34, C-02).
 *
 * The token is passed in by the caller (read from the env var named by
 * `repositories.credential_ref` at call time). Every error leaving this module is a
 * {@link GitHubError} whose message has the token and token-like strings removed, and which
 * carries no `cause`, request or response object (NFR-04).
 * @packageDocumentation
 */
import { Octokit } from '@octokit/rest';
import { DELIVERY_BRANCH_PREFIX, redactForDelivery, unsafeBranchReason } from '@sma/core';
import { githubRequestRefusal } from './allowlist.js';

/** Default GitHub REST API origin. */
export const GITHUB_API_URL = 'https://api.github.com';

/** Wall-clock limit for one GitHub request. */
export const GITHUB_REQUEST_TIMEOUT_MS = 30_000;

/** Options for {@link createGitHubClient}. */
export interface GitHubClientOptions {
  owner: string;
  repo: string;
  /** Default branch recorded for the repository; never written. */
  defaultBranch: string;
  /** Token value. Kept inside the client; never returned, logged or put in an error. */
  token: string;
  /** API origin (GitHub Enterprise); default {@link GITHUB_API_URL}. */
  baseUrl?: string;
  /** Replaceable transport (tests use a mocked GitHub API). */
  fetch?: typeof globalThis.fetch;
}

/** One file entry for {@link SafeGitHubClient.createTree}. `blobSha: null` deletes the path. */
export interface TreeEntry {
  path: string;
  mode: '100644' | '100755';
  blobSha: string | null;
}

/** A pull request as the client reports it. */
export interface PullRequestInfo {
  number: number;
  url: string;
  state: string;
  merged: boolean;
  head: string;
  base: string;
  labels: string[];
}

/** The complete set of operations. Nothing here can merge, enable auto-merge, update or delete. */
export interface SafeGitHubClient {
  /** Repository facts; also records the live default branch as protected. */
  getRepo(): Promise<{ fullName: string; defaultBranch: string }>;
  /** Head commit of a branch. */
  getRef(branch: string): Promise<{ sha: string }>;
  /** A commit and its tree. */
  getCommit(sha: string): Promise<{ sha: string; treeSha: string }>;
  /** Uploads one UTF-8 file body. */
  createBlob(content: string): Promise<{ sha: string }>;
  /** A new tree on top of `baseTreeSha`. */
  createTree(baseTreeSha: string, entries: readonly TreeEntry[]): Promise<{ sha: string }>;
  /** A new commit object (not on any branch until {@link createBranch}). */
  createCommit(input: {
    message: string;
    treeSha: string;
    parentSha: string;
  }): Promise<{ sha: string }>;
  /** Creates a new `sma/…` branch at `sha`. Throws for the default branch or any other name. */
  createBranch(branch: string, sha: string): Promise<{ ref: string }>;
  /** Opens a pull request from an `sma/…` head. */
  createPullRequest(input: {
    title: string;
    body: string;
    head: string;
    base: string;
  }): Promise<PullRequestInfo>;
  /** Creates the label if it does not exist yet. */
  ensureLabel(label: { name: string; color: string; description: string }): Promise<void>;
  /** Adds labels to a pull request. */
  addLabels(pullNumber: number, labels: readonly string[]): Promise<void>;
  /** Reads a pull request. */
  getPullRequest(pullNumber: number): Promise<PullRequestInfo>;
}

/** A GitHub failure with the token and token-like strings removed (NFR-04). */
export class GitHubError extends Error {
  override readonly name = 'GitHubError';
  /** HTTP status, when GitHub answered. */
  readonly status: number | undefined;
  /** Which client operation failed. */
  readonly operation: string;

  /**
   * @param operation - Client operation name.
   * @param message - Already-redacted message.
   * @param status - HTTP status, if any.
   */
  constructor(operation: string, message: string, status?: number) {
    super(message);
    this.operation = operation;
    this.status = status;
  }
}

const SILENT = { debug() {}, info() {}, warn() {}, error() {} };

interface PullData {
  number: number;
  html_url: string;
  state: string;
  merged?: boolean | null;
  head: { ref: string };
  base: { ref: string };
  labels: ({ name?: string } | string)[];
}
const pullInfo = (d: PullData): PullRequestInfo => ({
  number: d.number,
  url: d.html_url,
  state: d.state,
  merged: d.merged === true,
  head: d.head.ref,
  base: d.base.ref,
  labels: d.labels.map((l) => (typeof l === 'string' ? l : (l.name ?? ''))),
});

/**
 * Creates the delivery client for one repository. The returned object is frozen and exposes
 * only {@link SafeGitHubClient}'s methods.
 * @param options - Repository, default branch, token and optional transport.
 */
export function createGitHubClient(options: GitHubClientOptions): SafeGitHubClient {
  const { owner, repo, token } = options;
  if (!token) throw new GitHubError('configure', 'No GitHub token is configured.');
  const baseUrl = (options.baseUrl ?? GITHUB_API_URL).replace(/\/$/, '');
  const transport = options.fetch ?? globalThis.fetch;
  const protectedBranches = new Set([options.defaultBranch]);
  let liveDefaultKnown = false;

  const guardedFetch: typeof globalThis.fetch = (input, init) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    const method = init?.method ?? (input instanceof Request ? input.method : 'GET');
    const refusal = githubRequestRefusal(
      { baseUrl, owner, repo, protectedBranches: [...protectedBranches] },
      method,
      url,
      init?.body,
    );
    if (refusal) return Promise.reject(new Error(`Blocked by the delivery allowlist: ${refusal}`));
    const timeout = AbortSignal.timeout(GITHUB_REQUEST_TIMEOUT_MS);
    const signal = init?.signal ? AbortSignal.any([init.signal, timeout]) : timeout;
    return transport(input, { ...init, signal });
  };

  const octokit = new Octokit({
    auth: token,
    baseUrl,
    userAgent: 'self-maintaining-apis-delivery',
    log: SILENT,
    request: { fetch: guardedFetch, retries: 0 },
  });

  /** Runs one call; any failure becomes a redacted GitHubError with no cause attached. */
  async function call<T>(operation: string, fn: () => Promise<T>): Promise<T> {
    try {
      return await fn();
    } catch (e) {
      if (e instanceof GitHubError) throw e;
      const status = (e as { status?: unknown }).status;
      const raw = e instanceof Error ? e.message : String(e);
      throw new GitHubError(
        operation,
        redactForDelivery(
          `GitHub ${operation} failed${typeof status === 'number' ? ` (HTTP ${status})` : ''}: ${raw}`,
          [token],
        ),
        typeof status === 'number' ? status : undefined,
      );
    }
  }

  const client: SafeGitHubClient = {
    getRepo: () =>
      call('getRepo', async () => {
        const { data } = await octokit.rest.repos.get({ owner, repo });
        protectedBranches.add(data.default_branch);
        liveDefaultKnown = true;
        return { fullName: data.full_name, defaultBranch: data.default_branch };
      }),
    getRef: (branch) =>
      call('getRef', async () => {
        const { data } = await octokit.rest.git.getRef({ owner, repo, ref: `heads/${branch}` });
        return { sha: data.object.sha };
      }),
    getCommit: (sha) =>
      call('getCommit', async () => {
        const { data } = await octokit.rest.git.getCommit({ owner, repo, commit_sha: sha });
        return { sha: data.sha, treeSha: data.tree.sha };
      }),
    createBlob: (content) =>
      call('createBlob', async () => {
        const { data } = await octokit.rest.git.createBlob({
          owner,
          repo,
          content: Buffer.from(content, 'utf8').toString('base64'),
          encoding: 'base64',
        });
        return { sha: data.sha };
      }),
    createTree: (baseTreeSha, entries) =>
      call('createTree', async () => {
        const { data } = await octokit.rest.git.createTree({
          owner,
          repo,
          base_tree: baseTreeSha,
          tree: entries.map((e) => ({ path: e.path, mode: e.mode, type: 'blob', sha: e.blobSha })),
        });
        return { sha: data.sha };
      }),
    createCommit: ({ message, treeSha, parentSha }) =>
      call('createCommit', async () => {
        const { data } = await octokit.rest.git.createCommit({
          owner,
          repo,
          message,
          tree: treeSha,
          parents: [parentSha],
        });
        return { sha: data.sha };
      }),
    createBranch: (branch, sha) =>
      call('createBranch', async () => {
        // Always compare with GitHub's own default branch, not only the stored one.
        if (!liveDefaultKnown) await client.getRepo();
        const reason = unsafeBranchReason(branch, [...protectedBranches]);
        if (reason)
          throw new GitHubError(
            'createBranch',
            `Refused to create branch "${redactForDelivery(branch, [token])}": ${reason}. Only new ${DELIVERY_BRANCH_PREFIX}… branches may be created.`,
          );
        const ref = `refs/heads/${branch}`;
        await octokit.rest.git.createRef({ owner, repo, ref, sha });
        return { ref };
      }),
    createPullRequest: ({ title, body, head, base }) =>
      call('createPullRequest', async () => {
        const { data } = await octokit.rest.pulls.create({ owner, repo, title, body, head, base });
        return pullInfo(data as PullData);
      }),
    ensureLabel: ({ name, color, description }) =>
      call('ensureLabel', async () => {
        try {
          await octokit.rest.issues.getLabel({ owner, repo, name });
          return;
        } catch (e) {
          if ((e as { status?: number }).status !== 404) throw e;
        }
        try {
          await octokit.rest.issues.createLabel({ owner, repo, name, color, description });
        } catch (e) {
          // 422: someone created it in the meantime.
          if ((e as { status?: number }).status !== 422) throw e;
        }
      }),
    addLabels: (pullNumber, labels) =>
      call('addLabels', async () => {
        await octokit.rest.issues.addLabels({
          owner,
          repo,
          issue_number: pullNumber,
          labels: [...labels],
        });
      }),
    getPullRequest: (pullNumber) =>
      call('getPullRequest', async () => {
        const { data } = await octokit.rest.pulls.get({ owner, repo, pull_number: pullNumber });
        return pullInfo(data as PullData);
      }),
  };
  return Object.freeze(client);
}
