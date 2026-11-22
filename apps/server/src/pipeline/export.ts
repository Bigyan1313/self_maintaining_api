/**
 * Run export (FR-41, DR-05): the whole run record as JSON and as one readable, self-contained
 * HTML page. Both are built from {@link RunDetail}, the same scrubbed record the Run Detail
 * endpoint returns, so an export never holds a credential (NFR-04) and always matches the DB.
 * @packageDocumentation
 */
import { mkdir, rename, rm, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { RunDetail } from '@sma/core';

/** Default folder for saved exports (gitignored). */
export const DEFAULT_EXPORT_DIR = fileURLToPath(new URL('../../../../exports', import.meta.url));

/** Banner shown on a fixture or demonstration run (BR-06). */
export const FIXTURE_BANNER = 'FIXTURE / DEMO RUN';

/** A copy of JSON data with object keys sorted at every level (stable key order). */
export function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value && typeof value === 'object')
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((k) => [k, sortKeys((value as Record<string, unknown>)[k])]),
    );
  return value;
}

/**
 * The JSON export: the run detail with stable (sorted) key order, two-space indented.
 * @param detail - A loaded run detail.
 */
export function exportRunJson(detail: RunDetail): string {
  return `${JSON.stringify(sortKeys(detail), null, 2)}\n`;
}

/**
 * HTML-escapes any value (non-strings are JSON-encoded first).
 * @param value - Text or data to show.
 */
export function escapeHtml(value: unknown): string {
  const text =
    typeof value === 'string'
      ? value
      : value === undefined
        ? ''
        : (JSON.stringify(value, null, 2) ?? String(value));
  return text
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

const e = escapeHtml;
const pre = (v: unknown) => `<pre>${e(v ?? '')}</pre>`;
const labeled = (v: { value: string; label: string } | null | undefined) =>
  v ? `${e(v.label)} <code>${e(v.value)}</code>` : '<em>none</em>';

function table(headers: string[], rows: string[][]): string {
  if (!rows.length) return '<p><em>None recorded.</em></p>';
  const head = headers.map((h) => `<th scope="col">${e(h)}</th>`).join('');
  const body = rows.map((r) => `<tr>${r.map((c) => `<td>${c}</td>`).join('')}</tr>`).join('\n');
  return `<table><thead><tr>${head}</tr></thead><tbody>\n${body}\n</tbody></table>`;
}

function dl(items: [string, string][]): string {
  return `<dl>${items.map(([k, v]) => `<dt>${e(k)}</dt><dd>${v}</dd>`).join('')}</dl>`;
}

const CSS = `
body{font:15px/1.5 system-ui,-apple-system,Segoe UI,sans-serif;margin:0;padding:16px;background:#fff;color:#1a1a1a;max-width:1100px}
h1{font-size:1.5rem;margin:.2em 0}h2{font-size:1.15rem;margin-top:1.8em;border-bottom:1px solid #ccc;padding-bottom:.2em}
.banner{background:#fff3cd;border:2px solid #8a6d00;color:#4d3d00;padding:8px 12px;font-weight:700;letter-spacing:.05em}
.outcome{font-size:1.2rem;font-weight:700;border:2px solid currentColor;display:inline-block;padding:2px 10px;margin:8px 0}
pre{background:#f5f5f5;border:1px solid #ddd;padding:8px;overflow-x:auto;white-space:pre-wrap;word-break:break-word;font-size:13px}
table{border-collapse:collapse;width:100%;font-size:14px}th,td{border:1px solid #ccc;padding:4px 6px;text-align:left;vertical-align:top}
th{background:#eee}dl{display:grid;grid-template-columns:max-content 1fr;gap:2px 12px}dt{font-weight:600}dd{margin:0}
code{font-size:12px;color:#444}
@media (prefers-color-scheme:dark){body{background:#141414;color:#e6e6e6}pre{background:#1f1f1f;border-color:#333}th{background:#262626}th,td{border-color:#444}code{color:#bbb}.banner{background:#3d3000;color:#ffe08a;border-color:#ffe08a}}
`;

/**
 * The HTML export: one self-contained page (inline CSS, no scripts, no external requests; a
 * Content-Security-Policy forbids both). Every stored value is HTML-escaped. Sections: summary
 * with a text-labelled outcome, spec evidence, mapping source, stage results, call sites,
 * coverage, attempts, each attempt's patch and validation output, and the PR link or the
 * reason none exists. A fixture run carries a {@link FIXTURE_BANNER} banner (BR-06).
 * @param detail - A loaded run detail.
 */
export function renderRunHtml(detail: RunDetail): string {
  const { run, change, migrationNote: note } = detail;
  const out: string[] = [];
  if (run.isFixture)
    out.push(
      `<p class="banner" role="note">${FIXTURE_BANNER}: fixture data, not a live provider event.</p>`,
    );
  out.push(`<h1>Run report <code>${e(run.id)}</code></h1>`);
  out.push(`<p class="outcome">Outcome: ${e(run.status.label)}</p>`);

  out.push('<h2>Summary</h2>');
  out.push(
    dl([
      ['Status', labeled(run.status)],
      ['Stage reached', labeled(run.stageReached)],
      ['Failure stage', labeled(run.failureStage)],
      ['Failure detail', run.failureDetail ? e(run.failureDetail) : '<em>none</em>'],
      ['Flagged reason', run.flaggedReason ? e(run.flaggedReason) : '<em>none</em>'],
      ['Change', `${labeled(change.category)}: ${e(change.method ?? '')} ${e(change.path)}`],
      ['Classification', `${labeled(change.classification)} (confidence ${e(change.confidence)})`],
      ['Repository commit', `<code>${e(run.commitSha)}</code>`],
      ['Parent run', run.parentRunId ? `<code>${e(run.parentRunId)}</code>` : '<em>none</em>'],
      ['Attempts', e(run.attemptCount)],
      ['Tokens (in / out)', `${e(run.tokensIn)} / ${e(run.tokensOut)}`],
      ['Cost (USD)', e(run.costUsd)],
      ['Model', run.modelId ? e(run.modelId) : '<em>none</em>'],
      ['Fixture run', run.isFixture ? 'Yes (demonstration)' : 'No'],
      ['Started', e(run.startedAt)],
      ['Finished', run.finishedAt ? e(run.finishedAt) : '<em>still running</em>'],
    ]),
  );

  out.push('<h2>Pull request</h2>');
  if (run.prUrl && /^https:\/\//.test(run.prUrl))
    out.push(
      `<p>Pull request (awaiting human review, never merged by this tool): <a href="${e(run.prUrl)}">${e(run.prUrl)}</a></p>`,
    );
  else
    out.push(
      `<p>No pull request. Reason: ${e(run.flaggedReason ?? run.failureDetail ?? (run.finishedAt ? 'none recorded' : 'the run has not finished'))}</p>`,
    );

  out.push('<h2>Specification evidence</h2>');
  out.push(
    dl([
      ['oasdiff rule', `<code>${e(change.oasdiffRuleId)}</code>`],
      ['JSON pointer', `<code>${e(change.jsonPointer)}</code>`],
    ]),
  );
  out.push(
    '<h3>Before</h3>',
    pre(change.evidenceBefore),
    '<h3>After</h3>',
    pre(change.evidenceAfter),
  );

  out.push('<h2>Mapping source</h2>');
  out.push(
    dl([
      ['Mapping status', labeled(change.mappingStatus)],
      ['Confirmed by', labeled(change.mappingSource)],
      ['Confirmed by (person)', change.confirmedBy ? e(change.confirmedBy) : '<em>none</em>'],
      ['Confirmed at', change.confirmedAt ? e(change.confirmedAt) : '<em>none</em>'],
    ]),
  );
  out.push('<h3>Mapping</h3>', pre(change.mapping));
  if (note)
    out.push(
      `<h3>Migration note <code>${e(note.id)}</code> (uploaded ${e(note.uploadedAt)})</h3>`,
      pre(note.rawYaml),
    );

  out.push('<h2>Stage results</h2>');
  out.push(
    table(
      ['Stage', 'Status', 'Started', 'Finished', 'Result'],
      detail.stageResults.map((r) => [
        labeled(r.stage),
        labeled(r.status),
        e(r.startedAt),
        e(r.finishedAt),
        pre(r.result),
      ]),
    ),
  );

  out.push('<h2>Call sites</h2>');
  out.push(
    table(
      ['File', 'Line', 'Column', 'Pattern', 'Excerpt'],
      detail.callSites.map((s) => [
        `<code>${e(s.filePath)}</code>`,
        e(s.line),
        e(s.column),
        labeled(s.pattern),
        pre(s.excerpt),
      ]),
    ),
  );

  out.push('<h2>Coverage</h2>');
  out.push(
    table(
      ['File', 'Inspected', 'Skip reason'],
      detail.coverage.map((c) => [
        `<code>${e(c.filePath)}</code>`,
        c.inspected ? 'Inspected' : 'Skipped',
        c.skipReason ? e(c.skipReason) : '',
      ]),
    ),
  );

  out.push('<h2>Attempts</h2>');
  out.push(
    table(
      [
        '#',
        'Outcome',
        'Guard',
        'Compile errors',
        'Tests',
        'Tokens in/out',
        'Cost',
        'Model',
        'Duration (ms)',
      ],
      detail.attempts.map((a) => [
        e(a.attemptNumber),
        labeled(a.outcome),
        labeled(a.guardName),
        e(a.compileErrors ?? 'n/a'),
        `${e(a.testsPassed ?? 'n/a')} / ${e(a.testsTotal ?? 'n/a')}`,
        `${e(a.tokensIn)} / ${e(a.tokensOut)}`,
        e(a.costUsd),
        e(a.modelId),
        e(a.durationMs),
      ]),
    ),
  );

  for (const a of detail.attempts) {
    out.push(`<h2>Attempt ${e(a.attemptNumber)}: ${e(a.outcome.label)}</h2>`);
    out.push('<h3>Patch</h3>', a.patch ? pre(a.patch) : '<p><em>No patch.</em></p>');
    out.push('<h3>Validation output</h3>', pre(a.validationOutput ?? 'No validation output.'));
  }
  if (!detail.attempts.length)
    out.push('<h2>Patch</h2><p><em>No repair attempt was made.</em></p>');

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'">
<title>Run report ${e(run.id)}</title>
<style>${CSS}</style>
</head>
<body>
${out.join('\n')}
</body>
</html>
`;
}

/** A report that could not be written (DR-05). Nothing is marked saved. */
export class ExportWriteError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ExportWriteError';
  }
}

/** What a successful save returns. `saved` is `true` only when both files are in place. */
export interface SavedExport {
  saved: true;
  json: string;
  html: string;
}

/**
 * Writes `run-<id>.json` and `run-<id>.html` into `dir` (DR-05). Each file is written to a
 * temporary name first and renamed into place only after **both** were written, so a failure
 * leaves no partial report. Any failure throws {@link ExportWriteError} and the report is not
 * reported as saved.
 * @param detail - A loaded run detail.
 * @param dir - Target folder (default {@link DEFAULT_EXPORT_DIR}).
 */
export async function writeRunExport(
  detail: RunDetail,
  dir: string = DEFAULT_EXPORT_DIR,
): Promise<SavedExport> {
  const root = resolve(dir);
  const base = join(root, `run-${detail.run.id}`);
  const files = [
    { final: `${base}.json`, temp: `${base}.json.tmp-${process.pid}`, body: exportRunJson(detail) },
    { final: `${base}.html`, temp: `${base}.html.tmp-${process.pid}`, body: renderRunHtml(detail) },
  ];
  const placed: string[] = [];
  try {
    await mkdir(root, { recursive: true });
    for (const f of files) await writeFile(f.temp, f.body, { encoding: 'utf8', flag: 'w' });
    for (const f of files) {
      await rename(f.temp, f.final);
      placed.push(f.final);
    }
  } catch (cause) {
    // No half-saved report: remove temporaries and anything this call already put in place.
    await Promise.all(
      [...files.map((f) => f.temp), ...placed].map((p) =>
        rm(p, { force: true }).catch(() => undefined),
      ),
    );
    const code = (cause as { code?: string }).code;
    throw new ExportWriteError(
      `Could not write the run report${code ? ` (${code})` : ''}; it was not saved.`,
    );
  }
  return { saved: true, json: files[0]!.final, html: files[1]!.final };
}
