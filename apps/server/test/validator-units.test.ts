import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { runProcess } from '../src/infra/process.js';
import { dockerCliEnv, dockerServerVersion } from '../src/infra/validator/docker.js';
import { VALIDATOR_IMAGE, VALIDATOR_IMAGE_DIGEST } from '../src/infra/validator/image.js';
import {
  buildRunArgs,
  checkSandboxEnv,
  readReport,
  REPORT_DIR,
  sandboxUser,
} from '../src/infra/validator/sandbox.js';
import {
  applyPatch,
  createWorkingCopy,
  DEFAULT_WORK_ROOT,
  disposeWorkingCopy,
} from '../src/infra/workcopy/index.js';
import { validate } from '../src/pipeline/validate.js';

const repoRoot = fileURLToPath(new URL('../../../', import.meta.url));
const consumer = join(repoRoot, 'demo/consumer');

const git = (cwd: string, ...args: string[]) =>
  execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', ...args], {
    cwd,
    encoding: 'utf8',
    env: { PATH: process.env.PATH ?? '', GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1' },
  }).trim();

const SHIPPING_PATCH = [
  'diff --git a/src/orders.ts b/src/orders.ts',
  '--- a/src/orders.ts',
  '+++ b/src/orders.ts',
  "@@ -2,7 +2,7 @@ import axios from 'axios';",
  " import { apiBaseUrl } from './config.js';",
  ' ',
  ' /** Flat shipping fee added to every order, in the shop currency. */',
  '-export const SHIPPING_FEE = 5;',
  '+export const SHIPPING_FEE = 6;',
  ' ',
  ' /** Order as returned by GET /orders/{id}. */',
  ' interface OrderResponse {',
  '',
].join('\n');

let workRoot: string;
let scratch: string;
beforeAll(async () => {
  workRoot = await mkdtemp(join(tmpdir(), 'sma-work-'));
  scratch = await mkdtemp(join(tmpdir(), 'sma-src-'));
});
afterAll(async () => {
  await rm(workRoot, { recursive: true, force: true });
  await rm(scratch, { recursive: true, force: true });
});

describe('runProcess', () => {
  it('passes only the given environment and captures output', async () => {
    process.env.SMA_SECRET_FOR_TEST = 'leak';
    const out = await runProcess(
      process.execPath,
      ['-e', 'console.log(JSON.stringify(process.env))'],
      {
        cwd: tmpdir(),
        env: { ONLY: '1' },
      },
    );
    delete process.env.SMA_SECRET_FOR_TEST;
    expect(out.exitCode).toBe(0);
    const env = JSON.parse(out.output) as Record<string, string>;
    expect(env.ONLY).toBe('1');
    expect(env.SMA_SECRET_FOR_TEST).toBeUndefined();
  });

  it('reports a missing binary, a timeout (running onTimeout first) and truncation', async () => {
    const missing = await runProcess('/nonexistent/sma-bin', [], { cwd: tmpdir(), env: {} });
    expect(missing.spawnError).toBe('ENOENT');
    let hook = false;
    const slow = await runProcess(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], {
      cwd: tmpdir(),
      env: {},
      timeoutMs: 200,
      onTimeout: async () => {
        hook = true;
      },
    });
    expect(slow.timedOut).toBe(true);
    expect(hook).toBe(true);
    const big = await runProcess(
      process.execPath,
      ['-e', 'process.stdout.write("x".repeat(5000))'],
      {
        cwd: tmpdir(),
        env: {},
        maxOutputBytes: 100,
      },
    );
    expect(big.truncated).toBe(true);
    expect(big.output).toContain('[output truncated at 100 bytes]');
  });
});

describe('createWorkingCopy', () => {
  it('plain-copies a non-root folder without node_modules and leaves the source untouched', async () => {
    const before = git(repoRoot, 'status', '--porcelain', '--', 'demo/consumer');
    const copy = await createWorkingCopy(consumer, undefined, { workRoot });
    expect(copy.ok).toBe(true);
    if (!copy.ok) return;
    expect(copy.value.source).toBe('copy');
    expect(copy.value.path.startsWith(workRoot)).toBe(true);
    expect(existsSync(join(copy.value.path, 'src/orders.ts'))).toBe(true);
    expect(existsSync(join(copy.value.path, 'node_modules'))).toBe(false);
    expect(git(copy.value.path, 'rev-parse', 'HEAD')).toBe(copy.value.commit);
    expect(git(copy.value.path, 'status', '--porcelain')).toBe('');
    expect(await readFile(join(copy.value.path, '.git/info/exclude'), 'utf8')).toContain('.sma/');
    // Writing in the copy never reaches the source.
    await writeFile(join(copy.value.path, 'src/orders.ts'), 'changed');
    expect(git(repoRoot, 'status', '--porcelain', '--', 'demo/consumer')).toBe(before);
    expect(await disposeWorkingCopy(copy.value.path, { workRoot })).toBe(true);
    expect(existsSync(copy.value.path)).toBe(false);
  });

  it('clones a git repository root at the requested commit, without origin', async () => {
    const src = join(scratch, 'repo');
    await mkdir(src);
    git(src, 'init', '--quiet');
    await writeFile(join(src, 'a.ts'), 'one\n');
    git(src, 'add', '.');
    git(src, 'commit', '--quiet', '-m', 'one');
    const first = git(src, 'rev-parse', 'HEAD');
    await writeFile(join(src, 'a.ts'), 'two\n');
    git(src, 'commit', '--quiet', '-am', 'two');
    await writeFile(join(src, 'dirty.ts'), 'uncommitted\n');

    const head = await createWorkingCopy(src, undefined, { workRoot });
    expect(head.ok && head.value.source).toBe('git-clone');
    if (!head.ok) return;
    expect(await readFile(join(head.value.path, 'a.ts'), 'utf8')).toBe('two\n');
    expect(existsSync(join(head.value.path, 'dirty.ts'))).toBe(false);
    expect(git(head.value.path, 'remote')).toBe('');

    const old = await createWorkingCopy(src, first, { workRoot });
    expect(old.ok && old.value.commit).toBe(first);
    if (old.ok) expect(await readFile(join(old.value.path, 'a.ts'), 'utf8')).toBe('one\n');
    // The developer's repo is unchanged.
    expect(git(src, 'status', '--porcelain')).toBe('?? dirty.ts');
    expect(await readFile(join(src, 'a.ts'), 'utf8')).toBe('two\n');
  });

  it('rejects a bad commit, an unknown commit, a commit for a non-git folder, and a missing path', async () => {
    const src = join(scratch, 'repo');
    for (const [path, sha] of [
      [src, '--orphan'],
      [src, 'deadbeefdeadbeef'],
      [consumer, 'deadbeef'],
      [join(scratch, 'nope'), undefined],
    ] as const) {
      const r = await createWorkingCopy(path, sha, { workRoot });
      expect(r.ok ? 'ok' : r.error.code).toBe('workcopy_failed');
    }
    // Failed attempts leave nothing behind.
    const left = (await readdir(workRoot)).length;
    const again = await createWorkingCopy(src, 'deadbeefdeadbeef', { workRoot });
    expect(again.ok).toBe(false);
    expect((await readdir(workRoot)).length).toBe(left);
  });

  it('uses .work/ in the project root by default', () => {
    expect(DEFAULT_WORK_ROOT).toBe(join(repoRoot, '.work'));
  });
});

describe('applyPatch', () => {
  it('applies a valid patch and lists its files', async () => {
    const copy = await createWorkingCopy(consumer, undefined, { workRoot });
    if (!copy.ok) throw new Error(copy.error.message);
    const r = await applyPatch(copy.value.path, SHIPPING_PATCH, { workRoot });
    expect(r).toEqual({
      ok: true,
      value: [{ oldPath: 'src/orders.ts', newPath: 'src/orders.ts', change: 'modified' }],
    });
    expect(await readFile(join(copy.value.path, 'src/orders.ts'), 'utf8')).toContain(
      'SHIPPING_FEE = 6;',
    );
    expect(await readFile(join(consumer, 'src/orders.ts'), 'utf8')).toContain('SHIPPING_FEE = 5;');
  });

  it('rejects ../, absolute, a patch that does not apply, and a non-work directory', async () => {
    const copy = await createWorkingCopy(consumer, undefined, { workRoot });
    if (!copy.ok) throw new Error(copy.error.message);
    const dir = copy.value.path;
    const escape = SHIPPING_PATCH.replaceAll('src/orders.ts', '../../outside.ts');
    expect(await applyPatch(dir, escape, { workRoot })).toMatchObject({
      ok: false,
      error: { code: 'patch_invalid' },
    });
    expect(existsSync(join(workRoot, 'outside.ts'))).toBe(false);
    const absolute = ['--- /etc/hosts', '+++ /etc/hosts', '@@ -1 +1 @@', '-a', '+b', ''].join('\n');
    expect(await applyPatch(dir, absolute, { workRoot })).toMatchObject({
      ok: false,
      error: { code: 'patch_invalid' },
    });
    const stale = SHIPPING_PATCH.replace(
      '-export const SHIPPING_FEE = 5;',
      '-export const SHIPPING_FEE = 99;',
    );
    expect(await applyPatch(dir, stale, { workRoot })).toMatchObject({
      ok: false,
      error: { code: 'patch_invalid', message: expect.stringMatching(/--check/) },
    });
    expect(await applyPatch(consumer, SHIPPING_PATCH, { workRoot })).toMatchObject({ ok: false });
    expect(await readFile(join(consumer, 'src/orders.ts'), 'utf8')).toContain('SHIPPING_FEE = 5;');
  });
});

describe('disposeWorkingCopy', () => {
  it('refuses anything that is not directly inside the work root', async () => {
    expect(await disposeWorkingCopy(consumer, { workRoot })).toBe(false);
    expect(await disposeWorkingCopy(workRoot, { workRoot })).toBe(false);
    expect(await disposeWorkingCopy(join(workRoot, 'a', 'b'), { workRoot })).toBe(false);
    expect(existsSync(consumer)).toBe(true);
  });
});

describe('sandbox arguments', () => {
  const args = (phase: 'install' | 'validate') =>
    buildRunArgs({
      phase,
      name: 'sma-test',
      workDir: '/host/.work/abc',
      env: { API_VERSION: 'v1' },
      command: ['npm', 'test'],
    });
  const flag = (a: string[], name: string) => a[a.indexOf(name) + 1];

  it('validate: no network, non-root, limits, read-only, no caps, only /work mounted, pinned image', () => {
    const a = args('validate');
    expect(flag(a, '--network')).toBe('none');
    expect(flag(a, '--user')).not.toMatch(/^0:/);
    expect(flag(a, '--memory')).toBe('2g');
    expect(flag(a, '--memory-swap')).toBe('2g');
    expect(flag(a, '--cpus')).toBe('2');
    expect(flag(a, '--pids-limit')).toBe('256');
    expect(flag(a, '--cap-drop')).toBe('ALL');
    expect(flag(a, '--security-opt')).toBe('no-new-privileges');
    expect(a).toContain('--read-only');
    expect(a).toContain('--rm');
    expect(a.filter((x) => x === '--volume')).toHaveLength(1);
    expect(flag(a, '--volume')).toBe('/host/.work/abc:/work');
    expect(flag(a, '--tmpfs')).toMatch(/^\/tmp:/);
    expect(a.join(' ')).toContain(`sma.workcopy=abc`);
    expect(a.slice(-3)).toEqual([VALIDATOR_IMAGE, 'npm', 'test']);
    expect(VALIDATOR_IMAGE).toContain(`@${VALIDATOR_IMAGE_DIGEST}`);
    expect(VALIDATOR_IMAGE_DIGEST).toMatch(/^sha256:[0-9a-f]{64}$/);
  });

  it('every env var is an explicit KEY=VALUE pair (nothing inherited from the host)', () => {
    const a = args('validate');
    const envs = a.flatMap((x, i) => (x === '--env' ? [a[i + 1]!] : []));
    expect(envs.every((e) => /^[A-Za-z_][A-Za-z0-9_]*=/.test(e))).toBe(true);
    expect(envs).toContain('API_VERSION=v1');
    expect(envs).toContain('CI=true');
    expect(envs.some((e) => /TOKEN|KEY|SECRET|PASSWORD/i.test(e.split('=')[0]!))).toBe(false);
  });

  it('install: network on, everything else the same', () => {
    const a = args('install');
    expect(flag(a, '--network')).toBe('bridge');
    expect(flag(a, '--user')).toBe(flag(args('validate'), '--user'));
    expect(a).toContain('--read-only');
  });

  it('runs as the host user, or 1000 when the host is root; never uid 0', () => {
    const user = sandboxUser();
    expect(user).toMatch(/^\d+:\d+$/);
    expect(user.split(':')[0]).not.toBe('0');
    const uid = process.getuid?.();
    if (uid && uid !== 0) expect(user.startsWith(`${uid}:`)).toBe(true);
  });

  it('only allow-listed env keys pass', () => {
    expect(checkSandboxEnv({ API_VERSION: 'v2', NODE_ENV: 'test' })).toBeNull();
    expect(checkSandboxEnv({ GITHUB_TOKEN: 'ghp_FAKE' })).toMatchObject({
      code: 'env_not_allowed',
    });
    expect(checkSandboxEnv({ PATH: '/x' })).toMatchObject({ code: 'env_not_allowed' });
    expect(checkSandboxEnv({ API_VERSION: 'v1\nX=1' })).toMatchObject({ code: 'env_not_allowed' });
  });

  it('the Docker CLI env never carries credentials', () => {
    process.env.GITHUB_TOKEN = 'ghp_FAKE';
    process.env.ANTHROPIC_API_KEY = 'sk-ant-FAKE';
    try {
      const env = dockerCliEnv();
      expect(Object.values(env).join(' ')).not.toMatch(/ghp_FAKE|sk-ant-FAKE/);
      expect(
        Object.keys(env).every((k) => k === 'PATH' || k === 'HOME' || k.startsWith('DOCKER_')),
      ).toBe(true);
    } finally {
      delete process.env.GITHUB_TOKEN;
      delete process.env.ANTHROPIC_API_KEY;
    }
  });
});

describe('readReport', () => {
  it('reads a regular report, and refuses a symlinked or missing one', async () => {
    const dir = join(workRoot, 'report-test');
    await mkdir(join(dir, REPORT_DIR), { recursive: true });
    expect(await readReport(dir)).toBeUndefined();
    await writeFile(join(dir, REPORT_DIR, 'vitest.json'), '{"success":true,"testResults":[]}');
    expect(await readReport(dir)).toEqual({ success: true, testResults: [] });
    const secret = join(scratch, 'host-secret.json');
    await writeFile(secret, '{"secret":"host"}');
    await rm(join(dir, REPORT_DIR, 'vitest.json'));
    await symlink(secret, join(dir, REPORT_DIR, 'vitest.json'));
    expect(await readReport(dir)).toBeUndefined();
    await rm(join(dir, REPORT_DIR, 'vitest.json'));
    await writeFile(join(dir, REPORT_DIR, 'vitest.json'), 'not json');
    expect(await readReport(dir)).toBeUndefined();
  });
});

describe('validate: failures before any container runs', () => {
  it('env_not_allowed for a non-allow-listed key', async () => {
    const r = await validate({
      repoPath: consumer,
      env: { GITHUB_TOKEN: 'ghp_FAKE' },
      workcopy: { workRoot },
    });
    expect(r).toMatchObject({ ok: false, error: { code: 'env_not_allowed' } });
  });

  it('patch_invalid for a ../ path, before Docker or a copy is touched', async () => {
    const before = (await readdir(workRoot)).length;
    const r = await validate({
      repoPath: consumer,
      patch: SHIPPING_PATCH.replaceAll('src/orders.ts', '../escape.ts'),
      docker: { binary: '/nonexistent/docker' },
      workcopy: { workRoot },
    });
    expect(r).toMatchObject({ ok: false, error: { code: 'patch_invalid' } });
    expect((await readdir(workRoot)).length).toBe(before);
  });

  it('container_unavailable when the Docker CLI is missing', async () => {
    const r = await validate({
      repoPath: consumer,
      docker: { binary: '/nonexistent/docker' },
      workcopy: { workRoot },
    });
    expect(r).toMatchObject({ ok: false, error: { code: 'container_unavailable' } });
  });

  it('container_unavailable when the daemon is down (unreachable DOCKER_HOST)', async () => {
    const dockerOptions = {
      env: { DOCKER_HOST: `unix://${join(scratch, 'no-daemon.sock')}`, DOCKER_CONTEXT: '' },
    };
    expect(await dockerServerVersion(dockerOptions)).toBeNull();
    const r = await validate({ repoPath: consumer, docker: dockerOptions, workcopy: { workRoot } });
    expect(r).toMatchObject({ ok: false, error: { code: 'container_unavailable' } });
  });

  it('the work root basename is a uuid per copy', async () => {
    const a = await createWorkingCopy(consumer, undefined, { workRoot });
    const b = await createWorkingCopy(consumer, undefined, { workRoot });
    if (!a.ok || !b.ok) throw new Error('copy failed');
    expect(basename(a.value.path)).toMatch(/^[0-9a-f-]{36}$/);
    expect(a.value.path).not.toBe(b.value.path);
  });
});
