/**
 * `npm run acceptance` — runs the acceptance checks that this build supports, against a clean
 * database, and writes the records:
 *
 * - `docs/acceptance/output/AT-NN.txt`: the transcript of what ran and what was observed
 * - `docs/acceptance/output/summary.json`: machine-readable results, build and environment
 * - `docs/acceptance/screenshots/AT-NN.png`: the transcript rendered as a terminal window
 * - `docs/acceptance/AT-NN.md` and `docs/acceptance/README.md`: the records and the summary table
 *
 * Credentials loaded from `.env` are removed from the process before any check runs, and every
 * output is scanned for their values before it is written (NFR-04).
 *
 * @packageDocumentation
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { release, tmpdir, type } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { sql } from 'drizzle-orm';
import { buildApp } from '../../apps/server/src/app.js';
import { createDbClient } from '../../apps/server/src/infra/db/client.js';
import { loadRootEnv } from '../../apps/server/src/infra/db/env.js';
import { resetTestDatabase } from '../../apps/server/src/infra/db/test-db.js';
import { checkOasdiffVersion } from '../../apps/server/src/infra/oasdiff/runner.js';
import { dockerServerVersion } from '../../apps/server/src/infra/validator/docker.js';
import { CHECKS, PENDING, hostState, type Ctx } from './checks.js';
import { Recorder, scrub } from './record.js';
import { renderReadme, renderRecord, type CheckRecord, type RunMeta } from './report.js';
import { renderTerminalScreenshots } from './screenshot.js';

const root = realpathSync(fileURLToPath(new URL('../../', import.meta.url))).replace(/\/?$/, '/');
const docsDir = join(root, 'docs/acceptance');
const outDir = join(docsDir, 'output');
const shotDir = join(docsDir, 'screenshots');
const DB_NAME = 'sma_acceptance_test';

// ---- credentials: remember their values (to scrub outputs), then remove them (NFR-04) ----
loadRootEnv();
const SECRET_NAME = /TOKEN|KEY|SECRET|PASSWORD|PASSWD|CREDENTIAL/i;
const secrets = Object.entries(process.env)
  .filter(([k, v]) => SECRET_NAME.test(k) && v && v.length >= 8)
  .map(([, v]) => v!);
if (!process.env.DATABASE_URL) throw new Error('Set DATABASE_URL (see .env.example)');
const dbUrl = new URL(process.env.DATABASE_URL);
if (dbUrl.password) secrets.push(decodeURIComponent(dbUrl.password));
for (const k of Object.keys(process.env)) if (SECRET_NAME.test(k)) delete process.env[k];
dbUrl.pathname = `/${DB_NAME}`;

const sh = (cmd: string, args: string[]) => {
  try {
    return execFileSync(cmd, args, {
      cwd: root,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
  } catch {
    return '';
  }
};

async function main(): Promise<number> {
  console.log(`Resetting database ${DB_NAME} (drop, create, migrate)…`);
  await resetTestDatabase(dbUrl.toString());
  const client = createDbClient(dbUrl.toString());
  const app = buildApp({}, { db: client.db, polling: false });
  await app.ready();
  const tmp = realpathSync(mkdtempSync(join(tmpdir(), 'sma-acceptance-')));

  const pg = await client.db.execute(sql`select version() as v`);
  const oasdiff = await checkOasdiffVersion();
  const docker = await dockerServerVersion();
  const macos = process.platform === 'darwin' ? sh('sw_vers', ['-productVersion']) : '';
  const meta: RunMeta = {
    runAt: new Date().toISOString(),
    commit: sh('git', ['rev-parse', '--short=12', 'HEAD']),
    branch: sh('git', ['rev-parse', '--abbrev-ref', 'HEAD']),
    dirty: sh('git', ['status', '--porcelain', '--', '.', ':(exclude)docs/acceptance']) !== '',
    os: `${macos ? `macOS ${macos}, ` : ''}${type()} ${release()} (${process.arch})`,
    node: process.version,
    docker: docker ?? 'not running',
    postgres: String((pg.rows[0] as { v?: string } | undefined)?.v ?? 'unknown').split(' on ')[0]!,
    oasdiff: oasdiff.ok ? oasdiff.value : `unavailable (${oasdiff.error.code})`,
    database: DB_NAME,
  };

  const ctx: Ctx = {
    root: root.replace(/\/$/, ''),
    tmp,
    dbUrl: dbUrl.toString(),
    client,
    app,
    docker,
    specs: {
      v1: readFileSync(join(root, 'demo/api/specs/v1.yaml'), 'utf8'),
      v2: readFileSync(join(root, 'demo/api/specs/v2.yaml'), 'utf8'),
      note: readFileSync(join(root, 'demo/api/migration-notes/v1-to-v2.yaml'), 'utf8'),
    },
    hostBefore: hostState(root),
    shared: {},
  };

  const only = process.argv.slice(2).filter((a) => /^AT-\d\d$/.test(a));
  const records: CheckRecord[] = [];
  let secretsFound = 0;
  // A full run replaces every output; a partial run (`npm run acceptance -- AT-02`) keeps the rest.
  if (!only.length) rmSync(outDir, { recursive: true, force: true });
  mkdirSync(outDir, { recursive: true });
  try {
    for (const def of CHECKS) {
      if (only.length && !only.includes(def.info.id)) continue;
      const r = new Recorder(def.info);
      const started = Date.now();
      console.log(`\n▶ ${def.info.id} ${def.info.title}`);
      try {
        await def.run(r, ctx);
      } catch (e) {
        r.error(e);
      }
      const clean = scrub(r.transcript(), secrets, { [tmp]: '<tmp>', [root]: '<repo>/' });
      secretsFound += clean.secretsFound;
      writeFileSync(join(outDir, `${def.info.id}.txt`), clean.text);
      console.log(clean.text);
      records.push({
        ...def.info,
        steps: r.steps.map((s) => scrub(s, secrets, { [tmp]: '<tmp>', [root]: '<repo>/' }).text),
        notRun: r.notRun,
        verdict: r.verdict(),
        reason: scrub(r.reason(), secrets).text,
        transcript: clean.text,
        durationMs: Date.now() - started,
        screenshot: false,
      });
    }
  } finally {
    await ctx.app.close();
    await ctx.client.close();
    rmSync(tmp, { recursive: true, force: true });
  }

  mkdirSync(shotDir, { recursive: true });
  const shots = await renderTerminalScreenshots(
    records.map((r) => ({ id: r.id, text: r.transcript })),
    shotDir,
  );
  for (const r of records) r.screenshot = shots.includes(r.id);

  // summary.json and README.md describe a full run only.
  if (!only.length)
    writeFileSync(
      join(outDir, 'summary.json'),
      `${JSON.stringify(
        {
          meta,
          checks: records.map(({ transcript: _t, ...rest }) => rest),
          pending: PENDING,
        },
        null,
        2,
      )}\n`,
    );
  for (const r of records) writeFileSync(join(docsDir, `${r.id}.md`), renderRecord(r, meta));
  if (!only.length) writeFileSync(join(docsDir, 'README.md'), renderReadme(records, PENDING, meta));

  console.log('\nSummary');
  for (const r of records) console.log(`  ${r.id.padEnd(6)} ${r.verdict.padEnd(8)} ${r.title}`);
  if (secretsFound) {
    console.error(
      `\n✗ ${secretsFound} credential value(s) appeared in the output and were redacted.`,
    );
    return 1;
  }
  return records.some((r) => r.verdict === 'FAIL') ? 1 : 0;
}

main().then(
  (code) => {
    process.exitCode = code;
  },
  (e: unknown) => {
    console.error(scrub(e instanceof Error ? (e.stack ?? e.message) : String(e), secrets).text);
    process.exitCode = 1;
  },
);
