import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/** C-05 / NFR-08: core stays pure — no process spawning, network, Docker, LLM, or apps/* imports. */
const FORBIDDEN = [
  /^(node:)?child_process$/,
  /^(node:)?(net|http|https|http2|dgram|tls|dns)$/,
  /^(node:)?fs(\/promises)?$/,
  /^@sma\/(server|web)/,
  /apps\//,
  /^(axios|undici|node-fetch|dockerode|@octokit\/|@anthropic-ai\/)/,
];

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(full);
    return entry.name.endsWith('.ts') && !entry.name.endsWith('.test.ts') ? [full] : [];
  });
}

describe('packages/core boundaries', () => {
  it('has no forbidden imports in non-test source', () => {
    const offenders: string[] = [];
    for (const file of sourceFiles(fileURLToPath(new URL('.', import.meta.url)))) {
      const text = readFileSync(file, 'utf8');
      for (const m of text.matchAll(/(?:from\s+|import\s*\(\s*|require\s*\(\s*)['"]([^'"]+)['"]/g))
        if (FORBIDDEN.some((re) => re.test(m[1]!))) offenders.push(`${file}: ${m[1]}`);
      if (/\bfetch\s*\(/.test(text)) offenders.push(`${file}: fetch()`);
    }
    expect(offenders).toEqual([]);
  });
});
