import { execFileSync } from 'node:child_process';
import { chmod, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { normalizeSpec, parseOasdiffChangelog, parseSpec, type SpecDifference } from '@sma/core';
import { checkOasdiffVersion, runOasdiff } from '../src/infra/oasdiff/runner.js';
import { OASDIFF_VERSION } from '../src/infra/oasdiff/version.js';

const root = new URL('../../../', import.meta.url);

function installedVersion(): string | null {
  try {
    return execFileSync(process.env.OASDIFF_BIN ?? 'oasdiff', ['--version'], { encoding: 'utf8' });
  } catch {
    return null;
  }
}
const installed = installedVersion();
const realAvailable = installed !== null && installed.includes(OASDIFF_VERSION);
if (!realAvailable)
  console.warn(
    `[oasdiff-runner] SKIPPING real-binary tests: oasdiff ${OASDIFF_VERSION} not found on PATH ` +
      '(install it — see README). These tests always run in CI.',
  );
if (process.env.CI && !realAvailable)
  throw new Error(`oasdiff ${OASDIFF_VERSION} must be installed in CI`);

async function loadSpec(version: 'v1' | 'v2'): Promise<unknown> {
  const parsed = await parseSpec(
    await readFile(new URL(`demo/api/specs/${version}.yaml`, root), 'utf8'),
  );
  if (!parsed.ok) throw new Error(parsed.error.message);
  return JSON.parse(normalizeSpec(parsed.value)) as unknown;
}

/** Fields compared between the recorded fixture and a live run. */
function summary(list: SpecDifference[]) {
  return list.map((d) => ({
    id: d.id,
    ruleId: d.ruleId,
    level: d.level,
    path: d.path,
    method: d.method,
    jsonPointer: d.jsonPointer,
    description: d.description,
    evidenceBefore: d.evidenceBefore,
    evidenceAfter: d.evidenceAfter,
  }));
}

describe.skipIf(!realAvailable)('runOasdiff with the real pinned binary', () => {
  it(`reports version ${OASDIFF_VERSION}`, async () => {
    expect(await checkOasdiffVersion()).toEqual({ ok: true, value: OASDIFF_VERSION });
  });

  it('demo v1→v2 live run matches the recorded fixture', async () => {
    const [before, after] = await Promise.all([loadSpec('v1'), loadSpec('v2')]);
    const live = await runOasdiff(before, after);
    expect(live.ok).toBe(true);
    if (!live.ok) return;
    const fixture = JSON.parse(
      await readFile(new URL('packages/core/test/fixtures/oasdiff-demo-v1-v2.json', root), 'utf8'),
    ) as unknown;
    const fromLive = parseOasdiffChangelog(live.value, { before, after });
    const fromFixture = parseOasdiffChangelog(fixture, { before, after });
    expect(fromLive.ok && fromFixture.ok).toBe(true);
    if (!fromLive.ok || !fromFixture.ok) return;
    expect(summary(fromLive.value)).toEqual(summary(fromFixture.value));
    expect(fromLive.value.filter((d) => d.level === 'error')).toHaveLength(5);
  });

  it('identical specs give no differences', async () => {
    const v1 = await loadSpec('v1');
    expect(await runOasdiff(v1, v1)).toEqual({ ok: true, value: [] });
  });

  it('external $refs are refused (no SSRF) → bad_output, not a crash', async () => {
    const spec = {
      openapi: '3.0.0',
      info: { title: 't', version: '1' },
      paths: { '/x': { $ref: 'http://127.0.0.1:9/x.json' } },
    };
    const result = await runOasdiff(spec, spec);
    expect(result).toMatchObject({ ok: false, error: { code: 'bad_output' } });
    if (!result.ok) expect(result.error.message).not.toContain('127.0.0.1');
  });
});

describe('runOasdiff typed failures (fake binaries)', () => {
  const dirs: string[] = [];
  afterAll(() => Promise.all(dirs.map((d) => rm(d, { recursive: true, force: true }))));

  async function fake(script: string): Promise<string> {
    const dir = await mkdtemp(join(tmpdir(), 'sma-fake-oasdiff-'));
    dirs.push(dir);
    const path = join(dir, 'oasdiff');
    await writeFile(path, `#!/bin/sh\n${script}\n`);
    await chmod(path, 0o755);
    return path;
  }
  const version = `if [ "$1" = "--version" ]; then echo "oasdiff version ${OASDIFF_VERSION}"; exit 0; fi`;

  it('missing binary → binary_missing', async () => {
    const result = await runOasdiff({}, {}, { binary: join(tmpdir(), 'no-such-oasdiff-binary') });
    expect(result).toMatchObject({ ok: false, error: { code: 'binary_missing' } });
  });

  it('wrong version → version_mismatch (changelog never runs)', async () => {
    const binary = await fake('echo "oasdiff version 1.0.0"');
    const result = await runOasdiff({}, {}, { binary });
    expect(result).toMatchObject({ ok: false, error: { code: 'version_mismatch' } });
    if (!result.ok) expect(result.error.message).toContain(OASDIFF_VERSION);
  });

  it('slow run → timeout', async () => {
    const binary = await fake(`${version}\nsleep 5`);
    const result = await runOasdiff({}, {}, { binary, timeoutMs: 300 });
    expect(result).toMatchObject({ ok: false, error: { code: 'timeout' } });
  });

  it('non-JSON output → bad_output', async () => {
    const binary = await fake(`${version}\necho "this is not json"`);
    expect(await runOasdiff({}, {}, { binary })).toMatchObject({
      ok: false,
      error: { code: 'bad_output' },
    });
  });

  it('non-zero exit → bad_output without exposing stderr', async () => {
    const binary = await fake(`${version}\necho "Error: secret-token-in-spec" >&2\nexit 102`);
    const result = await runOasdiff({}, {}, { binary });
    expect(result).toMatchObject({ ok: false, error: { code: 'bad_output' } });
    if (!result.ok) expect(result.error.message).toBe('oasdiff exited with code 102');
  });

  it('passes the expected arguments and only PATH in the environment', async () => {
    const binary = await fake(
      `${version}\nif [ -n "$DATABASE_URL$OASDIFF_CONFIG" ]; then echo leak >&2; exit 9; fi\n` +
        `[ "$1 $2 $3 $4 $5 $6" = "changelog base.json revision.json --format json --allow-external-refs=false" ] || exit 8\n` +
        `cat base.json >/dev/null && echo '[]'`,
    );
    const prev = process.env.OASDIFF_CONFIG;
    process.env.OASDIFF_CONFIG = '/tmp/x';
    try {
      expect(await runOasdiff({ a: 1 }, { b: 2 }, { binary })).toEqual({ ok: true, value: [] });
    } finally {
      if (prev === undefined) delete process.env.OASDIFF_CONFIG;
      else process.env.OASDIFF_CONFIG = prev;
    }
  });
});
