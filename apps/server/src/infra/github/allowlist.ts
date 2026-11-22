/**
 * Transport-level allowlist for the delivery GitHub client (FR-34, C-02).
 *
 * Every HTTP request the client sends passes through {@link githubRequestRefusal} before it
 * reaches the network. Only the read and create calls delivery needs are allowed. Anything
 * else (a merge, an auto-merge mutation, any GraphQL, a ref update, a delete, a write to a
 * branch that is not `sma/…`) is refused, so it cannot be sent even through Octokit's generic
 * `request()` method.
 * @packageDocumentation
 */
import { DELIVERY_BRANCH_PREFIX, unsafeBranchReason } from '@sma/core';

/** Scope of one client: the single repository it may touch. */
export interface GitHubRequestScope {
  /** API origin, for example `https://api.github.com`. */
  baseUrl: string;
  owner: string;
  repo: string;
  /** Branches that must never be written (the default branch). */
  protectedBranches: readonly string[];
}

/** Allowed (method, path below `/repos/{owner}/{repo}`) pairs. */
const ALLOWED: readonly { method: string; path: RegExp }[] = [
  { method: 'GET', path: /^$/ },
  { method: 'GET', path: /^\/git\/ref\/heads\/[A-Za-z0-9._/-]+$/ },
  { method: 'GET', path: /^\/git\/commits\/[0-9a-f]{40}$/ },
  { method: 'POST', path: /^\/git\/blobs$/ },
  { method: 'POST', path: /^\/git\/trees$/ },
  { method: 'POST', path: /^\/git\/commits$/ },
  { method: 'POST', path: /^\/git\/refs$/ },
  { method: 'POST', path: /^\/pulls$/ },
  { method: 'GET', path: /^\/pulls\/\d+$/ },
  { method: 'GET', path: /^\/labels\/[^/]+$/ },
  { method: 'POST', path: /^\/labels$/ },
  { method: 'POST', path: /^\/issues\/\d+\/labels$/ },
];

function parseBody(body: unknown): Record<string, unknown> | null {
  if (typeof body !== 'string') return null;
  try {
    const value: unknown = JSON.parse(body);
    return value && typeof value === 'object' ? (value as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

/**
 * Why a request may not be sent, or `null` when it is on the allowlist.
 *
 * Besides the method/path list, a `POST /git/refs` must create `refs/heads/sma/…` (never a
 * protected branch), and a `POST /pulls` must have an `sma/…` head.
 * @param scope - The one repository and the protected branches.
 * @param method - HTTP method.
 * @param url - Full request URL.
 * @param body - Request body (JSON string) if any.
 */
export function githubRequestRefusal(
  scope: GitHubRequestScope,
  method: string,
  url: string,
  body?: unknown,
): string | null {
  let parsed: URL;
  let base: URL;
  try {
    parsed = new URL(url);
    base = new URL(scope.baseUrl);
  } catch {
    return 'invalid URL';
  }
  if (parsed.origin !== base.origin) return 'request to another host';
  const basePath = base.pathname.replace(/\/$/, '');
  const prefix = `${basePath}/repos/${encodeURIComponent(scope.owner)}/${encodeURIComponent(scope.repo)}`;
  const pathname = parsed.pathname;
  if (pathname !== prefix && !pathname.startsWith(`${prefix}/`))
    return 'request outside the configured repository';
  const rest = pathname.slice(prefix.length);
  const verb = method.toUpperCase();
  if (!ALLOWED.some((a) => a.method === verb && a.path.test(rest)))
    return `${verb} ${rest || '/'} is not an allowed delivery operation`;

  if (verb === 'POST' && rest === '/git/refs') {
    const ref = parseBody(body)?.ref;
    if (typeof ref !== 'string' || !ref.startsWith(`refs/heads/${DELIVERY_BRANCH_PREFIX}`))
      return `only refs/heads/${DELIVERY_BRANCH_PREFIX}… branches may be created`;
    const reason = unsafeBranchReason(ref, scope.protectedBranches);
    if (reason) return reason;
  }
  if (verb === 'POST' && rest === '/pulls') {
    const head = parseBody(body)?.head;
    if (typeof head !== 'string' || unsafeBranchReason(head, scope.protectedBranches))
      return `pull request head must be an ${DELIVERY_BRANCH_PREFIX}… branch`;
  }
  return null;
}
