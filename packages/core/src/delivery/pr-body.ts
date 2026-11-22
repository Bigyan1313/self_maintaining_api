import type { ChangeCategory } from '../domain/enums.js';
import { redactForDelivery } from './redact.js';

/** BR-03 note placed in every pull request the system opens. */
export const NEVER_MERGE_NOTE =
  'Machine-generated. Passing validation is evidence, not proof. Review before merging. This tool never merges.';

/** Longest spec before/after JSON shown in the body, per side. */
export const MAX_EVIDENCE_CHARS = 2000;
/** Longest raw validator output kept in the collapsed section (the tail is kept). */
export const MAX_RAW_OUTPUT_CHARS = 6000;
/** Hard cap on the whole body; GitHub rejects bodies over 65,536 characters. */
export const MAX_PR_BODY_CHARS = 60_000;

/**
 * Everything a pull request must show (FR-33). JSON-safe, so it can be stored with a failed
 * delivery and reused by a retry.
 */
export interface DeliveryEvidence {
  runId: string;
  /** A fixture or demonstration run is labelled as such (BR-06). */
  isFixture: boolean;
  change: {
    category: ChangeCategory;
    method: string | null;
    path: string;
    jsonPointer: string;
    before: unknown;
    after: unknown;
  };
  /** Who confirmed the mapping (BR-04): a migration-note entry, or a named human. */
  confirmation:
    | { source: 'migration_note'; noteRef: string; entry: unknown }
    | { source: 'human'; confirmedBy: string; confirmedAt: string };
  /** Located call sites the patch addresses. */
  callSites: { filePath: string; line: number; column?: number; pattern?: string }[];
  /** Files the patch changes. */
  affectedFiles: string[];
  /** Repair attempts used (1–4). */
  attempts: number;
  /** Validation of the delivered patch. */
  tests: { passed: number | null; total: number | null; rawOutput: string };
}

/** Fence longer than any backtick run inside `text`, so the content cannot close it. */
function fenced(text: string, lang = ''): string {
  const longest = Math.max(0, ...[...text.matchAll(/`+/g)].map((m) => m[0].length));
  const fence = '`'.repeat(Math.max(3, longest + 1));
  return `${fence}${lang}\n${text}\n${fence}`;
}

/** Inline code that survives backticks inside the value. */
function code(text: string): string {
  const longest = Math.max(0, ...[...text.matchAll(/`+/g)].map((m) => m[0].length));
  const ticks = '`'.repeat(longest + 1);
  return `${ticks}${longest ? ' ' : ''}${text}${longest ? ' ' : ''}${ticks}`;
}

/** JSON for display, cut to `max` characters with a visible note. */
function trimmedJson(value: unknown, max = MAX_EVIDENCE_CHARS): string {
  const text = value === undefined ? 'null' : (JSON.stringify(value, null, 2) ?? 'null');
  if (text.length <= max) return text;
  return `${text.slice(0, max)}\n… (trimmed, ${text.length - max} more characters)`;
}

/** The last `max` characters, with a visible note when something was dropped. */
function tail(text: string, max = MAX_RAW_OUTPUT_CHARS): string {
  if (text.length <= max) return text;
  return `… (trimmed, first ${text.length - max} characters omitted)\n${text.slice(-max)}`;
}

/** Plain text on one line, with markdown-active characters neutralised. */
function plain(text: string): string {
  return text.replace(/[\r\n]+/g, ' ').replace(/([\\`*_[\]<>#|])/g, '\\$1');
}

/**
 * Pull-request title: `[SMA] <category>: <METHOD> <path>`, redacted.
 * @param evidence - Delivery evidence.
 * @param knownSecrets - Exact secret values to redact (the token in use).
 */
export function buildPrTitle(
  evidence: DeliveryEvidence,
  knownSecrets: readonly string[] = [],
): string {
  const { category, method, path } = evidence.change;
  const title = `[SMA] ${category}: ${method ? `${method.toUpperCase()} ` : ''}${path}`;
  return redactForDelivery(title.replace(/[\r\n]+/g, ' '), knownSecrets).slice(0, 250);
}

/**
 * Pull-request body (FR-33, BR-03): the spec change before/after (trimmed), the migration-note
 * citation or human confirmation, the affected files and call-site lines, the attempt count,
 * the test summary with the trimmed raw output in a collapsed `<details>`, and
 * {@link NEVER_MERGE_NOTE}. Everything is passed through {@link redactForDelivery}.
 * @param evidence - Delivery evidence.
 * @param knownSecrets - Exact secret values to redact (the token in use).
 */
export function buildPrBody(
  evidence: DeliveryEvidence,
  knownSecrets: readonly string[] = [],
): string {
  const { change, confirmation, tests } = evidence;
  const confirmed =
    confirmation.source === 'migration_note'
      ? `Mapping confirmed by migration note ${code(confirmation.noteRef)}, entry:\n\n${fenced(trimmedJson(confirmation.entry), 'json')}`
      : `Mapping confirmed by ${plain(confirmation.confirmedBy)} at ${plain(confirmation.confirmedAt)}.`;
  const files = evidence.affectedFiles.length
    ? evidence.affectedFiles.map((f) => `- ${code(f)}`).join('\n')
    : '- (none)';
  const sites = evidence.callSites.length
    ? evidence.callSites
        .map(
          (s) =>
            `- ${code(`${s.filePath}:${s.line}${s.column ? `:${s.column}` : ''}`)}` +
            (s.pattern ? ` (${plain(s.pattern)})` : ''),
        )
        .join('\n')
    : '- (none)';
  const summary =
    tests.passed !== null && tests.total !== null
      ? `${tests.passed}/${tests.total} tests passed`
      : 'test counts unavailable';

  const sections = [
    `> **${NEVER_MERGE_NOTE}**`,
    ...(evidence.isFixture
      ? [
          '> This pull request comes from a **fixture / demonstration run**, not a live provider event.',
        ]
      : []),
    `## Specification change\n\n` +
      `- Category: ${code(change.category)}\n` +
      `- Operation: ${code(`${change.method ? `${change.method.toUpperCase()} ` : ''}${change.path}`)}\n` +
      `- JSON pointer: ${code(change.jsonPointer)}\n\n` +
      `Before:\n\n${fenced(trimmedJson(change.before), 'json')}\n\n` +
      `After:\n\n${fenced(trimmedJson(change.after), 'json')}`,
    `## Mapping confirmation\n\n${confirmed}`,
    `## Affected files\n\n${files}\n\nCall sites:\n\n${sites}`,
    `## Validation\n\n` +
      `- Repair attempts: ${evidence.attempts}\n` +
      `- Result: ${summary} (repository's own typecheck and tests, run unchanged in an isolated container)\n\n` +
      `<details>\n<summary>Raw validator output (trimmed)</summary>\n\n${fenced(tail(tests.rawOutput), 'text')}\n\n</details>`,
    `---\nRun ${code(evidence.runId)} · Self-Maintaining APIs. ${NEVER_MERGE_NOTE}`,
  ];
  const body = redactForDelivery(sections.join('\n\n'), knownSecrets);
  return body.length <= MAX_PR_BODY_CHARS
    ? body
    : `${body.slice(0, MAX_PR_BODY_CHARS)}\n\n… (body trimmed)\n\n${NEVER_MERGE_NOTE}`;
}
