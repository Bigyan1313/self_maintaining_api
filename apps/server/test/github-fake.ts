/**
 * A mocked GitHub REST API at the `fetch` boundary: records every request that actually reached
 * the "network" and answers the delivery endpoints with plausible data. Failures can be
 * scripted per route.
 */
import { createHash } from 'node:crypto';

/** One request that reached the mocked API. */
export interface FakeCall {
  method: string;
  /** Path below `/repos/{owner}/{repo}` (`''` for the repository itself). */
  path: string;
  body: Record<string, unknown> | null;
  authorization: string | null;
}

/** A scripted failure: answer `status` (once, unless `times` is given) for a matching route. */
export interface FakeFailure {
  method: string;
  path: RegExp;
  status: number;
  message?: string;
  times?: number;
}

const sha = (s: string) => createHash('sha1').update(s).digest('hex');

/** Options for {@link createFakeGitHub}. */
export interface FakeGitHubOptions {
  owner?: string;
  repo?: string;
  defaultBranch?: string;
  /** Labels that already exist. */
  labels?: string[];
}

/** Creates a mocked GitHub API. */
export function createFakeGitHub(opts: FakeGitHubOptions = {}) {
  const owner = opts.owner ?? 'acme';
  const repo = opts.repo ?? 'consumer';
  const defaultBranch = opts.defaultBranch ?? 'main';
  const labels = new Set(opts.labels ?? []);
  const calls: FakeCall[] = [];
  const failures: FakeFailure[] = [];
  const refs = new Map<string, string>([[defaultBranch, sha('head')]]);
  let nextPr = 1;
  let counter = 0;

  const json = (status: number, body: unknown) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { 'content-type': 'application/json; charset=utf-8' },
    });

  const fetch: typeof globalThis.fetch = async (input, init) => {
    const url = new URL(
      typeof input === 'string' ? input : input instanceof URL ? input.href : input.url,
    );
    const method = (init?.method ?? 'GET').toUpperCase();
    const prefix = `/repos/${owner}/${repo}`;
    const path = url.pathname.startsWith(prefix) ? url.pathname.slice(prefix.length) : url.pathname;
    const body =
      typeof init?.body === 'string' ? (JSON.parse(init.body) as Record<string, unknown>) : null;
    const headers = new Headers(init?.headers);
    calls.push({ method, path, body, authorization: headers.get('authorization') });

    const failure = failures.find((f) => f.method === method && f.path.test(path));
    if (failure) {
      if (failure.times === undefined || --failure.times <= 0)
        failures.splice(failures.indexOf(failure), 1);
      return json(failure.status, { message: failure.message ?? 'Server Error' });
    }
    const id = () => sha(`${++counter}`);
    const pull = (n: number, b: Record<string, unknown>) => ({
      number: n,
      html_url: `https://github.com/${owner}/${repo}/pull/${n}`,
      state: 'open',
      merged: false,
      head: { ref: b.head },
      base: { ref: b.base },
      labels: [],
    });

    if (method === 'GET' && path === '')
      return json(200, { full_name: `${owner}/${repo}`, default_branch: defaultBranch });
    let m: RegExpExecArray | null;
    if (method === 'GET' && (m = /^\/git\/ref\/heads\/(.+)$/.exec(path))) {
      const ref = refs.get(m[1]!);
      return ref
        ? json(200, { ref: `refs/heads/${m[1]}`, object: { sha: ref } })
        : json(404, { message: 'Not Found' });
    }
    if (method === 'GET' && (m = /^\/git\/commits\/([0-9a-f]{40})$/.exec(path)))
      return json(200, { sha: m[1], tree: { sha: sha(`tree-${m[1]}`) } });
    if (method === 'POST' && ['/git/blobs', '/git/trees', '/git/commits'].includes(path))
      return json(201, { sha: id() });
    if (method === 'POST' && path === '/git/refs') {
      const ref = String(body?.ref).replace(/^refs\/heads\//, '');
      if (refs.has(ref)) return json(422, { message: 'Reference already exists' });
      refs.set(ref, String(body?.sha));
      return json(201, { ref: body?.ref, object: { sha: body?.sha } });
    }
    if (method === 'POST' && path === '/pulls') return json(201, pull(nextPr++, body ?? {}));
    if (method === 'GET' && (m = /^\/pulls\/(\d+)$/.exec(path)))
      return json(200, pull(Number(m[1]), { head: 'sma/x', base: defaultBranch }));
    if (method === 'GET' && (m = /^\/labels\/(.+)$/.exec(path)))
      return labels.has(decodeURIComponent(m[1]!))
        ? json(200, { name: decodeURIComponent(m[1]!) })
        : json(404, { message: 'Not Found' });
    if (method === 'POST' && path === '/labels') {
      labels.add(String(body?.name));
      return json(201, { name: body?.name });
    }
    if (method === 'POST' && /^\/issues\/\d+\/labels$/.test(path))
      return json(
        200,
        ((body?.labels as string[]) ?? []).map((name) => ({ name })),
      );
    return json(404, { message: `fake GitHub has no route for ${method} ${path}` });
  };

  return {
    owner,
    repo,
    defaultBranch,
    fetch,
    calls,
    refs,
    labels,
    /** Script a failure. */
    fail(f: FakeFailure) {
      failures.push(f);
    },
    /** `METHOD path` for each call, with ids collapsed, for order assertions. */
    sequence() {
      return calls.map(
        (c) =>
          `${c.method} ${c.path
            .replace(/[0-9a-f]{40}/g, ':sha')
            .replace(/\/\d+(\/|$)/g, '/:n$1')
            .replace(/^\/labels\/.+$/, '/labels/:name')}`,
      );
    },
  };
}

/** The type of {@link createFakeGitHub}'s result. */
export type FakeGitHub = ReturnType<typeof createFakeGitHub>;
